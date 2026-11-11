/**
 * Member engagement, inspired by fitness apps (Strava, Apple Fitness) but kept simple:
 *  - progress: weekly goal, week streak, monthly comparison, badges earned automatically;
 *  - challenges: the gym sets a target for a period (e.g. 12 visits in November); every member
 *    takes part automatically, with a leaderboard (first name + initial, members can hide);
 *  - referrals: each member has an invite link; the friend leaves their number, reception
 *    follows up, and when they join the referrer is told and the gym sees who brings whom;
 *  - offers and the product catalogue shown in the app, with "I want it" requests.
 * Every piece can be switched off by the gym (settings.engage).
 */
import crypto from "node:crypto";
import { z } from "zod";
import { db, many, one, audit, type Queryable } from "../db/index.ts";
import { checkRateLimit, requireMember, requireStaff } from "../auth.ts";
import { bad, notFound, zDate, zId, zPhone, type Router } from "../http.ts";
import { notify } from "../services/notify.ts";
import { gymToday } from "../services/money.ts";

export interface EngageSettings { badges: boolean; challenges: boolean; leaderboard: boolean; referrals: boolean; referralReward: string }
export const DEFAULT_ENGAGE: EngageSettings = { badges: true, challenges: true, leaderboard: true, referrals: true, referralReward: "" };
export const engageSettings = (settings: any): EngageSettings => ({ ...DEFAULT_ENGAGE, ...(settings?.engage ?? {}) });

// ---------------- badges ----------------
interface Stats { visits: number; bestStreak: number; classes: number; early: number; late: number; tenureDays: number; challenges: number; referrals: number }
export const BADGES: { key: string; label: string; detail: string; icon: string; goal: number; of: (s: Stats) => number }[] = [
  { key: "first_visit", label: "First visit", detail: "Check in for the first time", icon: "🎉", goal: 1, of: (s) => s.visits },
  { key: "visits_10", label: "10 visits", detail: "Come 10 times", icon: "🔟", goal: 10, of: (s) => s.visits },
  { key: "visits_25", label: "25 visits", detail: "Come 25 times", icon: "💪", goal: 25, of: (s) => s.visits },
  { key: "visits_50", label: "50 visits", detail: "Come 50 times", icon: "🔥", goal: 50, of: (s) => s.visits },
  { key: "visits_100", label: "100 club", detail: "Come 100 times", icon: "💯", goal: 100, of: (s) => s.visits },
  { key: "visits_250", label: "250 visits", detail: "Come 250 times", icon: "🏛️", goal: 250, of: (s) => s.visits },
  { key: "streak_4", label: "4-week streak", detail: "Train every week for 4 weeks in a row", icon: "📅", goal: 4, of: (s) => s.bestStreak },
  { key: "streak_12", label: "12-week streak", detail: "Train every week for 3 months", icon: "⚡", goal: 12, of: (s) => s.bestStreak },
  { key: "streak_26", label: "Half-year habit", detail: "Train every week for 6 months", icon: "🏅", goal: 26, of: (s) => s.bestStreak },
  { key: "streak_52", label: "Year-round", detail: "Train every week for a whole year", icon: "👑", goal: 52, of: (s) => s.bestStreak },
  { key: "first_class", label: "First class", detail: "Attend a class", icon: "🧘", goal: 1, of: (s) => s.classes },
  { key: "classes_10", label: "Class regular", detail: "Attend 10 classes", icon: "🎵", goal: 10, of: (s) => s.classes },
  { key: "classes_50", label: "Class hero", detail: "Attend 50 classes", icon: "🌟", goal: 50, of: (s) => s.classes },
  { key: "early_bird", label: "Early bird", detail: "5 visits before 7:00", icon: "🌅", goal: 5, of: (s) => s.early },
  { key: "night_owl", label: "Night owl", detail: "5 visits after 21:00", icon: "🌙", goal: 5, of: (s) => s.late },
  { key: "anniversary", label: "One year with us", detail: "A year since your first membership", icon: "🎂", goal: 365, of: (s) => s.tenureDays },
  { key: "challenger", label: "Challenge completed", detail: "Finish a gym challenge", icon: "🏆", goal: 1, of: (s) => s.challenges },
  { key: "ambassador", label: "Brought a friend", detail: "A friend you invited joined the gym", icon: "🤝", goal: 1, of: (s) => s.referrals },
];

/** Longest run of consecutive weeks with at least one visit, and the current run. */
export function streaks(weekStarts: string[], thisWeek: string): { best: number; current: number } {
  const weeks = [...new Set(weekStarts)].sort();
  let best = 0, run = 0, prev: number | null = null;
  const toN = (w: string) => Math.round(Date.parse(w + "T00:00:00Z") / (7 * 86400000));
  for (const w of weeks) {
    const n = toN(w);
    run = prev != null && n === prev + 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = n;
  }
  // the current run counts if the member trained this week or last week (the week isn't over yet)
  const last = weeks.length ? toN(weeks[weeks.length - 1]) : null;
  const now = toN(thisWeek);
  return { best, current: last != null && now - last <= 1 ? run : 0 };
}

async function memberStats(q: Queryable, gymId: string, memberId: string) {
  const r = await one(q, `
    WITH g AS (SELECT timezone AS tz, (now() AT TIME ZONE timezone)::date AS today FROM gyms WHERE id = $1),
    ck AS (SELECT (c.at AT TIME ZONE g.tz) AS local FROM checkins c, g WHERE c.member_id = $2 AND c.result = 'ok')
    SELECT (SELECT count(*) FROM ck)::int AS visits,
           (SELECT count(*) FROM ck WHERE extract(hour FROM local) < 7)::int AS early,
           (SELECT count(*) FROM ck WHERE extract(hour FROM local) >= 21)::int AS late,
           (SELECT coalesce(array_agg(DISTINCT date_trunc('week', local)::date::text), '{}') FROM ck) AS weeks,
           (SELECT date_trunc('week', today)::date::text FROM g) AS this_week,
           (SELECT count(*) FROM bookings b WHERE b.member_id = $2 AND b.status = 'attended')::int AS classes,
           (SELECT coalesce((SELECT today FROM g) - min(start_date), 0) FROM memberships WHERE member_id = $2 AND status = 'active' AND start_date <= (SELECT today FROM g))::int AS tenure_days,
           (SELECT count(*) FROM members f WHERE f.referred_by = $2)::int AS referrals`, [gymId, memberId]);
  const s = streaks(r.weeks ?? [], r.this_week);
  return { visits: r.visits, early: r.early, late: r.late, classes: r.classes, tenureDays: r.tenure_days, referrals: r.referrals, bestStreak: s.best, currentStreak: s.current, thisWeek: r.this_week as string };
}

/** Challenge progress = distinct days with a visit (or classes attended) inside the challenge dates. */
async function challengeProgress(q: Queryable, c: any, memberId: string): Promise<number> {
  const r = c.metric === "classes"
    ? await one(q, `SELECT count(*)::int AS n FROM bookings b JOIN class_sessions s ON s.id = b.session_id JOIN gyms g ON g.id = s.gym_id
                     WHERE b.member_id = $1 AND b.status = 'attended' AND (s.starts_at AT TIME ZONE g.timezone)::date BETWEEN $2 AND $3`, [memberId, c.starts_on, c.ends_on])
    : await one(q, `SELECT count(DISTINCT (c.at AT TIME ZONE g.timezone)::date)::int AS n FROM checkins c JOIN gyms g ON g.id = c.gym_id
                     WHERE c.member_id = $1 AND c.result = 'ok' AND (c.at AT TIME ZONE g.timezone)::date BETWEEN $2 AND $3`, [memberId, c.starts_on, c.ends_on]);
  return r.n;
}

async function completedChallenges(q: Queryable, gymId: string, memberId: string) {
  const list = await many(q, "SELECT * FROM challenges WHERE gym_id = $1 AND active AND starts_on <= current_date", [gymId]);
  let n = 0;
  for (const c of list) if ((await challengeProgress(q, c, memberId)) >= c.target) n++;
  return n;
}

/**
 * Awards the badges a member has newly earned, and tells them about badges and finished
 * challenges (once each). Called after a check-in and when the app opens.
 */
export async function refreshProgress(q: Queryable, gymId: string, memberId: string) {
  const gym = await one(q, "SELECT settings FROM gyms WHERE id = $1", [gymId]);
  const es = engageSettings(gym.settings);
  const stats = await memberStats(q, gymId, memberId);
  const challenges = es.challenges ? await completedChallenges(q, gymId, memberId) : 0;
  const full: Stats = { ...stats, challenges };
  const fresh: string[] = [];
  if (es.badges) {
    const have = new Set((await many(q, "SELECT badge FROM member_badges WHERE member_id = $1", [memberId])).map((x) => x.badge));
    for (const b of BADGES) {
      if (have.has(b.key) || b.of(full) < b.goal) continue;
      const row = await one(q, "INSERT INTO member_badges (member_id, gym_id, badge) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING badge", [memberId, gymId, b.key]);
      if (row) fresh.push(b.key);
    }
    // a member joining with years of history gets their badges quietly; only the latest one is announced
    const announce = fresh.slice(-1);
    for (const key of announce) {
      const b = BADGES.find((x) => x.key === key)!;
      await notify(q, { gymId, memberId, kind: "badge", title: `${b.icon} New badge: ${b.label}`, body: `${b.detail}. Keep it up!`, tab: "progress", dedupeKey: `badge:${memberId}:${key}` });
    }
  }
  if (es.challenges) {
    const active = await many(q, "SELECT * FROM challenges WHERE gym_id = $1 AND active AND current_date BETWEEN starts_on AND ends_on + 1", [gymId]);
    for (const c of active) {
      if ((await challengeProgress(q, c, memberId)) >= c.target) {
        await notify(q, { gymId, memberId, kind: "challenge", title: `🏆 Challenge complete: ${c.title}`, body: c.reward ? `You did it! ${c.reward}` : "You did it! See where you rank in the app.", tab: "progress", dedupeKey: `challenge-done:${c.id}:${memberId}` });
      }
    }
  }
  return { stats: full, fresh };
}

/** Visible name on leaderboards: "Rita K." */
const shortName = (first: string, last: string) => `${first}${last ? ` ${last.trim()[0]?.toUpperCase() ?? ""}.` : ""}`;

export async function leaderboard(q: Queryable, c: any, opts: { memberId?: string; full?: boolean; limit?: number } = {}) {
  const metric = c.metric === "classes"
    ? `(SELECT count(*) FROM bookings b JOIN class_sessions s ON s.id = b.session_id WHERE b.member_id = m.id AND b.status = 'attended' AND (s.starts_at AT TIME ZONE g.timezone)::date BETWEEN $2 AND $3)`
    : `(SELECT count(DISTINCT (ck.at AT TIME ZONE g.timezone)::date) FROM checkins ck WHERE ck.member_id = m.id AND ck.result = 'ok' AND (ck.at AT TIME ZONE g.timezone)::date BETWEEN $2 AND $3)`;
  const rows = await many(q, `
    SELECT * FROM (
      SELECT m.id, m.first_name, m.last_name, coalesce((m.app_prefs->>'hideOnLeaderboard')::boolean, false) AS hidden, ${metric}::int AS score
        FROM members m JOIN gyms g ON g.id = m.gym_id WHERE m.gym_id = $1 AND m.archived_at IS NULL) x
     WHERE score > 0 ORDER BY score DESC, first_name`, [c.gym_id, c.starts_on, c.ends_on]);
  // ties share a rank (1, 2, 2, 4)
  let rank = 0, prevScore = -1;
  const ranked = rows.map((r, i) => {
    if (r.score !== prevScore) { rank = i + 1; prevScore = r.score; }
    return { ...r, rank };
  });
  const me = opts.memberId ? ranked.find((r) => r.id === opts.memberId) : undefined;
  const top = ranked.filter((r) => opts.full || !r.hidden || r.id === opts.memberId).slice(0, opts.limit ?? 10).map((r) => ({
    rank: r.rank, name: opts.full ? `${r.first_name} ${r.last_name}`.trim() : shortName(r.first_name, r.last_name), score: r.score,
    done: r.score >= c.target, me: r.id === opts.memberId, ...(opts.full ? { id: r.id, hidden: r.hidden } : {}),
  }));
  return { top, participants: ranked.length, finished: ranked.filter((r) => r.score >= c.target).length, me: me ? { rank: me.rank, score: me.score } : null };
}

// ---------------- referrals ----------------
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export async function referralCode(q: Queryable, gymId: string, memberId: string): Promise<string> {
  const cur = await one(q, "SELECT referral_code FROM members WHERE id = $1", [memberId]);
  if (cur?.referral_code) return cur.referral_code;
  for (let i = 0; i < 8; i++) {
    const code = Array.from(crypto.randomBytes(6), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
    const r = await one(q, "UPDATE members SET referral_code = $3 WHERE id = $1 AND gym_id = $2 AND referral_code IS NULL AND NOT EXISTS (SELECT 1 FROM members WHERE gym_id = $2 AND referral_code = $3) RETURNING referral_code", [memberId, gymId, code]);
    if (r) return r.referral_code;
    const again = await one(q, "SELECT referral_code FROM members WHERE id = $1", [memberId]);
    if (again?.referral_code) return again.referral_code;
  }
  throw new Error("could not allocate a referral code");
}

/**
 * Credits `referrerId` for bringing `memberId`: sets referred_by (only if not set yet), tells the
 * referrer in the app and refreshes their badges. Returns false when nothing changed.
 */
export async function creditReferral(q: Queryable, gymId: string, memberId: string, referrerId: string): Promise<boolean> {
  if (referrerId === memberId) throw bad("self_referral", "A member cannot refer themselves");
  const referrer = await one(q, "SELECT id FROM members WHERE id = $1 AND gym_id = $2 AND archived_at IS NULL", [referrerId, gymId]);
  if (!referrer) throw bad("unknown_referrer", "The member who referred them was not found");
  const set = await one(q, "UPDATE members SET referred_by = $3 WHERE id = $1 AND gym_id = $2 AND referred_by IS NULL RETURNING first_name", [memberId, gymId, referrerId]);
  if (!set) return false;
  // sequential: a transaction's connection runs one query at a time
  const gym = await one(q, "SELECT settings FROM gyms WHERE id = $1", [gymId]);
  const reward = engageSettings(gym.settings).referralReward;
  await notify(q, { gymId, memberId: referrerId, kind: "referral", title: `🤝 ${set.first_name} joined the gym!`, body: reward ? `Thanks for inviting them. Your reward: ${reward}. Ask reception.` : "Thanks for inviting them!", tab: "progress", dedupeKey: `referral:${memberId}` });
  await refreshProgress(q, gymId, referrerId);
  return true;
}

/**
 * When reception creates a member, link them to the lead with the same phone (or the lead
 * they came from): the lead is converted and whoever invited them is credited. Reception can
 * also pick the referrer directly ("Referred by"), which is used when the lead has none.
 */
export async function linkNewMember(q: Queryable, gymId: string, memberId: string, phone: string | null, leadId?: string | null, referrerId?: string | null) {
  const lead = leadId
    ? await one(q, "SELECT * FROM leads WHERE id = $1 AND gym_id = $2", [leadId, gymId])
    : phone ? await one(q, "SELECT * FROM leads WHERE gym_id = $1 AND phone = $2 AND status <> 'converted' AND member_id IS NULL ORDER BY created_at DESC LIMIT 1", [gymId, phone]) : null;
  if (lead) await q.query("UPDATE leads SET status = 'converted', member_id = $2 WHERE id = $1", [lead.id, memberId]);
  const by = (lead?.referred_by && lead.referred_by !== memberId ? lead.referred_by : null) ?? referrerId ?? null;
  if (by) await creditReferral(q, gymId, memberId, by);
  return lead?.id ?? null;
}

// ---------------- images (products, offers) ----------------
export function parseImage(dataUrl: string) {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw bad("invalid_image", "Use a PNG, JPEG or WebP image");
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 600_000) throw bad("image_too_large", "The image is too large (600 KB max)");
  const sig = buf.subarray(0, 12).toString("hex");
  const ok = m[1] === "image/png" ? sig.startsWith("89504e47") : m[1] === "image/jpeg" ? sig.startsWith("ffd8ff") : sig.startsWith("52494646") && sig.slice(16, 24) === "57454250";
  if (!ok) throw bad("invalid_image", "This file is not the image type it claims to be");
  return { mime: m[1], buf };
}

const offerSchema = z.object({
  title: z.string().trim().min(1).max(80),
  body: z.string().trim().max(600).nullable().optional(),
  badge: z.string().trim().max(14).nullable().optional(),
  kind: z.enum(["offer", "event", "news"]).default("offer"),
  product_id: zId.nullable().optional(),
  plan_id: zId.nullable().optional(),
  starts_on: zDate.nullable().optional().or(z.literal("").transform(() => null)),
  ends_on: zDate.nullable().optional().or(z.literal("").transform(() => null)),
  active: z.boolean().default(true),
  sort: z.coerce.number().int().min(-1000).max(1000).default(0),
});

const challengeBase = z.object({
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(400).nullable().optional(),
  metric: z.enum(["visits", "classes"]).default("visits"),
  target: z.coerce.number().int().min(1).max(1000),
  starts_on: zDate,
  ends_on: zDate,
  reward: z.string().trim().max(120).nullable().optional(),
  active: z.boolean().default(true),
});
const datesOk = (c: { starts_on: string; ends_on: string }): boolean => c.ends_on >= c.starts_on;
const datesMsg = { message: "The end date is before the start date", path: ["ends_on"] };
const challengeSchema = challengeBase.refine(datesOk, datesMsg);

/** Offers visible to members today. */
async function liveOffers(q: Queryable, gymId: string) {
  return many(q, `
    SELECT o.id, o.title, o.body, o.badge, o.kind, o.starts_on, o.ends_on, (o.image IS NOT NULL) AS has_image,
           o.product_id, p.name AS product_name, o.plan_id, pl.name AS plan_name, pl.price AS plan_price, pl.currency AS plan_currency
      FROM offers o JOIN gyms g ON g.id = o.gym_id
      LEFT JOIN products p ON p.id = o.product_id AND p.active LEFT JOIN plans pl ON pl.id = o.plan_id AND pl.active
     WHERE o.gym_id = $1 AND o.active
       AND (o.starts_on IS NULL OR o.starts_on <= (now() AT TIME ZONE g.timezone)::date)
       AND (o.ends_on IS NULL OR o.ends_on >= (now() AT TIME ZONE g.timezone)::date)
     ORDER BY o.sort, o.created_at DESC LIMIT 20`, [gymId]);
}

/** Catalogue for members: what's on sale in the app, with whether it's in stock (never the count). */
async function catalogue(q: Queryable, gymId: string) {
  const rows = await many(q, `
    SELECT p.id, p.name, p.name_ar, p.category, p.brand, p.description, p.price, p.currency, p.kind, p.featured, (p.image IS NOT NULL) AS has_image,
           CASE WHEN p.kind = 'bundle' THEN coalesce((SELECT min(floor(c.stock / greatest((x->>'qty')::int, 1)))::int
                                                         FROM jsonb_array_elements(p.components) x JOIN products c ON c.id = (x->>'product_id')::uuid AND c.track_stock), 99)
                WHEN p.track_stock THEN p.stock ELSE 99 END AS available,
           (SELECT string_agg((x->>'qty') || ' × ' || c.name, ', ') FROM jsonb_array_elements(p.components) x JOIN products c ON c.id = (x->>'product_id')::uuid) AS contents
      FROM products p WHERE p.gym_id = $1 AND p.active AND p.in_app
     ORDER BY p.featured DESC, p.category, p.name`, [gymId]);
  return rows.map(({ available, ...p }) => ({ ...p, in_stock: available > 0, low: available > 0 && available <= 3 }));
}

export function registerCommunity(r: Router) {
  // ===================== staff: offers =====================
  r.get("/api/offers", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    return many(db, `SELECT o.id, o.title, o.body, o.badge, o.kind, o.product_id, o.plan_id, o.starts_on::text, o.ends_on::text, o.active, o.sort, o.created_at, (o.image IS NOT NULL) AS has_image,
                            p.name AS product_name, pl.name AS plan_name
                       FROM offers o LEFT JOIN products p ON p.id = o.product_id LEFT JOIN plans pl ON pl.id = o.plan_id
                      WHERE o.gym_id = $1 ORDER BY o.active DESC, o.sort, o.created_at DESC`, [u.gymId]);
  });

  r.post("/api/offers", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const b = await ctx.body(offerSchema.extend({ notify: z.boolean().default(false) }));
    return db.tx(async (q) => {
      const o = await one(q, `INSERT INTO offers (gym_id, title, body, badge, kind, product_id, plan_id, starts_on, ends_on, active, sort)
                              SELECT $1,$2,$3,$4,$5,
                                     (SELECT id FROM products WHERE id = $6 AND gym_id = $1), (SELECT id FROM plans WHERE id = $7 AND gym_id = $1),
                                     $8,$9,$10,$11 RETURNING *`,
        [u.gymId, b.title, b.body ?? null, b.badge ?? null, b.kind, b.product_id ?? null, b.plan_id ?? null, b.starts_on ?? null, b.ends_on ?? null, b.active, b.sort]);
      let told = 0;
      if (b.notify && b.active) {
        const members = await many(q, "SELECT id FROM member_overview WHERE gym_id = $1 AND archived_at IS NULL AND status IN ('active','expiring','frozen') AND has_app_access", [u.gymId]);
        for (const m of members) {
          if (await notify(q, { gymId: u.gymId, memberId: m.id, kind: "offer", title: `${b.badge ? b.badge + " · " : ""}${b.title}`, body: b.body ?? "New in the app", tab: "home", dedupeKey: `offer:${o!.id}:${m.id}`, createdBy: u.id })) told++;
        }
      }
      await audit(q, u.gymId, u.id, "offer.create", "offer", o!.id, { notify: b.notify, told });
      return { ...o, image: undefined, told };
    });
  });

  r.put("/api/offers/:id", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const b = await ctx.body(offerSchema);
    const o = await one(db, `UPDATE offers SET title=$3, body=$4, badge=$5, kind=$6, product_id=(SELECT id FROM products WHERE id = $7 AND gym_id = $2), plan_id=(SELECT id FROM plans WHERE id = $8 AND gym_id = $2),
                                starts_on=$9, ends_on=$10, active=$11, sort=$12 WHERE id = $1 AND gym_id = $2 RETURNING id`,
      [zId.parse(ctx.params.id), u.gymId, b.title, b.body ?? null, b.badge ?? null, b.kind, b.product_id ?? null, b.plan_id ?? null, b.starts_on ?? null, b.ends_on ?? null, b.active, b.sort]);
    if (!o) throw notFound("offer");
    return { ok: true };
  });

  r.put("/api/offers/:id/image", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const b = await ctx.body(z.object({ image: z.string().max(900_000).nullable() }));
    const img = b.image ? parseImage(b.image) : null;
    const o = await one(db, "UPDATE offers SET image = $3, image_mime = $4 WHERE id = $1 AND gym_id = $2 RETURNING id", [zId.parse(ctx.params.id), u.gymId, img?.buf ?? null, img?.mime ?? null]);
    if (!o) throw notFound("offer");
    return { ok: true };
  });

  r.del("/api/offers/:id", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const r2 = await db.query("DELETE FROM offers WHERE id = $1 AND gym_id = $2", [zId.parse(ctx.params.id), u.gymId]);
    if (!r2.rowCount) throw notFound("offer");
    return { ok: true };
  });

  // public images (unguessable ids; cached briefly)
  const sendImage = (ctx: any, row: any) => {
    if (!row?.image) throw notFound("image");
    ctx.res.writeHead(200, { "Content-Type": row.image_mime, "Cache-Control": "public, max-age=600", "Content-Security-Policy": "default-src 'none'", "X-Content-Type-Options": "nosniff" });
    ctx.res.end(row.image);
    return undefined;
  };
  r.get("/api/public/offers/:id/image", async (ctx) => sendImage(ctx, await one(db, "SELECT image, image_mime FROM offers WHERE id = $1", [zId.parse(ctx.params.id)])));
  r.get("/api/public/products/:id/image", async (ctx) => sendImage(ctx, await one(db, "SELECT image, image_mime FROM products WHERE id = $1", [zId.parse(ctx.params.id)])));

  // ===================== staff: challenges =====================
  r.get("/api/challenges", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const list = await many(db, "SELECT id, gym_id, title, description, metric, target, starts_on::text, ends_on::text, reward, active, created_at FROM challenges WHERE gym_id = $1 ORDER BY ends_on DESC LIMIT 50", [u.gymId]);
    return Promise.all(list.map(async (c) => {
      const lb = await leaderboard(db, c, { full: true, limit: 3 });
      return { ...c, participants: lb.participants, finished: lb.finished, leaders: lb.top };
    }));
  });

  r.post("/api/challenges", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const b = await ctx.body(challengeBase.extend({ notify: z.boolean().default(true) }).refine(datesOk, datesMsg));
    return db.tx(async (q) => {
      const c = await one(q, `INSERT INTO challenges (gym_id, title, description, metric, target, starts_on, ends_on, reward, active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [u.gymId, b.title, b.description ?? null, b.metric, b.target, b.starts_on, b.ends_on, b.reward ?? null, b.active]);
      let told = 0;
      const today = await gymToday(q, u.gymId);
      if (b.notify && b.active && b.ends_on >= today) {
        const members = await many(q, "SELECT id FROM member_overview WHERE gym_id = $1 AND archived_at IS NULL AND status IN ('active','expiring') AND has_app_access", [u.gymId]);
        const what = b.metric === "classes" ? `${b.target} classes` : `${b.target} visits`;
        for (const m of members) {
          if (await notify(q, { gymId: u.gymId, memberId: m.id, kind: "challenge", title: `🏁 New challenge: ${b.title}`, body: `${what} by ${b.ends_on}.${b.reward ? ` Reward: ${b.reward}.` : ""} You're in automatically.`, tab: "progress", dedupeKey: `challenge-new:${c!.id}:${m.id}`, createdBy: u.id })) told++;
        }
      }
      await audit(q, u.gymId, u.id, "challenge.create", "challenge", c!.id);
      return { ...c, told };
    });
  });

  r.put("/api/challenges/:id", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const b = await ctx.body(challengeSchema);
    const c = await one(db, `UPDATE challenges SET title=$3, description=$4, metric=$5, target=$6, starts_on=$7, ends_on=$8, reward=$9, active=$10 WHERE id = $1 AND gym_id = $2 RETURNING id`,
      [zId.parse(ctx.params.id), u.gymId, b.title, b.description ?? null, b.metric, b.target, b.starts_on, b.ends_on, b.reward ?? null, b.active]);
    if (!c) throw notFound("challenge");
    return { ok: true };
  });

  r.del("/api/challenges/:id", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const r2 = await db.query("DELETE FROM challenges WHERE id = $1 AND gym_id = $2", [zId.parse(ctx.params.id), u.gymId]);
    if (!r2.rowCount) throw notFound("challenge");
    return { ok: true };
  });

  r.get("/api/challenges/:id/leaderboard", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager", "reception"]);
    const c = await one(db, "SELECT * FROM challenges WHERE id = $1 AND gym_id = $2", [zId.parse(ctx.params.id), u.gymId]);
    if (!c) throw notFound("challenge");
    return leaderboard(db, c, { full: true, limit: 200 });
  });

  // ===================== staff: referrals =====================
  r.get("/api/referrals", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager", "reception"]);
    const [referrers, recent, totals] = await Promise.all([
      many(db, `SELECT m.id, m.code, m.first_name, m.last_name,
                       (SELECT count(*) FROM members f WHERE f.referred_by = m.id)::int AS joined,
                       (SELECT count(*) FROM leads l WHERE l.referred_by = m.id AND l.status NOT IN ('converted','lost'))::int AS pending,
                       (SELECT max(l.created_at) FROM leads l WHERE l.referred_by = m.id) AS last_at
                  FROM members m WHERE m.gym_id = $1 AND (EXISTS (SELECT 1 FROM leads l WHERE l.referred_by = m.id) OR EXISTS (SELECT 1 FROM members f WHERE f.referred_by = m.id))
                 ORDER BY joined DESC, pending DESC, last_at DESC LIMIT 100`, [u.gymId]),
      many(db, `SELECT l.id, l.name, l.phone, l.status, l.created_at, l.member_id, r.first_name || ' ' || r.last_name AS referrer, r.id AS referrer_id
                  FROM leads l JOIN members r ON r.id = l.referred_by WHERE l.gym_id = $1 ORDER BY l.created_at DESC LIMIT 50`, [u.gymId]),
      one(db, `SELECT count(*)::int AS leads, count(*) FILTER (WHERE status = 'converted')::int AS joined FROM leads WHERE gym_id = $1 AND referred_by IS NOT NULL`, [u.gymId]),
    ]);
    return { referrers, recent, totals };
  });

  // ===================== staff: product requests =====================
  r.get("/api/shop/requests", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager", "reception"]);
    const open = ctx.query.get("status") !== "all";
    return many(db, `SELECT pr.*, p.name AS product_name, p.price, p.currency, p.kind, m.first_name, m.last_name, m.code, m.phone,
                            CASE WHEN p.track_stock AND p.kind = 'item' THEN p.stock END AS stock
                       FROM product_requests pr JOIN products p ON p.id = pr.product_id JOIN members m ON m.id = pr.member_id
                      WHERE pr.gym_id = $1 ${open ? "AND pr.status IN ('pending','ready')" : ""}
                      ORDER BY (pr.status = 'pending') DESC, pr.created_at DESC LIMIT 200`, [u.gymId]);
  });

  r.put("/api/shop/requests/:id", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager", "reception"]);
    const b = await ctx.body(z.object({ status: z.enum(["pending", "ready", "cancelled"]) }));
    return db.tx(async (q) => {
      const pr = await one(q, `SELECT pr.*, p.name AS product_name FROM product_requests pr JOIN products p ON p.id = pr.product_id WHERE pr.id = $1 AND pr.gym_id = $2 FOR UPDATE OF pr`, [zId.parse(ctx.params.id), u.gymId]);
      if (!pr) throw notFound("request");
      if (pr.status === "collected") throw bad("already_collected", "This order was already collected");
      await q.query("UPDATE product_requests SET status = $2, updated_at = now() WHERE id = $1", [pr.id, b.status]);
      if (b.status === "ready" && pr.status !== "ready") {
        await notify(q, { gymId: u.gymId, memberId: pr.member_id, kind: "request_ready", title: "Your order is ready ✅", body: `${pr.qty} × ${pr.product_name} is waiting for you at reception.`, tab: "shop", dedupeKey: `request-ready:${pr.id}` });
      }
      if (b.status === "cancelled" && pr.status !== "cancelled") {
        await notify(q, { gymId: u.gymId, memberId: pr.member_id, kind: "request_ready", title: "About your order", body: `${pr.product_name} isn't available right now. Ask reception for an alternative.`, tab: "shop", dedupeKey: `request-cancel:${pr.id}` });
      }
      return { ok: true };
    });
  });

  // ===================== member app =====================
  r.get("/api/m/home", async (ctx) => {
    const me = await requireMember(ctx);
    const gym = await one(db, "SELECT settings, modules FROM gyms WHERE id = $1", [me.gymId]);
    const es = engageSettings(gym.settings);
    // badges are awarded lazily too (history imported, visits added by staff)
    await db.tx((q) => refreshProgress(q, me.gymId, me.id)).catch(() => null);
    const [stats, prefs, nextClass, nextPt, offers, products, challenge, requests, lastMonth] = await Promise.all([
      memberStats(db, me.gymId, me.id),
      one(db, "SELECT app_prefs FROM members WHERE id = $1", [me.id]),
      one(db, `SELECT s.id, s.starts_at, s.ends_at, ct.name, ct.name_ar, ct.color, us.name AS coach_name, b.status
                 FROM bookings b JOIN class_sessions s ON s.id = b.session_id JOIN class_types ct ON ct.id = s.class_type_id LEFT JOIN users us ON us.id = s.coach_id
                WHERE b.member_id = $1 AND b.status IN ('booked','waitlist') AND NOT s.cancelled AND s.ends_at > now() ORDER BY s.starts_at LIMIT 1`, [me.id]),
      one(db, `SELECT ps.id, ps.starts_at, ps.duration_min, us.name AS coach_name FROM pt_sessions ps LEFT JOIN users us ON us.id = ps.coach_id
                WHERE ps.member_id = $1 AND ps.status = 'scheduled' AND ps.starts_at > now() - interval '30 minutes' ORDER BY ps.starts_at LIMIT 1`, [me.id]),
      gym.modules?.memberApp === false ? [] : liveOffers(db, me.gymId),
      gym.modules?.shop === false ? [] : catalogue(db, me.gymId).then((list) => list.filter((p) => p.featured).slice(0, 8)),
      es.challenges ? one(db, "SELECT * FROM challenges WHERE gym_id = $1 AND active AND current_date BETWEEN starts_on AND ends_on ORDER BY ends_on LIMIT 1", [me.gymId]) : null,
      many(db, `SELECT pr.id, pr.status, pr.qty, p.name FROM product_requests pr JOIN products p ON p.id = pr.product_id WHERE pr.member_id = $1 AND pr.status IN ('pending','ready') ORDER BY pr.created_at DESC`, [me.id]),
      one(db, `SELECT count(*) FILTER (WHERE (c.at AT TIME ZONE g.timezone) >= date_trunc('month', now() AT TIME ZONE g.timezone))::int AS this_month,
                      count(*) FILTER (WHERE (c.at AT TIME ZONE g.timezone) >= date_trunc('month', now() AT TIME ZONE g.timezone) - interval '1 month'
                                         AND (c.at AT TIME ZONE g.timezone) < date_trunc('month', now() AT TIME ZONE g.timezone) - interval '1 month' + (now() AT TIME ZONE g.timezone - date_trunc('month', now() AT TIME ZONE g.timezone)))::int AS last_month_same_point,
                      count(*) FILTER (WHERE (c.at AT TIME ZONE g.timezone) >= date_trunc('week', now() AT TIME ZONE g.timezone))::int AS this_week
                 FROM checkins c JOIN gyms g ON g.id = c.gym_id WHERE c.member_id = $1 AND c.result = 'ok'`, [me.id]),
    ]);
    let ch: any = null;
    if (challenge) {
      const lb = es.leaderboard ? await leaderboard(db, challenge, { memberId: me.id, limit: 3 }) : null;
      ch = { id: challenge.id, title: challenge.title, metric: challenge.metric, target: challenge.target, ends_on: challenge.ends_on, reward: challenge.reward,
        progress: await challengeProgress(db, challenge, me.id), rank: lb?.me?.rank ?? null, participants: lb?.participants ?? null };
    }
    const goal = Number(prefs.app_prefs?.weeklyGoal ?? 2);
    const badgeCount = es.badges ? (await one(db, "SELECT count(*)::int AS n FROM member_badges WHERE member_id = $1", [me.id])).n : null;
    return {
      week: { goal, visits: lastMonth.this_week }, streak: stats.currentStreak, month: { visits: lastMonth.this_month, lastMonthSamePoint: lastMonth.last_month_same_point },
      badges: badgeCount, next: { class: nextClass, pt: nextPt }, offers, featured: products, challenge: ch, requests,
      features: { badges: es.badges, challenges: es.challenges, leaderboard: es.leaderboard, referrals: es.referrals, shop: gym.modules?.shop !== false, pt: gym.modules?.pt !== false },
    };
  });

  r.get("/api/m/progress", async (ctx) => {
    const me = await requireMember(ctx);
    const gym = await one(db, "SELECT settings FROM gyms WHERE id = $1", [me.gymId]);
    const es = engageSettings(gym.settings);
    const [{ stats }, earned, weeks, prefs, challenges] = await Promise.all([
      db.tx((q) => refreshProgress(q, me.gymId, me.id)),
      many(db, "SELECT badge, earned_at FROM member_badges WHERE member_id = $1", [me.id]),
      many(db, `WITH g AS (SELECT timezone AS tz, date_trunc('week', now() AT TIME ZONE timezone)::date AS wk FROM gyms WHERE id = $2)
                SELECT w::date::text AS week, (SELECT count(*) FROM checkins c WHERE c.member_id = $1 AND c.result = 'ok'
                          AND (c.at AT TIME ZONE g.tz)::date >= w::date AND (c.at AT TIME ZONE g.tz)::date < w::date + 7)::int AS visits
                  FROM g, generate_series(g.wk - 77, g.wk, interval '7 days') w ORDER BY w`, [me.id, me.gymId]),
      one(db, "SELECT app_prefs FROM members WHERE id = $1", [me.id]),
      es.challenges ? many(db, "SELECT * FROM challenges WHERE gym_id = $1 AND active AND starts_on <= current_date AND ends_on >= current_date - 45 ORDER BY ends_on DESC LIMIT 4", [me.gymId]) : [],
    ]);
    const have = new Map(earned.map((x) => [x.badge, x.earned_at]));
    const statsFull = { ...stats, currentStreak: (stats as any).currentStreak };
    return {
      stats: { visits: stats.visits, classes: stats.classes, bestStreak: stats.bestStreak, currentStreak: (stats as any).currentStreak, weeklyGoal: Number(prefs.app_prefs?.weeklyGoal ?? 2) },
      weeks,
      badges: es.badges ? BADGES.map((b) => ({ key: b.key, label: b.label, detail: b.detail, icon: b.icon, goal: b.goal, progress: Math.min(b.goal, b.of(statsFull as any)), earned_at: have.get(b.key) ?? null })) : [],
      challenges: await Promise.all(challenges.map(async (c) => {
        const lb = es.leaderboard ? await leaderboard(db, c, { memberId: me.id, limit: 10 }) : null;
        return { id: c.id, title: c.title, description: c.description, metric: c.metric, target: c.target, starts_on: c.starts_on, ends_on: c.ends_on, reward: c.reward,
          progress: await challengeProgress(db, c, me.id), leaderboard: lb };
      })),
      hidden: !!prefs.app_prefs?.hideOnLeaderboard,
      leaderboard: es.leaderboard,
    };
  });

  r.put("/api/m/prefs", async (ctx) => {
    const me = await requireMember(ctx);
    const b = await ctx.body(z.object({ weeklyGoal: z.number().int().min(1).max(7).optional(), hideOnLeaderboard: z.boolean().optional() }));
    await db.query("UPDATE members SET app_prefs = app_prefs || $2::jsonb WHERE id = $1", [me.id, JSON.stringify(b)]);
    return { ok: true };
  });

  // ---- referrals ----
  r.get("/api/m/referral", async (ctx) => {
    const me = await requireMember(ctx);
    const gym = await one(db, "SELECT slug, name, settings FROM gyms WHERE id = $1", [me.gymId]);
    const es = engageSettings(gym.settings);
    if (!es.referrals) return { enabled: false };
    const code = await referralCode(db, me.gymId, me.id);
    const counts = await one(db, `SELECT (SELECT count(*) FROM members WHERE referred_by = $1)::int AS joined,
                                         (SELECT count(*) FROM leads WHERE referred_by = $1 AND status NOT IN ('converted','lost'))::int AS pending`, [me.id]);
    return { enabled: true, code, path: `/m/${gym.slug}?ref=${code}`, reward: es.referralReward || null, gym: gym.name, ...counts };
  });

  /** A friend leaves their name and number from an invite link; reception follows up. */
  r.post("/api/public/gyms/:slug/join", async (ctx) => {
    const g = await one(db, "SELECT id, settings, saas_status FROM gyms WHERE slug = $1", [ctx.params.slug]);
    if (!g || g.saas_status === "suspended") throw notFound("gym");
    const b = await ctx.body(z.object({ name: z.string().trim().min(2).max(80), phone: zPhone, ref: z.string().trim().max(12).nullable().optional(), interest: z.string().trim().max(80).nullable().optional() }));
    await checkRateLimit(`join:${ctx.ip}:${g.id}`, 5, 60);
    const referrer = b.ref && engageSettings(g.settings).referrals
      ? await one(db, "SELECT id, first_name FROM members WHERE gym_id = $1 AND referral_code = $2 AND archived_at IS NULL", [g.id, b.ref.toUpperCase()]) : null;
    const existingMember = await one(db, "SELECT 1 FROM members WHERE gym_id = $1 AND phone = $2 AND archived_at IS NULL", [g.id, b.phone]);
    // same answer as for anyone else: this public form must not tell who is a member
    if (existingMember) return { ok: true };
    const existing = await one(db, "SELECT id FROM leads WHERE gym_id = $1 AND phone = $2 AND status NOT IN ('converted','lost')", [g.id, b.phone]);
    if (existing) {
      if (referrer) await db.query("UPDATE leads SET referred_by = coalesce(referred_by, $2) WHERE id = $1", [existing.id, referrer.id]);
      return { ok: true };
    }
    await db.query(`INSERT INTO leads (gym_id, name, phone, source, status, interest, notes, follow_up_on, referred_by)
                    VALUES ($1,$2,$3,$4,'new',$5,$6,current_date,$7)`,
      [g.id, b.name, b.phone, referrer ? "Referral" : "Member app link", b.interest ?? null, referrer ? `Invited by ${referrer.first_name} from the member app` : null, referrer?.id ?? null]);
    return { ok: true };
  });

  // ---- catalogue & orders ----
  r.get("/api/m/shop", async (ctx) => {
    const me = await requireMember(ctx);
    const gym = await one(db, "SELECT modules FROM gyms WHERE id = $1", [me.gymId]);
    if (gym.modules?.shop === false) return { enabled: false, products: [], offers: [], requests: [] };
    const [products, offers, requests] = await Promise.all([
      catalogue(db, me.gymId),
      liveOffers(db, me.gymId),
      many(db, `SELECT pr.id, pr.status, pr.qty, pr.created_at, p.name, p.id AS product_id FROM product_requests pr JOIN products p ON p.id = pr.product_id
                 WHERE pr.member_id = $1 AND (pr.status IN ('pending','ready') OR pr.updated_at > now() - interval '14 days') ORDER BY pr.created_at DESC LIMIT 20`, [me.id]),
    ]);
    return { enabled: true, products, offers, requests };
  });

  r.post("/api/m/shop/requests", async (ctx) => {
    const me = await requireMember(ctx);
    const b = await ctx.body(z.object({ product_id: zId, qty: z.coerce.number().int().min(1).max(20).default(1), note: z.string().trim().max(200).nullable().optional() }));
    await checkRateLimit(`order:${me.id}`, 20, 60);
    const p = await one(db, "SELECT id, name FROM products WHERE id = $1 AND gym_id = $2 AND active AND in_app", [b.product_id, me.gymId]);
    if (!p) throw notFound("product");
    const open = await one(db, "SELECT count(*)::int AS n FROM product_requests WHERE member_id = $1 AND status IN ('pending','ready')", [me.id]);
    if (open.n >= 10) throw bad("too_many_requests", "You already have 10 orders waiting. Pick them up first.");
    const row = await one(db, "INSERT INTO product_requests (gym_id, member_id, product_id, qty, note) VALUES ($1,$2,$3,$4,$5) RETURNING id, status, qty, created_at", [me.gymId, me.id, p.id, b.qty, b.note ?? null]);
    return { ...row, name: p.name };
  });

  r.post("/api/m/shop/requests/:id/cancel", async (ctx) => {
    const me = await requireMember(ctx);
    const row = await one(db, "UPDATE product_requests SET status = 'cancelled', updated_at = now() WHERE id = $1 AND member_id = $2 AND status = 'pending' RETURNING id", [zId.parse(ctx.params.id), me.id]);
    if (!row) throw bad("not_cancellable", "This order is already being prepared: ask reception");
    return { ok: true };
  });
}
