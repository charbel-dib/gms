/** Applies pending database migrations: `npm run migrate` (dev) or `node dist/migrate.js` (production). */
import { db } from "../server/db/index.ts";
import { migrate } from "../server/db/migrate.ts";

const applied = await migrate(db);
console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Database is up to date.");
await db.end();
