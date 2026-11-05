import { one, type Queryable } from "../db/index.ts";
import { hashPassword } from "../auth.ts";
import { getTemplate } from "../templates.ts";
import { clampModules, PLAN_PRICES } from "./plans.ts";

export interface NewGym {
  name: string;
  name_ar?: string | null;
  slug: string;
  city?: string | null;
  phone?: string | null;
  brand_color?: string;
  template: string;
  saas_plan?: "starter" | "pro" | "elite";
  owner: { name: string; email: string; password: string; phone?: string | null };
}

/** Creates a gym from a template, with its owner account, plans, classes and knowledge base. */
export async function provisionGym(q: Queryable, input: NewGym): Promise<{ gymId: string; ownerId: string }> {
  const t = getTemplate(input.template);
  const gym = await one<{ id: string }>(
    q,
    `INSERT INTO gyms (slug, name, name_ar, city, phone, whatsapp, brand_color, modules, settings, saas_plan, saas_price_usd)
     VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [
      input.slug, input.name, input.name_ar ?? null, input.city ?? null, input.phone ?? null,
      input.brand_color ?? "#E4572E", clampModules(input.saas_plan ?? "pro", t.modules), { ...t.settings, template: t.key },
      input.saas_plan ?? "pro", PLAN_PRICES[input.saas_plan ?? "pro"],
    ],
  );
  const gymId = gym!.id;
  const owner = await one<{ id: string }>(
    q,
    `INSERT INTO users (gym_id, email, name, phone, password_hash, role) VALUES ($1, lower($2), $3, $4, $5, 'owner') RETURNING id`,
    [gymId, input.owner.email, input.owner.name, input.owner.phone ?? null, await hashPassword(input.owner.password)],
  );

  let sort = 0;
  for (const p of t.plans) {
    await q.query(
      `INSERT INTO plans (gym_id, name, name_ar, kind, duration_days, visits, price, currency, includes_classes, gender_restriction, freeze_days_allowed, sort)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'USD',$8,$9,$10,$11)`,
      [gymId, p.name, p.name_ar, p.kind, p.duration_days, p.visits ?? null, p.price, p.includes_classes, p.gender_restriction ?? null, p.freeze_days_allowed, sort++],
    );
  }
  for (const c of t.classTypes) {
    const ct = await one<{ id: string }>(
      q,
      `INSERT INTO class_types (gym_id, name, name_ar, color, default_capacity, duration_min, women_only) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [gymId, c.name, c.name_ar, c.color, c.default_capacity, c.duration_min, c.women_only ?? false],
    );
    for (const [weekday, time] of c.slots) {
      await q.query(
        `INSERT INTO class_schedules (gym_id, class_type_id, weekday, start_time, duration_min, capacity) VALUES ($1,$2,$3,$4,$5,$6)`,
        [gymId, ct!.id, weekday, time, c.duration_min, c.default_capacity],
      );
    }
  }
  for (const k of t.knowledge) {
    await q.query(`INSERT INTO knowledge_docs (gym_id, title, body) VALUES ($1,$2,$3)`, [gymId, k.title, k.body]);
  }
  return { gymId, ownerId: owner!.id };
}
