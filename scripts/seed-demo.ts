/**
 * Creates two fully-populated demo gyms for sales demos.
 *   npm run seed:demo            (uses DATABASE_URL)
 * Logins (change them before showing a real client):
 *   Platform admin : admin@gms.local / admin12345 (dev default, see SUPERADMIN_*)
 *   Cedar Fitness (demo) : owner@demo.gms / demo12345 · reception@demo.gms / demo12345
 *   Summit Box (demo)    : owner@demo-box.gms / demo12345
 *   Member app           : /m/demo  phone and PIN printed at the end
 */
import { db, one } from "../server/db/index.ts";
import { migrate } from "../server/db/migrate.ts";
import { hashPassword } from "../server/auth.ts";
import { provisionGym } from "../server/services/provision.ts";
import { seedDemoActivity } from "../server/services/demo.ts";
import { config } from "../server/config.ts";

await migrate(db);

if (!(await one(db, "SELECT 1 FROM users WHERE role = 'superadmin'")) && config.superadminPassword) {
  await db.query("INSERT INTO users (email, name, password_hash, role) VALUES (lower($1), 'GMS Admin', $2, 'superadmin')", [config.superadminEmail, await hashPassword(config.superadminPassword)]);
}

async function makeGym(slug: string, name: string, nameAr: string, template: string, color: string, city: string, extra: Record<string, unknown>, members: number) {
  const existing = await one(db, "SELECT id FROM gyms WHERE slug = $1", [slug]);
  if (existing) {
    console.log(`- ${slug} already exists, skipped`);
    return existing.id as string;
  }
  const { gymId } = await db.tx((q) =>
    provisionGym(q, { slug, name, name_ar: nameAr, template, brand_color: color, city, saas_plan: "elite", phone: "+96171000000", owner: { name: "Demo Owner", email: `owner@${slug}.gms`, password: "demo12345" } }),
  );
  await db.query(`INSERT INTO users (gym_id, email, name, password_hash, role) VALUES ($1, $2, 'Reception Desk', $3, 'reception')`, [gymId, `reception@${slug}.gms`, await hashPassword("demo12345")]);
  await db.query(`UPDATE gyms SET address = $2, instagram = $3, tagline = $4, settings = settings || $5::jsonb, saas_status = 'active', saas_paid_until = current_date + 30 WHERE id = $1`,
    [gymId, extra.address, extra.instagram, extra.tagline, JSON.stringify(extra.settings ?? {})]);
  const stats = await seedDemoActivity(gymId, { members, days: 200, seed: slug.length * 97 });
  console.log(`- ${name}:`, JSON.stringify({ ...stats, model: { kind: stats.model.kind, auc: stats.model.metrics.auc, samples: stats.model.metrics.samples } }));
  return gymId;
}

const pulse = await makeGym("demo", "Cedar Fitness (demo)", "سيدر فيتنس", "classic", "#E4572E", "Jounieh", {
  address: "Main road, Kaslik, Jounieh", instagram: "@gms.demo", tagline: "Train hard. Stay consistent.",
  settings: { ladiesHours: [{ day: 1, from: "10:00", to: "12:00" }, { day: 3, from: "10:00", to: "12:00" }, { day: 5, from: "10:00", to: "12:00" }] },
}, 260);
await makeGym("demo-box", "Summit Box (demo)", "سوميت بوكس", "crossfit", "#2F6FCF", "Beirut", { address: "Mar Mikhael, Beirut", instagram: "@gms.demo", tagline: "Stronger together." }, 90);

// give two demo members app access with a known PIN
const pin = "1234";
const demoMembers = (await db.query(`SELECT id, code, first_name, last_name, phone FROM member_overview WHERE gym_id = $1 AND status IN ('active','expiring') AND includes_classes ORDER BY code LIMIT 2`, [pulse])).rows;
for (const m of demoMembers) await db.query("UPDATE members SET pin_hash = $2 WHERE id = $1", [m.id, await hashPassword(pin)]);
console.log("\nMember app demo logins (/m/demo):");
for (const m of demoMembers) console.log(`  #${m.code} ${m.first_name} ${m.last_name}: phone ${m.phone}  PIN ${pin}`);
await db.end();
