/**
 * Web Push sender, dependency-free.
 *  - Message encryption: RFC 8291 (aes128gcm content coding, RFC 8188)
 *  - Server identification: RFC 8292 (VAPID, ES256 JWT)
 * Works with Chrome/Android (FCM), Firefox (Mozilla autopush), Safari/iOS 16.4+ (Apple), Edge (WNS).
 */
import crypto from "node:crypto";
import { db, one } from "../db/index.ts";
import { config } from "../config.ts";

const b64u = (b: Buffer) => b.toString("base64url");
const fromB64u = (s: string) => Buffer.from(s, "base64url");

export interface VapidKeys {
  publicKey: string; // base64url, 65-byte uncompressed P-256 point (what the browser needs)
  privateJwk: JsonWebKey;
}

let cached: VapidKeys | null = null;

/** VAPID keys: from env (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY), else generated once and kept in the database. */
export async function vapidKeys(): Promise<VapidKeys> {
  if (cached) return cached;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    const pub = fromB64u(process.env.VAPID_PUBLIC_KEY);
    cached = {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateJwk: { kty: "EC", crv: "P-256", x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)), d: process.env.VAPID_PRIVATE_KEY },
    };
    return cached;
  }
  const row = await one<{ value: VapidKeys }>(db, "SELECT value FROM app_config WHERE key = 'vapid'");
  if (row) return (cached = row.value);
  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" });
  const publicKey = b64u(Buffer.concat([Buffer.from([4]), fromB64u(jwk.x!), fromB64u(jwk.y!)]));
  // ON CONFLICT: two app servers starting together keep the same keys
  await db.query("INSERT INTO app_config (key, value) VALUES ('vapid', $1) ON CONFLICT (key) DO NOTHING", [{ publicKey, privateJwk: jwk }]);
  const saved = await one<{ value: VapidKeys }>(db, "SELECT value FROM app_config WHERE key = 'vapid'");
  return (cached = saved!.value);
}

export function vapidAuthHeader(endpoint: string, keys: VapidKeys, subject: string): string {
  const aud = new URL(endpoint).origin;
  const header = b64u(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = b64u(Buffer.from(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const key = crypto.createPrivateKey({ key: keys.privateJwk, format: "jwk" });
  const sig = crypto.sign("sha256", Buffer.from(`${header}.${payload}`), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${header}.${payload}.${b64u(sig)}, k=${keys.publicKey}`;
}

const hmac = (key: Buffer, data: Buffer) => crypto.createHmac("sha256", key).update(data).digest();

/** Encrypts a payload for one subscription (RFC 8291). Exported for tests. */
export function encryptPayload(payload: Buffer, p256dh: string, authSecret: string, opts: { salt?: Buffer; ecdh?: crypto.ECDH } = {}): Buffer {
  const uaPublic = fromB64u(p256dh);
  const auth = fromB64u(authSecret);
  if (uaPublic.length !== 65 || auth.length < 16) throw new Error("invalid subscription keys");
  const ecdh = opts.ecdh ?? crypto.createECDH("prime256v1");
  if (!opts.ecdh) ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const secret = ecdh.computeSecret(uaPublic);
  const salt = opts.salt ?? crypto.randomBytes(16);
  const prkKey = hmac(auth, secret);
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from("Content-Encoding: aes128gcm\0"), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from("Content-Encoding: nonce\0"), Buffer.from([1])])).subarray(0, 12);
  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

const PUSH_HOSTS = [/(^|\.)fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/, /(^|\.)push\.api\.chromium\.org$/];

/** Only real browser push services are accepted (no request to arbitrary URLs from our servers). */
export function allowedEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    if (process.env.PUSH_ALLOW_ANY_ENDPOINT === "true") return u.protocol === "https:" || u.protocol === "http:";
    return u.protocol === "https:" && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

export interface PushResult { ok: boolean; gone: boolean; status: number; error?: string }

export async function sendPush(sub: { endpoint: string; p256dh: string; auth: string }, message: Record<string, unknown>, opts: { ttl?: number; urgency?: "low" | "normal" | "high"; topic?: string } = {}): Promise<PushResult> {
  if (!allowedEndpoint(sub.endpoint)) return { ok: false, gone: true, status: 0, error: "endpoint not allowed" };
  const keys = await vapidKeys();
  const body = encryptPayload(Buffer.from(JSON.stringify(message)), sub.p256dh, sub.auth);
  try {
    const res = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        Authorization: vapidAuthHeader(sub.endpoint, keys, `mailto:${config.superadminEmail}`),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(opts.ttl ?? 86400),
        Urgency: opts.urgency ?? "normal",
        ...(opts.topic ? { Topic: opts.topic.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) } : {}),
      },
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(10_000),
    });
    // 404/410: the browser unsubscribed or the app was uninstalled
    return { ok: res.status >= 200 && res.status < 300, gone: res.status === 404 || res.status === 410, status: res.status, error: res.ok ? undefined : (await res.text().catch(() => "")).slice(0, 200) };
  } catch (e: any) {
    return { ok: false, gone: false, status: 0, error: String(e.message) };
  }
}
