/**
 * Realistic demo data for sales demos and testing: Lebanese names and numbers,
 * renewals and churn driven by a hidden "engagement" level (so the churn model
 * has a real signal to learn), peak-hour check-ins, mixed USD/LBP/Whish/OMT
 * payments, PT packages, class bookings, expenses (rent, generator...) and leads.
 */
import { db, many, one, type Queryable } from "../db/index.ts";
import { hashPassword } from "../auth.ts";
import { trainForGym, scoreGym } from "../ai/churn.ts";
import { ensureSessions } from "../modules/classes.ts";

const MALE = ["Charbel", "Elie", "Georges", "Joe", "Rami", "Karim", "Hadi", "Ali", "Mohamad", "Hassan", "Rabih", "Tony", "Marc", "Fadi", "Ziad", "Samer", "Omar", "Bilal", "Jad", "Anthony", "Ralph", "Nadim", "Wissam", "Hussein", "Youssef", "Michel", "Peter", "Khalil", "Ghassan", "Tarek"];
const FEMALE = ["Maria", "Rita", "Nour", "Lea", "Yara", "Christelle", "Rana", "Lara", "Joelle", "Sara", "Mira", "Hiba", "Zeina", "Nadine", "Carla", "Maya", "Rima", "Layal", "Fatima", "Dima", "Jessica", "Tala", "Perla", "Celine", "Reem"];
const LAST = ["Khoury", "Haddad", "Nassar", "Saab", "Aoun", "Gemayel", "Chamoun", "Frangieh", "Hajj", "Karam", "Mansour", "Najjar", "Rizk", "Salameh", "Tannous", "Zein", "Hamdan", "Fakhoury", "Abi Nader", "Bou Saab", "Daher", "Assaf", "Chahine", "Harb", "Moussa", "Sleiman", "Younes", "Kassab", "Itani", "Ghanem"];
const PREFIX = ["3", "70", "71", "76", "78", "79", "81"];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

async function insertMany(q: Queryable, table: string, cols: string[], rows: unknown[][]) {
  for (let i = 0; i < rows.length; i += 400) {
    const chunk = rows.slice(i, i + 400);
    const vals: unknown[] = [];
    const tuples = chunk.map((r) => `(${r.map((v) => { vals.push(v); return `$${vals.length}`; }).join(",")})`);
    await q.query(`INSERT INTO ${table} (${cols.join(",")}) VALUES ${tuples.join(",")} ON CONFLICT DO NOTHING`, vals);
  }
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

export async function seedDemoActivity(gymId: string, opts: { members: number; days: number; seed?: number }) {
  const R = rng(opts.seed ?? 42);
  const pick = <T>(a: T[]) => a[Math.floor(R() * a.length)];
  const gym = await one(db, "SELECT lbp_rate FROM gyms WHERE id = $1", [gymId]);
  const rate = Number(gym.lbp_rate);
  const plans = await many(db, "SELECT * FROM plans WHERE gym_id = $1 AND active AND kind = 'time' ORDER BY duration_days", [gymId]);
  if (!plans.length) throw new Error("gym has no time-based plans");

  // coaches
  let coaches = await many(db, "SELECT id FROM users WHERE gym_id = $1 AND role = 'coach'", [gymId]);
  if (!coaches.length) {
    const pw = await hashPassword("coach12345");
    const slug = (await one(db, "SELECT slug FROM gyms WHERE id = $1", [gymId])).slug;
    const list = [
      ["Coach Rami", "Strength & hypertrophy, 8 years experience. IFBB certified.", "#E4572E", 40],
      ["Coach Nour", "Pilates, Zumba and women's fitness. Nutrition follow-up.", "#C06C84", 40],
      ["Coach Jad", "CrossFit L2, conditioning and weight loss programs.", "#3D5A80", 35],
    ] as const;
    for (const [i, c] of list.entries()) {
      await db.query(`INSERT INTO users (gym_id, email, name, password_hash, role, bio, color, commission_pct) VALUES ($1,$2,$3,$4,'coach',$5,$6,$7) ON CONFLICT DO NOTHING`,
        [gymId, `coach${i + 1}@${slug}.gms.demo`, c[0], pw, c[1], c[2], c[3]]);
    }
    coaches = await many(db, "SELECT id FROM users WHERE gym_id = $1 AND role = 'coach'", [gymId]);
  }
  await db.query("UPDATE class_schedules s SET coach_id = (SELECT u.id FROM users u WHERE u.gym_id = s.gym_id AND u.role = 'coach' ORDER BY md5(u.id::text || s.id::text) LIMIT 1) WHERE s.gym_id = $1 AND s.coach_id IS NULL", [gymId]);
  const reception = await one(db, "SELECT id FROM users WHERE gym_id = $1 AND role IN ('owner','manager','reception') ORDER BY role DESC LIMIT 1", [gymId]);

  // past class sessions (last 60 days) from the weekly schedule
  await db.query(`
    INSERT INTO class_sessions (gym_id, schedule_id, class_type_id, coach_id, starts_at, ends_at, capacity, room)
    SELECT s.gym_id, s.id, s.class_type_id, s.coach_id, ((d::date + s.start_time) AT TIME ZONE g.timezone),
           ((d::date + s.start_time) AT TIME ZONE g.timezone) + make_interval(mins => s.duration_min), s.capacity, s.room
      FROM class_schedules s JOIN gyms g ON g.id = s.gym_id
     CROSS JOIN LATERAL generate_series((now() AT TIME ZONE g.timezone)::date - 60, (now() AT TIME ZONE g.timezone)::date - 1, interval '1 day') d
     WHERE s.gym_id = $1 AND s.active AND extract(dow FROM d) = s.weekday
    ON CONFLICT (schedule_id, starts_at) DO NOTHING`, [gymId]);
  await ensureSessions(db, gymId);
  const sessions = await many(db, "SELECT id, starts_at, capacity FROM class_sessions WHERE gym_id = $1 AND starts_at > now() - interval '60 days' AND starts_at < now() + interval '6 days' ORDER BY starts_at", [gymId]);

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const counter = await one(db, "SELECT coalesce(max(code), 1000) AS c FROM members WHERE gym_id = $1", [gymId]);
  let code = counter.c;
  let receipt = (await one(db, "SELECT coalesce(max(receipt_no), 1000) AS r FROM payments WHERE gym_id = $1", [gymId])).r;

  const memberRows: unknown[][] = [];
  const msRows: unknown[][] = [];
  const payRows: unknown[][] = [];
  const ckRows: unknown[][] = [];
  const bookingRows: unknown[][] = [];
  const ptRows: unknown[][] = [];
  const usedPhones = new Set<string>();

  for (let i = 0; i < opts.members; i++) {
    const female = R() < 0.42;
    const first = pick(female ? FEMALE : MALE);
    const last = pick(LAST);
    let phone: string;
    do phone = `+961${pick(PREFIX)}${String(Math.floor(R() * 1e6)).padStart(6, "0")}`; while (usedPhones.has(phone));
    usedPhones.add(phone);
    const engagement = R(); // hidden: drives visits and renewals
    const joinedAgo = Math.floor(Math.pow(R(), 0.8) * opts.days);
    const joined = addDays(today, -joinedAgo);
    const memberId = crypto.randomUUID();
    code++;
    memberRows.push([memberId, gymId, code, first, last, phone, female ? "female" : "male",
      R() < 0.6 ? iso(new Date(Date.UTC(1975 + Math.floor(R() * 30), Math.floor(R() * 12), 1 + Math.floor(R() * 28)))) : null,
      pick(["walk-in", "instagram", "instagram", "referral", "tiktok", "google"]), joined.toISOString()]);

    // membership chain
    let start = joined;
    let active = true;
    let renewals = 0;
    while (active && start <= today) {
      const plan = renewals === 0 ? (R() < 0.65 ? plans[0] : pick(plans)) : (R() < 0.5 ? plans[0] : pick(plans));
      const end = addDays(start, plan.duration_days - 1);
      const msId = crypto.randomUUID();
      const lbp = R() < 0.12;
      const price = Number(plan.price);
      const discount = R() < 0.15 ? Math.round(price * 0.1) : 0;
      const priceUsd = price - discount;
      msRows.push([msId, gymId, memberId, plan.id, plan.name, iso(start), iso(end), price, discount, priceUsd, "USD", plan.freeze_days_allowed, plan.includes_classes, reception?.id ?? null, start.toISOString()]);
      // payment: most pay in full, some leave a balance
      const paidShare = R() < 0.9 ? 1 : 0.5;
      const method = pick(["cash", "cash", "cash", "cash", "whish", "whish", "omt", "card"]);
      const amountUsd = Math.round(priceUsd * paidShare * 100) / 100;
      if (amountUsd > 0) {
        receipt++;
        const payAt = new Date(start.getTime() + (9 + Math.floor(R() * 11)) * 3600000);
        payRows.push([gymId, memberId, msId, lbp ? Math.round(amountUsd * rate) : amountUsd, lbp ? "LBP" : "USD", rate, amountUsd, method, receipt, reception?.id ?? null, payAt.toISOString()]);
      }
      // check-ins: engaged members come 3-5x/week; disengaged ones fade out before the end
      const weekly = 0.6 + engagement * 4.2;
      const willRenew = R() < 0.25 + engagement * 0.7 && renewals < 8;
      const fadeFrom = willRenew ? 1 : 0.35 + R() * 0.4; // fraction of the membership after which they stop
      const lenDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
      const prefersMorning = R() < 0.35;
      for (let d = 0; d < lenDays; d++) {
        const day = addDays(start, d);
        if (day > today) break;
        const p = d / lenDays > fadeFrom ? weekly * 0.05 : weekly;
        if (R() < p / 7) {
          const hourLocal = prefersMorning ? 6 + Math.floor(R() * 3) : R() < 0.75 ? 17 + Math.floor(R() * 4) : 10 + Math.floor(R() * 6);
          const at = new Date(day.getTime() + (hourLocal - 2) * 3600000 + Math.floor(R() * 59) * 60000);
          if (at.getTime() < Date.now()) ckRows.push([gymId, memberId, msId, at.toISOString(), R() < 0.85 ? "qr" : "manual", "ok", reception?.id ?? null]);
        }
      }
      // PT package for some engaged members
      if (engagement > 0.6 && R() < 0.35) {
        const coach = pick(coaches);
        const total = pick([8, 10, 12]);
        const ptPrice = total * 15;
        const ptId = crypto.randomUUID();
        ptRows.push([ptId, gymId, memberId, coach.id, `${total} PT sessions`, total, Math.min(total, Math.floor(R() * total) + 1), ptPrice, "USD", ptPrice, start.toISOString()]);
        receipt++;
        payRows.push([gymId, memberId, null, ptPrice, "USD", rate, ptPrice, pick(["cash", "whish"]), receipt, reception?.id ?? null, new Date(start.getTime() + 12 * 3600000).toISOString(), ptId]);
      }
      if (!willRenew) active = false;
      start = addDays(end, 1 + (R() < 0.2 ? Math.floor(R() * 10) : 0));
      renewals++;
    }
    // class bookings for engaged members on plans with classes
    if (engagement > 0.45 && sessions.length) {
      for (const s of sessions) {
        if (new Date(s.starts_at) < joined) continue;
        if (R() < 0.04 + engagement * 0.06) {
          const past = new Date(s.starts_at).getTime() < Date.now();
          bookingRows.push([gymId, s.id, memberId, past ? (R() < 0.88 ? "attended" : "no_show") : "booked"]);
        }
      }
    }
  }

  await db.tx(async (q) => {
    await insertMany(q, "members", ["id", "gym_id", "code", "first_name", "last_name", "phone", "gender", "birth_date", "source", "created_at"], memberRows);
    await insertMany(q, "memberships", ["id", "gym_id", "member_id", "plan_id", "plan_name", "start_date", "end_date", "price", "discount", "price_usd", "currency", "freeze_days_allowed", "includes_classes", "created_by", "created_at"], msRows);
    await insertMany(q, "pt_packages", ["id", "gym_id", "member_id", "coach_id", "title", "sessions_total", "sessions_used", "price", "currency", "price_usd", "created_at"], ptRows);
    const payWithPt = payRows.map((r) => (r.length === 12 ? r : [...r, null]));
    await insertMany(q, "payments", ["gym_id", "member_id", "membership_id", "amount", "currency", "lbp_rate", "amount_usd", "method", "receipt_no", "received_by", "paid_at", "pt_package_id"], payWithPt);
    await insertMany(q, "checkins", ["gym_id", "member_id", "membership_id", "at", "method", "result", "by_user"], ckRows);
    await insertMany(q, "bookings", ["gym_id", "session_id", "member_id", "status"], bookingRows);
    // counters continue after the demo data
    await q.query(`INSERT INTO counters (gym_id, name, value) VALUES ($1,'member',$2), ($1,'receipt',$3)
                   ON CONFLICT (gym_id, name) DO UPDATE SET value = greatest(counters.value, EXCLUDED.value)`, [gymId, code, receipt]);
    // expenses: 6 months of typical Lebanese gym costs
    const exp: unknown[][] = [];
    for (let m = 0; m < 6; m++) {
      const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - m, 1));
      exp.push([gymId, "rent", 2500, "USD", rate, 2500, iso(d), "Monthly rent"]);
      exp.push([gymId, "salaries", 3200, "USD", rate, 3200, iso(addDays(d, 27)), "Staff & coaches"]);
      exp.push([gymId, "generator", 650 + Math.round(R() * 250), "USD", rate, 0, iso(addDays(d, 4)), "Generator subscription + diesel"]);
      exp.push([gymId, "electricity", Math.round((90 + R() * 40) * rate), "LBP", rate, 0, iso(addDays(d, 10)), "EDL bill"]);
      if (R() < 0.5) exp.push([gymId, "marketing", 150 + Math.round(R() * 150), "USD", rate, 0, iso(addDays(d, 12)), "Instagram ads"]);
      if (R() < 0.3) exp.push([gymId, "maintenance", 80 + Math.round(R() * 200), "USD", rate, 0, iso(addDays(d, 18)), "Treadmill repair"]);
    }
    for (const e of exp) e[5] = e[3] === "USD" ? e[2] : Math.round(((e[2] as number) / rate) * 100) / 100;
    await insertMany(q, "expenses", ["gym_id", "category", "amount", "currency", "lbp_rate", "amount_usd", "spent_on", "note"], exp);
    // leads
    const leadStatus = ["new", "new", "contacted", "trial", "lost", "converted"];
    const leads: unknown[][] = [];
    for (let i = 0; i < 14; i++) {
      const female = R() < 0.5;
      leads.push([gymId, `${pick(female ? FEMALE : MALE)} ${pick(LAST)}`, `+961${pick(PREFIX)}${String(Math.floor(R() * 1e6)).padStart(6, "0")}`,
        pick(["instagram", "instagram", "walk-in", "referral", "tiktok"]), pick(leadStatus), pick(["Weight loss", "Muscle gain", "Classes", "PT", "Student offer"]),
        iso(addDays(today, Math.floor(R() * 10) - 3))]);
    }
    await insertMany(q, "leads", ["gym_id", "name", "phone", "source", "status", "interest", "follow_up_on"], leads);
  });

  await seedShop(gymId, R, reception?.id ?? null, memberRows.map((r) => r[0] as string));
  await seedEngagement(gymId, R);
  const train = await trainForGym(gymId);
  const score = await scoreGym(gymId);
  return { members: memberRows.length, memberships: msRows.length, payments: payRows.length, checkins: ckRows.length, bookings: bookingRows.length, model: train, scored: score.scored };
}

const CATALOG: [name: string, category: string, brand: string, price: number, cost: number, stock: number][] = [
  ["Whey protein 2 kg — chocolate", "supplements", "Generic", 75, 52, 14],
  ["Whey protein 2 kg — vanilla", "supplements", "Generic", 75, 52, 3],
  ["Creatine monohydrate 300 g", "supplements", "Generic", 30, 17, 22],
  ["Pre-workout 30 servings", "supplements", "Generic", 40, 25, 9],
  ["BCAA 400 g", "supplements", "Generic", 32, 19, 6],
  ["Mass gainer 3 kg", "supplements", "Generic", 65, 44, 4],
  ["Protein bar", "snacks", "Generic", 3, 1.6, 60],
  ["Water 500 ml", "drinks", "Local", 0.5, 0.2, 120],
  ["Energy drink", "drinks", "Generic", 2, 1.1, 48],
  ["Isotonic drink", "drinks", "Generic", 1.5, 0.8, 36],
  ["Shaker 700 ml", "accessories", "Gym brand", 8, 3, 25],
  ["Lifting straps", "accessories", "Generic", 12, 5, 2],
  ["Gym towel", "accessories", "Gym brand", 10, 4, 15],
];

/** Shop catalog + 90 days of sales, for demos. */
async function seedShop(gymId: string, R: () => number, userId: string | null, memberIds: string[]) {
  const exists = await one(db, "SELECT 1 FROM products WHERE gym_id = $1 LIMIT 1", [gymId]);
  if (exists) return;
  const rate = Number((await one(db, "SELECT lbp_rate FROM gyms WHERE id = $1", [gymId])).lbp_rate);
  const products: any[] = [];
  for (const [i, [name, category, brand, price, cost, stock]] of CATALOG.entries()) {
    const p = await one(db, `INSERT INTO products (gym_id, name, category, brand, barcode, price, currency, cost_usd, stock, low_stock_at, expires_on)
                             VALUES ($1,$2,$3,$4,$5,$6,'USD',$7,$8,$9,$10) RETURNING *`,
      [gymId, name, category, brand, `628000${String(1000 + i)}`, price, cost, stock, category === "drinks" ? 12 : 5,
        category === "supplements" ? new Date(Date.now() + (40 + Math.floor(R() * 400)) * 86400000).toISOString().slice(0, 10) : null]);
    products.push(p);
  }
  let saleNo = 0;
  let receipt = (await one(db, "SELECT coalesce(max(receipt_no), 1000) AS r FROM payments WHERE gym_id = $1", [gymId])).r;
  await db.tx(async (q) => {
    for (let d = 90; d >= 1; d--) {
      const perDay = 2 + Math.floor(R() * 6);
      for (let k = 0; k < perDay; k++) {
        const picks = [products[Math.floor(Math.pow(R(), 1.6) * products.length)]];
        if (R() < 0.25) picks.push(products[6 + Math.floor(R() * 4)]);
        const lines = picks.map((p) => ({ p, qty: p.category === "supplements" ? 1 : 1 + Math.floor(R() * 2) }));
        const total = Math.round(lines.reduce((s, l) => s + Number(l.p.price) * l.qty, 0) * 100) / 100;
        const cost = Math.round(lines.reduce((s, l) => s + Number(l.p.cost_usd) * l.qty, 0) * 100) / 100;
        const member = R() < 0.7 && memberIds.length ? memberIds[Math.floor(R() * memberIds.length)] : null;
        const at = new Date(Date.now() - d * 86400000 + (8 + Math.floor(R() * 12)) * 3600000);
        saleNo++;
        const sale = await one(q, `INSERT INTO sales (gym_id, sale_no, member_id, subtotal_usd, total_usd, cost_usd, lbp_rate, status, sold_by, sold_at)
                                   VALUES ($1,$2,$3,$4,$4,$5,$6,'paid',$7,$8) RETURNING id`, [gymId, saleNo, member, total, cost, rate, userId, at.toISOString()]);
        for (const l of lines) {
          await q.query(`INSERT INTO sale_items (sale_id, product_id, name, qty, unit_price, currency, line_total_usd, unit_cost_usd) VALUES ($1,$2,$3,$4,$5,'USD',$6,$7)`,
            [sale!.id, l.p.id, l.p.name, l.qty, l.p.price, Math.round(Number(l.p.price) * l.qty * 100) / 100, l.p.cost_usd]);
        }
        const lbp = R() < 0.25;
        receipt++;
        await q.query(`INSERT INTO payments (gym_id, member_id, sale_id, amount, currency, lbp_rate, amount_usd, method, receipt_no, received_by, paid_at, note)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [gymId, member, sale!.id, lbp ? Math.round((total * rate) / 1000) * 1000 : total, lbp ? "LBP" : "USD", rate, total,
            R() < 0.7 ? "cash" : "whish", receipt, userId, at.toISOString(), `Shop sale #${saleNo}`]);
      }
    }
    await q.query(`INSERT INTO counters (gym_id, name, value) VALUES ($1,'sale',$2), ($1,'receipt',$3)
                   ON CONFLICT (gym_id, name) DO UPDATE SET value = greatest(counters.value, EXCLUDED.value)`, [gymId, saleNo, receipt]);
  });
}

const DESCRIPTIONS: Record<string, string> = {
  "Whey protein 2 kg — chocolate": "25 g of protein per scoop, 66 servings. Mixes smoothly with water or milk. Best right after training.",
  "Whey protein 2 kg — vanilla": "25 g of protein per scoop, 66 servings. Light vanilla taste, great in a morning shake.",
  "Creatine monohydrate 300 g": "Pure creatine, 5 g a day. Helps strength and power over the weeks. Unflavoured.",
  "Pre-workout 30 servings": "Caffeine and beta-alanine for energy before hard sessions. Not after 6 pm!",
  "BCAA 400 g": "Amino acids to sip during training. Fruit flavour.",
  "Mass gainer 3 kg": "Calories and protein for members who struggle to gain weight.",
  "Protein bar": "20 g protein, low sugar. The easy snack after the gym.",
  "Shaker 700 ml": "Leak-proof shaker with the gym's logo.",
  "Gym towel": "Soft microfibre towel with the gym's logo.",
  "Lifting straps": "Cotton straps for a better grip on heavy pulls.",
};

/** Offers, a bundle, a challenge, coach hours, referrals and app orders, for demos of the member app. */
export async function seedEngagement(gymId: string, R: () => number) {
  if (await one(db, "SELECT 1 FROM offers WHERE gym_id = $1 LIMIT 1", [gymId])) return;
  const today = (await one(db, "SELECT (now() AT TIME ZONE timezone)::date::text AS d FROM gyms WHERE id = $1", [gymId])).d as string;
  const monthStart = today.slice(0, 8) + "01";
  const monthEnd = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const monthName = new Date(today + "T00:00:00Z").toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
  await db.tx(async (q) => {
    for (const [name, text] of Object.entries(DESCRIPTIONS)) {
      await q.query("UPDATE products SET description = $3, featured = $4 WHERE gym_id = $1 AND name = $2", [gymId, name, text, /chocolate|Creatine|Protein bar|Shaker/.test(name)]);
    }
    const whey = await one(q, "SELECT id FROM products WHERE gym_id = $1 AND name LIKE 'Whey protein 2 kg — chocolate'", [gymId]);
    const shaker = await one(q, "SELECT id FROM products WHERE gym_id = $1 AND name = 'Shaker 700 ml'", [gymId]);
    const creatine = await one(q, "SELECT id FROM products WHERE gym_id = $1 AND name LIKE 'Creatine%'", [gymId]);
    let bundle: any = null;
    if (whey && shaker && creatine) {
      bundle = await one(q, `INSERT INTO products (gym_id, name, category, price, currency, kind, components, track_stock, featured, description)
                             VALUES ($1, 'Starter pack: whey + creatine + shaker', 'supplements', 99, 'USD', 'bundle', $2, false, true,
                                     'Everything to start: 2 kg chocolate whey, 300 g creatine and the gym shaker. Save $14 compared with buying them one by one.') RETURNING id`,
        [gymId, JSON.stringify([{ product_id: whey.id, qty: 1 }, { product_id: creatine.id, qty: 1 }, { product_id: shaker.id, qty: 1 }])]);
    }
    const plan3 = await one(q, "SELECT id FROM plans WHERE gym_id = $1 AND active AND duration_days BETWEEN 80 AND 100 ORDER BY price LIMIT 1", [gymId]);
    await q.query(`INSERT INTO offers (gym_id, title, body, badge, kind, product_id, plan_id, starts_on, ends_on, sort) VALUES
      ($1, 'Starter pack', 'Whey, creatine and a shaker for $99 instead of $113. Ask at reception or tap "I want it".', '-12%', 'offer', $2, NULL, NULL, $5, 0),
      ($1, 'Renew for 3 months, get a free week', 'Renew before your membership ends and we add 7 days for free.', '+7 days', 'offer', NULL, $3, NULL, $5, 1),
      ($1, 'Saturday bootcamp', 'Free outdoor session every Saturday at 9:00 for all members. Bring water!', 'FREE', 'event', NULL, NULL, $4, NULL, 2)`,
      [gymId, bundle?.id ?? null, plan3?.id ?? null, monthStart, monthEnd]);
    await q.query(`INSERT INTO challenges (gym_id, title, description, metric, target, starts_on, ends_on, reward) VALUES
      ($1, $2, 'Come to the gym on 12 different days this month. Everyone takes part automatically.', 'visits', 12, $3, $4, 'A free shaker for everyone who makes it')`,
      [gymId, `12 days in ${monthName}`, monthStart, monthEnd]);
    // coach hours: mornings and evenings on weekdays, Saturday morning
    const coaches = await many(q, "SELECT id FROM users WHERE gym_id = $1 AND role = 'coach' AND active", [gymId]);
    for (const [i, c] of coaches.entries()) {
      for (let wd = 1; wd <= 5; wd++) {
        if ((wd + i) % 2 === 0) await q.query("INSERT INTO coach_availability (gym_id, coach_id, weekday, start_time, end_time) VALUES ($1,$2,$3,'07:00','11:00')", [gymId, c.id, wd]);
        await q.query("INSERT INTO coach_availability (gym_id, coach_id, weekday, start_time, end_time) VALUES ($1,$2,$3,'16:00','21:00')", [gymId, c.id, wd]);
      }
      await q.query("INSERT INTO coach_availability (gym_id, coach_id, weekday, start_time, end_time) VALUES ($1,$2,6,'09:00','13:00')", [gymId, c.id]);
    }
    // a few upcoming PT sessions on packages with sessions left
    const pkgs = await many(q, "SELECT id, member_id, coach_id FROM pt_packages WHERE gym_id = $1 AND coach_id IS NOT NULL AND sessions_used < sessions_total - 1 LIMIT 6", [gymId]);
    for (const [i, p] of pkgs.entries()) {
      await q.query(`INSERT INTO pt_sessions (gym_id, package_id, member_id, coach_id, starts_at, duration_min)
                     SELECT $1, $2, $3, $4, ((($5::date + $6::int) + time '17:00') AT TIME ZONE g.timezone), 60 FROM gyms g WHERE g.id = $1`, [gymId, p.id, p.member_id, p.coach_id, today, 1 + i]);
    }
    // referrals: some members brought friends
    const members = await many(q, "SELECT id FROM members WHERE gym_id = $1 AND archived_at IS NULL ORDER BY created_at LIMIT 400", [gymId]);
    if (members.length > 40) {
      for (let k = 0; k < 8; k++) {
        const ref = members[Math.floor(R() * 20)];
        const friend = members[30 + Math.floor(R() * (members.length - 30))];
        if (ref.id !== friend.id) await q.query("UPDATE members SET referred_by = $2 WHERE id = $1 AND referred_by IS NULL", [friend.id, ref.id]);
      }
      const pending = await many(q, "SELECT id FROM leads WHERE gym_id = $1 AND status IN ('new','contacted') LIMIT 4", [gymId]);
      for (const l of pending) await q.query("UPDATE leads SET referred_by = $2, source = 'Referral' WHERE id = $1", [l.id, members[Math.floor(R() * 20)].id]);
      // two orders placed from the app
      const featured = await many(q, "SELECT id FROM products WHERE gym_id = $1 AND featured AND kind = 'item' LIMIT 2", [gymId]);
      for (const [i, f] of featured.entries()) {
        await q.query("INSERT INTO product_requests (gym_id, member_id, product_id, qty, status) VALUES ($1,$2,$3,1,$4)", [gymId, members[i + 3].id, f.id, i === 0 ? "pending" : "ready"]);
      }
    }
    await q.query(`UPDATE gyms SET settings = jsonb_set(settings, '{engage}', coalesce(settings->'engage', '{}') || '{"referralReward": "1 free week"}'::jsonb) WHERE id = $1`, [gymId]);
  });
}
