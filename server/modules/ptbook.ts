/**
 * Personal-training self-booking.
 * Each coach publishes weekly availability (and time off); a member with a PT package sees
 * their coach's free slots and books one or several (back-to-back is fine) within the
 * sessions left on the package. Cancelling is free until `cancelHours` before the session.
 */
import { z } from "zod";
import { db, many, one, audit, type Queryable } from "../db/index.ts";
import { requireMember, requireStaff } from "../auth.ts";
import { bad, forbidden, notFound, zId, type Router } from "../http.ts";

export interface PtSettings { memberBooking: boolean; cancelHours: number; bookAheadDays: number; minNoticeHours: number }
export const DEFAULT_PT: PtSettings = { memberBooking: true, cancelHours: 12, bookAheadDays: 14, minNoticeHours: 3 };
export const ptSettings = (settings: any): PtSettings => ({ ...DEFAULT_PT, ...(settings?.pt ?? {}) });

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM");

/**
 * Free slots of a coach: availability windows cut into `minutes`-long slots (local gym time),
 * minus the past and the notice period, PT sessions already scheduled with that coach,
 * classes the coach teaches and time off.
 */
export async function freeSlots(q: Queryable, gymId: string, coachId: string, minutes: number, opts: { days: number; minNoticeHours: number }) {
  return many(q, `
    WITH g AS (SELECT timezone AS tz, (now() AT TIME ZONE timezone)::date AS today FROM gyms WHERE id = $1),
    win AS (
      SELECT d::date AS day, a.start_time, a.end_time FROM g
        CROSS JOIN generate_series(g.today, g.today + $4::int, interval '1 day') d
        JOIN coach_availability a ON a.coach_id = $2 AND a.gym_id = $1 AND a.weekday = extract(dow FROM d)::int),
    slots AS (
      SELECT DISTINCT (t AT TIME ZONE g.tz) AS starts_at FROM win, g,
        generate_series(win.day + win.start_time, win.day + win.end_time - make_interval(mins => $3), make_interval(mins => $3)) t)
    SELECT s.starts_at FROM slots s
     WHERE s.starts_at >= now() + make_interval(hours => $5)
       AND NOT EXISTS (SELECT 1 FROM pt_sessions ps WHERE ps.coach_id = $2 AND ps.status = 'scheduled'
                         AND ps.starts_at < s.starts_at + make_interval(mins => $3) AND ps.starts_at + make_interval(mins => ps.duration_min) > s.starts_at)
       AND NOT EXISTS (SELECT 1 FROM class_sessions cs WHERE cs.coach_id = $2 AND NOT cs.cancelled
                         AND cs.starts_at < s.starts_at + make_interval(mins => $3) AND cs.ends_at > s.starts_at)
       AND NOT EXISTS (SELECT 1 FROM coach_time_off o WHERE o.coach_id = $2
                         AND o.starts_at < s.starts_at + make_interval(mins => $3) AND o.ends_at > s.starts_at)
     ORDER BY s.starts_at`, [gymId, coachId, minutes, opts.days, opts.minNoticeHours]);
}

/** Sessions still bookable on a package: total − done/no-show − already scheduled. */
async function remaining(q: Queryable, pkgId: string) {
  const r = await one(q, `SELECT p.sessions_total - p.sessions_used - (SELECT count(*) FROM pt_sessions s WHERE s.package_id = p.id AND s.status = 'scheduled') AS n
                            FROM pt_packages p WHERE p.id = $1`, [pkgId]);
  return Number(r?.n ?? 0);
}

async function memberPackage(q: Queryable, memberId: string, gymId: string, pkgId: string, lock = false) {
  const p = await one(q, `SELECT p.*, us.name AS coach_name FROM pt_packages p LEFT JOIN users us ON us.id = p.coach_id
                           WHERE p.id = $1 AND p.member_id = $2 AND p.gym_id = $3 ${lock ? "FOR UPDATE OF p" : ""}`, [pkgId, memberId, gymId]);
  if (!p) throw notFound("PT package");
  return p;
}

export function registerPtBooking(r: Router) {
  // ================= staff: availability =================
  r.get("/api/pt/availability", async (ctx) => {
    const u = await requireStaff(ctx);
    const coaches = await many(db, `SELECT id, name, role FROM users WHERE gym_id = $1 AND active AND (role = 'coach' OR EXISTS (SELECT 1 FROM pt_packages p WHERE p.coach_id = users.id))
                                     ${u.role === "coach" ? "AND id = $2" : ""} ORDER BY name`, u.role === "coach" ? [u.gymId, u.id] : [u.gymId]);
    const coachId = u.role === "coach" ? u.id : ctx.query.get("coach_id") ? zId.parse(ctx.query.get("coach_id")) : coaches[0]?.id ?? null;
    if (!coachId) return { coaches, coach_id: null, windows: [], timeOff: [], upcoming: 0 };
    const [windows, timeOff, upcoming] = await Promise.all([
      many(db, "SELECT id, weekday, to_char(start_time, 'HH24:MI') AS start_time, to_char(end_time, 'HH24:MI') AS end_time FROM coach_availability WHERE coach_id = $1 AND gym_id = $2 ORDER BY weekday, start_time", [coachId, u.gymId]),
      many(db, "SELECT id, starts_at, ends_at, note FROM coach_time_off WHERE coach_id = $1 AND gym_id = $2 AND ends_at > now() ORDER BY starts_at", [coachId, u.gymId]),
      one(db, "SELECT count(*)::int AS n FROM pt_sessions WHERE coach_id = $1 AND status = 'scheduled' AND starts_at > now()", [coachId]),
    ]);
    return { coaches, coach_id: coachId, windows, timeOff, upcoming: upcoming.n };
  });

  r.put("/api/pt/availability/:coachId", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager", "coach"]);
    const coachId = zId.parse(ctx.params.coachId);
    if (u.role === "coach" && coachId !== u.id) throw forbidden("Coaches can only change their own availability");
    const b = await ctx.body(z.object({
      windows: z.array(z.object({ weekday: z.number().int().min(0).max(6), start_time: hhmm, end_time: hhmm }).refine((w) => w.end_time > w.start_time, "end must be after start")).max(60),
    }));
    // overlapping windows on the same day would create duplicate slots
    const byDay = new Map<number, { s: string; e: string }[]>();
    for (const w of b.windows) byDay.set(w.weekday, [...(byDay.get(w.weekday) ?? []), { s: w.start_time, e: w.end_time }]);
    for (const list of byDay.values()) {
      list.sort((a, c) => a.s.localeCompare(c.s));
      for (let i = 1; i < list.length; i++) if (list[i].s < list[i - 1].e) throw bad("overlap", "Two time ranges overlap on the same day");
    }
    return db.tx(async (q) => {
      if (!(await one(q, "SELECT 1 FROM users WHERE id = $1 AND gym_id = $2", [coachId, u.gymId]))) throw notFound("coach");
      await q.query("DELETE FROM coach_availability WHERE coach_id = $1 AND gym_id = $2", [coachId, u.gymId]);
      for (const w of b.windows) {
        await q.query("INSERT INTO coach_availability (gym_id, coach_id, weekday, start_time, end_time) VALUES ($1,$2,$3,$4,$5)", [u.gymId, coachId, w.weekday, w.start_time, w.end_time]);
      }
      await audit(q, u.gymId, u.id, "pt.availability.update", "user", coachId, { windows: b.windows.length });
      return { ok: true, windows: b.windows.length };
    });
  });

  r.post("/api/pt/time-off", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager", "coach"]);
    const b = await ctx.body(z.object({ coach_id: zId, starts_at: z.string().datetime({ offset: true }), ends_at: z.string().datetime({ offset: true }), note: z.string().max(120).nullable().optional() })
      .refine((x) => x.ends_at > x.starts_at, { message: "The end must be after the start", path: ["ends_at"] }));
    if (u.role === "coach" && b.coach_id !== u.id) throw forbidden();
    if (!(await one(db, "SELECT 1 FROM users WHERE id = $1 AND gym_id = $2", [b.coach_id, u.gymId]))) throw notFound("coach");
    const clash = await one(db, "SELECT count(*)::int AS n FROM pt_sessions WHERE coach_id = $1 AND status = 'scheduled' AND starts_at < $3 AND starts_at + make_interval(mins => duration_min) > $2", [b.coach_id, b.starts_at, b.ends_at]);
    const row = await one(db, "INSERT INTO coach_time_off (gym_id, coach_id, starts_at, ends_at, note) VALUES ($1,$2,$3,$4,$5) RETURNING *", [u.gymId, b.coach_id, b.starts_at, b.ends_at, b.note ?? null]);
    return { ...row, sessions_to_move: clash.n };
  });

  r.del("/api/pt/time-off/:id", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager", "coach"]);
    const r2 = await db.query(`DELETE FROM coach_time_off WHERE id = $1 AND gym_id = $2 ${u.role === "coach" ? "AND coach_id = $3" : ""}`,
      u.role === "coach" ? [zId.parse(ctx.params.id), u.gymId, u.id] : [zId.parse(ctx.params.id), u.gymId]);
    if (!r2.rowCount) throw notFound("time off");
    return { ok: true };
  });

  r.get("/api/pt/slots", async (ctx) => {
    const u = await requireStaff(ctx);
    const coachId = u.role === "coach" ? u.id : zId.parse(ctx.query.get("coach_id"));
    const minutes = Math.min(240, Math.max(15, Number(ctx.query.get("minutes") ?? 60) || 60));
    const days = Math.min(60, Math.max(1, Number(ctx.query.get("days") ?? 14) || 14));
    return freeSlots(db, u.gymId, coachId, minutes, { days, minNoticeHours: 0 });
  });

  // ================= member app =================
  r.get("/api/m/pt", async (ctx) => {
    const me = await requireMember(ctx);
    const gym = await one(db, "SELECT settings, modules FROM gyms WHERE id = $1", [me.gymId]);
    const s = ptSettings(gym.settings);
    const [packages, upcoming, past] = await Promise.all([
      many(db, `SELECT p.id, p.title, p.sessions_total, p.sessions_used, p.session_min, p.expires_on, p.coach_id, us.name AS coach_name, us.bio AS coach_bio,
                       p.sessions_total - p.sessions_used - (SELECT count(*) FROM pt_sessions s WHERE s.package_id = p.id AND s.status = 'scheduled')::int AS bookable,
                       (SELECT count(*) FROM coach_availability a WHERE a.coach_id = p.coach_id)::int > 0 AS coach_has_hours
                  FROM pt_packages p LEFT JOIN users us ON us.id = p.coach_id
                 WHERE p.member_id = $1 AND p.sessions_used < p.sessions_total AND (p.expires_on IS NULL OR p.expires_on >= current_date)
                 ORDER BY p.created_at DESC`, [me.id]),
      many(db, `SELECT s.id, s.starts_at, s.duration_min, s.status, s.package_id, us.name AS coach_name,
                       s.starts_at - now() > make_interval(hours => $2) AS can_cancel
                  FROM pt_sessions s LEFT JOIN users us ON us.id = s.coach_id
                 WHERE s.member_id = $1 AND s.status = 'scheduled' AND s.starts_at > now() - interval '2 hours' ORDER BY s.starts_at`, [me.id, s.cancelHours]),
      many(db, `SELECT s.id, s.starts_at, s.duration_min, s.status, us.name AS coach_name FROM pt_sessions s LEFT JOIN users us ON us.id = s.coach_id
                 WHERE s.member_id = $1 AND s.status IN ('done','no_show') ORDER BY s.starts_at DESC LIMIT 10`, [me.id]),
    ]);
    return { settings: { cancelHours: s.cancelHours, bookAheadDays: s.bookAheadDays, memberBooking: s.memberBooking && gym.modules?.pt !== false }, packages, upcoming, past };
  });

  r.get("/api/m/pt/slots", async (ctx) => {
    const me = await requireMember(ctx);
    const pkg = await memberPackage(db, me.id, me.gymId, zId.parse(ctx.query.get("package_id")));
    if (!pkg.coach_id) return [];
    const gym = await one(db, "SELECT settings FROM gyms WHERE id = $1", [me.gymId]);
    const s = ptSettings(gym.settings);
    return freeSlots(db, me.gymId, pkg.coach_id, pkg.session_min, { days: s.bookAheadDays, minNoticeHours: s.minNoticeHours });
  });

  r.post("/api/m/pt/book", async (ctx) => {
    const me = await requireMember(ctx);
    const b = await ctx.body(z.object({ package_id: zId, starts: z.array(z.string().datetime({ offset: true })).min(1).max(10) }));
    return db.tx(async (q) => {
      const gym = await one(q, "SELECT settings, modules FROM gyms WHERE id = $1", [me.gymId]);
      const s = ptSettings(gym.settings);
      if (!s.memberBooking || gym.modules?.pt === false) throw bad("booking_closed", "Booking from the app is turned off: ask reception or your coach");
      const pkg = await memberPackage(q, me.id, me.gymId, b.package_id, true);
      if (!pkg.coach_id) throw bad("no_coach", "This package has no coach yet: ask reception");
      if (pkg.expires_on && pkg.expires_on < new Date().toISOString().slice(0, 10)) throw bad("package_expired", "This package has expired");
      // one booking at a time per coach, so two members can't take the same slot
      await q.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`pt:${pkg.coach_id}`]);
      const left = await remaining(q, pkg.id);
      const wanted = [...new Set(b.starts.map((x) => new Date(x).toISOString()))].sort();
      if (wanted.length > left) throw bad("not_enough_sessions", left > 0 ? `You have ${left} session${left > 1 ? "s" : ""} left to book` : "No sessions left on this package");
      const free = new Set((await freeSlots(q, me.gymId, pkg.coach_id, pkg.session_min, { days: s.bookAheadDays, minNoticeHours: s.minNoticeHours }))
        .map((x) => new Date(x.starts_at).toISOString()));
      const taken = wanted.filter((w) => !free.has(w));
      if (taken.length) throw bad("slot_taken", "One of these times was just taken. Pick another one.", { taken });
      const rows: any[] = [];
      for (const w of wanted) {
        rows.push(await one(q, `INSERT INTO pt_sessions (gym_id, package_id, member_id, coach_id, starts_at, duration_min, booked_by)
                                VALUES ($1,$2,$3,$4,$5,$6,'member') RETURNING id, starts_at, duration_min`, [me.gymId, pkg.id, me.id, pkg.coach_id, w, pkg.session_min]));
      }
      return { sessions: rows, left: left - rows.length };
    });
  });

  r.post("/api/m/pt/sessions/:id/cancel", async (ctx) => {
    const me = await requireMember(ctx);
    return db.tx(async (q) => {
      const s = await one(q, "SELECT * FROM pt_sessions WHERE id = $1 AND member_id = $2 FOR UPDATE", [zId.parse(ctx.params.id), me.id]);
      if (!s) throw notFound("session");
      if (s.status !== "scheduled") throw bad("not_scheduled", "This session is no longer scheduled");
      const gym = await one(q, "SELECT settings FROM gyms WHERE id = $1", [me.gymId]);
      const { cancelHours } = ptSettings(gym.settings);
      if (new Date(s.starts_at).getTime() - Date.now() < cancelHours * 3600_000) {
        throw bad("too_late", `Sessions can be cancelled up to ${cancelHours} hours before. Message your coach or reception.`);
      }
      await q.query("UPDATE pt_sessions SET status = 'cancelled', notes = coalesce(notes || ' · ', '') || 'Cancelled by the member in the app' WHERE id = $1", [s.id]);
      return { ok: true };
    });
  });
}
