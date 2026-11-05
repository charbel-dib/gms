/** Tiny HTTP toolkit: router, JSON bodies, cookies, errors, validation. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { z, type ZodTypeAny } from "zod";
import { config } from "./config.ts";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string, public details?: unknown) {
    super(message ?? code);
  }
}

export const bad = (code: string, message?: string, details?: unknown) => new HttpError(400, code, message, details);
export const notFound = (what = "resource") => new HttpError(404, "not_found", `${what} not found`);
export const forbidden = (message = "You do not have access to this") => new HttpError(403, "forbidden", message);
export const unauthorized = () => new HttpError(401, "unauthorized", "Please sign in");

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  query: URLSearchParams;
  ip: string;
  cookies: Record<string, string>;
  body<S extends ZodTypeAny>(schema: S): Promise<z.output<S>>;
  rawBody(): Promise<Buffer>;
  // set by auth middleware
  user?: StaffUser;
  member?: MemberPrincipal;
  gymId?: string;
}

export interface StaffUser {
  id: string;
  gym_id: string | null;
  email: string;
  name: string;
  role: "superadmin" | "owner" | "manager" | "reception" | "coach";
}

export interface MemberPrincipal {
  id: string;
  gym_id: string;
}

export type Handler = (ctx: Ctx) => Promise<unknown> | unknown;

interface Route {
  method: string;
  parts: string[];
  handler: Handler;
}

export class Router {
  private routes: Route[] = [];

  on(method: string, pattern: string, handler: Handler) {
    this.routes.push({ method, parts: pattern.split("/").filter(Boolean), handler });
  }
  get(p: string, h: Handler) { this.on("GET", p, h); }
  post(p: string, h: Handler) { this.on("POST", p, h); }
  put(p: string, h: Handler) { this.on("PUT", p, h); }
  del(p: string, h: Handler) { this.on("DELETE", p, h); }

  match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | "method" | null {
    const parts = pathname.split("/").filter(Boolean);
    let methodMismatch = false;
    for (const r of this.routes) {
      if (r.parts.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < parts.length; i++) {
        const rp = r.parts[i];
        if (rp.startsWith(":")) params[rp.slice(1)] = decodeURIComponent(parts[i]);
        else if (rp !== parts[i]) { ok = false; break; }
      }
      if (!ok) continue;
      if (r.method !== method) { methodMismatch = true; continue; }
      return { handler: r.handler, params };
    }
    return methodMismatch ? "method" : null;
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch { /* malformed cookie */ }
  }
  return out;
}

export function setCookie(res: ServerResponse, name: string, value: string, opts: { maxAgeSec?: number; path?: string } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${opts.path ?? "/"}`, "HttpOnly", "SameSite=Lax"];
  if (opts.maxAgeSec !== undefined) parts.push(`Max-Age=${opts.maxAgeSec}`);
  if (config.isProd) parts.push("Secure");
  const prev = res.getHeader("Set-Cookie");
  const list = Array.isArray(prev) ? prev : prev ? [String(prev)] : [];
  res.setHeader("Set-Cookie", [...list, parts.join("; ")]);
}

const MAX_BODY = 3 * 1024 * 1024; // logos are uploaded as base64 JSON

export function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, "payload_too_large", "Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function makeBodyReader(req: IncomingMessage) {
  let cached: Promise<Buffer> | null = null;
  const raw = () => (cached ??= readBody(req));
  async function body<S extends ZodTypeAny>(schema: S): Promise<z.output<S>> {
    const buf = await raw();
    let json: unknown = {};
    if (buf.length) {
      try {
        json = JSON.parse(buf.toString("utf8"));
      } catch {
        throw bad("invalid_json", "Body must be valid JSON");
      }
    }
    const r = schema.safeParse(json);
    if (!r.success) {
      const issues = r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
      throw bad("validation_error", issues.map((i) => `${i.path || "body"}: ${i.message}`).join("; "), issues);
    }
    return r.data;
  }
  return { body, raw };
}

export function sendJson(res: ServerResponse, status: number, data: unknown) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

export function clientIp(req: IncomingMessage): string {
  if (config.trustProxy) {
    const xff = req.headers["x-forwarded-for"];
    if (typeof xff === "string" && xff) return xff.split(",")[0].trim();
  }
  return req.socket.remoteAddress ?? "unknown";
}

// ---- reusable validators ----
export const zId = z.string().uuid();
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
export const zCurrency = z.enum(["USD", "LBP"]);
export const zMethod = z.enum(["cash", "whish", "omt", "card", "bank", "other"]);
export const zPhone = z
  .string()
  .trim()
  .transform((s) => normalizePhone(s))
  .refine((s) => /^\+\d{8,15}$/.test(s), "invalid phone number");
export const zMoney = z.coerce.number().finite().nonnegative().max(1e12);

/** Normalizes Lebanese and international numbers to E.164 (+961...). */
export function normalizePhone(input: string): string {
  let s = input.replace(/[\s\-().]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (s.startsWith("+")) return s;
  if (s.startsWith("961")) return "+" + s;
  // Lebanese local formats: 03 123456, 3 123456, 71 123456, 01 123456
  if (s.startsWith("0")) s = s.slice(1);
  return "+961" + s;
}

export function pageParams(q: URLSearchParams, maxLimit = 200) {
  const limit = Math.min(Math.max(Number(q.get("limit") ?? 50) || 50, 1), maxLimit);
  const offset = Math.max(Number(q.get("offset") ?? 0) || 0, 0);
  return { limit, offset };
}
