/**
 * Minimal, dependency-free PostgreSQL client (wire protocol v3).
 *
 * Supports: TLS (required by AWS RDS), SCRAM-SHA-256 / MD5 / cleartext auth,
 * the extended query protocol with bound parameters (no string interpolation,
 * so no SQL injection), simple multi-statement queries (migrations),
 * a connection pool and transactions.
 */
import net from "node:net";
import tls from "node:tls";
import crypto from "node:crypto";

export interface PgConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: false | { rejectUnauthorized: boolean; ca?: string };
  max?: number;
  idleTimeoutMs?: number;
  connectTimeoutMs?: number;
}

export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
  command: string;
}

export class PgError extends Error {
  code?: string;
  detail?: string;
  constraint?: string;
  table?: string;
  column?: string;
  constructor(fields: Record<string, string>) {
    super(fields.M || "PostgreSQL error");
    this.name = "PgError";
    this.code = fields.C;
    this.detail = fields.D;
    this.constraint = fields.n;
    this.table = fields.t;
    this.column = fields.c;
  }
}

// ---------- serialization helpers ----------

function cstr(s: string): Buffer {
  return Buffer.concat([Buffer.from(s, "utf8"), Buffer.from([0])]);
}

function msg(type: string | null, body: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeInt32BE(body.length + 4);
  return type === null ? Buffer.concat([len, body]) : Buffer.concat([Buffer.from(type, "ascii"), len, body]);
}

function int32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n);
  return b;
}

function int16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeInt16BE(n);
  return b;
}

export function serializeParam(v: unknown): Buffer | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return Buffer.from(v.toISOString(), "utf8");
  if (typeof v === "boolean") return Buffer.from(v ? "t" : "f");
  if (Buffer.isBuffer(v)) return Buffer.from("\\x" + v.toString("hex"), "utf8");
  // JS arrays → PostgreSQL array literal (text[], int[]...). Pass JSON.stringify(arr) for a jsonb array.
  if (Array.isArray(v)) {
    const items = v.map((x) => (x === null || x === undefined ? "NULL" : `"${String(x).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`));
    return Buffer.from(`{${items.join(",")}}`, "utf8");
  }
  if (typeof v === "object") return Buffer.from(JSON.stringify(v), "utf8");
  return Buffer.from(String(v), "utf8");
}

// ---------- type parsing (text format) ----------

const OID = {
  bool: 16, bytea: 17, int8: 20, int2: 21, int4: 23, oid: 26, json: 114, float4: 700, float8: 701,
  int4arr: 1007, textarr: 1009, int8arr: 1016, numeric: 1700, timestamp: 1114, timestamptz: 1184,
  jsonb: 3802, uuidarr: 2951,
};

function parseTextArray(s: string): (string | null)[] {
  // handles simple 1-D arrays: {a,b,"c d",NULL}
  const inner = s.slice(1, -1);
  if (!inner) return [];
  const out: (string | null)[] = [];
  let cur = "";
  let quoted = false;
  let wasQuoted = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quoted) {
      if (ch === "\\") cur += inner[++i];
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') {
      quoted = true;
      wasQuoted = true;
    } else if (ch === ",") {
      out.push(!wasQuoted && cur === "NULL" ? null : cur);
      cur = "";
      wasQuoted = false;
    } else cur += ch;
  }
  out.push(!wasQuoted && cur === "NULL" ? null : cur);
  return out;
}

export function parseValue(oid: number, s: string): unknown {
  switch (oid) {
    case OID.bool:
      return s === "t";
    case OID.int2:
    case OID.int4:
    case OID.oid:
    case OID.float4:
    case OID.float8:
    case OID.numeric:
      return Number(s);
    case OID.int8: {
      const n = Number(s);
      return Number.isSafeInteger(n) ? n : s;
    }
    case OID.json:
    case OID.jsonb:
      return JSON.parse(s);
    case OID.timestamptz:
    case OID.timestamp: {
      if (s === "infinity" || s === "-infinity") return s;
      let iso = s.replace(" ", "T");
      if (oid === OID.timestamp) iso += "Z";
      else iso = iso.replace(/([+-]\d\d)$/, "$1:00").replace(/([+-]\d\d:\d\d):\d\d$/, "$1");
      return new Date(iso);
    }
    case OID.bytea:
      return Buffer.from(s.slice(2), "hex");
    case OID.int4arr:
    case OID.int8arr:
      return parseTextArray(s).map((x) => (x === null ? null : Number(x)));
    case OID.textarr:
    case OID.uuidarr:
      return parseTextArray(s);
    default:
      return s; // text, varchar, uuid, date ('YYYY-MM-DD'), time, interval...
  }
}

// ---------- a single connection ----------

interface Pending {
  resolve: (r: QueryResult[]) => void;
  reject: (e: Error) => void;
  results: QueryResult[];
  fields: { name: string; oid: number }[] | null;
  rows: any[];
  error: PgError | null;
}

export class Connection {
  private sock!: net.Socket | tls.TLSSocket;
  private buf: Buffer = Buffer.alloc(0);
  private pending: Pending | null = null;
  private onAuthMessage: ((type: string, body: Buffer) => void) | null = null;
  dead = false;
  lastUsed = Date.now();

  constructor(private cfg: PgConfig) {}

  async connect(): Promise<void> {
    const raw = net.connect({ host: this.cfg.host, port: this.cfg.port });
    raw.setNoDelay(true);
    raw.setKeepAlive(true, 30_000);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => {
        raw.destroy();
        reject(new Error(`PostgreSQL connect timeout to ${this.cfg.host}:${this.cfg.port}`));
      }, this.cfg.connectTimeoutMs ?? 10_000);
      raw.once("connect", () => { clearTimeout(t); resolve(); });
      raw.once("error", (e) => { clearTimeout(t); reject(e); });
    });

    if (this.cfg.ssl) {
      raw.write(Buffer.concat([int32(8), int32(80877103)]));
      const answer: Buffer = await new Promise((resolve, reject) => {
        raw.once("data", resolve);
        raw.once("error", reject);
      });
      if (answer.toString("ascii", 0, 1) !== "S") throw new Error("PostgreSQL server refused TLS");
      const sslOpts = this.cfg.ssl;
      this.sock = await new Promise<tls.TLSSocket>((resolve, reject) => {
        const s = tls.connect({
          socket: raw,
          servername: net.isIP(this.cfg.host) ? undefined : this.cfg.host,
          rejectUnauthorized: sslOpts.rejectUnauthorized,
          ca: sslOpts.ca,
        });
        s.once("secureConnect", () => resolve(s));
        s.once("error", reject);
      });
    } else {
      this.sock = raw;
    }

    this.sock.on("data", (d: Buffer) => this.onData(d));
    this.sock.on("error", (e) => this.fail(e));
    this.sock.on("close", () => this.fail(new Error("PostgreSQL connection closed")));

    await this.startup();
  }

  private fail(e: Error) {
    if (this.dead) return;
    this.dead = true;
    if (this.pending) {
      const p = this.pending;
      this.pending = null;
      p.reject(e);
    }
    if (this.onAuthMessage) this.onAuthMessage("!", Buffer.from(e.message));
  }

  private startup(): Promise<void> {
    return new Promise((resolve, reject) => {
      let clientNonce = "";
      let clientFirstBare = "";
      let serverSignature = "";
      this.onAuthMessage = (type, body) => {
        try {
          if (type === "!") return reject(new Error(body.toString()));
          if (type === "E") return reject(new PgError(parseFields(body)));
          if (type === "Z") {
            this.onAuthMessage = null;
            return resolve();
          }
          if (type !== "R") return; // ParameterStatus, BackendKeyData, Notice
          const code = body.readInt32BE(0);
          if (code === 0) return; // AuthenticationOk
          if (code === 3) return this.write(msg("p", cstr(this.cfg.password)));
          if (code === 5) {
            const salt = body.subarray(4, 8);
            const inner = crypto.createHash("md5").update(this.cfg.password + this.cfg.user).digest("hex");
            const outer = crypto.createHash("md5").update(Buffer.concat([Buffer.from(inner), salt])).digest("hex");
            return this.write(msg("p", cstr("md5" + outer)));
          }
          if (code === 10) {
            const mechanisms = body.subarray(4).toString("utf8").split("\0").filter(Boolean);
            if (!mechanisms.includes("SCRAM-SHA-256")) throw new Error("No supported SASL mechanism: " + mechanisms.join(","));
            clientNonce = crypto.randomBytes(18).toString("base64");
            clientFirstBare = `n=*,r=${clientNonce}`;
            const first = Buffer.from("n,," + clientFirstBare, "utf8");
            return this.write(msg("p", Buffer.concat([cstr("SCRAM-SHA-256"), int32(first.length), first])));
          }
          if (code === 11) {
            const serverFirst = body.subarray(4).toString("utf8");
            const attrs = Object.fromEntries(serverFirst.split(",").map((kv) => [kv[0], kv.slice(2)]));
            if (!attrs.r?.startsWith(clientNonce)) throw new Error("SCRAM: server nonce mismatch");
            const salted = crypto.pbkdf2Sync(this.cfg.password.normalize("NFKC"), Buffer.from(attrs.s, "base64"), Number(attrs.i), 32, "sha256");
            const clientKey = hmac(salted, "Client Key");
            const storedKey = crypto.createHash("sha256").update(clientKey).digest();
            const finalNoProof = `c=biws,r=${attrs.r}`;
            const authMessage = `${clientFirstBare},${serverFirst},${finalNoProof}`;
            const clientSig = hmac(storedKey, authMessage);
            const proof = Buffer.alloc(clientKey.length);
            for (let i = 0; i < proof.length; i++) proof[i] = clientKey[i] ^ clientSig[i];
            serverSignature = hmac(hmac(salted, "Server Key"), authMessage).toString("base64");
            return this.write(msg("p", Buffer.from(`${finalNoProof},p=${proof.toString("base64")}`, "utf8")));
          }
          if (code === 12) {
            const final = body.subarray(4).toString("utf8");
            const v = final.split(",").find((x) => x.startsWith("v="))?.slice(2);
            if (v !== serverSignature) throw new Error("SCRAM: invalid server signature");
            return;
          }
          throw new Error("Unsupported PostgreSQL auth method " + code);
        } catch (e) {
          reject(e as Error);
        }
      };
      const params = Buffer.concat([
        int32(196608),
        cstr("user"), cstr(this.cfg.user),
        cstr("database"), cstr(this.cfg.database),
        cstr("client_encoding"), cstr("UTF8"),
        cstr("DateStyle"), cstr("ISO"),
        cstr("TimeZone"), cstr("UTC"),
        cstr("application_name"), cstr("gms"),
        Buffer.from([0]),
      ]);
      this.write(msg(null, params));
    });
  }

  private write(b: Buffer) {
    this.sock.write(b);
  }

  private onData(d: Buffer) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    while (this.buf.length >= 5) {
      const len = this.buf.readInt32BE(1);
      if (this.buf.length < len + 1) break;
      const type = String.fromCharCode(this.buf[0]);
      const body = this.buf.subarray(5, len + 1);
      this.buf = this.buf.subarray(len + 1);
      if (this.onAuthMessage) this.onAuthMessage(type, body);
      else this.handle(type, body);
    }
  }

  private handle(type: string, body: Buffer) {
    const p = this.pending;
    if (!p) return;
    switch (type) {
      case "T": {
        const n = body.readInt16BE(0);
        let off = 2;
        const fields: { name: string; oid: number }[] = [];
        for (let i = 0; i < n; i++) {
          const end = body.indexOf(0, off);
          const name = body.toString("utf8", off, end);
          off = end + 1;
          const oid = body.readInt32BE(off + 6);
          off += 18;
          fields.push({ name, oid });
        }
        p.fields = fields;
        p.rows = [];
        break;
      }
      case "D": {
        const n = body.readInt16BE(0);
        let off = 2;
        const row: any = {};
        for (let i = 0; i < n; i++) {
          const len = body.readInt32BE(off);
          off += 4;
          const f = p.fields![i];
          if (len === -1) row[f.name] = null;
          else {
            row[f.name] = parseValue(f.oid, body.toString("utf8", off, off + len));
            off += len;
          }
        }
        p.rows.push(row);
        break;
      }
      case "C": {
        const tag = body.toString("utf8", 0, body.length - 1);
        const parts = tag.split(" ");
        const count = Number(parts[parts.length - 1]);
        p.results.push({ rows: p.rows, rowCount: Number.isFinite(count) ? count : p.rows.length, command: parts[0] });
        p.rows = [];
        p.fields = null;
        break;
      }
      case "I": // EmptyQueryResponse
        p.results.push({ rows: [], rowCount: 0, command: "" });
        break;
      case "E":
        p.error = new PgError(parseFields(body));
        break;
      case "Z": {
        this.pending = null;
        this.lastUsed = Date.now();
        if (p.error) p.reject(p.error);
        else p.resolve(p.results);
        break;
      }
      default:
        break; // 1,2,n,s,N,S,A
    }
  }

  private run(buffers: Buffer[]): Promise<QueryResult[]> {
    if (this.dead) return Promise.reject(new Error("PostgreSQL connection is closed"));
    if (this.pending) return Promise.reject(new Error("Connection busy"));
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject, results: [], fields: null, rows: [], error: null };
      this.write(Buffer.concat(buffers));
    });
  }

  async query<T = any>(text: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const paramBufs = params.map(serializeParam);
    const bind = Buffer.concat([
      cstr(""), cstr(""),
      int16(0),
      int16(paramBufs.length),
      ...paramBufs.map((b) => (b === null ? int32(-1) : Buffer.concat([int32(b.length), b]))),
      int16(0),
    ]);
    const results = await this.run([
      msg("P", Buffer.concat([cstr(""), cstr(text), int16(0)])),
      msg("B", bind),
      msg("D", Buffer.concat([Buffer.from("P"), cstr("")])),
      msg("E", Buffer.concat([cstr(""), int32(0)])),
      msg("S", Buffer.alloc(0)),
    ]);
    return results[results.length - 1] ?? { rows: [], rowCount: 0, command: "" };
  }

  /** Simple query protocol: multiple statements, no parameters (migrations only). */
  async exec(text: string): Promise<QueryResult[]> {
    return this.run([msg("Q", cstr(text))]);
  }

  close() {
    if (this.dead) return;
    try {
      this.write(msg("X", Buffer.alloc(0)));
    } catch { /* ignore */ }
    this.dead = true;
    this.sock?.end();
  }
}

function hmac(key: Buffer, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data).digest();
}

function parseFields(body: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let off = 0;
  while (off < body.length && body[off] !== 0) {
    const code = String.fromCharCode(body[off]);
    const end = body.indexOf(0, off + 1);
    out[code] = body.toString("utf8", off + 1, end);
    off = end + 1;
  }
  return out;
}

// ---------- pool ----------

export interface Queryable {
  query<T = any>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
}

export class Pool implements Queryable {
  private idle: Connection[] = [];
  private total = 0;
  private waiters: ((c: Connection) => void)[] = [];
  /** How busy the pool is right now: open connections, idle ones, and callers waiting for one. */
  stats() { return { max: this.cfg.max ?? 10, open: this.total, idle: this.idle.length, waiting: this.waiters.length }; }
  private timer: NodeJS.Timeout;
  private closed = false;

  constructor(private cfg: PgConfig) {
    this.timer = setInterval(() => this.reap(), 10_000);
    this.timer.unref();
  }

  private reap() {
    const limit = this.cfg.idleTimeoutMs ?? 60_000;
    const now = Date.now();
    this.idle = this.idle.filter((c) => {
      if (this.idle.length > 1 && now - c.lastUsed > limit) {
        c.close();
        this.total--;
        return false;
      }
      return true;
    });
  }

  async acquire(): Promise<Connection> {
    if (this.closed) throw new Error("Pool closed");
    while (this.idle.length) {
      const c = this.idle.pop()!;
      if (!c.dead) return c;
      this.total--;
    }
    if (this.total < (this.cfg.max ?? 10)) {
      this.total++;
      const c = new Connection(this.cfg);
      try {
        await c.connect();
        return c;
      } catch (e) {
        this.total--;
        throw e;
      }
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  release(c: Connection) {
    if (c.dead) {
      this.total--;
      // a waiter may be stuck; give it a fresh connection
      const w = this.waiters.shift();
      if (w) this.acquire().then(w, () => this.waiters.unshift(w));
      return;
    }
    // a query that was running when the pool closed: close its connection instead of keeping it (it would keep the process alive)
    if (this.closed) {
      this.total--;
      c.close();
      return;
    }
    const w = this.waiters.shift();
    if (w) w(c);
    else this.idle.push(c);
  }

  async query<T = any>(text: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const c = await this.acquire();
    try {
      return await c.query<T>(text, params);
    } finally {
      this.release(c);
    }
  }

  async exec(text: string) {
    const c = await this.acquire();
    try {
      return await c.exec(text);
    } finally {
      this.release(c);
    }
  }

  /** Runs fn inside a transaction; rolls back on any thrown error. */
  async tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
    const c = await this.acquire();
    try {
      await c.query("BEGIN");
      const out = await fn(c);
      await c.query("COMMIT");
      return out;
    } catch (e) {
      try {
        await c.query("ROLLBACK");
      } catch { /* connection may be dead */ }
      throw e;
    } finally {
      this.release(c);
    }
  }

  /** Holds a dedicated connection (e.g. for advisory locks). */
  async withConnection<T>(fn: (c: Connection) => Promise<T>): Promise<T> {
    const c = await this.acquire();
    try {
      return await fn(c);
    } finally {
      this.release(c);
    }
  }

  async end() {
    this.closed = true;
    clearInterval(this.timer);
    for (const c of this.idle) c.close();
    this.idle = [];
  }
}

export function configFromUrl(url: string, opts: Partial<PgConfig> = {}): PgConfig {
  const u = new URL(url);
  const sslmode = u.searchParams.get("sslmode") ?? "disable";
  return {
    host: u.hostname,
    port: Number(u.port || 5432),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.slice(1)),
    ssl: sslmode === "disable" ? false : { rejectUnauthorized: sslmode === "verify-full" },
    max: Number(u.searchParams.get("pool_max") ?? 10),
    ...opts,
  };
}
