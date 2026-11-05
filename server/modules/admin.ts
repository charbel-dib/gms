/** GMS platform console (super-admin): onboard gyms, plans, billing status, demo data. */
import { z } from "zod";
import { db, one, many, audit } from "../db/index.ts";
import { randomPassword, requireSuperadmin } from "../auth.ts";
import { bad, notFound, zDate, zId, type Router } from "../http.ts";
import { provisionGym } from "../services/provision.ts";
import { TEMPLATES } from "../templates.ts";
import { seedDemoActivity } from "../services/demo.ts";
import { clampModules, PLAN_PRICES, type SaasPlan } from "../services/plans.ts";
import { getTemplate } from "../templates.ts";

export function registerAdmin(r: Router) {
  r.get("/api/admin/gyms", async (ctx) => {
    await requireSuperadmin(ctx);
    const rows = await many(db, `
      SELECT g.id, g.slug, g.name, g.city, g.phone, g.saas_plan, g.saas_status, g.saas_price_usd, g.saas_paid_until, g.trial_ends_at, g.created_at,
             (SELECT count(*) FROM member_overview mo WHERE mo.gym_id = g.id AND mo.archived_at IS NULL AND mo.status IN ('active','expiring'))::int AS active_members,
             (SELECT count(*) FROM checkins c WHERE c.gym_id = g.id AND c.at > now() - interval '7 days')::int AS checkins_7d,
             (SELECT max(u.last_login_at) FROM users u WHERE u.gym_id = g.id) AS last_login,
             (SELECT u.email FROM users u WHERE u.gym_id = g.id AND u.role = 'owner' ORDER BY created_at LIMIT 1) AS owner_email
        FROM gyms g ORDER BY g.created_at DESC`);
    const mrr = rows.filter((g) => g.saas_status === "active").reduce((s, g) => s + Number(g.saas_price_usd), 0);
    return { rows, totals: { gyms: rows.length, active: rows.filter((g) => g.saas_status === "active").length, trial: rows.filter((g) => g.saas_status === "trial").length, mrr } };
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
    const base = b.saas_plan && b.saas_plan !== g.saas_plan ? { ...g.modules, ...getTemplate(g.settings?.template ?? "classic").modules } : g.modules;
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

  r.post("/api/admin/gyms/:id/reset-owner", async (ctx) => {
    const su = await requireSuperadmin(ctx);
    const id = zId.parse(ctx.params.id);
    const owner = await one(db, "SELECT id, email FROM users WHERE gym_id = $1 AND role = 'owner' ORDER BY created_at LIMIT 1", [id]);
    if (!owner) throw notFound("owner");
    const password = randomPassword();
    const { hashPassword } = await import("../auth.ts");
    await db.query("UPDATE users SET password_hash = $2, active = true WHERE id = $1", [owner.id, await hashPassword(password)]);
    await db.query("DELETE FROM sessions WHERE user_id = $1", [owner.id]);
    await audit(db, id, su.id, "gym.reset_owner", "user", owner.id);
    return { email: owner.email, temporaryPassword: password };
  });

  r.post("/api/admin/gyms/:id/demo-data", async (ctx) => {
    await requireSuperadmin(ctx);
    const id = zId.parse(ctx.params.id);
    if (!(await one(db, "SELECT 1 FROM gyms WHERE id = $1", [id]))) throw notFound("gym");
    return seedDemoActivity(id, { members: 120, days: 180 });
  });
}
