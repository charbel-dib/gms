import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

process.env.DATABASE_URL ??= "postgres://postgres:devpass@127.0.0.1:5432/gms_test?sslmode=disable";
process.env.JOBS_ENABLED = "false";
process.env.SUPERADMIN_EMAIL = "root@gms.test";
process.env.SUPERADMIN_PASSWORD = "rootpass123";
process.env.PORT = "0";
process.env.PUSH_ALLOW_ANY_ENDPOINT = "true"; // tests use a local fake push service

export async function startTestServer() {
  const { db } = await import("../server/db/index.ts");
  // fresh schema for every run
  await db.exec("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  const { start } = await import("../server/index.ts");
  const server: Server = await start();
  const port = (server.address() as AddressInfo).port;
  return { server, base: `http://127.0.0.1:${port}`, db };
}

export class Client {
  cookies = new Map<string, string>();
  gymId?: string;
  constructor(public base: string) {}

  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(this.base + path, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
        ...(this.gymId ? { "x-gym-id": this.gymId } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(";");
      const i = kv.indexOf("=");
      const v = kv.slice(i + 1);
      if (v) this.cookies.set(kv.slice(0, i), v);
      else this.cookies.delete(kv.slice(0, i));
    }
    const text = await res.text();
    let data: any = text;
    try {
      data = JSON.parse(text);
    } catch { /* html/csv */ }
    return { status: res.status, data, headers: res.headers };
  }
  get(p: string) { return this.req("GET", p); }
  post(p: string, b: unknown = {}) { return this.req("POST", p, b); }
  put(p: string, b: unknown) { return this.req("PUT", p, b); }
  del(p: string) { return this.req("DELETE", p); }

  async ok(method: string, path: string, body?: unknown) {
    const r = await this.req(method, path, body);
    if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  }
}

/** Dates relative to "today" in Beirut, the way the server computes them. */
export async function beirutDates(db: { query: (s: string) => Promise<{ rows: any[] }> }) {
  const r = await db.query("SELECT (now() AT TIME ZONE 'Asia/Beirut')::date::text AS d");
  const today: string = r.rows[0].d;
  return (offset = 0) => {
    const d = new Date(today + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };
}
