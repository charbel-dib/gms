import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { config } from "./config.ts";
import { db, one } from "./db/index.ts";
import { migrate } from "./db/migrate.ts";
import { HttpError, Router, clientIp, makeBodyReader, parseCookies, sendJson, type Ctx } from "./http.ts";
import { hashPassword } from "./auth.ts";
import { registerGym } from "./modules/gym.ts";
import { registerMembers } from "./modules/members.ts";
import { registerClasses } from "./modules/classes.ts";
import { registerBusiness } from "./modules/business.ts";
import { registerEngage } from "./modules/engage.ts";
import { registerPortal } from "./modules/portal.ts";
import { registerAdmin } from "./modules/admin.ts";
import { startJobs, stopJobs } from "./jobs.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
// dist/server.js → dist/public ; server/index.ts (dev) → dist/public
const PUBLIC_DIR = [path.join(here, "public"), path.join(here, "..", "public"), path.join(here, "..", "dist", "public")].find((d) => fs.existsSync(d)) ?? path.join(here, "public");

export const router = new Router();
registerGym(router);
registerMembers(router);
registerClasses(router);
registerBusiness(router);
registerEngage(router);
registerPortal(router);
registerAdmin(router);

router.get("/healthz", async () => {
  await db.query("SELECT 1");
  return { ok: true, version: process.env.APP_VERSION ?? "dev" };
});

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2", ".txt": "text/plain",
};

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(self), microphone=(), geolocation=()",
  "Content-Security-Policy": [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data: blob:", "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'",
  ].join("; "),
};

const fileCache = new Map<string, { buf: Buffer; gz: Buffer; etag: string }>();

function serveFile(req: http.IncomingMessage, res: http.ServerResponse, file: string, cacheControl: string) {
  let entry = config.isProd ? fileCache.get(file) : undefined;
  if (!entry) {
    const buf = fs.readFileSync(file);
    entry = { buf, gz: zlib.gzipSync(buf), etag: `"${crypto.createHash("sha1").update(buf).digest("base64url").slice(0, 16)}"` };
    if (config.isProd) fileCache.set(file, entry);
  }
  if (req.headers["if-none-match"] === entry.etag) {
    res.writeHead(304, { ETag: entry.etag });
    return res.end();
  }
  const type = MIME[path.extname(file)] ?? "application/octet-stream";
  const gzip = /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? "")) && /text|javascript|json|svg|manifest/.test(type);
  res.writeHead(200, { "Content-Type": type, "Cache-Control": cacheControl, ETag: entry.etag, Vary: "Accept-Encoding", ...(gzip ? { "Content-Encoding": "gzip" } : {}) });
  res.end(gzip ? entry.gz : entry.buf);
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const rel = path.normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, "");
  if (rel.includes("..")) return false;
  const file = path.join(PUBLIC_DIR, rel);
  if (rel && fs.existsSync(file) && fs.statSync(file).isFile()) {
    const immutable = /\.(js|css|png|svg|woff2)$/.test(rel) && !rel.endsWith("sw.js");
    serveFile(req, res, file, immutable ? "public, max-age=31536000, immutable" : "no-cache");
    return true;
  }
  // SPA entry points
  if (pathname === "/m" || pathname.startsWith("/m/")) {
    serveFile(req, res, path.join(PUBLIC_DIR, "member.html"), "no-cache");
    return true;
  }
  if (!pathname.startsWith("/api/")) {
    serveFile(req, res, path.join(PUBLIC_DIR, "index.html"), "no-cache");
    return true;
  }
  return false;
}

export async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  const started = Date.now();
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  if (config.isProd) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    // CSRF defence: state-changing API calls must come from our own pages (or be the signed webhook)
    if (req.method !== "GET" && req.method !== "HEAD" && url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/webhooks/")) {
      const origin = req.headers.origin;
      const host = req.headers["x-forwarded-host"] ?? req.headers.host;
      if (origin && new URL(origin).host !== host) throw new HttpError(403, "bad_origin", "Cross-site request blocked");
      if (!String(req.headers["content-type"] ?? "").includes("application/json") && Number(req.headers["content-length"] ?? 0) > 0) {
        throw new HttpError(415, "unsupported_media_type", "JSON required");
      }
    }
    const m = router.match(req.method ?? "GET", url.pathname);
    if (m === null || m === "method") {
      if (m === null && serveStatic(req, res, url.pathname)) return;
      throw new HttpError(m === "method" ? 405 : 404, m === "method" ? "method_not_allowed" : "not_found", "Not found");
    }
    const reader = makeBodyReader(req);
    const ctx: Ctx = {
      req, res, url, params: m.params, query: url.searchParams, ip: clientIp(req), cookies: parseCookies(req.headers.cookie),
      body: reader.body, rawBody: reader.raw,
    };
    const out = await m.handler(ctx);
    if (!res.headersSent && out !== undefined) sendJson(res, 200, out);
  } catch (e: any) {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (e instanceof HttpError) sendJson(res, e.status, { error: e.code, message: e.message, details: e.details });
    else if (e?.name === "ZodError") sendJson(res, 400, { error: "validation_error", message: e.issues?.map((i: any) => i.message).join("; ") });
    else if (e?.code === "23505") sendJson(res, 409, { error: "conflict", message: "This already exists" });
    else if (e?.code === "23503") sendJson(res, 409, { error: "in_use", message: "This item is linked to other records" });
    else if (e?.code === "22P02" || e?.code === "22007" || e?.code === "22008") sendJson(res, 400, { error: "invalid_input", message: "Invalid value" });
    else {
      console.error(`[error] ${req.method} ${url.pathname}`, e);
      sendJson(res, 500, { error: "server_error", message: "Something went wrong. Please try again." });
    }
  } finally {
    if (url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/public/")) {
      console.log(JSON.stringify({ t: new Date().toISOString(), m: req.method, p: url.pathname, s: res.statusCode, ms: Date.now() - started }));
    }
  }
}

async function bootstrap() {
  await migrate(db);
  const su = await one(db, "SELECT id FROM users WHERE role = 'superadmin' LIMIT 1");
  if (!su && config.superadminPassword) {
    await db.query("INSERT INTO users (email, name, password_hash, role) VALUES (lower($1), 'GMS Admin', $2, 'superadmin')", [config.superadminEmail, await hashPassword(config.superadminPassword)]);
    console.log(`[bootstrap] super-admin created: ${config.superadminEmail}`);
  }
}

export async function start() {
  await bootstrap();
  const server = http.createServer((req, res) => void handle(req, res));
  server.keepAliveTimeout = 65_000; // above the AWS ALB idle timeout (60s)
  server.headersTimeout = 66_000;
  server.requestTimeout = 60_000;
  await new Promise<void>((resolve) => server.listen(config.port, resolve));
  console.log(`[gms] listening on :${config.port} (${config.isProd ? "production" : "development"})`);
  if (config.jobsEnabled) startJobs();
  const shutdown = (sig: string) => {
    console.log(`[gms] ${sig}: shutting down`);
    stopJobs();
    server.close(() => db.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  return server;
}

const isMain = !!process.argv[1] && /(^|[\\/])(server\.js|index\.ts)$/.test(process.argv[1]);
if (isMain) {
  start().catch((e) => {
    console.error("[gms] failed to start:", e);
    process.exit(1);
  });
}
