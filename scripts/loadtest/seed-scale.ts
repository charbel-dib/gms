/**
 * Load-test data: N gyms with M members each and months of history (check-ins, payments, classes).
 * Run it against a separate database, never production:
 *   DATABASE_URL=postgres://.../gms_load npx tsx scripts/loadtest/seed-scale.ts 50 1000 120
 * Every gym gets owner@load-NN.gms and reception@load-NN.gms (password demo12345);
 * every member gets PIN 1234 so the member app can be exercised.
 */
import { db, one, many } from "../../server/db/index.ts";
import { migrate } from "../../server/db/migrate.ts";
import { hashPassword } from "../../server/auth.ts";
import { provisionGym } from "../../server/services/provision.ts";
import { seedDemoActivity } from "../../server/services/demo.ts";
import fs from "node:fs";

const [gyms = 50, members = 1000, days = 120] = process.argv.slice(2).map(Number);
await migrate(db);
const pw = await hashPassword("demo12345");
const pin = await hashPassword("1234");
const t0 = Date.now();
for (let i = 1; i <= gyms; i++) {
  const slug = `load-${String(i).padStart(2, "0")}`;
  if (await one(db, "SELECT 1 FROM gyms WHERE slug = $1", [slug])) { console.log(`${slug} exists`); continue; }
  const level = i % 5 === 0 ? "essential" : i % 3 === 0 ? "full" : "studio";
  const plan = level === "essential" ? "starter" : level === "full" ? "elite" : "pro";
  const { gymId } = await db.tx((q) => provisionGym(q, {
    slug, name: `Load Gym ${i}`, template: i % 4 === 0 ? "crossfit" : "classic", brand_color: "#0F5E8C", city: "Beirut",
    saas_plan: plan, level, phone: "+96171000000", owner: { name: "Owner", email: `owner@${slug}.gms`, password: "demo12345" },
  }));
  await db.query("INSERT INTO users (gym_id, email, name, password_hash, role) VALUES ($1, $2, 'Reception', $3, 'reception')", [gymId, `reception@${slug}.gms`, pw]);
  await db.query(`UPDATE gyms SET saas_status = 'active', saas_paid_until = current_date + 30,
                  settings = settings || '{"setup":{"prices":true,"logoSkipped":true}}'::jsonb WHERE id = $1`, [gymId]);
  const s = Date.now();
  const st = await seedDemoActivity(gymId, { members, days, seed: i * 131 });
  await db.query("UPDATE members SET pin_hash = $2 WHERE gym_id = $1 AND phone IS NOT NULL", [gymId, pin]);
  console.log(`${slug} (${level}): ${st.members} members, ${st.checkins} check-ins, ${st.payments} payments in ${((Date.now() - s) / 1000).toFixed(1)}s`);
}
// a list of members with a phone, for the traffic generator
const rows = await many(db, `SELECT g.slug, m.id, m.phone, m.code FROM members m JOIN gyms g ON g.id = m.gym_id
                             WHERE g.slug LIKE 'load-%' AND m.phone IS NOT NULL AND m.archived_at IS NULL`);
fs.writeFileSync("scripts/loadtest/members.json", JSON.stringify(rows));
const size = await one(db, "SELECT pg_size_pretty(pg_database_size(current_database())) AS s");
const counts = await one(db, `SELECT (SELECT count(*) FROM members) AS members, (SELECT count(*) FROM checkins) AS checkins,
  (SELECT count(*) FROM payments) AS payments, (SELECT count(*) FROM bookings) AS bookings`);
console.log(`done in ${((Date.now() - t0) / 60000).toFixed(1)} min, database ${size.s}`, counts);
await db.end?.();
process.exit(0);
