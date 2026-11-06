import { z } from "zod";
import { db, one, many, audit, type Queryable } from "../db/index.ts";
import { requireStaff } from "../auth.ts";
import { bad, forbidden, notFound, zCurrency, zDate, zId, zMethod, zMoney, type Router } from "../http.ts";
import { gymRate, toUsd } from "../services/money.ts";
import { getOverview, recordPayment } from "./members.ts";
import { sendWhatsApp } from "../services/whatsapp.ts";
import { notify } from "../services/notify.ts";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:00)?$/);
const zColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** Materializes recurring schedules into dated sessions for the next `days` days. */
export async function ensureSessions(q: Queryable, gymId: string, days = 14) {
  await q.query(
    `INSERT INTO class_sessions (gym_id, schedule_id, class_type_id, coach_id, starts_at, ends_at, capacity, room)
     SELECT s.gym_id, s.id, s.class_type_id, s.coach_id,
            ((d::date + s.start_time) AT TIME ZONE g.timezone),
            ((d::date + s.start_time) AT TIME ZONE g.timezone) + make_interval(mins => s.duration_min),
            s.capacity, s.room
       FROM class_schedules s
       JOIN gyms g ON g.id = s.gym_id
      CROSS JOIN LATERAL generate_series((now() AT TIME ZONE g.timezone)::date, (now() AT TIME ZONE g.timezone)::date + $2::int, interval '1 day') d
      WHERE s.gym_id = $1 AND s.active AND extract(dow FROM d) = s.weekday
     ON CONFLICT (schedule_id, starts_at) DO NOTHING`,
    [gymId, days],
  );
}

async function refreshSchedule(q: Queryable, gymId: string, scheduleId: string) {
  // drop future, untouched sessions of this schedule, then regenerate from the new definition
  await q.query(
    `DELETE FROM class_sessions s WHERE s.schedule_id = $1 AND s.starts_at > now()
       AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.session_id = s.id AND b.status IN ('booked','waitlist'))`,
    [scheduleId],
  );
  await ensureSessions(q, gymId);
}

export type BookResult = { status: "booked" | "waitlist"; booking: any };

export async function bookSession(q: Queryable, gymId: string, sessionId: string, memberId: string, opts: { byStaff: boolean }): Promise<BookResult> {
  const s = await one(
    q,
    `SELECT s.*, ct.women_only, ct.name FROM class_sessions s JOIN class_types ct ON ct.id = s.class_type_id
      WHERE s.id = $1 AND s.gym_id = $2 FOR UPDATE OF s`,
    [sessionId, gymId],
  );
  if (!s) throw notFound("class");
  if (s.cancelled) throw bad("class_cancelled", "This class was cancelled");
  if (new Date(s.ends_at).getTime() < Date.now()) throw bad("class_over", "This class is already over");
  const m = await getOverview(q, gymId, memberId);
  if (s.women_only && m.gender === "male") throw bad("women_only", "This class is for women only");
  if (!opts.byStaff) {
    if (!["active", "expiring"].includes(m.status)) throw bad("membership_inactive", "You need an active membership to book classes");
    if (m.includes_classes === false) throw bad("classes_not_included", "Your plan does not include group classes");
    if (m.end_date && new Date(s.starts_at).toISOString().slice(0, 10) > m.end_date) throw bad("after_expiry", "This class is after your membership ends");
  }
  const existing = await one(q, "SELECT * FROM bookings WHERE session_id = $1 AND member_id = $2", [sessionId, memberId]);
  if (existing && ["booked", "waitlist", "attended"].includes(existing.status)) throw bad("already_booked", "Already booked");
  const taken = await one(q, "SELECT count(*)::int AS n FROM bookings WHERE session_id = $1 AND status IN ('booked','attended')", [sessionId]);
  const status = taken.n < s.capacity ? "booked" : "waitlist";
  const booking = existing
    ? await one(q, "UPDATE bookings SET status = $2, created_at = now() WHERE id = $1 RETURNING *", [existing.id, status])
    : await one(q, "INSERT INTO bookings (gym_id, session_id, member_id, status) VALUES ($1,$2,$3,$4) RETURNING *", [gymId, sessionId, memberId, status]);
  return { status, booking };
}

/** Cancels a booking and promotes the first person on the waitlist (they get a WhatsApp). */
export async function cancelBooking(q: Queryable, gymId: string, bookingId: string, opts: { byStaff: boolean; memberId?: string }) {
  const b = await one(
    q,
    `SELECT b.*, s.starts_at, s.capacity, ct.name AS class_name FROM bookings b
       JOIN class_sessions s ON s.id = b.session_id JOIN class_types ct ON ct.id = s.class_type_id
      WHERE b.id = $1 AND b.gym_id = $2 FOR UPDATE OF b`,
    [bookingId, gymId],
  );
  if (!b || (opts.memberId && b.member_id !== opts.memberId)) throw notFound("booking");
  if (!opts.byStaff && new Date(b.starts_at).getTime() - Date.now() < 2 * 3600_000) {
    throw bad("too_late", "Classes can be cancelled up to 2 hours before they start");
  }
  const wasBooked = b.status === "booked";
  await q.query("UPDATE bookings SET status = 'cancelled' WHERE id = $1", [bookingId]);
  if (wasBooked) {
    const next = await one(
      q,
      `UPDATE bookings SET status = 'booked' WHERE id = (
         SELECT id FROM bookings WHERE session_id = $1 AND status = 'waitlist' ORDER BY created_at LIMIT 1 FOR UPDATE)
       RETURNING member_id`,
      [b.session_id],
    );
    if (next) {
      const m = await one(q, "SELECT first_name, phone, whatsapp_opt_in FROM members WHERE id = $1", [next.member_id]);
      const when = new Date(b.starts_at).toLocaleString("en-GB", { timeZone: "Asia/Beirut", weekday: "short", hour: "2-digit", minute: "2-digit" });
      await notify(q, {
        gymId, memberId: next.member_id, kind: "waitlist", tab: "classes", dedupeKey: `waitlist:${b.session_id}:${next.member_id}`,
        title: "You're in ✅", body: `A spot opened in ${b.class_name} (${when}). See you there!`,
      });
      if (m?.phone && m.whatsapp_opt_in) {
        await sendWhatsApp(q, {
          gymId, memberId: next.member_id, phone: m.phone, kind: "waitlist_promoted",
          body: `Good news ${m.first_name}! A spot opened in ${b.class_name} (${when}). You're in ✅`,
          dedupeKey: `waitlist:${b.session_id}:${next.member_id}`,
        });
      }
    }
  }
  return { ok: true };
}

export function registerClasses(r: Router) {
  // ---- class types ----
  const typeSchema = z.object({
    name: z.string().trim().min(1).max(60),
    name_ar: z.string().trim().max(60).nullable().optional(),
    color: zColor,
    description: z.string().max(500).nullable().optional(),
    default_capacity: z.coerce.number().int().min(1).max(500),
    duration_min: z.coerce.number().int().min(10).max(300),
    women_only: z.boolean().default(false),
    active: z.boolean().default(true),
  });
  r.get("/api/classes/types", async (ctx) => {
    const u = await requireStaff(ctx);
    return many(db, "SELECT * FROM class_types WHERE gym_id = $1 ORDER BY active DESC, name", [u.gymId]);
  });
  r.post("/api/classes/types", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const b = await ctx.body(typeSchema);
    return one(db, `INSERT INTO class_types (gym_id, name, name_ar, color, description, default_capacity, duration_min, women_only, active)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [u.gymId, b.name, b.name_ar ?? null, b.color, b.description ?? null, b.default_capacity, b.duration_min, b.women_only, b.active]);
  });
  r.put("/api/classes/types/:id", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const b = await ctx.body(typeSchema);
    const row = await one(db, `UPDATE class_types SET name=$3, name_ar=$4, color=$5, description=$6, default_capacity=$7, duration_min=$8, women_only=$9, active=$10
                               WHERE id=$1 AND gym_id=$2 RETURNING *`,
      [zId.parse(ctx.params.id), u.gymId, b.name, b.name_ar ?? null, b.color, b.description ?? null, b.default_capacity, b.duration_min, b.women_only, b.active]);
    if (!row) throw notFound("class type");
    return row;
  });

  // ---- weekly schedule ----
  const schedSchema = z.object({
    class_type_id: zId,
    coach_id: zId.nullable().optional(),
    weekday: z.coerce.number().int().min(0).max(6),
    start_time: hhmm,
    duration_min: z.coerce.number().int().min(10).max(300),
    capacity: z.coerce.number().int().min(1).max(500),
    room: z.string().max(40).nullable().optional(),
    active: z.boolean().default(true),
  });
  async function checkRefs(q: Queryable, gymId: string, b: z.infer<typeof schedSchema>) {
    if (!(await one(q, "SELECT 1 FROM class_types WHERE id = $1 AND gym_id = $2", [b.class_type_id, gymId]))) throw notFound("class type");
    if (b.coach_id && !(await one(q, "SELECT 1 FROM users WHERE id = $1 AND gym_id = $2", [b.coach_id, gymId]))) throw notFound("coach");
  }
  r.get("/api/classes/schedules", async (ctx) => {
    const u = await requireStaff(ctx);
    return many(db, `SELECT s.*, to_char(s.start_time, 'HH24:MI') AS start_time, ct.name AS class_name, ct.color, us.name AS coach_name
                       FROM class_schedules s JOIN class_types ct ON ct.id = s.class_type_id LEFT JOIN users us ON us.id = s.coach_id
                      WHERE s.gym_id = $1 ORDER BY s.weekday, s.start_time`, [u.gymId]);
  });
  r.post("/api/classes/schedules", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const b = await ctx.body(schedSchema);
    return db.tx(async (q) => {
      await checkRefs(q, u.gymId, b);
      const row = await one(q, `INSERT INTO class_schedules (gym_id, class_type_id, coach_id, weekday, start_time, duration_min, capacity, room, active)
                                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [u.gymId, b.class_type_id, b.coach_id ?? null, b.weekday, b.start_time, b.duration_min, b.capacity, b.room ?? null, b.active]);
      await ensureSessions(q, u.gymId);
      return row;
    });
  });
  r.put("/api/classes/schedules/:id", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const b = await ctx.body(schedSchema);
    return db.tx(async (q) => {
      await checkRefs(q, u.gymId, b);
      const row = await one(q, `UPDATE class_schedules SET class_type_id=$3, coach_id=$4, weekday=$5, start_time=$6, duration_min=$7, capacity=$8, room=$9, active=$10
                                 WHERE id=$1 AND gym_id=$2 RETURNING *`,
        [zId.parse(ctx.params.id), u.gymId, b.class_type_id, b.coach_id ?? null, b.weekday, b.start_time, b.duration_min, b.capacity, b.room ?? null, b.active]);
      if (!row) throw notFound("schedule");
      await refreshSchedule(q, u.gymId, row.id);
      return row;
    });
  });
  r.del("/api/classes/schedules/:id", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    return db.tx(async (q) => {
      const row = await one(q, "UPDATE class_schedules SET active = false WHERE id = $1 AND gym_id = $2 RETURNING id", [zId.parse(ctx.params.id), u.gymId]);
      if (!row) throw notFound("schedule");
      await refreshSchedule(q, u.gymId, row.id);
      return { ok: true };
    });
  });

  // ---- dated sessions ----
  r.get("/api/classes/sessions", async (ctx) => {
    const u = await requireStaff(ctx);
    await ensureSessions(db, u.gymId);
    const from = ctx.query.get("from");
    const to = ctx.query.get("to");
    const vals: unknown[] = [u.gymId, from ? zDate.parse(from) : null, to ? zDate.parse(to) : null];
    let coachFilter = "";
    if (u.role === "coach") { vals.push(u.id); coachFilter = `AND s.coach_id = $${vals.length}`; }
    return many(db, `
      SELECT s.*, ct.name AS class_name, ct.name_ar AS class_name_ar, ct.color, ct.women_only, us.name AS coach_name,
             count(b.*) FILTER (WHERE b.status IN ('booked','attended'))::int AS booked,
             count(b.*) FILTER (WHERE b.status = 'waitlist')::int AS waitlist,
             count(b.*) FILTER (WHERE b.status = 'attended')::int AS attended
        FROM class_sessions s
        JOIN gyms g ON g.id = s.gym_id
        JOIN class_types ct ON ct.id = s.class_type_id
        LEFT JOIN users us ON us.id = s.coach_id
        LEFT JOIN bookings b ON b.session_id = s.id
       WHERE s.gym_id = $1
         AND (s.starts_at AT TIME ZONE g.timezone)::date >= coalesce($2::date, (now() AT TIME ZONE g.timezone)::date)
         AND (s.starts_at AT TIME ZONE g.timezone)::date <= coalesce($3::date, (now() AT TIME ZONE g.timezone)::date + 6)
         ${coachFilter}
       GROUP BY s.id, ct.id, us.name ORDER BY s.starts_at`, vals);
  });
  r.post("/api/classes/sessions", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const b = await ctx.body(z.object({ class_type_id: zId, coach_id: zId.nullable().optional(), starts_at: z.string().datetime({ offset: true }), duration_min: z.coerce.number().int().min(10).max(300), capacity: z.coerce.number().int().min(1).max(500), room: z.string().max(40).nullable().optional() }));
    if (!(await one(db, "SELECT 1 FROM class_types WHERE id = $1 AND gym_id = $2", [b.class_type_id, u.gymId]))) throw notFound("class type");
    return one(db, `INSERT INTO class_sessions (gym_id, class_type_id, coach_id, starts_at, ends_at, capacity, room)
                    VALUES ($1,$2,$3,$4::timestamptz,$4::timestamptz + make_interval(mins => $5),$6,$7) RETURNING *`,
      [u.gymId, b.class_type_id, b.coach_id ?? null, b.starts_at, b.duration_min, b.capacity, b.room ?? null]);
  });
  r.put("/api/classes/sessions/:id", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const b = await ctx.body(z.object({ cancelled: z.boolean().optional(), coach_id: zId.nullable().optional(), capacity: z.coerce.number().int().min(1).max(500).optional(), notify: z.boolean().default(true) }));
    return db.tx(async (q) => {
      const s = await one(q, `SELECT s.*, ct.name FROM class_sessions s JOIN class_types ct ON ct.id = s.class_type_id WHERE s.id = $1 AND s.gym_id = $2`, [zId.parse(ctx.params.id), u.gymId]);
      if (!s) throw notFound("class");
      const row = await one(q, `UPDATE class_sessions SET cancelled = coalesce($2, cancelled), coach_id = CASE WHEN $3::boolean THEN $4 ELSE coach_id END, capacity = coalesce($5, capacity) WHERE id = $1 RETURNING *`,
        [s.id, b.cancelled ?? null, b.coach_id !== undefined, b.coach_id ?? null, b.capacity ?? null]);
      if (b.cancelled && !s.cancelled && b.notify) {
        const people = await many(q, `SELECT m.id, m.first_name, m.phone, m.whatsapp_opt_in FROM bookings bk JOIN members m ON m.id = bk.member_id WHERE bk.session_id = $1 AND bk.status IN ('booked','waitlist')`, [s.id]);
        const when = new Date(s.starts_at).toLocaleString("en-GB", { timeZone: "Asia/Beirut", weekday: "long", hour: "2-digit", minute: "2-digit" });
        for (const p of people) {
          await notify(q, {
            gymId: u.gymId, memberId: p.id, kind: "class_cancelled", tab: "classes", dedupeKey: `cancel:${s.id}:${p.id}`,
            title: `${s.name} is cancelled`, body: `Sorry, ${s.name} on ${when} won't take place. Book another class in the app.`,
          });
          if (!p.phone || !p.whatsapp_opt_in) continue;
          await sendWhatsApp(q, { gymId: u.gymId, memberId: p.id, phone: p.phone, kind: "class_cancelled", body: `Hi ${p.first_name}, sorry: ${s.name} on ${when} is cancelled. Check the app for other classes 🙏`, dedupeKey: `cancel:${s.id}:${p.id}` });
        }
        await q.query("UPDATE bookings SET status = 'cancelled' WHERE session_id = $1 AND status IN ('booked','waitlist')", [s.id]);
      }
      await audit(q, u.gymId, u.id, "class.update", "class_session", s.id, b);
      return row;
    });
  });
  r.get("/api/classes/sessions/:id/bookings", async (ctx) => {
    const u = await requireStaff(ctx);
    const s = await one(db, "SELECT coach_id FROM class_sessions WHERE id = $1 AND gym_id = $2", [zId.parse(ctx.params.id), u.gymId]);
    if (!s) throw notFound("class");
    if (u.role === "coach" && s.coach_id !== u.id) throw forbidden();
    return many(db, `SELECT b.*, m.first_name, m.last_name, m.code, m.phone FROM bookings b JOIN members m ON m.id = b.member_id
                      WHERE b.session_id = $1 AND b.status <> 'cancelled' ORDER BY b.status, b.created_at`, [zId.parse(ctx.params.id)]);
  });
  r.post("/api/classes/sessions/:id/bookings", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager", "reception"]);
    const b = await ctx.body(z.object({ member_id: zId }));
    return db.tx((q) => bookSession(q, u.gymId, zId.parse(ctx.params.id), b.member_id, { byStaff: true }));
  });
  r.put("/api/bookings/:id", async (ctx) => {
    const u = await requireStaff(ctx);
    const b = await ctx.body(z.object({ status: z.enum(["attended", "no_show", "cancelled", "booked"]) }));
    const id = zId.parse(ctx.params.id);
    return db.tx(async (q) => {
      const bk = await one(q, `SELECT b.*, s.coach_id FROM bookings b JOIN class_sessions s ON s.id = b.session_id WHERE b.id = $1 AND b.gym_id = $2`, [id, u.gymId]);
      if (!bk) throw notFound("booking");
      if (u.role === "coach" && bk.coach_id !== u.id) throw forbidden();
      if (b.status === "cancelled") return cancelBooking(q, u.gymId, id, { byStaff: true });
      return one(q, "UPDATE bookings SET status = $2 WHERE id = $1 RETURNING *", [id, b.status]);
    });
  });

  // ---- personal training ----
  r.get("/api/pt/packages", async (ctx) => {
    const u = await requireStaff(ctx);
    const vals: unknown[] = [u.gymId];
    let filter = "";
    if (u.role === "coach") { vals.push(u.id); filter = `AND p.coach_id = $${vals.length}`; }
    else if (ctx.query.get("coach_id")) { vals.push(zId.parse(ctx.query.get("coach_id"))); filter = `AND p.coach_id = $${vals.length}`; }
    if (ctx.query.get("active") === "1") filter += " AND p.sessions_used < p.sessions_total AND (p.expires_on IS NULL OR p.expires_on >= current_date)";
    return many(db, `SELECT p.*, m.first_name, m.last_name, m.code, m.phone, us.name AS coach_name,
                            coalesce((SELECT sum(amount_usd) FROM payments WHERE pt_package_id = p.id AND voided_at IS NULL), 0) AS paid_usd
                       FROM pt_packages p JOIN members m ON m.id = p.member_id LEFT JOIN users us ON us.id = p.coach_id
                      WHERE p.gym_id = $1 ${filter} ORDER BY p.created_at DESC LIMIT 500`, vals);
  });
  r.post("/api/pt/packages", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager", "reception"]);
    const b = await ctx.body(z.object({
      member_id: zId, coach_id: zId.nullable().optional(), title: z.string().trim().min(1).max(80).default("Personal training"),
      sessions_total: z.coerce.number().int().min(1).max(500), session_min: z.coerce.number().int().min(15).max(240).default(60), price: zMoney, currency: zCurrency, expires_on: zDate.nullable().optional(), notes: z.string().max(500).nullable().optional(),
      payment: z.object({ amount: zMoney.refine((n) => n > 0), currency: zCurrency, method: zMethod, reference: z.string().max(80).nullable().optional() }).nullable().optional(),
    }));
    return db.tx(async (q) => {
      await getOverview(q, u.gymId, b.member_id);
      if (b.coach_id && !(await one(q, "SELECT 1 FROM users WHERE id = $1 AND gym_id = $2", [b.coach_id, u.gymId]))) throw notFound("coach");
      const rate = await gymRate(q, u.gymId);
      const pkg = await one(q, `INSERT INTO pt_packages (gym_id, member_id, coach_id, title, sessions_total, price, currency, price_usd, expires_on, notes, session_min)
                                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [u.gymId, b.member_id, b.coach_id ?? null, b.title, b.sessions_total, b.price, b.currency, toUsd(b.price, b.currency, rate), b.expires_on ?? null, b.notes ?? null, b.session_min]);
      let payment = null;
      if (b.payment) payment = await recordPayment(q, u.gymId, u.id, { member_id: b.member_id, pt_package_id: pkg!.id, ...b.payment });
      await audit(q, u.gymId, u.id, "pt.package.create", "pt_package", pkg!.id);
      return { package: pkg, payment };
    });
  });
  r.get("/api/pt/sessions", async (ctx) => {
    const u = await requireStaff(ctx);
    const vals: unknown[] = [u.gymId];
    let filter = "";
    if (u.role === "coach") { vals.push(u.id); filter = `AND ps.coach_id = $${vals.length}`; }
    return many(db, `SELECT ps.*, m.first_name, m.last_name, m.code, us.name AS coach_name, p.title, p.sessions_total, p.sessions_used
                       FROM pt_sessions ps JOIN members m ON m.id = ps.member_id JOIN pt_packages p ON p.id = ps.package_id LEFT JOIN users us ON us.id = ps.coach_id
                      WHERE ps.gym_id = $1 AND ps.starts_at > now() - interval '14 days' AND ps.starts_at < now() + interval '30 days' ${filter}
                      ORDER BY ps.starts_at`, vals);
  });
  r.post("/api/pt/sessions", async (ctx) => {
    const u = await requireStaff(ctx);
    const b = await ctx.body(z.object({ package_id: zId, starts_at: z.string().datetime({ offset: true }), notes: z.string().max(500).nullable().optional() }));
    const p = await one(db, "SELECT * FROM pt_packages WHERE id = $1 AND gym_id = $2", [b.package_id, u.gymId]);
    if (!p) throw notFound("PT package");
    if (u.role === "coach" && p.coach_id !== u.id) throw forbidden();
    const planned = await one(db, "SELECT count(*)::int AS n FROM pt_sessions WHERE package_id = $1 AND status = 'scheduled'", [p.id]);
    if (p.sessions_used + planned.n >= p.sessions_total) throw bad("package_full", "No sessions left on this package");
    return one(db, "INSERT INTO pt_sessions (gym_id, package_id, member_id, coach_id, starts_at, notes, duration_min) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
      [u.gymId, p.id, p.member_id, p.coach_id, b.starts_at, b.notes ?? null, p.session_min]);
  });
  r.put("/api/pt/sessions/:id", async (ctx) => {
    const u = await requireStaff(ctx);
    const b = await ctx.body(z.object({ status: z.enum(["scheduled", "done", "cancelled", "no_show"]).optional(), notes: z.string().max(1000).nullable().optional(), starts_at: z.string().datetime({ offset: true }).optional() }));
    return db.tx(async (q) => {
      const s = await one(q, "SELECT * FROM pt_sessions WHERE id = $1 AND gym_id = $2 FOR UPDATE", [zId.parse(ctx.params.id), u.gymId]);
      if (!s) throw notFound("PT session");
      if (u.role === "coach" && s.coach_id !== u.id) throw forbidden();
      const consumes = (st: string) => st === "done" || st === "no_show";
      if (b.status && consumes(b.status) !== consumes(s.status)) {
        await q.query(`UPDATE pt_packages SET sessions_used = sessions_used + $2 WHERE id = $1`, [s.package_id, consumes(b.status) ? 1 : -1]);
      }
      return one(q, "UPDATE pt_sessions SET status = coalesce($2, status), notes = coalesce($3, notes), starts_at = coalesce($4, starts_at) WHERE id = $1 RETURNING *",
        [s.id, b.status ?? null, b.notes ?? null, b.starts_at ?? null]);
    });
  });

  // ---- training programs ----
  r.post("/api/members/:id/programs", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager", "coach"]);
    const b = await ctx.body(z.object({ title: z.string().trim().min(1).max(100), content: z.string().trim().min(1).max(10000) }));
    const id = zId.parse(ctx.params.id);
    await getOverview(db, u.gymId, id);
    return one(db, "INSERT INTO programs (gym_id, member_id, coach_id, title, content) VALUES ($1,$2,$3,$4,$5) RETURNING *", [u.gymId, id, u.role === "coach" ? u.id : null, b.title, b.content]);
  });
  r.del("/api/programs/:id", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager", "coach"]);
    const vals: unknown[] = [zId.parse(ctx.params.id), u.gymId];
    const r2 = await db.query(`DELETE FROM programs WHERE id = $1 AND gym_id = $2 ${u.role === "coach" ? "AND coach_id = $3" : ""}`, u.role === "coach" ? [...vals, u.id] : vals);
    if (!r2.rowCount) throw notFound("program");
    return { ok: true };
  });
}
