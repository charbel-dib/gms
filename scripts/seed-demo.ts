/**
 * Creates two fully-populated demo gyms for sales demos.
 *   npm run seed:demo            (uses DATABASE_URL)
 * Logins (change them before showing a real client):
 *   Platform admin : admin@gms.local / admin12345 (dev default, see SUPERADMIN_*)
 *   Cedar Fitness (demo) : owner@demo.gms / demo12345 · reception@demo.gms / demo12345
 *   Summit Box (demo)    : owner@demo-box.gms / demo12345   (level: studio)
 *   Halba Gym (demo)     : owner@demo-halba.gms / demo12345 (level: essential — the small-gym demo)
 *   Member apps          : /m/<slug>, phone and PIN printed at the end and shown on the Platform page
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

async function makeGym(slug: string, name: string, nameAr: string, template: string, color: string, city: string, extra: Record<string, unknown>, members: number, level: "essential" | "studio" | "full" = "full", plan: "starter" | "pro" | "elite" = "elite", priceFactor = 1) {
  const existing = await one(db, "SELECT id FROM gyms WHERE slug = $1", [slug]);
  if (existing) {
    console.log(`- ${slug} already exists, skipped`);
    return existing.id as string;
  }
  const { gymId } = await db.tx((q) =>
    provisionGym(q, { slug, name, name_ar: nameAr, template, brand_color: color, city, saas_plan: plan, level, phone: "+96171000000", owner: { name: "Demo Owner", email: `owner@${slug}.gms`, password: "demo12345" } }),
  );
  await db.query(`INSERT INTO users (gym_id, email, name, password_hash, role) VALUES ($1, $2, 'Reception Desk', $3, 'reception')`, [gymId, `reception@${slug}.gms`, await hashPassword("demo12345")]);
  await db.query(`UPDATE gyms SET address = $2, instagram = $3, tagline = $4, settings = settings || $5::jsonb || '{"setup":{"prices":true,"logoSkipped":true}}'::jsonb, saas_status = 'active', is_demo = true, saas_paid_until = current_date + 30 WHERE id = $1`,
    [gymId, extra.address, extra.instagram, extra.tagline, JSON.stringify(extra.settings ?? {})]);
  if (priceFactor !== 1) await db.query("UPDATE plans SET price = greatest(5, round(price * $2)) WHERE gym_id = $1", [gymId, priceFactor]);
  const stats = await seedDemoActivity(gymId, { members, days: 200, seed: slug.length * 97 });
  console.log(`- ${name}:`, JSON.stringify({ ...stats, model: { kind: stats.model.kind, auc: stats.model.metrics.auc, samples: stats.model.metrics.samples } }));
  return gymId;
}

await makeGym("demo", "Cedar Fitness (demo)", "سيدر فيتنس", "classic", "#E4572E", "Jounieh", {
  address: "Main road, Kaslik, Jounieh", instagram: "@gms.demo", tagline: "Train hard. Stay consistent.",
  settings: { ladiesHours: [{ day: 1, from: "10:00", to: "12:00" }, { day: 3, from: "10:00", to: "12:00" }, { day: 5, from: "10:00", to: "12:00" }] },
}, 260);
await makeGym("demo-box", "Summit Box (demo)", "سوميت بوكس", "crossfit", "#2F6FCF", "Beirut", { address: "Mar Mikhael, Beirut", instagram: "@gms.demo", tagline: "Stronger together." }, 90, "studio", "pro");
// a small weights gym on the simplest level: what most gyms outside Beirut look like
await makeGym("demo-halba", "Halba Gym (demo)", "نادي حلبا", "classic", "#0F5E8C", "Halba", { address: "Main street, Halba, Akkar", instagram: "@gms.demo", tagline: "Your gym, next door." }, 140, "essential", "starter", 0.45);

// the member to log in as in each demo gym's app (chosen and filled by seedShowcase)
console.log("\nMember app demo logins (also shown on the Platform page):");
for (const g of (await db.query(`SELECT slug, settings->'demo' AS d FROM gyms WHERE is_demo AND slug LIKE 'demo%' ORDER BY slug`)).rows) {
  if (g.d) console.log(`  /m/${g.slug}  ${g.d.name}: phone ${g.d.phone}  PIN ${g.d.pin}`);
}
await db.end();
