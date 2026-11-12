/** GMS platform console (super-admin): onboard gyms, plans, billing status, demo data. */
import { z } from "zod";
import { db, one, many, audit } from "../db/index.ts";
import { checkRateLimit, encryptSecret, randomPassword, requireSuperadmin } from "../auth.ts";
import { config } from "../config.ts";
import { HttpError, bad, notFound, zDate, zId, zPhone, type Router } from "../http.ts";
import { provisionGym } from "../services/provision.ts";
import { TEMPLATES } from "../templates.ts";
import { seedDemoActivity } from "../services/demo.ts";
import { clampModules, PLAN_PRICES, type SaasPlan } from "../services/plans.ts";
import { getTemplate, levelModules } from "../templates.ts";
import { setupSql } from "../services/setup.ts";
import { notifyOperator } from "../services/telegram.ts";

const DEMO_STATUSES = ["new", "contacted", "demo_booked", "won", "lost"] as const;

export function registerAdmin(r: Router) {
  // ---------- demo requests from the GMS website ----------
  r.post("/api/public/demo-requests", async (ctx) => {
    const b = await ctx.body(z.object({
      name: z.string().trim().min(2).max(80),
      gym_name: z.string().trim().min(2).max(100),
      city: z.string().trim().max(60).nullable().optional(),
      phone: zPhone,
      email: z.string().trim().email().max(120).nullable().optional().or(z.literal("").transform(() => null)),
      members: z.enum(["<100", "100-300", "300+"]).nullable().optional(),
      message: z.string().trim().max(1000).nullable().optional(),
      website: z.string().max(200).optional(), // honeypot: people never fill it, bots do
    }));
    await checkRateLimit(`demo:${ctx.ip}`, 5, 60);
    if (b.website) return { ok: true };
    await db.query(`INSERT INTO demo_requests (name, gym_name, city, phone, email, members, message, ip) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [b.name, b.gym_name, b.city ?? null, b.phone, b.email ?? null, b.members ?? null, b.message ?? null, ctx.ip]);
    // tell the operator on Telegram right away (if connected); never slows down or fails the form
    const line = [`New free-month request: ${b.name}, ${b.gym_name}`, [b.city, b.members ? `${b.members} members` : null].filter(Boolean).join(", "), b.message, `WhatsApp: ${b.phone}`].filter(Boolean).join("\n");
    queueMicrotask(() => { notifyOperator(line); });
    return { ok: true };
  });

  r.get("/api/admin/demo-requests", async (ctx) => {
    await requireSuperadmin(ctx);
    return many(db, "SELECT id, name, gym_name, city, phone, email, members, message, status, notes, created_at FROM demo_requests ORDER BY (status = 'new') DESC, created_at DESC LIMIT 300");
  });

  r.put("/api/admin/demo-requests/:id", async (ctx) => {
    const su = await requireSuperadmin(ctx);
    const b = await ctx.body(z.object({ status: z.enum(DEMO_STATUSES).optional(), notes: z.string().max(1000).nullable().optional() }));
    const row = await one(db, "UPDATE demo_requests SET status = coalesce($2, status), notes = CASE WHEN $4 THEN $3 ELSE notes END WHERE id = $1 RETURNING id, status",
      [zId.parse(ctx.params.id), b.status ?? null, b.notes ?? null, b.notes !== undefined]);
    if (!row) throw notFound("demo request");
    await audit(db, null, su.id, "demo_request.update", "demo_request", row.id, b);
    return row;
  });

  // The main list shows the gyms you work with; ?archived=1 shows the ones that left.
  r.get("/api/admin/gyms", async (ctx) => {
    await requireSuperadmin(ctx);
    const archived = ctx.query.get("archived") === "1";
    const rows = await many(db, `
      SELECT g.id, g.slug, g.name, g.city, g.phone, g.saas_plan, g.saas_status, g.saas_price_usd, g.saas_paid_until, g.trial_ends_at, g.created_at, g.is_demo,
             g.settings->'whatsapp'->>'phoneNumberId' AS wa_phone_number_id, g.settings->'whatsapp'->>'businessNumber' AS wa_business_number,
             (g.settings->'whatsapp'->>'tokenEnc') IS NOT NULL AS wa_has_token,
             (SELECT count(*) FROM member_overview mo WHERE mo.gym_id = g.id AND mo.archived_at IS NULL AND mo.status IN ('active','expiring'))::int AS active_members,
             (SELECT count(*) FROM checkins c WHERE c.gym_id = g.id AND c.at > now() - interval '7 days')::int AS checkins_7d,
             (SELECT max(u.last_login_at) FROM users u WHERE u.gym_id = g.id) AS last_login,
             (SELECT u.email FROM users u WHERE u.gym_id = g.id AND u.role = 'owner' ORDER BY created_at LIMIT 1) AS owner_email,
             (SELECT u.phone FROM users u WHERE u.gym_id = g.id AND u.role = 'owner' ORDER BY created_at LIMIT 1) AS owner_phone,
             (SELECT max(c.at) FROM checkins c WHERE c.gym_id = g.id) AS last_checkin,
             g.settings->>'level' AS level, ${setupSql("g")} AS setup, g.archived_at, g.archived_reason
        FROM gyms g WHERE (g.archived_at IS NOT NULL) = $1
       ORDER BY ${archived ? "g.archived_at" : "g.created_at"} DESC`, [archived]);
    const archivedCount = Number((await one(db, "SELECT count(*) AS n FROM gyms WHERE archived_at IS NOT NULL"))?.n ?? 0);
    const mrr = rows.filter((g) => g.saas_status === "active").reduce((s, g) => s + Number(g.saas_price_usd), 0);
    return { rows, totals: { gyms: rows.length, active: rows.filter((g) => g.saas_status === "active").length, trial: rows.filter((g) => g.saas_status === "trial").length, mrr: archived ? 0 : mrr, archived: archivedCount } };
  });

  r.get("/api/admin/templates", async (ctx) => {
    await requireSuperadmin(ctx);
    return TEMPLATES.map((t) => ({ key: t.key, label: t.label, description: t.description }));
  });

  r.post("/api/admin/gyms", async (ctx) => {
    const su = await requireSuperadmin(ctx);
    const b = await ctx.body(z.object({
      name: z.string().trim().min(2).max(80),
      name_ar: z.string().trim().max(80).nullable().optional(),
      slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,40}$/, "lowercase letters, digits and dashes"),
      city: z.string().max(60).nullable().optional(),
      phone: z.string().max(30).nullable().optional(),
      brand_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#E4572E"),
      template: z.enum(TEMPLATES.map((t) => t.key) as [string, ...string[]]),
      saas_plan: z.enum(["starter", "pro", "elite"]).default("pro"),
      level: z.enum(["essential", "studio", "full"]).default("essential"),
      owner_name: z.string().trim().min(2).max(80),
      owner_email: z.string().trim().email(),
      owner_phone: z.string().max(30).nullable().optional(),
      demo_data: z.boolean().default(false),
    }));
    if (await one(db, "SELECT 1 FROM gyms WHERE slug = $1", [b.slug])) throw bad("slug_taken", "This web address is already used");
    if (await one(db, "SELECT 1 FROM users WHERE lower(email) = lower($1)", [b.owner_email])) throw bad("email_taken", "This owner email already has an account");
    const password = randomPassword();
    const out = await db.tx(async (q) => {
      const ids = await provisionGym(q, { ...b, owner: { name: b.owner_name, email: b.owner_email, phone: b.owner_phone, password } });
      // the owner replaces the temporary password at first sign-in; a gym with demo data is a demo gym
      await q.query("UPDATE users SET must_change_password = true WHERE id = $1", [ids.ownerId]);
      if (b.demo_data) await q.query("UPDATE gyms SET is_demo = true WHERE id = $1", [ids.gymId]);
      await audit(q, ids.gymId, su.id, "gym.create", "gym", ids.gymId, { template: b.template });
      return ids;
    });
    if (b.demo_data) await seedDemoActivity(out.gymId, { members: 120, days: 180 });
    return { ...out, ownerEmail: b.owner_email, temporaryPassword: password };
  });

  r.put("/api/admin/gyms/:id", async (ctx) => {
    const su = await requireSuperadmin(ctx);
    const b = await ctx.body(z.object({
      saas_plan: z.enum(["starter", "pro", "elite"]).optional(),
      saas_status: z.enum(["trial", "active", "past_due", "suspended"]).optional(),
      saas_price_usd: z.coerce.number().min(0).max(10000).optional(),
      saas_paid_until: zDate.nullable().optional(),
      trial_ends_at: zDate.nullable().optional(),
      modules: z.record(z.string(), z.boolean()).optional(),
    }));
    const id = zId.parse(ctx.params.id);
    const g = await one(db, "SELECT modules, saas_plan, settings FROM gyms WHERE id = $1", [id]);
    if (!g) throw notFound("gym");
    const plan: SaasPlan = b.saas_plan ?? g.saas_plan;
    // upgrading turns the plan's features on; downgrading turns the extra ones off
    // a change of plan re-applies the gym's chosen level: what the new plan allows comes on, nothing beyond the level
    const base = b.saas_plan && b.saas_plan !== g.saas_plan ? { ...g.modules, ...levelModules(g.settings?.level ?? "full") } : g.modules;
    const nextModules = clampModules(plan, { ...base, ...(b.modules ?? {}) });
    if (b.saas_plan && b.saas_price_usd === undefined) b.saas_price_usd = PLAN_PRICES[plan];
    await db.query(
      `UPDATE gyms SET saas_plan = coalesce($2, saas_plan), saas_status = coalesce($3, saas_status), saas_price_usd = coalesce($4, saas_price_usd),
              saas_paid_until = CASE WHEN $5::boolean THEN $6::date ELSE saas_paid_until END,
              trial_ends_at = CASE WHEN $7::boolean THEN $8::date ELSE trial_ends_at END, modules = $9 WHERE id = $1`,
      [id, b.saas_plan ?? null, b.saas_status ?? null, b.saas_price_usd ?? null, b.saas_paid_until !== undefined, b.saas_paid_until ?? null,
        b.trial_ends_at !== undefined, b.trial_ends_at ?? null, nextModules],
    );
    if (b.saas_status === "suspended") await db.query("DELETE FROM sessions WHERE gym_id = $1", [id]);
    await audit(db, id, su.id, "gym.platform_update", "gym", id, b);
    return { ok: true };
  });

  // Archive: the gym leaves the main list, its team and members are signed out and can no longer sign in,
  // reminders stop. Every row is kept, so restoring brings it back exactly as it was.
  r.post("/api/admin/gyms/:id/archive", async (ctx) => {
    const su = await requireSuperadmin(ctx);
    const id = zId.parse(ctx.params.id);
    const b = await ctx.body(z.object({ reason: z.string().trim().min(2).max(500) }));
    const g = await one(db, "UPDATE gyms SET archived_at = now(), archived_reason = $2 WHERE id = $1 AND archived_at IS NULL RETURNING id, name", [id, b.reason]);
    if (!g) throw notFound("gym");
    await db.query("DELETE FROM sessions WHERE gym_id = $1", [id]);
    await audit(db, id, su.id, "gym.archive", "gym", id, { reason: b.reason });
    return { ok: true };
  });

  r.post("/api/admin/gyms/:id/restore", async (ctx) => {
    const su = await requireSuperadmin(ctx);
    const id = zId.parse(ctx.params.id);
    const g = await one(db, "UPDATE gyms SET archived_at = NULL, archived_reason = NULL WHERE id = $1 AND archived_at IS NOT NULL RETURNING id, archived_at", [id]);
    if (!g) throw notFound("archived gym");
    await audit(db, id, su.id, "gym.restore", "gym", id);
    return { ok: true };
  });

  // Delete for good: only an archived gym, and only when its exact address (slug) is typed back.
  // Every member, payment, check-in and account of the gym goes with it. This cannot be undone.
  r.del("/api/admin/gyms/:id", async (ctx) => {
    const su = await requireSuperadmin(ctx);
    const id = zId.parse(ctx.params.id);
    const b = await ctx.body(z.object({ confirm: z.string().trim() }));
    const g = await one(db, "SELECT id, slug, name, archived_at, archived_reason FROM gyms WHERE id = $1", [id]);
    if (!g) throw notFound("gym");
    if (!g.archived_at) throw new HttpError(409, "not_archived", "Archive the gym first. Only an archived gym can be deleted.");
    if (b.confirm !== g.slug) throw new HttpError(400, "confirm_mismatch", `Type the gym's address "${g.slug}" to confirm.`);
    const counts = await one(db, `SELECT (SELECT count(*) FROM members WHERE gym_id = $1)::int AS members, (SELECT count(*) FROM payments WHERE gym_id = $1)::int AS payments`, [id]);
    await db.tx(async (q) => {
      await q.query("DELETE FROM sessions WHERE gym_id = $1", [id]);
      await q.query("DELETE FROM gyms WHERE id = $1", [id]);
      // the gym's own log goes with it; this line stays in the platform log
      await audit(q, null, su.id, "gym.delete", "gym", id, { slug: g.slug, name: g.name, archived_reason: g.archived_reason, ...counts });
    });
    return { ok: true };
  });

  r.post("/api/admin/gyms/:id/reset-owner", async (ctx) => {
    const su = await requireSuperadmin(ctx);
    const id = zId.parse(ctx.params.id);
    const owner = await one(db, "SELECT id, email FROM users WHERE gym_id = $1 AND role = 'owner' ORDER BY created_at LIMIT 1", [id]);
    if (!owner) throw notFound("owner");
    const password = randomPassword();
    const { hashPassword } = await import("../auth.ts");
    await db.query("UPDATE users SET password_hash = $2, active = true, must_change_password = true WHERE id = $1", [owner.id, await hashPassword(password)]);
    await db.query("DELETE FROM sessions WHERE user_id = $1", [owner.id]);
    await audit(db, id, su.id, "gym.reset_owner", "user", owner.id);
    return { email: owner.email, temporaryPassword: password };
  });

  r.post("/api/admin/gyms/:id/demo-data", async (ctx) => {
    const su = await requireSuperadmin(ctx);
    const id = zId.parse(ctx.params.id);
    const g = await one(db, "SELECT is_demo FROM gyms WHERE id = $1", [id]);
    if (!g) throw notFound("gym");
    // fake members and payments would mix with a real gym's records
    if (!g.is_demo) throw bad("not_a_demo_gym", "Demo data can only be added to a gym created as a demo");
    await audit(db, id, su.id, "gym.demo_data", "gym", id);
    return seedDemoActivity(id, { members: 120, days: 180 });
  });

  /**
   * WhatsApp Cloud API number of a gym: set by GMS only. A number belongs to one gym
   * (unique in the database too), and a gym's number is used with that gym's own token.
   */
  r.put("/api/admin/gyms/:id/whatsapp", async (ctx) => {
    const su = await requireSuperadmin(ctx);
    const id = zId.parse(ctx.params.id);
    const b = await ctx.body(z.object({
      phoneNumberId: z.string().trim().regex(/^\d{6,30}$/, "The phone number ID is the long number from Meta's WhatsApp Manager").nullable(),
      businessNumber: z.string().trim().max(30).nullable().optional(),
      token: z.string().trim().max(600).optional(), // write-only; "" removes it
    }));
    const g = await one(db, "SELECT settings FROM gyms WHERE id = $1", [id]);
    if (!g) throw notFound("gym");
    if (b.phoneNumberId) {
      const other = await one(db, "SELECT name FROM gyms WHERE id <> $1 AND settings->'whatsapp'->>'phoneNumberId' = $2", [id, b.phoneNumberId]);
      if (other) throw bad("number_taken", `This WhatsApp number is already connected to ${other.name}`);
    }
    const prev = g.settings?.whatsapp ?? {};
    const next = {
      phoneNumberId: b.phoneNumberId,
      businessNumber: b.businessNumber !== undefined ? b.businessNumber : prev.businessNumber ?? null,
      tokenEnc: b.token ? encryptSecret(b.token) : b.token === "" ? null : prev.tokenEnc ?? null,
    };
    if (next.phoneNumberId && !next.tokenEnc && next.phoneNumberId !== config.whatsapp.phoneNumberId) {
      throw bad("token_required", "Add this number's access token: a gym's number never uses the GMS token");
    }
    await db.query("UPDATE gyms SET settings = jsonb_set(settings, '{whatsapp}', $2::jsonb) WHERE id = $1", [id, JSON.stringify(next)]);
    await audit(db, id, su.id, "gym.whatsapp", "gym", id, { phoneNumberId: next.phoneNumberId, token: b.token === undefined ? "kept" : b.token ? "set" : "removed" });
    return { ok: true, phoneNumberId: next.phoneNumberId, businessNumber: next.businessNumber, hasToken: !!next.tokenEnc };
  });
}
