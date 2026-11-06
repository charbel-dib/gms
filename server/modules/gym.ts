import { z } from "zod";
import { db, one, many, audit } from "../db/index.ts";
import {
  checkRateLimit, clearRateLimit, createSession, destroySession, encryptSecret, hashPassword,
  randomPassword, requireStaff, verifyPassword,
} from "../auth.ts";
import { bad, notFound, zCurrency, zId, type Router } from "../http.ts";
import { TEMPLATES } from "../templates.ts";
import { clampModules } from "../services/plans.ts";

const GYM_PUBLIC_COLS = `id, slug, name, name_ar, tagline, brand_color, phone, whatsapp, email, instagram, address, city,
  timezone, default_currency, lbp_rate, locale, modules, settings, saas_plan, saas_status, trial_ends_at, saas_paid_until,
  (logo IS NOT NULL) AS has_logo`;

/** Strips secrets from gym settings before sending them to a browser. */
export function publicSettings(settings: any) {
  const s = structuredClone(settings ?? {});
  if (s.whatsapp) {
    s.whatsapp = { phoneNumberId: s.whatsapp.phoneNumberId ?? null, businessNumber: s.whatsapp.businessNumber ?? null, hasToken: !!s.whatsapp.tokenEnc };
  }
  return s;
}

export async function loadGym(gymId: string) {
  const g = await one(db, `SELECT ${GYM_PUBLIC_COLS} FROM gyms WHERE id = $1`, [gymId]);
  if (!g) throw notFound("gym");
  g.settings = publicSettings(g.settings);
  return g;
}

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const settingsSchema = z.object({
  hours: z.array(z.object({ day: z.number().int().min(0).max(6), open: hhmm, close: hhmm, closed: z.boolean().optional() })).max(7).optional(),
  ladiesHours: z.array(z.object({ day: z.number().int().min(0).max(6), from: hhmm, to: hhmm })).max(21).optional(),
  checkin: z.object({
    graceDays: z.number().int().min(0).max(30),
    blockOnBalance: z.boolean(),
    cooldownMinutes: z.number().int().min(0).max(1440),
  }).partial().optional(),
  reminders: z.object({
    enabled: z.boolean(),
    daysBefore: z.array(z.number().int().min(0).max(60)).max(5),
    afterExpiryDays: z.array(z.number().int().min(1).max(90)).max(5),
    winback: z.boolean(),
    templateEn: z.string().max(1000),
    templateAr: z.string().max(1000),
  }).partial().optional(),
  whatsapp: z.object({
    phoneNumberId: z.string().max(40).nullable(),
    businessNumber: z.string().max(30).nullable(),
    token: z.string().max(600).optional(), // write-only, stored encrypted
  }).partial().optional(),
  receiptFooter: z.string().max(300).optional(),
  push: z.object({
    enabled: z.boolean(),
    classReminderHours: z.number().int().min(1).max(24),
    ptReminderHours: z.number().int().min(1).max(24),
    quietFrom: hhmm,
    quietTo: hhmm,
    types: z.record(z.string(), z.boolean()),
  }).partial().optional(),
});

const gymUpdateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  name_ar: z.string().trim().max(80).nullable(),
  tagline: z.string().trim().max(120).nullable(),
  brand_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  phone: z.string().max(30).nullable(),
  whatsapp: z.string().max(30).nullable(),
  email: z.string().email().max(120).nullable().or(z.literal("").transform(() => null)),
  instagram: z.string().max(60).nullable(),
  address: z.string().max(200).nullable(),
  city: z.string().max(60).nullable(),
  default_currency: zCurrency,
  lbp_rate: z.coerce.number().positive().max(10_000_000),
  locale: z.enum(["en", "ar"]),
  modules: z.record(z.string(), z.boolean()),
  settings: settingsSchema,
}).partial();

const planSchema = z.object({
  name: z.string().trim().min(1).max(60),
  name_ar: z.string().trim().max(60).nullable().optional(),
  kind: z.enum(["time", "visits"]),
  duration_days: z.coerce.number().int().min(1).max(3650),
  visits: z.coerce.number().int().min(1).max(1000).nullable().optional(),
  price: z.coerce.number().min(0).max(1e10),
  currency: zCurrency,
  includes_classes: z.boolean().default(true),
  gender_restriction: z.enum(["male", "female"]).nullable().optional(),
  freeze_days_allowed: z.coerce.number().int().min(0).max(365).default(0),
  description: z.string().max(300).nullable().optional(),
  active: z.boolean().default(true),
  sort: z.coerce.number().int().default(0),
}).refine((p) => p.kind === "time" || (p.visits ?? 0) > 0, { message: "visits is required for visit packs", path: ["visits"] });

const staffSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(120),
  phone: z.string().max(30).nullable().optional(),
  role: z.enum(["owner", "manager", "reception", "coach"]),
  active: z.boolean().default(true),
  bio: z.string().max(500).nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  commission_pct: z.coerce.number().min(0).max(100).default(0),
  password: z.string().min(8).max(100).optional(),
});

export function registerGym(r: Router) {
  // ---------- auth ----------
  r.post("/api/auth/login", async (ctx) => {
    const b = await ctx.body(z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) }));
    const key = `staff:${ctx.ip}:${b.email}`;
    await checkRateLimit(key);
    const u = await one(db, `SELECT u.id, u.gym_id, u.password_hash, u.active, g.saas_status FROM users u LEFT JOIN gyms g ON g.id = u.gym_id WHERE lower(u.email) = $1`, [b.email]);
    if (!u || !u.active || !(await verifyPassword(b.password, u.password_hash))) throw bad("invalid_credentials", "Wrong email or password");
    if (u.saas_status === "suspended") throw bad("gym_suspended", "This gym's subscription is suspended. Contact GMS support.");
    await clearRateLimit(key);
    await createSession(ctx, "staff", { userId: u.id, gymId: u.gym_id });
    await db.query("UPDATE users SET last_login_at = now() WHERE id = $1", [u.id]);
    return { ok: true };
  });

  r.post("/api/auth/logout", async (ctx) => {
    await destroySession(ctx, "staff");
    return { ok: true };
  });

  r.get("/api/auth/me", async (ctx) => {
    let gym = null;
    try {
      const u = await requireStaff(ctx);
      gym = await loadGym(u.gymId);
    } catch (e: any) {
      if (e.code !== "gym_required") throw e;
    }
    return { user: ctx.user, gym };
  });

  r.post("/api/auth/password", async (ctx) => {
    const u = await requireStaff(ctx).catch(async (e) => {
      if (e.code === "gym_required" && ctx.user) return { ...ctx.user, gymId: "" };
      throw e;
    });
    const b = await ctx.body(z.object({ current: z.string(), next: z.string().min(8).max(100) }));
    const row = await one(db, "SELECT password_hash FROM users WHERE id = $1", [u.id]);
    if (!(await verifyPassword(b.current, row.password_hash))) throw bad("invalid_credentials", "Current password is wrong");
    await db.query("UPDATE users SET password_hash = $2 WHERE id = $1", [u.id, await hashPassword(b.next)]);
    return { ok: true };
  });

  // ---------- gym profile & settings ----------
  r.get("/api/gym", async (ctx) => {
    const u = await requireStaff(ctx);
    return loadGym(u.gymId);
  });

  r.put("/api/gym", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const b = await ctx.body(gymUpdateSchema);
    const current = await one(db, "SELECT settings, modules, saas_plan FROM gyms WHERE id = $1", [u.gymId]);
    const sets: string[] = [];
    const vals: unknown[] = [u.gymId];
    const add = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    for (const k of ["name", "name_ar", "tagline", "brand_color", "phone", "whatsapp", "email", "instagram", "address", "city", "default_currency", "lbp_rate", "locale"] as const) {
      if (b[k] !== undefined) add(k, b[k]);
    }
    if (b.modules) add("modules", clampModules(current.saas_plan, { ...current.modules, ...b.modules }));
    if (b.settings) {
      const next: any = { ...current.settings };
      for (const [k, v] of Object.entries(b.settings)) {
        if (k === "whatsapp") {
          const wa = v as any;
          const prev = next.whatsapp ?? {};
          next.whatsapp = {
            phoneNumberId: wa.phoneNumberId !== undefined ? wa.phoneNumberId : prev.phoneNumberId ?? null,
            businessNumber: wa.businessNumber !== undefined ? wa.businessNumber : prev.businessNumber ?? null,
            tokenEnc: wa.token ? encryptSecret(wa.token) : wa.token === "" ? null : prev.tokenEnc ?? null,
          };
        } else if (v && typeof v === "object" && !Array.isArray(v)) next[k] = { ...(next[k] ?? {}), ...v };
        else next[k] = v;
      }
      add("settings", next);
    }
    if (!sets.length) return loadGym(u.gymId);
    await db.query(`UPDATE gyms SET ${sets.join(", ")} WHERE id = $1`, vals);
    await audit(db, u.gymId, u.id, "gym.update", "gym", u.gymId, { fields: Object.keys(b) });
    return loadGym(u.gymId);
  });

  r.put("/api/gym/logo", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const b = await ctx.body(z.object({ dataUrl: z.string().max(2_800_000).nullable() }));
    if (b.dataUrl === null) {
      await db.query("UPDATE gyms SET logo = NULL, logo_mime = NULL WHERE id = $1", [u.gymId]);
      return { ok: true };
    }
    const m = /^data:(image\/(png|jpeg|webp|svg\+xml));base64,([A-Za-z0-9+/=]+)$/.exec(b.dataUrl);
    if (!m) throw bad("invalid_image", "Logo must be a PNG, JPEG, WEBP or SVG image");
    const buf = Buffer.from(m[3], "base64");
    if (buf.length > 1_500_000) throw bad("image_too_large", "Logo must be under 1.5 MB");
    await db.query("UPDATE gyms SET logo = $2, logo_mime = $3 WHERE id = $1", [u.gymId, buf, m[1]]);
    return { ok: true };
  });

  r.get("/api/templates", async (ctx) => {
    await requireStaff(ctx).catch(() => null);
    return TEMPLATES.map((t) => ({ key: t.key, label: t.label, description: t.description, plans: t.plans.length, classes: t.classTypes.length }));
  });

  // ---------- staff ----------
  r.get("/api/staff", async (ctx) => {
    const u = await requireStaff(ctx);
    const cols = ["owner", "manager", "superadmin"].includes(u.role)
      ? "id, name, email, phone, role, active, bio, color, commission_pct, last_login_at, created_at"
      : "id, name, role, color, bio";
    return many(db, `SELECT ${cols} FROM users WHERE gym_id = $1 ORDER BY active DESC, role, name`, [u.gymId]);
  });

  r.post("/api/staff", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const b = await ctx.body(staffSchema);
    if (b.role === "owner" && u.role !== "owner" && u.role !== "superadmin") throw bad("forbidden_role", "Only an owner can add another owner");
    const password = b.password ?? randomPassword();
    const exists = await one(db, "SELECT 1 FROM users WHERE lower(email) = lower($1)", [b.email]);
    if (exists) throw bad("email_taken", "This email is already used by another account");
    const row = await one(
      db,
      `INSERT INTO users (gym_id, email, name, phone, role, active, bio, color, commission_pct, password_hash)
       VALUES ($1, lower($2), $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [u.gymId, b.email, b.name, b.phone ?? null, b.role, b.active, b.bio ?? null, b.color ?? null, b.commission_pct, await hashPassword(password)],
    );
    await audit(db, u.gymId, u.id, "staff.create", "user", row.id, { role: b.role });
    return { id: row.id, temporaryPassword: b.password ? undefined : password };
  });

  r.put("/api/staff/:id", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const b = await ctx.body(staffSchema.partial().extend({ resetPassword: z.boolean().optional() }));
    const target = await one(db, "SELECT id, role FROM users WHERE id = $1 AND gym_id = $2", [zId.parse(ctx.params.id), u.gymId]);
    if (!target) throw notFound("staff member");
    if ((target.role === "owner" || b.role === "owner") && u.role !== "owner" && u.role !== "superadmin") throw bad("forbidden_role", "Only an owner can change an owner");
    if (target.id === u.id && b.active === false) throw bad("cannot_deactivate_self", "You cannot deactivate your own account");
    let temporaryPassword: string | undefined;
    const sets: string[] = [];
    const vals: unknown[] = [target.id];
    const add = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    for (const k of ["name", "phone", "role", "active", "bio", "color", "commission_pct"] as const) if (b[k] !== undefined) add(k, b[k]);
    if (b.email) add("email", b.email.toLowerCase());
    if (b.resetPassword) {
      temporaryPassword = randomPassword();
      add("password_hash", await hashPassword(temporaryPassword));
    }
    if (sets.length) await db.query(`UPDATE users SET ${sets.join(", ")} WHERE id = $1`, vals);
    if (b.active === false || b.resetPassword) await db.query("DELETE FROM sessions WHERE user_id = $1", [target.id]);
    await audit(db, u.gymId, u.id, "staff.update", "user", target.id, { fields: Object.keys(b) });
    return { ok: true, temporaryPassword };
  });

  // ---------- plans ----------
  r.get("/api/plans", async (ctx) => {
    const u = await requireStaff(ctx);
    return many(db, `SELECT p.*, (SELECT count(*) FROM memberships m WHERE m.plan_id = p.id) AS sold FROM plans p WHERE gym_id = $1 ORDER BY active DESC, sort, price`, [u.gymId]);
  });

  r.post("/api/plans", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const p = await ctx.body(planSchema);
    const row = await one(
      db,
      `INSERT INTO plans (gym_id, name, name_ar, kind, duration_days, visits, price, currency, includes_classes, gender_restriction, freeze_days_allowed, description, active, sort)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [u.gymId, p.name, p.name_ar ?? null, p.kind, p.duration_days, p.kind === "visits" ? p.visits : null, p.price, p.currency, p.includes_classes, p.gender_restriction ?? null, p.freeze_days_allowed, p.description ?? null, p.active, p.sort],
    );
    return row;
  });

  r.put("/api/plans/:id", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const p = await ctx.body(planSchema);
    const row = await one(
      db,
      `UPDATE plans SET name=$3, name_ar=$4, kind=$5, duration_days=$6, visits=$7, price=$8, currency=$9, includes_classes=$10,
              gender_restriction=$11, freeze_days_allowed=$12, description=$13, active=$14, sort=$15
        WHERE id = $1 AND gym_id = $2 RETURNING *`,
      [zId.parse(ctx.params.id), u.gymId, p.name, p.name_ar ?? null, p.kind, p.duration_days, p.kind === "visits" ? p.visits : null, p.price, p.currency, p.includes_classes, p.gender_restriction ?? null, p.freeze_days_allowed, p.description ?? null, p.active, p.sort],
    );
    if (!row) throw notFound("plan");
    return row;
  });

  r.get("/api/audit", async (ctx) => {
    const u = await requireStaff(ctx, ["owner"]);
    return many(db, `SELECT a.*, us.name AS user_name FROM audit_log a LEFT JOIN users us ON us.id = a.user_id WHERE a.gym_id = $1 ORDER BY a.at DESC LIMIT 200`, [u.gymId]);
  });
}
