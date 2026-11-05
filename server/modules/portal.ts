/** Member app API (/api/m/...) and public gym endpoints (branding, logo, manifest). */
import { z } from "zod";
import { db, one, many } from "../db/index.ts";
import { checkRateLimit, clearRateLimit, createSession, destroySession, hashPassword, requireMember, verifyPassword } from "../auth.ts";
import { bad, notFound, zId, zPhone, type Router } from "../http.ts";
import { bookSession, cancelBooking, ensureSessions } from "./classes.ts";
import { botReply } from "../ai/bot.ts";

async function gymBySlug(slug: string) {
  const g = await one(db, `SELECT id, slug, name, name_ar, tagline, brand_color, phone, whatsapp, instagram, address, city, locale, modules, settings, saas_status, (logo IS NOT NULL) AS has_logo
                             FROM gyms WHERE slug = $1`, [slug]);
  if (!g || g.saas_status === "suspended") throw notFound("gym");
  const { settings, saas_status, ...rest } = g;
  return { ...rest, hours: settings?.hours ?? [], ladiesHours: settings?.ladiesHours ?? [] };
}

export function registerPortal(r: Router) {
  // ---- public ----
  r.get("/api/public/gyms/:slug", async (ctx) => gymBySlug(ctx.params.slug));

  r.get("/api/public/gyms/:slug/logo", async (ctx) => {
    const g = await one(db, "SELECT logo, logo_mime FROM gyms WHERE slug = $1", [ctx.params.slug]);
    if (!g?.logo) throw notFound("logo");
    ctx.res.writeHead(200, { "Content-Type": g.logo_mime, "Cache-Control": "public, max-age=300", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" });
    ctx.res.end(g.logo);
    return undefined;
  });

  /** Per-gym PWA manifest: members install "their gym's" app with its name and colour. */
  r.get("/m/:slug/manifest.webmanifest", async (ctx) => {
    const g = await gymBySlug(ctx.params.slug);
    const icons = g.has_logo
      ? [{ src: `/api/public/gyms/${g.slug}/logo`, sizes: "512x512", purpose: "any" }]
      : [{ src: "/icon-512.png", sizes: "512x512", type: "image/png" }, { src: "/icon-192.png", sizes: "192x192", type: "image/png" }];
    ctx.res.writeHead(200, { "Content-Type": "application/manifest+json" });
    ctx.res.end(JSON.stringify({
      name: g.name, short_name: g.name.slice(0, 12), start_url: `/m/${g.slug}`, scope: `/m/${g.slug}`, display: "standalone",
      background_color: "#0F1115", theme_color: g.brand_color, icons,
    }));
    return undefined;
  });

  // ---- member auth: phone + 4-digit PIN given by reception ----
  r.post("/api/m/:slug/login", async (ctx) => {
    const g = await gymBySlug(ctx.params.slug);
    const b = await ctx.body(z.object({ phone: zPhone, pin: z.string().regex(/^\d{4,6}$/) }));
    const key = `member:${ctx.ip}:${g.id}:${b.phone}`;
    await checkRateLimit(key, 8);
    const candidates = await many(db, "SELECT id, pin_hash FROM members WHERE gym_id = $1 AND phone = $2 AND archived_at IS NULL AND pin_hash IS NOT NULL", [g.id, b.phone]);
    let found: string | null = null;
    for (const c of candidates) if (await verifyPassword(b.pin, c.pin_hash)) found = c.id;
    if (!found) throw bad("invalid_credentials", "Wrong phone or PIN. Ask reception for your PIN.");
    await clearRateLimit(key);
    await createSession(ctx, "member", { memberId: found, gymId: g.id });
    return { ok: true };
  });

  r.post("/api/m/logout", async (ctx) => {
    await destroySession(ctx, "member");
    return { ok: true };
  });

  r.get("/api/m/me", async (ctx) => {
    const me = await requireMember(ctx);
    const m = await one(db, `SELECT id, code, qr_token, first_name, last_name, phone, gender, status, plan_name, start_date, end_date, days_left,
                                    visits_total, visits_used, frozen_from, frozen_until, includes_classes, balance_usd, last_checkin
                               FROM member_overview WHERE id = $1`, [me.id]);
    const gym = await one(db, "SELECT slug FROM gyms WHERE id = $1", [me.gymId]);
    const stats = await one(db, `SELECT count(*) FILTER (WHERE at > now() - interval '30 days')::int AS visits_30d,
                                        count(*) FILTER (WHERE at > date_trunc('year', now()))::int AS visits_year,
                                        count(*)::int AS visits_total
                                   FROM checkins WHERE member_id = $1 AND result = 'ok'`, [me.id]);
    const streak = await one(db, `WITH w AS (SELECT DISTINCT date_trunc('week', at)::date AS wk FROM checkins WHERE member_id = $1 AND result = 'ok')
                                  SELECT count(*)::int AS weeks FROM (SELECT wk, row_number() OVER (ORDER BY wk DESC) AS rn FROM w) x
                                   WHERE wk = date_trunc('week', now())::date - ((rn::int - 1) * 7)`, [me.id]);
    return { member: m, gym: await gymBySlug(gym.slug), stats: { ...stats, week_streak: streak.weeks } };
  });

  r.put("/api/m/pin", async (ctx) => {
    const me = await requireMember(ctx);
    const b = await ctx.body(z.object({ current: z.string(), next: z.string().regex(/^\d{4,6}$/) }));
    const row = await one(db, "SELECT pin_hash FROM members WHERE id = $1", [me.id]);
    if (!(await verifyPassword(b.current, row.pin_hash))) throw bad("invalid_credentials", "Current PIN is wrong");
    await db.query("UPDATE members SET pin_hash = $2 WHERE id = $1", [me.id, await hashPassword(b.next)]);
    return { ok: true };
  });

  r.get("/api/m/classes", async (ctx) => {
    const me = await requireMember(ctx);
    await ensureSessions(db, me.gymId);
    return many(db, `
      SELECT s.id, s.starts_at, s.ends_at, s.capacity, s.room, ct.name, ct.name_ar, ct.color, ct.women_only, us.name AS coach_name,
             (SELECT count(*) FROM bookings b WHERE b.session_id = s.id AND b.status IN ('booked','attended'))::int AS booked,
             mb.id AS my_booking_id, mb.status AS my_status
        FROM class_sessions s JOIN class_types ct ON ct.id = s.class_type_id LEFT JOIN users us ON us.id = s.coach_id
        LEFT JOIN bookings mb ON mb.session_id = s.id AND mb.member_id = $2 AND mb.status <> 'cancelled'
       WHERE s.gym_id = $1 AND NOT s.cancelled AND s.ends_at > now() AND s.starts_at < now() + interval '8 days'
       ORDER BY s.starts_at`, [me.gymId, me.id]);
  });

  r.post("/api/m/classes/:id/book", async (ctx) => {
    const me = await requireMember(ctx);
    return db.tx((q) => bookSession(q, me.gymId, zId.parse(ctx.params.id), me.id, { byStaff: false }));
  });

  r.post("/api/m/bookings/:id/cancel", async (ctx) => {
    const me = await requireMember(ctx);
    return db.tx((q) => cancelBooking(q, me.gymId, zId.parse(ctx.params.id), { byStaff: false, memberId: me.id }));
  });

  r.get("/api/m/history", async (ctx) => {
    const me = await requireMember(ctx);
    const [checkins, payments, memberships, pt, programs] = await Promise.all([
      many(db, "SELECT at, result, reason FROM checkins WHERE member_id = $1 ORDER BY at DESC LIMIT 60", [me.id]),
      many(db, "SELECT receipt_no, amount, currency, method, paid_at FROM payments WHERE member_id = $1 AND voided_at IS NULL ORDER BY paid_at DESC LIMIT 30", [me.id]),
      many(db, "SELECT plan_name, start_date, end_date, status FROM memberships WHERE member_id = $1 ORDER BY start_date DESC LIMIT 20", [me.id]),
      many(db, `SELECT p.title, p.sessions_total, p.sessions_used, p.expires_on, us.name AS coach_name FROM pt_packages p LEFT JOIN users us ON us.id = p.coach_id WHERE p.member_id = $1 ORDER BY p.created_at DESC`, [me.id]),
      many(db, `SELECT p.id, p.title, p.content, p.created_at, us.name AS coach_name FROM programs p LEFT JOIN users us ON us.id = p.coach_id WHERE p.member_id = $1 ORDER BY p.created_at DESC`, [me.id]),
    ]);
    return { checkins, payments, memberships, pt, programs };
  });

  r.post("/api/m/ask", async (ctx) => {
    const me = await requireMember(ctx);
    const b = await ctx.body(z.object({ text: z.string().trim().min(1).max(1000), history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(2000) })).max(8).default([]) }));
    await checkRateLimit(`ask:${me.id}`, 40, 60);
    try {
      return await botReply(me.gymId, me.id, b.text, b.history);
    } catch {
      return { reply: "Sorry, I can't answer right now. Please message reception 🙏", handoff: true, mode: "offline" };
    }
  });
}
