import { z } from "zod";
import { db, one, many, audit, nextCounter, type Queryable } from "../db/index.ts";
import { hashPassword, randomPin, requireStaff } from "../auth.ts";
import {
  bad, notFound, pageParams, zCurrency, zDate, zId, zMethod, zMoney, zPhone, normalizePhone, type Router,
} from "../http.ts";
import { addDays, daysBetween, gymRate, gymToday, toUsd, type Currency } from "../services/money.ts";
import { waLink } from "../services/whatsapp.ts";
import { config } from "../config.ts";
import { parseCsv, toCsv } from "../services/text.ts";
import { receiptForStaff } from "../services/receipt.ts";
import { notify } from "../services/notify.ts";
import { creditReferral, linkNewMember, refreshProgress } from "./community.ts";

const memberSchema = z.object({
  first_name: z.string().trim().min(1).max(60),
  last_name: z.string().trim().max(60).default(""),
  phone: zPhone.nullable().optional(),
  email: z.string().trim().email().max(120).nullable().optional().or(z.literal("").transform(() => null)),
  gender: z.enum(["male", "female"]).nullable().optional(),
  birth_date: zDate.nullable().optional().or(z.literal("").transform(() => null)),
  emergency_contact: z.string().max(120).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  source: z.string().max(40).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
  whatsapp_opt_in: z.boolean().optional(),
});

const paymentInput = z.object({
  amount: zMoney.refine((n) => n > 0, "amount must be positive"),
  currency: zCurrency,
  method: zMethod,
  reference: z.string().max(80).nullable().optional(),
  note: z.string().max(300).nullable().optional(),
});

export async function getOverview(q: Queryable, gymId: string, memberId: string) {
  const m = await one(q, "SELECT o.*, mm.referred_by FROM member_overview o JOIN members mm ON mm.id = o.id WHERE o.id = $1 AND o.gym_id = $2", [memberId, gymId]);
  if (!m) throw notFound("member");
  return m;
}

export async function recordPayment(
  q: Queryable,
  gymId: string,
  userId: string | null,
  p: {
    member_id: string | null; membership_id?: string | null; pt_package_id?: string | null; sale_id?: string | null;
    amount: number; currency: Currency; method: string; reference?: string | null; note?: string | null;
    /** exact USD value when the payment settles a USD total paid in rounded lira */
    amount_usd?: number;
  },
) {
  const rate = await gymRate(q, gymId);
  const receipt = await nextCounter(q, gymId, "receipt", 1001);
  const pay = await one(
    q,
    `INSERT INTO payments (gym_id, member_id, membership_id, pt_package_id, sale_id, amount, currency, lbp_rate, amount_usd, method, reference, note, receipt_no, received_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [gymId, p.member_id, p.membership_id ?? null, p.pt_package_id ?? null, p.sale_id ?? null, p.amount, p.currency, rate,
      p.amount_usd ?? toUsd(p.amount, p.currency, rate), p.method, p.reference ?? null, p.note ?? null, receipt, userId],
  );
  if (pay && p.member_id) await notifyPayment(q, gymId, pay);
  return pay;
}

async function notifyPayment(q: Queryable, gymId: string, pay: any) {
  const amount = pay.currency === "LBP" ? `${Math.round(Number(pay.amount)).toLocaleString("en-US")} LBP` : `$${Number(pay.amount).toFixed(2)}`;
  await notify(q, {
    gymId, memberId: pay.member_id, kind: "receipt", title: "Payment received ✅",
    body: `${amount} — receipt #${pay.receipt_no}. Tap to view it.`, url: `/r/${pay.public_token}`, dedupeKey: `pay:${pay.id}`,
  });
}

/** Sells a new membership or renews: a renewal starts the day after the current one ends. */
export async function sellMembership(
  q: Queryable,
  gymId: string,
  userId: string | null,
  memberId: string,
  input: { plan_id: string; start_date?: string | null; discount?: number; notes?: string | null; payment?: z.infer<typeof paymentInput> | null },
) {
  const member = await getOverview(q, gymId, memberId);
  if (member.archived_at) throw bad("member_archived", "This member is archived");
  const plan = await one(q, "SELECT * FROM plans WHERE id = $1 AND gym_id = $2 AND active", [input.plan_id, gymId]);
  if (!plan) throw notFound("plan");
  if (plan.gender_restriction && member.gender && plan.gender_restriction !== member.gender) {
    throw bad("plan_gender_mismatch", `This plan is for ${plan.gender_restriction} members only`);
  }
  const today = await gymToday(q, gymId);
  let start = input.start_date ?? today;
  if (!input.start_date && member.end_date && member.status !== "expired" && member.status !== "none" && member.end_date >= today) {
    start = addDays(member.end_date, 1);
  }
  const end = addDays(start, plan.duration_days - 1);
  const discount = Math.min(input.discount ?? 0, Number(plan.price));
  const rate = await gymRate(q, gymId);
  const ms = await one(
    q,
    `INSERT INTO memberships (gym_id, member_id, plan_id, plan_name, start_date, end_date, visits_total, price, discount, price_usd, currency,
                              freeze_days_allowed, includes_classes, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [gymId, memberId, plan.id, plan.name, start, end, plan.kind === "visits" ? plan.visits : null, plan.price, discount,
      toUsd(Number(plan.price) - discount, plan.currency, rate), plan.currency, plan.freeze_days_allowed, plan.includes_classes, input.notes ?? null, userId],
  );
  let payment = null;
  if (input.payment) payment = await recordPayment(q, gymId, userId, { member_id: memberId, membership_id: ms!.id, ...input.payment });
  await audit(q, gymId, userId, "membership.sell", "membership", ms!.id, { plan: plan.name, start, end, discount });
  return { membership: ms, payment };
}

async function createMember(q: Queryable, gymId: string, b: z.infer<typeof memberSchema>) {
  if (b.phone) {
    const dup = await one(q, "SELECT id, code, first_name, last_name FROM members WHERE gym_id = $1 AND phone = $2 AND archived_at IS NULL", [gymId, b.phone]);
    if (dup) throw bad("duplicate_phone", `This phone already belongs to #${dup.code} ${dup.first_name} ${dup.last_name}`, { memberId: dup.id });
  }
  const code = await nextCounter(q, gymId, "member", 1001);
  return one(
    q,
    `INSERT INTO members (gym_id, code, first_name, last_name, phone, email, gender, birth_date, emergency_contact, notes, source, tags, whatsapp_opt_in)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id, code`,
    [gymId, code, b.first_name, b.last_name, b.phone ?? null, b.email ?? null, b.gender ?? null, b.birth_date ?? null,
      b.emergency_contact ?? null, b.notes ?? null, b.source ?? null, b.tags ?? [], b.whatsapp_opt_in ?? true],
  );
}

// ---------- check-in ----------

export interface CheckinResult {
  result: "ok" | "denied";
  reason: string | null;
  warnings: string[];
  member: any;
  duplicate?: boolean;
}

function minutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export async function performCheckin(
  q: Queryable,
  gymId: string,
  userId: string | null,
  ref: { token?: string; code?: number; member_id?: string },
  method: "qr" | "manual" | "app",
): Promise<CheckinResult> {
  let memberId: string | null = null;
  if (ref.member_id) memberId = ref.member_id;
  else if (ref.token) {
    const tok = ref.token.trim().replace(/^GMS:/i, "");
    const r = await one(q, "SELECT id FROM members WHERE gym_id = $1 AND qr_token = $2", [gymId, tok]);
    memberId = r?.id ?? null;
  } else if (ref.code) {
    const r = await one(q, "SELECT id FROM members WHERE gym_id = $1 AND code = $2", [gymId, ref.code]);
    memberId = r?.id ?? null;
  }
  if (!memberId) throw notFound("member");
  const m = await getOverview(q, gymId, memberId);
  const gym = await one(q, "SELECT settings, (now() AT TIME ZONE timezone) AS local_now FROM gyms WHERE id = $1", [gymId]);
  const rules = { graceDays: 0, blockOnBalance: false, cooldownMinutes: 60, ...(gym.settings?.checkin ?? {}) };
  const warnings: string[] = [];
  let reason: string | null = null;

  if (m.archived_at) reason = "archived";
  else if (m.status === "none") reason = "no_membership";
  else if (m.status === "frozen") reason = "frozen";
  else if (m.status === "upcoming") reason = "not_started";
  else if (m.status === "expired") {
    const visitsLeft = m.visits_total == null || m.visits_used < m.visits_total;
    const withinGrace = m.days_left !== null && -m.days_left <= rules.graceDays;
    if (visitsLeft && withinGrace) warnings.push("grace_period");
    else reason = m.visits_total != null && m.visits_used >= m.visits_total ? "no_visits_left" : "expired";
  }

  // Ladies-only hours (common in Lebanese gyms)
  if (!reason && m.gender === "male") {
    const local = new Date(gym.local_now);
    const day = local.getUTCDay();
    const now = local.getUTCHours() * 60 + local.getUTCMinutes();
    const slot = (gym.settings?.ladiesHours ?? []).find((s: any) => s.day === day && now >= minutes(s.from) && now < minutes(s.to));
    if (slot) reason = "ladies_hours";
  }

  const balance = Number(m.balance_usd ?? 0);
  if (!reason && balance > 0.009) {
    if (rules.blockOnBalance) reason = "unpaid_balance";
    else warnings.push("unpaid_balance");
  }
  if (!reason && m.status === "expiring") warnings.push("expiring_soon");

  let duplicate = false;
  if (!reason && rules.cooldownMinutes > 0) {
    const recent = await one(q, `SELECT 1 FROM checkins WHERE member_id = $1 AND result = 'ok' AND at > now() - ($2 || ' minutes')::interval`, [memberId, String(rules.cooldownMinutes)]);
    duplicate = !!recent;
  }

  if (!duplicate) {
    await q.query(
      `INSERT INTO checkins (gym_id, member_id, membership_id, method, result, reason, by_user) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [gymId, memberId, m.membership_id, method, reason ? "denied" : "ok", reason, userId],
    );
    if (!reason) {
      if (m.visits_total != null) await q.query("UPDATE memberships SET visits_used = visits_used + 1 WHERE id = $1", [m.membership_id]);
      // a booked class starting around now is marked attended
      await q.query(
        `UPDATE bookings b SET status = 'attended' FROM class_sessions s
          WHERE b.session_id = s.id AND b.member_id = $1 AND b.status = 'booked'
            AND s.starts_at BETWEEN now() - interval '30 minutes' AND now() + interval '90 minutes'`,
        [memberId],
      );
    }
  }
  const fresh = await getOverview(q, gymId, memberId);
  return { result: reason ? "denied" : "ok", reason, warnings, member: fresh, duplicate };
}

// ---------- routes ----------

export function registerMembers(r: Router) {
  r.get("/api/members", async (ctx) => {
    const u = await requireStaff(ctx);
    const { limit, offset } = pageParams(ctx.query, 500);
    const where = ["gym_id = $1"];
    const vals: unknown[] = [u.gymId];
    const status = ctx.query.get("status");
    if (ctx.query.get("archived") === "1") where.push("archived_at IS NOT NULL");
    else where.push("archived_at IS NULL");
    if (status && ["active", "expiring", "expired", "frozen", "none", "upcoming"].includes(status)) {
      vals.push(status);
      where.push(`status = $${vals.length}`);
    }
    if (ctx.query.get("balance") === "1") where.push("balance_usd > 0.009");
    if (ctx.query.get("risk") === "1") where.push("churn_score >= 0.6 AND status IN ('active','expiring')");
    const qs = ctx.query.get("q")?.trim();
    if (qs) {
      const digits = qs.replace(/\D/g, "");
      vals.push(`%${qs}%`);
      const n = vals.length;
      const conds = [`(first_name || ' ' || last_name) ILIKE $${n}`, `email ILIKE $${n}`];
      if (digits.length >= 3) {
        vals.push(`%${digits.replace(/^0/, "")}%`);
        conds.push(`phone LIKE $${vals.length}`);
      }
      if (/^\d{1,7}$/.test(qs)) {
        vals.push(Number(qs));
        conds.push(`code = $${vals.length}`);
      }
      where.push(`(${conds.join(" OR ")})`);
    }
    const tag = ctx.query.get("tag");
    if (tag) {
      vals.push(tag);
      where.push(`$${vals.length} = ANY(tags)`);
    }
    const sort = ({
      name: "first_name, last_name",
      end: "end_date NULLS LAST",
      recent: "created_at DESC",
      risk: "churn_score DESC NULLS LAST",
      balance: "balance_usd DESC",
      code: "code",
    } as Record<string, string>)[ctx.query.get("sort") ?? "recent"] ?? "created_at DESC";
    const rows = await many(db, `SELECT *, count(*) OVER () AS total FROM member_overview WHERE ${where.join(" AND ")} ORDER BY ${sort} LIMIT ${limit} OFFSET ${offset}`, vals);
    const counts = await many(db, `SELECT status, count(*)::int AS n FROM member_overview WHERE gym_id = $1 AND archived_at IS NULL GROUP BY status`, [u.gymId]);
    return { total: rows[0]?.total ?? 0, rows: rows.map(({ total, ...r }) => r), counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) };
  });

  r.post("/api/members", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager", "reception"]);
    const b = await ctx.body(memberSchema.extend({
      membership: z.object({ plan_id: zId, start_date: zDate.nullable().optional(), discount: zMoney.optional(), payment: paymentInput.nullable().optional() }).nullable().optional(),
      lead_id: zId.nullable().optional(),
      referred_by: zId.nullable().optional(),
    }));
    const out = await db.tx(async (q) => {
      const { referred_by, ...fields } = b;
      const m = await createMember(q, u.gymId, { ...fields, source: referred_by ? "referral" : fields.source });
      let sale: Awaited<ReturnType<typeof sellMembership>> | null = null;
      if (b.membership) sale = await sellMembership(q, u.gymId, u.id, m!.id, b.membership);
      // converts the lead (by id, or the open lead with the same phone) and credits whoever invited them
      await linkNewMember(q, u.gymId, m!.id, b.phone ?? null, b.lead_id ?? null, referred_by ?? null);
      await audit(q, u.gymId, u.id, "member.create", "member", m!.id);
      return { id: m!.id, code: m!.code, sale };
    });
    return out;
  });

  r.get("/api/members/export.csv", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const rows = await many(db, `SELECT code, first_name, last_name, phone, email, gender, birth_date, status, plan_name, start_date, end_date, balance_usd, last_checkin, created_at FROM member_overview WHERE gym_id = $1 AND archived_at IS NULL ORDER BY code`, [u.gymId]);
    ctx.res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="members.csv"' });
    ctx.res.end("﻿" + toCsv(rows));
    return undefined;
  });

  /**
   * Bulk import from the gym's existing Excel/CSV (exported as CSV).
   * Columns (header row, any order): first_name, last_name, phone, gender, email, plan, end_date, notes
   */
  r.post("/api/members/import", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const b = await ctx.body(z.object({ csv: z.string().min(1).max(2_000_000), dryRun: z.boolean().default(false) }));
    const rows = parseCsv(b.csv);
    if (rows.length < 2) throw bad("empty_csv", "The file has no data rows");
    const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
    const col = (name: string, ...alts: string[]) => [name, ...alts].map((n) => header.indexOf(n)).find((i) => i >= 0) ?? -1;
    const idx = {
      first: col("first_name", "firstname", "name", "first"), last: col("last_name", "lastname", "surname", "last"),
      phone: col("phone", "mobile", "tel", "whatsapp"), gender: col("gender", "sex"), email: col("email"),
      plan: col("plan", "membership", "subscription"), end: col("end_date", "expiry", "expires", "end"), notes: col("notes", "note", "comments"),
    };
    if (idx.first < 0) throw bad("missing_column", "A 'first_name' (or 'name') column is required");
    const report = { created: 0, skipped: [] as { line: number; reason: string }[] };
    await db.tx(async (q) => {
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const get = (k: keyof typeof idx) => (idx[k] >= 0 ? (row[idx[k]] ?? "").trim() : "");
        if (!get("first")) { if (row.some((c) => c.trim())) report.skipped.push({ line: i + 1, reason: "missing name" }); continue; }
        let first = get("first");
        let last = get("last");
        if (idx.last < 0 && first.includes(" ")) {
          const parts = first.split(/\s+/);
          first = parts.shift()!;
          last = parts.join(" ");
        }
        const g = get("gender").toLowerCase();
        const gender = /^(f|female|woman|أنثى|انثى)/.test(g) ? "female" : /^(m|male|man|ذكر)/.test(g) ? "male" : null;
        const phoneRaw = get("phone");
        const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
        if (phone && !/^\+\d{8,15}$/.test(phone)) { report.skipped.push({ line: i + 1, reason: `invalid phone ${phoneRaw}` }); continue; }
        if (phone) {
          const dup = await one(q, "SELECT 1 FROM members WHERE gym_id = $1 AND phone = $2 AND archived_at IS NULL", [u.gymId, phone]);
          if (dup) { report.skipped.push({ line: i + 1, reason: `duplicate phone ${phone}` }); continue; }
        }
        const endRaw = get("end");
        const end = parseLooseDate(endRaw);
        if (endRaw && !end) { report.skipped.push({ line: i + 1, reason: `unreadable end date ${endRaw}` }); continue; }
        if (b.dryRun) { report.created++; continue; }
        const m = await createMember(q, u.gymId, { first_name: first, last_name: last, phone, gender, email: get("email") || null, notes: get("notes") || null, source: "import" });
        if (end) {
          const planName = get("plan") || "Imported membership";
          const start = addDays(end, -29) < "2000-01-01" ? end : addDays(end, -29);
          await q.query(
            `INSERT INTO memberships (gym_id, member_id, plan_name, start_date, end_date, price, discount, price_usd, currency, notes, created_by)
             VALUES ($1,$2,$3,$4,$5,0,0,0,'USD','Imported from previous system',$6)`,
            [u.gymId, m!.id, planName, start, end, u.id],
          );
        }
        report.created++;
      }
      if (!b.dryRun) await audit(q, u.gymId, u.id, "member.import", "member", undefined, { created: report.created });
    });
    return report;
  });

  r.get("/api/members/:id", async (ctx) => {
    const u = await requireStaff(ctx);
    const id = zId.parse(ctx.params.id);
    const m = await getOverview(db, u.gymId, id);
    const [memberships, payments, checkins, bookings, pt, programs, messages, churn, notifications, push] = await Promise.all([
      many(db, "SELECT * FROM memberships WHERE member_id = $1 ORDER BY start_date DESC", [id]),
      many(db, "SELECT p.*, us.name AS received_by_name FROM payments p LEFT JOIN users us ON us.id = p.received_by WHERE p.member_id = $1 ORDER BY paid_at DESC", [id]),
      many(db, "SELECT * FROM checkins WHERE member_id = $1 ORDER BY at DESC LIMIT 60", [id]),
      many(db, `SELECT b.*, s.starts_at, ct.name AS class_name FROM bookings b JOIN class_sessions s ON s.id = b.session_id JOIN class_types ct ON ct.id = s.class_type_id
                 WHERE b.member_id = $1 ORDER BY s.starts_at DESC LIMIT 30`, [id]),
      many(db, `SELECT p.*, us.name AS coach_name FROM pt_packages p LEFT JOIN users us ON us.id = p.coach_id WHERE p.member_id = $1 ORDER BY created_at DESC`, [id]),
      many(db, `SELECT p.*, us.name AS coach_name FROM programs p LEFT JOIN users us ON us.id = p.coach_id WHERE p.member_id = $1 ORDER BY created_at DESC`, [id]),
      many(db, "SELECT * FROM messages WHERE member_id = $1 ORDER BY created_at DESC LIMIT 30", [id]),
      one(db, "SELECT * FROM churn_scores WHERE member_id = $1", [id]),
      many(db, "SELECT id, kind, title, body, status, devices, created_at, read_at FROM notifications WHERE member_id = $1 ORDER BY created_at DESC LIMIT 30", [id]),
      one(db, "SELECT count(*)::int AS devices FROM push_subscriptions WHERE member_id = $1", [id]),
    ]);
    // sequential after the batch: who brought them, and the friends they brought
    const referrer = m.referred_by ? await one(db, "SELECT id, code, first_name, last_name FROM members WHERE id = $1", [m.referred_by]) : null;
    const referred = await many(db, "SELECT id, code, first_name, last_name, created_at FROM members WHERE referred_by = $1 AND gym_id = $2 ORDER BY created_at DESC LIMIT 20", [id, u.gymId]);
    const visits30 = checkins.filter((c) => c.result === "ok" && Date.now() - new Date(c.at).getTime() < 30 * 86400000).length;
    return { ...m, memberships, payments, checkins, bookings, pt, programs, messages, churn, visits30, notifications, push_devices: push.devices, referrer, referred };
  });

  r.put("/api/members/:id", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager", "reception"]);
    const id = zId.parse(ctx.params.id);
    const { referred_by, ...b } = await ctx.body(memberSchema.partial().extend({ referred_by: zId.nullable().optional() }));
    const before = await getOverview(db, u.gymId, id);
    if (b.phone) {
      const dup = await one(db, "SELECT code FROM members WHERE gym_id = $1 AND phone = $2 AND id <> $3 AND archived_at IS NULL", [u.gymId, b.phone, id]);
      if (dup) throw bad("duplicate_phone", `This phone already belongs to member #${dup.code}`);
    }
    const sets: string[] = [];
    const vals: unknown[] = [id, u.gymId];
    for (const [k, v] of Object.entries(b)) {
      if (v === undefined) continue;
      vals.push(v);
      sets.push(`${k} = $${vals.length}`);
    }
    await db.tx(async (q) => {
      if (sets.length) await q.query(`UPDATE members SET ${sets.join(", ")} WHERE id = $1 AND gym_id = $2`, vals);
      // "Referred by": credit a new referrer (tells them, badge); clearing or changing it fixes a mistake quietly
      if (referred_by !== undefined && referred_by !== before.referred_by) {
        if (referred_by && !before.referred_by) {
          await creditReferral(q, u.gymId, id, referred_by);
          if (!b.source) await q.query("UPDATE members SET source = 'referral' WHERE id = $1", [id]);
        } else {
          if (referred_by) {
            if (referred_by === id) throw bad("self_referral", "A member cannot refer themselves");
            const ok = await one(q, "SELECT 1 FROM members WHERE id = $1 AND gym_id = $2", [referred_by, u.gymId]);
            if (!ok) throw bad("unknown_referrer", "The member who referred them was not found");
          }
          await q.query("UPDATE members SET referred_by = $2 WHERE id = $1", [id, referred_by]);
        }
      }
    });
    await audit(db, u.gymId, u.id, "member.update", "member", id, { fields: [...Object.keys(b), ...(referred_by !== undefined ? ["referred_by"] : [])] });
    return getOverview(db, u.gymId, id);
  });

  r.post("/api/members/:id/archive", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const id = zId.parse(ctx.params.id);
    const b = await ctx.body(z.object({ archived: z.boolean() }));
    const r2 = await db.query(`UPDATE members SET archived_at = ${b.archived ? "now()" : "NULL"} WHERE id = $1 AND gym_id = $2`, [id, u.gymId]);
    if (!r2.rowCount) throw notFound("member");
    if (b.archived) await db.query("DELETE FROM sessions WHERE member_id = $1", [id]);
    await audit(db, u.gymId, u.id, b.archived ? "member.archive" : "member.restore", "member", id);
    return { ok: true };
  });

  r.post("/api/members/:id/rotate-qr", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager", "reception"]);
    const row = await one(db, `UPDATE members SET qr_token = encode(gen_random_bytes(12), 'hex') WHERE id = $1 AND gym_id = $2 RETURNING qr_token`, [zId.parse(ctx.params.id), u.gymId]);
    if (!row) throw notFound("member");
    return row;
  });

  /** Gives the member access to the member app: generates a PIN and a ready-to-send WhatsApp message. */
  r.post("/api/members/:id/app-access", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager", "reception"]);
    const id = zId.parse(ctx.params.id);
    const m = await getOverview(db, u.gymId, id);
    if (!m.phone) throw bad("phone_required", "Add a phone number first: members sign in with phone + PIN");
    const pin = randomPin();
    await db.query("UPDATE members SET pin_hash = $2 WHERE id = $1", [id, await hashPassword(pin)]);
    await db.query("DELETE FROM sessions WHERE member_id = $1", [id]);
    const gym = await one(db, "SELECT slug, name FROM gyms WHERE id = $1", [u.gymId]);
    // the link opens a guide that installs the app on the member's phone (iPhone or Android), then sign-in
    const url = `${config.publicUrl}/m/${gym.slug}/install`;
    const text = `Hi ${m.first_name}! Your ${gym.name} app is ready 💪\n${url}\nPhone: ${m.phone}\nPIN: ${pin}\n\nOpen the link, add the app to your home screen, then sign in: your entry QR code, classes and membership in one tap.`;
    await audit(db, u.gymId, u.id, "member.app_access", "member", id);
    return { pin, url, whatsappLink: waLink(m.phone, text), text };
  });

  // ---------- memberships ----------
  r.post("/api/members/:id/memberships", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager", "reception"]);
    const b = await ctx.body(z.object({
      plan_id: zId,
      start_date: zDate.nullable().optional(),
      discount: zMoney.optional(),
      notes: z.string().max(500).nullable().optional(),
      payment: paymentInput.nullable().optional(),
    }));
    return db.tx((q) => sellMembership(q, u.gymId, u.id, zId.parse(ctx.params.id), b));
  });

  r.post("/api/memberships/:id/freeze", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager", "reception"]);
    const b = await ctx.body(z.object({ from: zDate, until: zDate, override: z.boolean().default(false) }));
    return db.tx(async (q) => {
      const ms = await one(q, "SELECT * FROM memberships WHERE id = $1 AND gym_id = $2 AND status = 'active' FOR UPDATE", [zId.parse(ctx.params.id), u.gymId]);
      if (!ms) throw notFound("membership");
      if (ms.frozen_from && ms.frozen_until >= (await gymToday(q, u.gymId))) throw bad("already_frozen", "This membership already has a freeze. Unfreeze it first.");
      const days = daysBetween(b.from, b.until) + 1;
      if (days < 1) throw bad("invalid_range", "The freeze must end after it starts");
      if (b.from < (await gymToday(q, u.gymId))) throw bad("past_freeze", "A freeze cannot start in the past");
      if (b.from > ms.end_date) throw bad("after_end", "The freeze starts after the membership ends");
      const left = ms.freeze_days_allowed - ms.freeze_days_used;
      const canOverride = b.override && ["owner", "manager", "superadmin"].includes(u.role);
      if (days > left && !canOverride) throw bad("freeze_limit", `Only ${left} freeze day(s) left on this membership`);
      const row = await one(
        q,
        `UPDATE memberships SET frozen_from = $2, frozen_until = $3, end_date = end_date + $4::int, freeze_days_used = freeze_days_used + $4::int WHERE id = $1 RETURNING *`,
        [ms.id, b.from, b.until, days],
      );
      await audit(q, u.gymId, u.id, "membership.freeze", "membership", ms.id, { from: b.from, until: b.until, days, override: canOverride && days > left });
      return row;
    });
  });

  r.post("/api/memberships/:id/unfreeze", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager", "reception"]);
    return db.tx(async (q) => {
      const ms = await one(q, "SELECT * FROM memberships WHERE id = $1 AND gym_id = $2 FOR UPDATE", [zId.parse(ctx.params.id), u.gymId]);
      if (!ms?.frozen_from) throw bad("not_frozen", "This membership is not frozen");
      const today = await gymToday(q, u.gymId);
      if (ms.frozen_until < today) throw bad("freeze_over", "This freeze is already over");
      const planned = daysBetween(ms.frozen_from, ms.frozen_until) + 1;
      const used = Math.max(0, daysBetween(ms.frozen_from, today));
      const giveBack = planned - used;
      const row = await one(
        q,
        `UPDATE memberships SET end_date = end_date - $2::int, freeze_days_used = freeze_days_used - $2::int,
                frozen_from = CASE WHEN $3::int = 0 THEN NULL ELSE frozen_from END,
                frozen_until = CASE WHEN $3::int = 0 THEN NULL ELSE ($4::date - 1) END
          WHERE id = $1 RETURNING *`,
        [ms.id, giveBack, used, today],
      );
      await audit(q, u.gymId, u.id, "membership.unfreeze", "membership", ms.id, { giveBack });
      return row;
    });
  });

  r.post("/api/memberships/:id/cancel", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const b = await ctx.body(z.object({ reason: z.string().max(300).default("") }));
    const row = await one(db, `UPDATE memberships SET status = 'cancelled', notes = trim(coalesce(notes,'') || ' [cancelled] ' || $3) WHERE id = $1 AND gym_id = $2 RETURNING id`, [zId.parse(ctx.params.id), u.gymId, b.reason]);
    if (!row) throw notFound("membership");
    await audit(db, u.gymId, u.id, "membership.cancel", "membership", row.id, b);
    return { ok: true };
  });

  r.put("/api/memberships/:id", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const b = await ctx.body(z.object({ start_date: zDate, end_date: zDate, notes: z.string().max(500).nullable().optional() }));
    if (b.end_date < b.start_date) throw bad("invalid_range", "End date must be after start date");
    const row = await one(db, "UPDATE memberships SET start_date = $3, end_date = $4, notes = coalesce($5, notes) WHERE id = $1 AND gym_id = $2 RETURNING *", [zId.parse(ctx.params.id), u.gymId, b.start_date, b.end_date, b.notes ?? null]);
    if (!row) throw notFound("membership");
    await audit(db, u.gymId, u.id, "membership.edit_dates", "membership", row.id, b);
    return row;
  });

  // ---------- payments ----------
  r.get("/api/payments", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager", "reception"]);
    const today = await gymToday(db, u.gymId);
    const from = ctx.query.get("from") ?? today;
    const to = ctx.query.get("to") ?? today;
    zDate.parse(from);
    zDate.parse(to);
    const rows = await many(
      db,
      `SELECT p.*, m.first_name, m.last_name, m.code, us.name AS received_by_name
         FROM payments p
         JOIN gyms g ON g.id = p.gym_id
         LEFT JOIN members m ON m.id = p.member_id
         LEFT JOIN users us ON us.id = p.received_by
        WHERE p.gym_id = $1 AND (p.paid_at AT TIME ZONE g.timezone)::date BETWEEN $2 AND $3
        ORDER BY p.paid_at DESC LIMIT 1000`,
      [u.gymId, from, to],
    );
    const live = rows.filter((p) => !p.voided_at);
    const totals: Record<string, any> = { usd: 0, byMethod: {}, byCurrency: { USD: 0, LBP: 0 } };
    for (const p of live) {
      totals.usd += Number(p.amount_usd);
      totals.byMethod[p.method] = (totals.byMethod[p.method] ?? 0) + Number(p.amount_usd);
      totals.byCurrency[p.currency] += Number(p.amount);
    }
    totals.usd = Math.round(totals.usd * 100) / 100;
    return { from, to, rows, totals };
  });

  r.post("/api/payments", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager", "reception"]);
    const b = await ctx.body(paymentInput.extend({ member_id: zId, membership_id: zId.nullable().optional(), pt_package_id: zId.nullable().optional() }));
    return db.tx(async (q) => {
      await getOverview(q, u.gymId, b.member_id);
      if (b.membership_id && !(await one(q, "SELECT 1 FROM memberships WHERE id = $1 AND member_id = $2", [b.membership_id, b.member_id]))) throw notFound("membership");
      if (b.pt_package_id && !(await one(q, "SELECT 1 FROM pt_packages WHERE id = $1 AND member_id = $2", [b.pt_package_id, b.member_id]))) throw notFound("PT package");
      const p = await recordPayment(q, u.gymId, u.id, b);
      await audit(q, u.gymId, u.id, "payment.create", "payment", p!.id, { amount: b.amount, currency: b.currency, method: b.method });
      return p;
    });
  });

  r.post("/api/payments/:id/void", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const b = await ctx.body(z.object({ reason: z.string().trim().min(3).max(300) }));
    const row = await one(db, "UPDATE payments SET voided_at = now(), void_reason = $3 WHERE id = $1 AND gym_id = $2 AND voided_at IS NULL RETURNING id", [zId.parse(ctx.params.id), u.gymId, b.reason]);
    if (!row) throw notFound("payment");
    await audit(db, u.gymId, u.id, "payment.void", "payment", row.id, b);
    return { ok: true };
  });

  /** Receipt: HTML for the in-app preview/print, shareable link and WhatsApp message. */
  r.get("/api/payments/:id/receipt", async (ctx) => {
    const u = await requireStaff(ctx);
    const r2 = await receiptForStaff(zId.parse(ctx.params.id), u.gymId);
    if (!r2) throw notFound("payment");
    return r2;
  });

  // ---------- check-in ----------
  r.post("/api/checkin", async (ctx) => {
    const u = await requireStaff(ctx);
    const b = await ctx.body(z.object({ token: z.string().max(80).optional(), code: z.coerce.number().int().positive().optional(), member_id: zId.optional() })
      .refine((x) => x.token || x.code || x.member_id, "token, code or member_id is required"));
    const res = await db.tx((q) => performCheckin(q, u.gymId, u.id, b, b.token ? "qr" : "manual"));
    // badges and challenge progress: after the check-in is committed, never blocking the desk
    if (res.result === "ok" && !res.duplicate && res.member?.id) {
      db.tx((q) => refreshProgress(q, u.gymId, res.member.id)).catch((e) => console.error("[progress]", e.message));
    }
    return res;
  });

  r.get("/api/checkins", async (ctx) => {
    const u = await requireStaff(ctx);
    return many(
      db,
      `SELECT c.*, m.first_name, m.last_name, m.code, m.gender, us.name AS by_name
         FROM checkins c JOIN members m ON m.id = c.member_id LEFT JOIN users us ON us.id = c.by_user
        WHERE c.gym_id = $1 AND c.at > now() - interval '24 hours' ORDER BY c.at DESC LIMIT 200`,
      [u.gymId],
    );
  });
}

/** Accepts 2026-03-31, 31/03/2026, 31-03-2026, 31/3/26. */
export function parseLooseDate(s: string): string | null {
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s.trim());
  if (m) {
    const y = m[3].length === 2 ? "20" + m[3] : m[3];
    const iso = `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return Number.isNaN(Date.parse(iso)) ? null : iso;
  }
  return null;
}
