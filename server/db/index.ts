import fs from "node:fs";
import { Pool, configFromUrl, type Queryable } from "./pg.ts";
import { config } from "../config.ts";

// With sslmode=verify-full, DB_CA_FILE points to the RDS CA bundle (baked into the Docker image).
const pgConfig = configFromUrl(config.databaseUrl, { idleTimeoutMs: 60_000 });
if (pgConfig.ssl && process.env.DB_CA_FILE) {
  pgConfig.ssl = { rejectUnauthorized: true, ca: fs.readFileSync(process.env.DB_CA_FILE, "utf8") };
}
export const db = new Pool(pgConfig);
export type { Queryable };

/** Returns the first row or null. */
export async function one<T = any>(q: Queryable, sql: string, params: unknown[] = []): Promise<T | null> {
  const r = await q.query<T>(sql, params);
  return r.rows[0] ?? null;
}

export async function many<T = any>(q: Queryable, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await q.query<T>(sql, params)).rows;
}

/** Atomic per-gym counter (member codes, receipt numbers). */
export async function nextCounter(q: Queryable, gymId: string, name: string, start: number): Promise<number> {
  const r = await one<{ value: number }>(
    q,
    `INSERT INTO counters (gym_id, name, value) VALUES ($1, $2, $3)
     ON CONFLICT (gym_id, name) DO UPDATE SET value = counters.value + 1
     RETURNING value`,
    [gymId, name, start],
  );
  return r!.value;
}

export async function audit(q: Queryable, gymId: string | null, userId: string | null, action: string, entity?: string, entityId?: string, data?: unknown) {
  await q.query(
    `INSERT INTO audit_log (gym_id, user_id, action, entity, entity_id, data) VALUES ($1,$2,$3,$4,$5,$6)`,
    [gymId, userId, action, entity ?? null, entityId ?? null, data ?? null],
  );
}
