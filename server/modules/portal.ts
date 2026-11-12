/** Member app API (/api/m/...) and public gym endpoints (branding, logo, manifest). */
import { z } from "zod";
import { db, one, many } from "../db/index.ts";
import { checkRateLimit, clearRateLimit, createSession, destroySession, endOtherSessions, guardLogin, hashPassword, noteLoginFailure, requireMember, verifyPassword } from "../auth.ts";
import { bad, notFound, zId, zPhone, type Router } from "../http.ts";
import { bookSession, cancelBooking, ensureSessions } from "./classes.ts";
import { botReply } from "../ai/bot.ts";
import { receiptByToken } from "../services/receipt.ts";
import { allowedEndpoint, vapidKeys } from "../services/webpush.ts";
import { NOTIFICATION_CATEGORIES, NOTIFICATION_TYPES, pushSettings } from "../services/notify.ts";

async function gymBySlug(slug: string) {
  const g = await one(db, `SELECT id, slug, name, name_ar, tagline, brand_color, phone, whatsapp, instagram, address, city, locale, modules, settings, saas_status, archived_at, (logo IS NOT NULL) AS has_logo,
                                  (app_icon_512 IS NOT NULL) AS has_app_icon, extract(epoch FROM app_icon_updated_at)::bigint AS icon_version
                             FROM gyms WHERE slug = $1`, [slug]);
  if (!g || g.saas_status === "suspended" || g.archived_at) throw notFound("gym");
  const { settings, saas_status, archived_at, ...rest } = g;
  return { ...rest, hours: settings?.hours ?? [], ladiesHours: settings?.ladiesHours ?? [], pushEnabled: pushSettings(settings).enabled };
}

/**
 * Head tags of the member app page for one gym, so the installed app gets the gym's name and icon
 * (iPhone reads them when the member taps "Add to Home Screen").
 */
export async function memberPageHead(slug: string) {
  const g = await one(db, `SELECT slug, name, tagline, (app_icon_512 IS NOT NULL) AS has_app_icon, extract(epoch FROM app_icon_updated_at)::bigint AS v
                             FROM gyms WHERE slug = $1 AND saas_status <> 'suspended' AND archived_at IS NULL`, [slug]).catch(() => null);
  if (!g) return null;
  const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const name = esc(g.name);
  const icon = g.has_app_icon ? `/api/public/gyms/${g.slug}/app-icon/192?v=${g.v}` : "/icon-192.png";
  return {
    title: name,
    tags: [
      `<meta name="apple-mobile-web-app-title" content="${name}">`,
      `<meta name="application-name" content="${name}">`,
      `<meta name="description" content="${esc(g.tagline ?? `${g.name}: your pass, classes and membership`)}">`,
      `<link rel="manifest" href="/m/${g.slug}/manifest.webmanifest">`,
      `<link rel="apple-touch-icon" href="${icon}">`,
    ].join("\n  "),
  };
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

  /** The gym's app icon (square PNG made from its logo); falls back to the GMS icon. */
  r.get("/api/public/gyms/:slug/app-icon/:size", async (ctx) => {
    const big = ctx.params.size !== "192";
    const g = await one(db, `SELECT ${big ? "app_icon_512" : "app_icon_192"} AS icon FROM gyms WHERE slug = $1`, [ctx.params.slug]);
    if (!g?.icon) {
      ctx.res.writeHead(302, { Location: big ? "/icon-512.png" : "/icon-192.png", "Cache-Control": "no-cache" });
      ctx.res.end();
      return undefined;
    }
    ctx.res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600", "Content-Security-Policy": "default-src 'none'" });
    ctx.res.end(g.icon);
    return undefined;
  });

  /**
   * Per-gym web app manifest: members install "their gym's" app, with its name, colour and icon.
   * On Android, Chrome turns it into a real installed app (WebAPK); on iPhone it's "Add to Home Screen".
   */
  r.get("/m/:slug/manifest.webmanifest", async (ctx) => {
    const g = await gymBySlug(ctx.params.slug);
    const v = g.icon_version ? `?v=${g.icon_version}` : "";
    const icons = g.has_app_icon
      ? [
          { src: `/api/public/gyms/${g.slug}/app-icon/192${v}`, sizes: "192x192", type: "image/png", purpose: "any" },
          { src: `/api/public/gyms/${g.slug}/app-icon/512${v}`, sizes: "512x512", type: "image/png", purpose: "any" },
          { src: `/api/public/gyms/${g.slug}/app-icon/512${v}`, sizes: "512x512", type: "image/png", purpose: "maskable" },
        ]
      : [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "/icon-512.png", sizes: "512x512", type: "image/png" }];
    ctx.res.writeHead(200, { "Content-Type": "application/manifest+json", "Cache-Control": "no-cache" });
    ctx.res.end(JSON.stringify({
      id: `/m/${g.slug}`, name: g.name, short_name: g.name.length > 14 ? g.name.split(/\s+/)[0].slice(0, 14) : g.name,
      description: g.tagline ?? `${g.name}: your pass, classes and membership`,
      start_url: `/m/${g.slug}?source=app`, scope: `/m/${g.slug}`, display: "standalone", orientation: "portrait",
      background_color: "#121821", theme_color: "#121821", categories: ["health", "fitness", "sports"], icons,
    }));
    return undefined;
  });

  /** Public receipt page, reached from the link sent to the member. */
  r.get("/r/:token", async (ctx) => {
    const html = await receiptByToken(ctx.params.token);
    ctx.res.writeHead(html ? 200 : 404, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" });
    ctx.res.end(html ?? "<!doctype html><meta charset=utf-8><title>Receipt not found</title><p style='font-family:sans-serif;padding:24px'>This receipt link is not valid. Ask the gym's reception for a new one.</p>");
    return undefined;
  });

  // ---- member auth: phone + PIN given by reception (6 digits; older ones have 4) ----
  r.post("/api/m/:slug/login", async (ctx) => {
    const g = await gymBySlug(ctx.params.slug);
    const b = await ctx.body(z.object({ phone: zPhone, pin: z.string().regex(/^\d{4,6}$/) }));
    // limited per member account (any address) and per address (any account)
    const keys = { account: `member:${g.id}:${b.phone}`, address: `member-ip:${ctx.ip}` };
    await guardLogin(keys);
    const candidates = await many(db, "SELECT id, pin_hash FROM members WHERE gym_id = $1 AND phone = $2 AND archived_at IS NULL AND pin_hash IS NOT NULL", [g.id, b.phone]);
    let found: string | null = null;
    for (const c of candidates) if (await verifyPassword(b.pin, c.pin_hash)) found = c.id;
    if (!found) {
      await noteLoginFailure(keys);
      throw bad("invalid_credentials", "Wrong phone or PIN. Ask reception for your PIN.");
    }
    await clearRateLimit(keys.account);
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
    const unread = await one(db, "SELECT count(*)::int AS n FROM notifications WHERE member_id = $1 AND read_at IS NULL AND send_after <= now()", [me.id]);
    const extra = await one(db, `SELECT (SELECT count(*) FROM pt_packages p WHERE p.member_id = $1 AND p.sessions_used < p.sessions_total AND (p.expires_on IS NULL OR p.expires_on >= current_date))::int AS pt_packages,
                                        (SELECT count(*) FROM pt_sessions s WHERE s.member_id = $1 AND s.status = 'scheduled' AND s.starts_at > now())::int AS pt_upcoming,
                                        (SELECT count(*) FROM products WHERE gym_id = $2 AND active AND in_app)::int AS products,
                                        m.created_at, m.app_prefs, g.settings, g.modules
                                   FROM members m JOIN gyms g ON g.id = m.gym_id WHERE m.id = $1`, [me.id, me.gymId]);
    // badges, challenges and referrals are extras: on by default only for gyms on the "everything" level
    const extras = (extra.settings?.level ?? "full") === "full";
    const es = { badges: extras, challenges: extras, leaderboard: extras, referrals: extras, ...(extra.settings?.engage ?? {}) };
    const pts = { memberBooking: true, ...(extra.settings?.pt ?? {}) };
    return {
      member: { ...m, member_since: extra.created_at }, gym: await gymBySlug(gym.slug), stats: { ...stats, week_streak: streak.weeks }, unread: unread.n,
      prefs: { weeklyGoal: Number(extra.app_prefs?.weeklyGoal ?? 2), hideOnLeaderboard: !!extra.app_prefs?.hideOnLeaderboard },
      features: {
        pt: extra.modules?.pt !== false && (extra.pt_packages > 0 || extra.pt_upcoming > 0), ptBooking: pts.memberBooking !== false,
        shop: extra.modules?.shop !== false && extra.products > 0, classes: extra.modules?.classes !== false, ai: extra.modules?.ai !== false,
        badges: es.badges !== false, challenges: es.challenges !== false, leaderboard: es.leaderboard !== false, referrals: es.referrals !== false,
      },
    };
  });

  r.put("/api/m/pin", async (ctx) => {
    const me = await requireMember(ctx);
    const b = await ctx.body(z.object({ current: z.string(), next: z.string().regex(/^\d{6}$/, "The new PIN must have 6 digits") }));
    const keys = { account: `member-pin:${me.id}`, address: `member-ip:${ctx.ip}` };
    await guardLogin(keys);
    const row = await one(db, "SELECT pin_hash FROM members WHERE id = $1", [me.id]);
    if (!(await verifyPassword(b.current, row.pin_hash))) {
      await noteLoginFailure(keys);
      throw bad("invalid_credentials", "Current PIN is wrong");
    }
    await db.query("UPDATE members SET pin_hash = $2 WHERE id = $1", [me.id, await hashPassword(b.next)]);
    await endOtherSessions(ctx, "member", me.id);
    return { ok: true };
  });

  r.get("/api/m/classes", async (ctx) => {
    const me = await requireMember(ctx);
    await ensureSessions(db, me.gymId);
    return many(db, `
      SELECT s.id, s.starts_at, s.ends_at, s.capacity, s.room, ct.name, ct.name_ar, ct.color, ct.women_only, ct.description, us.name AS coach_name,
             (extract(epoch FROM s.ends_at - s.starts_at) / 60)::int AS duration_min,
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
    const classCols = `s.id, s.starts_at, s.ends_at, (extract(epoch FROM s.ends_at - s.starts_at) / 60)::int AS duration_min, ct.name, ct.name_ar, ct.color, us.name AS coach_name, b.status, b.id AS booking_id`;
    const classFrom = `FROM bookings b JOIN class_sessions s ON s.id = b.session_id JOIN class_types ct ON ct.id = s.class_type_id LEFT JOIN users us ON us.id = s.coach_id`;
    const [checkins, payments, memberships, pt, programs, upcoming, attended] = await Promise.all([
      many(db, "SELECT at, result, reason FROM checkins WHERE member_id = $1 ORDER BY at DESC LIMIT 60", [me.id]),
      many(db, "SELECT receipt_no, amount, currency, method, paid_at, public_token FROM payments WHERE member_id = $1 AND voided_at IS NULL ORDER BY paid_at DESC LIMIT 30", [me.id]),
      many(db, "SELECT plan_name, start_date, end_date, status FROM memberships WHERE member_id = $1 ORDER BY start_date DESC LIMIT 20", [me.id]),
      many(db, `SELECT p.title, p.sessions_total, p.sessions_used, p.expires_on, us.name AS coach_name FROM pt_packages p LEFT JOIN users us ON us.id = p.coach_id WHERE p.member_id = $1 ORDER BY p.created_at DESC`, [me.id]),
      many(db, `SELECT p.id, p.title, p.content, p.created_at, us.name AS coach_name FROM programs p LEFT JOIN users us ON us.id = p.coach_id WHERE p.member_id = $1 ORDER BY p.created_at DESC`, [me.id]),
      many(db, `SELECT ${classCols} ${classFrom} WHERE b.member_id = $1 AND b.status IN ('booked','waitlist') AND NOT s.cancelled AND s.ends_at > now() ORDER BY s.starts_at LIMIT 20`, [me.id]),
      many(db, `SELECT ${classCols} ${classFrom} WHERE b.member_id = $1 AND b.status = 'attended' ORDER BY s.starts_at DESC LIMIT 20`, [me.id]),
    ]);
    return { checkins, payments, memberships, pt, programs, classes: { upcoming, attended } };
  });

  // ---- push notifications & inbox ----
  r.get("/api/m/push/key", async (ctx) => {
    await requireMember(ctx);
    return { publicKey: (await vapidKeys()).publicKey };
  });

  r.post("/api/m/push/subscribe", async (ctx) => {
    const me = await requireMember(ctx);
    const b = await ctx.body(z.object({
      endpoint: z.string().url().max(1000),
      keys: z.object({ p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/), auth: z.string().regex(/^[A-Za-z0-9_-]{16,32}$/) }),
    }));
    if (!allowedEndpoint(b.endpoint)) throw bad("unsupported_browser", "This browser's push service is not supported");
    // a device belongs to one member at a time (shared family phone: the last one who turned it on)
    await db.query(
      `INSERT INTO push_subscriptions (gym_id, member_id, endpoint, p256dh, auth, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (endpoint) DO UPDATE SET gym_id = EXCLUDED.gym_id, member_id = EXCLUDED.member_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, failures = 0`,
      [me.gymId, me.id, b.endpoint, b.keys.p256dh, b.keys.auth, String(ctx.req.headers["user-agent"] ?? "").slice(0, 200)],
    );
    return { ok: true };
  });

  r.post("/api/m/push/unsubscribe", async (ctx) => {
    const me = await requireMember(ctx);
    const b = await ctx.body(z.object({ endpoint: z.string().max(1000) }));
    await db.query("DELETE FROM push_subscriptions WHERE endpoint = $1 AND member_id = $2", [b.endpoint, me.id]);
    return { ok: true };
  });

  r.get("/api/m/notifications", async (ctx) => {
    const me = await requireMember(ctx);
    const [rows, m, gym] = await Promise.all([
      many(db, "SELECT id, kind, title, body, url, created_at, read_at FROM notifications WHERE member_id = $1 AND send_after <= now() ORDER BY created_at DESC LIMIT 50", [me.id]),
      one(db, "SELECT notify_prefs FROM members WHERE id = $1", [me.id]),
      one(db, "SELECT settings FROM gyms WHERE id = $1", [me.gymId]),
    ]);
    const ps = pushSettings(gym.settings);
    // only offer categories the gym actually sends
    const categories = NOTIFICATION_CATEGORIES.filter((c) => Object.entries(NOTIFICATION_TYPES).some(([k, t]) => t.category === c && ps.types[k as keyof typeof NOTIFICATION_TYPES] !== false));
    return {
      rows, unread: rows.filter((r) => !r.read_at).length, enabled: ps.enabled,
      categories: categories.map((c) => ({ key: c, on: m.notify_prefs?.[c] !== false })),
    };
  });

  r.post("/api/m/notifications/read", async (ctx) => {
    const me = await requireMember(ctx);
    await db.query("UPDATE notifications SET read_at = now() WHERE member_id = $1 AND read_at IS NULL AND send_after <= now()", [me.id]);
    return { ok: true };
  });

  r.put("/api/m/notifications/prefs", async (ctx) => {
    const me = await requireMember(ctx);
    const b = await ctx.body(z.object(Object.fromEntries(NOTIFICATION_CATEGORIES.map((c) => [c, z.boolean().optional()]))));
    await db.query("UPDATE members SET notify_prefs = notify_prefs || $2::jsonb WHERE id = $1", [me.id, JSON.stringify(b)]);
    return { ok: true };
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
