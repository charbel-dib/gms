/**
 * Load testing on a real deployment, for the platform operator only.
 *
 * - POST   /api/admin/loadtest/seed    creates fake gyms "load-01"… with members and months of history (in the background)
 * - POST   /api/admin/loadtest/kit     returns session tokens for those fake gyms, and a key to read the server status
 * - GET    /api/loadtest/status        server health while the test runs (memory, CPU, event loop, database pool)
 * - DELETE /api/admin/loadtest         deletes every fake gym (in the background)
 *
 * Everything only ever touches gyms whose slug starts with "load-", created here and marked as demo gyms.
 * The tokens give access to those fake gyms only, and expire after 24 hours.
 */
import crypto from "node:crypto";
import os from "node:os";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { z } from "zod";
import { db, one, many } from "../db/index.ts";
import { hashPassword, requireSuperadmin } from "../auth.ts";
import { HttpError, bad, type Router } from "../http.ts";
import { provisionGym } from "../services/provision.ts";
import { seedDemoActivity } from "../services/demo.ts";

const PREFIX = "load-";
const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

// progress lives in the database, so every app task sees the same thing
async function getState(): Promise<any> {
  return (await one(db, "SELECT value FROM platform_settings WHERE key = 'loadtest'"))?.value ?? { phase: "idle" };
}
async function setState(patch: Record<string, unknown>) {
  await db.query(
    `INSERT INTO platform_settings (key, value) VALUES ('loadtest', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = platform_settings.value || EXCLUDED.value, updated_at = now()`,
    [JSON.stringify({ ...patch, updatedAt: new Date().toISOString() })],
  );
}
// a run moves forward at least every few seconds per gym; one that has not moved for 3 minutes died with its server
const stalled = (s: any) => (s.phase === "seeding" || s.phase === "deleting") && Date.now() - Date.parse(s.updatedAt ?? 0) >= 3 * 60_000;
async function busy() {
  const s = await getState();
  return (s.phase === "seeding" || s.phase === "deleting") && !stalled(s);
}

async function seed(gyms: number, members: number, days: number) {
  const started = Date.now();
  await setState({ phase: "seeding", done: 0, total: gyms, error: null, startedAt: new Date().toISOString(), gyms, members, days });
  try {
    const pw = await hashPassword("demo12345");
    const pin = await hashPassword("1234");
    for (let i = 1; i <= gyms; i++) {
      const slug = `${PREFIX}${String(i).padStart(2, "0")}`;
      const existing = await one(db, "SELECT id, (SELECT count(*) FROM members m WHERE m.gym_id = g.id)::int AS n FROM gyms g WHERE slug = $1", [slug]);
      if (existing && existing.n >= members) { await setState({ done: i }); continue; }
      if (existing) await db.query("DELETE FROM gyms WHERE id = $1", [existing.id]); // half-made by an interrupted run
      const level = i % 5 === 0 ? "essential" : i % 3 === 0 ? "full" : "studio";
      const plan = level === "essential" ? "starter" : level === "full" ? "elite" : "pro";
      const { gymId } = await db.tx((q) => provisionGym(q, {
        slug, name: `Load test ${i}`, template: i % 4 === 0 ? "crossfit" : "classic", brand_color: "#0F5E8C", city: "Beirut",
        saas_plan: plan, level, phone: "+96171000000",
        owner: { name: "Load test owner", email: `owner@${slug}.loadtest.gms`, password: crypto.randomBytes(18).toString("base64url") },
      }));
      await db.query("INSERT INTO users (gym_id, email, name, password_hash, role) VALUES ($1, $2, 'Load test desk', $3, 'reception')", [gymId, `reception@${slug}.loadtest.gms`, pw]);
      await db.query(`UPDATE gyms SET is_demo = true, saas_status = 'active', saas_paid_until = current_date + 30,
                      settings = settings || '{"setup":{"prices":true,"logoSkipped":true}}'::jsonb WHERE id = $1`, [gymId]);
      await seedDemoActivity(gymId, { members, days, seed: i * 131 });
      await db.query("UPDATE members SET pin_hash = $2, whatsapp_opt_in = false WHERE gym_id = $1", [gymId, pin]);
      await setState({ done: i, seconds: Math.round((Date.now() - started) / 1000) });
    }
    await setState({ phase: "ready", seconds: Math.round((Date.now() - started) / 1000) });
  } catch (e) {
    await setState({ phase: "failed", error: String((e as Error).message ?? e) }).catch(() => {});
  }
}

async function removeAll() {
  const started = Date.now();
  const rows = await many(db, "SELECT id FROM gyms WHERE slug LIKE $1 AND is_demo", [`${PREFIX}%`]);
  await setState({ phase: "deleting", done: 0, total: rows.length, error: null, startedAt: new Date().toISOString(), seconds: 0 });
  try {
    for (let i = 0; i < rows.length; i++) {
      await db.query("DELETE FROM gyms WHERE id = $1", [rows[i].id]);
      await setState({ done: i + 1, seconds: Math.round((Date.now() - started) / 1000) });
    }
    await db.query("DELETE FROM platform_settings WHERE key = 'loadtest'");
  } catch (e) {
    await setState({ phase: "failed", error: String((e as Error).message ?? e) }).catch(() => {});
  }
}

// ---- server health, sampled continuously ----
const loop = monitorEventLoopDelay({ resolution: 10 });
loop.enable();
let lastCpu = process.cpuUsage();
let lastAt = performance.now();
let sample = { loopP50: 0, loopP99: 0, loopMax: 0, cpuPct: 0 };
setInterval(() => {
  const cpu = process.cpuUsage(lastCpu);
  const ms = performance.now() - lastAt;
  sample = {
    loopP50: +(loop.percentile(50) / 1e6).toFixed(1),
    loopP99: +(loop.percentile(99) / 1e6).toFixed(1),
    loopMax: +(loop.max / 1e6).toFixed(1),
    cpuPct: Math.round(((cpu.user + cpu.system) / 1000 / ms) * 100),
  };
  loop.reset();
  lastCpu = process.cpuUsage();
  lastAt = performance.now();
}, 5000).unref();

export function registerLoadtest(r: Router) {
  r.post("/api/admin/loadtest/seed", async (ctx) => {
    await requireSuperadmin(ctx);
    const b = await ctx.body(z.object({
      gyms: z.coerce.number().int().min(1).max(60).default(50),
      members: z.coerce.number().int().min(50).max(2500).default(1700),
      days: z.coerce.number().int().min(14).max(200).default(150),
    }));
    if (await busy()) throw new HttpError(409, "loadtest_busy", "A seeding or a clean-up is already running.");
    queueMicrotask(() => { seed(b.gyms, b.members, b.days); });
    return { started: true, ...b };
  });

  r.del("/api/admin/loadtest", async (ctx) => {
    await requireSuperadmin(ctx);
    if (await busy()) throw new HttpError(409, "loadtest_busy", "A seeding or a clean-up is already running.");
    await db.query("DELETE FROM sessions WHERE ip = 'loadtest'");
    queueMicrotask(() => { removeAll(); });
    return { started: true };
  });

  r.post("/api/admin/loadtest/kit", async (ctx) => {
    await requireSuperadmin(ctx);
    const b = await ctx.body(z.object({ members_per_gym: z.coerce.number().int().min(1).max(1000).default(300) }));
    const gyms = await many(db, "SELECT id, slug FROM gyms WHERE slug LIKE $1 AND is_demo ORDER BY slug", [`${PREFIX}%`]);
    if (!gyms.length) throw bad("no_load_gyms", "Create the test gyms first.");
    await db.query("DELETE FROM sessions WHERE ip = 'loadtest'");
    // tokens are made here and stored in one insert per gym (a request per token would be too slow on a small database)
    const out: any[] = [];
    for (const g of gyms) {
      const rows: [string, string, string | null, string | null][] = [];
      const mint = (kind: "staff" | "member", ids: { userId?: string; memberId?: string }) => {
        const token = crypto.randomBytes(32).toString("base64url");
        rows.push([sha256(token), kind, ids.userId ?? null, ids.memberId ?? null]);
        return token;
      };
      const staff = await many(db, "SELECT id, role FROM users WHERE gym_id = $1 AND role IN ('owner','reception')", [g.id]);
      const owner = staff.find((s) => s.role === "owner");
      const desk = staff.find((s) => s.role === "reception");
      const mem = await many(db,
        `SELECT mo.id, mo.code, mo.first_name FROM member_overview mo
          WHERE mo.gym_id = $1 AND mo.archived_at IS NULL AND mo.status IN ('active','expiring') ORDER BY random() LIMIT $2`,
        [g.id, b.members_per_gym]);
      const entry = {
        slug: g.slug,
        owner: owner ? mint("staff", { userId: owner.id }) : null,
        desk: desk ? mint("staff", { userId: desk.id }) : null,
        members: mem.map((m) => ({ id: m.id, code: m.code, name: m.first_name, token: mint("member", { memberId: m.id }) })),
      };
      await db.query(
        `INSERT INTO sessions (token_hash, kind, user_id, member_id, gym_id, expires_at, ip, user_agent)
         SELECT t.h, t.k, t.u::uuid, t.m::uuid, $5, now() + interval '24 hours', 'loadtest', 'gms-loadtest'
           FROM unnest($1::text[], $2::text[], $3::text[], $4::text[]) AS t(h, k, u, m)`,
        [rows.map((r) => r[0]), rows.map((r) => r[1]), rows.map((r) => r[2]), rows.map((r) => r[3]), g.id],
      );
      out.push(entry);
    }
    const monitorKey = crypto.randomBytes(24).toString("base64url");
    await setState({ monitorKeyHash: sha256(monitorKey), monitorKeyUntil: new Date(Date.now() + 86_400_000).toISOString() });
    ctx.res.setHeader("Content-Disposition", 'attachment; filename="gms-loadtest-kit.json"');
    return { createdAt: new Date().toISOString(), monitorKey, gyms: out };
  });

  r.get("/api/loadtest/status", async (ctx) => {
    const state = await getState();
    const key = String(ctx.req.headers["x-loadtest-key"] ?? "");
    const keyOk = key && state.monitorKeyHash && sha256(key) === state.monitorKeyHash && Date.parse(state.monitorKeyUntil) > Date.now();
    if (!keyOk) await requireSuperadmin(ctx);
    const pg = await one(db, `SELECT (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database())::int AS connections,
                                     (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND state = 'active')::int AS active,
                                     pg_size_pretty(pg_database_size(current_database())) AS size,
                                     (SELECT count(*) FROM gyms WHERE slug LIKE 'load-%')::int AS load_gyms`);
    const mem = process.memoryUsage();
    const { monitorKeyHash, monitorKeyUntil, ...progress } = state;
    if (stalled(state)) Object.assign(progress, { phase: "stopped", stoppedWhile: state.phase });
    return {
      task: `${os.hostname()}:${process.pid}`,
      uptimeSec: Math.round(process.uptime()),
      rssMb: Math.round(mem.rss / 1048576),
      heapMb: Math.round(mem.heapUsed / 1048576),
      ...sample,
      pool: db.stats(),
      db: pg,
      progress,
    };
  });
}
