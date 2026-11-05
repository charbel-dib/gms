import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "./pg.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

function migrationsDir(): string {
  const candidates = [path.join(here, "migrations"), path.join(here, "..", "migrations"), path.join(here, "db", "migrations"), path.join(process.cwd(), "dist", "migrations")];
  const found = candidates.find((d) => fs.existsSync(d));
  if (!found) throw new Error("migrations directory not found");
  return found;
}

/**
 * Applies pending SQL migrations in order. Safe with several app instances
 * starting at once (ECS rolling deploys): a Postgres advisory lock serializes them.
 */
export async function migrate(pool: Pool, log = console.log): Promise<string[]> {
  const dir = migrationsDir();
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  await pool.withConnection(async (c) => {
    await c.query("SELECT pg_advisory_lock(727001)");
    try {
      await c.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
      const done = new Set((await c.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
      for (const f of files) {
        if (done.has(f)) continue;
        const sql = fs.readFileSync(path.join(dir, f), "utf8");
        await c.exec(`BEGIN;\n${sql}\n;INSERT INTO schema_migrations (name) VALUES ('${f.replace(/'/g, "")}');\nCOMMIT;`).catch(async (e) => {
          await c.exec("ROLLBACK").catch(() => {});
          throw new Error(`Migration ${f} failed: ${e.message}`);
        });
        applied.push(f);
        log(`[migrate] applied ${f}`);
      }
    } finally {
      await c.query("SELECT pg_advisory_unlock(727001)");
    }
  });
  return applied;
}
