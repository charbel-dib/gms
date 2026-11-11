import crypto from "node:crypto";
import { promisify } from "node:util";
import { db, one } from "./db/index.ts";
import { config } from "./config.ts";
import { forbidden, HttpError, setCookie, unauthorized, type Ctx, type StaffUser } from "./http.ts";

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(pw: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [algo, n, saltB64, keyB64] = stored.split("$");
  if (algo !== "scrypt") return false;
  const key = await scrypt(pw, Buffer.from(saltB64, "base64"), 32, { ...SCRYPT, N: Number(n) });
  const expected = Buffer.from(keyB64, "base64");
  return expected.length === key.length && crypto.timingSafeEqual(expected, key);
}

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export const STAFF_COOKIE = "gms_staff";
export const MEMBER_COOKIE = "gms_member";

export async function createSession(
  ctx: Ctx,
  kind: "staff" | "member",
  ids: { userId?: string; memberId?: string; gymId: string | null },
) {
  const token = crypto.randomBytes(32).toString("base64url");
  const days = kind === "member" ? 90 : config.sessionDays;
  await db.query(
    `INSERT INTO sessions (token_hash, kind, user_id, member_id, gym_id, expires_at, ip, user_agent)
     VALUES ($1,$2,$3,$4,$5, now() + ($6 || ' days')::interval, $7, $8)`,
    [sha256(token), kind, ids.userId ?? null, ids.memberId ?? null, ids.gymId, String(days), ctx.ip, String(ctx.req.headers["user-agent"] ?? "").slice(0, 300)],
  );
  setCookie(ctx.res, kind === "staff" ? STAFF_COOKIE : MEMBER_COOKIE, token, { maxAgeSec: days * 86400 });
}

export async function destroySession(ctx: Ctx, kind: "staff" | "member") {
  const name = kind === "staff" ? STAFF_COOKIE : MEMBER_COOKIE;
  const token = ctx.cookies[name];
  if (token) await db.query("DELETE FROM sessions WHERE token_hash = $1", [sha256(token)]);
  setCookie(ctx.res, name, "", { maxAgeSec: 0 });
}

/** After a password or PIN change: every other device of that account is signed out. */
export async function endOtherSessions(ctx: Ctx, kind: "staff" | "member", id: string) {
  const token = ctx.cookies[kind === "staff" ? STAFF_COOKIE : MEMBER_COOKIE] ?? "";
  await db.query(`DELETE FROM sessions WHERE ${kind === "staff" ? "user_id" : "member_id"} = $1 AND token_hash <> $2`, [id, sha256(token)]);
}

/** Same work as a real check, so an unknown email answers as slowly as a known one. */
let dummyHash: Promise<string> | null = null;
export async function verifyNobody(pw: string) {
  dummyHash ??= hashPassword(crypto.randomBytes(16).toString("hex"));
  await verifyPassword(pw, await dummyHash);
  return false;
}

type Role = StaffUser["role"];

/**
 * Authenticates a staff member and resolves the tenant.
 * A super-admin may act on any gym by sending the X-Gym-Id header.
 */
/** While a staff member still has a password someone else chose, only these work. */
const PASSWORD_CHANGE_PATHS = new Set(["/api/auth/me", "/api/auth/password", "/api/auth/logout"]);
function checkPasswordChange(ctx: Ctx, mustChange: boolean) {
  if (mustChange && !PASSWORD_CHANGE_PATHS.has(ctx.url.pathname)) {
    throw new HttpError(403, "password_change_required", "Choose your own password first");
  }
}

/** One line in the gym's audit log per platform admin per gym per 12 hours: owners see when GMS looked. */
async function logPlatformAccess(ctx: Ctx, userId: string, gymId: string) {
  await db.query(
    `INSERT INTO audit_log (gym_id, user_id, action, entity, entity_id, data)
     SELECT $1::uuid, $2::uuid, 'platform.access', 'gym', $1::text, $3::jsonb
      WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE gym_id = $1 AND user_id = $2 AND action = 'platform.access' AND at > now() - interval '12 hours')`,
    [gymId, userId, JSON.stringify({ path: ctx.url.pathname, ip: ctx.ip })],
  ).catch(() => null); // never blocks the request
}

export async function requireStaff(ctx: Ctx, roles?: Role[]): Promise<StaffUser & { gymId: string }> {
  if (!ctx.user) {
    const token = ctx.cookies[STAFF_COOKIE];
    if (!token) throw unauthorized();
    const row = await one<StaffUser & { gym_status: string | null; must_change_password: boolean }>(
      db,
      `SELECT u.id, u.gym_id, u.email, u.name, u.role, u.must_change_password, u.totp_enabled, g.saas_status AS gym_status
         FROM sessions s JOIN users u ON u.id = s.user_id
         LEFT JOIN gyms g ON g.id = u.gym_id
        WHERE s.token_hash = $1 AND s.kind = 'staff' AND s.expires_at > now() AND u.active`,
      [sha256(token)],
    );
    if (!row) throw unauthorized();
    if (row.gym_status === "suspended") throw new HttpError(402, "gym_suspended", "This gym's GMS subscription is suspended. Contact GMS support.");
    ctx.user = { id: row.id, gym_id: row.gym_id, email: row.email, name: row.name, role: row.role, must_change_password: row.must_change_password, totp_enabled: row.totp_enabled };
    checkPasswordChange(ctx, row.must_change_password);
    if (row.role === "superadmin") {
      // header from the app, or ?gym= on links opened in a new tab (downloads)
      const h = ctx.req.headers["x-gym-id"] ?? (ctx.req.method === "GET" ? ctx.query.get("gym") : undefined);
      ctx.gymId = typeof h === "string" && /^[0-9a-f-]{36}$/.test(h) ? h : undefined;
      if (ctx.gymId) await logPlatformAccess(ctx, row.id, ctx.gymId);
    } else {
      ctx.gymId = row.gym_id!;
    }
  }
  const u = ctx.user;
  if (roles && u.role !== "superadmin" && !roles.includes(u.role)) throw forbidden();
  if (!ctx.gymId) throw new HttpError(400, "gym_required", "Select a gym first");
  return { ...u, gymId: ctx.gymId };
}

export async function requireSuperadmin(ctx: Ctx): Promise<StaffUser> {
  const token = ctx.cookies[STAFF_COOKIE];
  if (!token) throw unauthorized();
  const row = await one<StaffUser & { must_change_password: boolean }>(
    db,
    `SELECT u.id, u.gym_id, u.email, u.name, u.role, u.must_change_password, u.totp_enabled FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.kind = 'staff' AND s.expires_at > now() AND u.active`,
    [sha256(token)],
  );
  if (!row) throw unauthorized();
  if (row.role !== "superadmin") throw forbidden();
  checkPasswordChange(ctx, row.must_change_password);
  ctx.user = row;
  return row;
}

export async function requireMember(ctx: Ctx): Promise<{ id: string; gymId: string }> {
  const token = ctx.cookies[MEMBER_COOKIE];
  if (!token) throw unauthorized();
  const row = await one<{ member_id: string; gym_id: string }>(
    db,
    `SELECT s.member_id, s.gym_id FROM sessions s JOIN members m ON m.id = s.member_id
      WHERE s.token_hash = $1 AND s.kind = 'member' AND s.expires_at > now() AND m.archived_at IS NULL`,
    [sha256(token)],
  );
  if (!row) throw unauthorized();
  ctx.member = { id: row.member_id, gym_id: row.gym_id };
  ctx.gymId = row.gym_id;
  return { id: row.member_id, gymId: row.gym_id };
}

/** Sliding-window brute-force protection for logins (10 attempts / 15 min). */
export async function checkRateLimit(key: string, limit = 10, windowMin = 15) {
  const r = await one<{ count: number }>(
    db,
    `INSERT INTO login_attempts (key, count, window_start) VALUES ($1, 1, now())
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN login_attempts.window_start < now() - ($2 || ' minutes')::interval THEN 1 ELSE login_attempts.count + 1 END,
       window_start = CASE WHEN login_attempts.window_start < now() - ($2 || ' minutes')::interval THEN now() ELSE login_attempts.window_start END
     RETURNING count`,
    [key, String(windowMin)],
  );
  if (r && r.count > limit) throw new HttpError(429, "too_many_attempts", "Too many attempts. Try again in 15 minutes.");
}

/**
 * Failed-login limits, counted per account AND per address, failures only:
 *  - per account (phone in a gym, staff email): whatever address the attempts come from,
 *    so spreading guesses over many addresses doesn't help;
 *  - per address: someone trying many accounts from one place.
 * guardLogin() refuses while a key is over its limit; noteLoginFailure() counts a failure.
 */
export const LOGIN_LIMITS = { account: 10, address: 30, windowMin: 15 };

export async function guardLogin(keys: { account: string; address: string }) {
  const rows = await db.query(
    `SELECT key, count FROM login_attempts WHERE key = ANY($1::text[]) AND window_start > now() - ($2 || ' minutes')::interval`,
    [[keys.account, keys.address], String(LOGIN_LIMITS.windowMin)],
  );
  for (const r of rows.rows as { key: string; count: number }[]) {
    const limit = r.key === keys.account ? LOGIN_LIMITS.account : LOGIN_LIMITS.address;
    if (r.count >= limit) throw new HttpError(429, "too_many_attempts", "Too many attempts. Try again in 15 minutes.");
  }
}

export async function noteLoginFailure(keys: { account: string; address: string }) {
  for (const k of [keys.account, keys.address]) {
    await db.query(
      `INSERT INTO login_attempts (key, count, window_start) VALUES ($1, 1, now())
       ON CONFLICT (key) DO UPDATE SET
         count = CASE WHEN login_attempts.window_start < now() - ($2 || ' minutes')::interval THEN 1 ELSE login_attempts.count + 1 END,
         window_start = CASE WHEN login_attempts.window_start < now() - ($2 || ' minutes')::interval THEN now() ELSE login_attempts.window_start END`,
      [k, String(LOGIN_LIMITS.windowMin)],
    );
  }
}

export async function clearRateLimit(key: string) {
  await db.query("DELETE FROM login_attempts WHERE key = $1", [key]);
}

/** 6 digits = 1,000,000 combinations (PINs sent before were 4 digits; they keep working). */
export function randomPin(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

export function randomPassword(): string {
  return crypto.randomBytes(9).toString("base64url");
}

// ---- symmetric encryption for per-gym secrets (WhatsApp tokens) ----
function encKey(): Buffer {
  const k = process.env.ENCRYPTION_KEY || (config.isProd ? "" : "dev-only-encryption-key");
  if (!k) throw new Error("ENCRYPTION_KEY must be set in production");
  return crypto.createHash("sha256").update(k).digest();
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", encKey(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), enc.toString("base64")].join(":");
}

export function decryptSecret(blob: string): string {
  const [v, iv, tag, enc] = blob.split(":");
  if (v !== "v1") throw new Error("unknown secret format");
  const d = crypto.createDecipheriv("aes-256-gcm", encKey(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(enc, "base64")), d.final()]).toString("utf8");
}
