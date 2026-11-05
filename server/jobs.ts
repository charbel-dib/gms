/**
 * Background jobs, run inside the app container. On ECS several tasks may run;
 * a Postgres advisory lock guarantees each job runs once at a time across all of them.
 */
import { db, many, one } from "./db/index.ts";
import { ensureSessions } from "./modules/classes.ts";
import { reminderText, sendWhatsApp } from "./services/whatsapp.ts";
import { scoreGym, trainForGym } from "./ai/churn.ts";

async function withLock(key: number, fn: () => Promise<void>) {
  await db.withConnection(async (c) => {
    const r = await c.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [key]);
    if (!r.rows[0].ok) return;
    try {
      await fn();
    } finally {
      await c.query("SELECT pg_advisory_unlock($1)", [key]);
    }
  });
}

/** Sends renewal reminders and win-back messages for one gym. Idempotent (dedupe keys). */
export async function runReminders(gymId: string) {
  const gym = await one(db, "SELECT name, locale, settings, modules FROM gyms WHERE id = $1 AND saas_status <> 'suspended'", [gymId]);
  if (!gym || gym.modules?.whatsapp === false) return { sent: 0, queued: 0 };
  const cfg = { enabled: true, daysBefore: [7, 1], afterExpiryDays: [3], ...(gym.settings?.reminders ?? {}) };
  if (!cfg.enabled) return { sent: 0, queued: 0 };
  const lang = gym.locale === "ar" ? "ar" : "en";
  const members = await many(db, `
    SELECT mo.id, mo.first_name, mo.phone, mo.plan_name, mo.end_date::text AS end_date, mo.days_left, mo.membership_id
      FROM member_overview mo
     WHERE mo.gym_id = $1 AND mo.archived_at IS NULL AND mo.phone IS NOT NULL AND mo.whatsapp_opt_in
       AND mo.status IN ('active','expiring','expired') AND mo.days_left BETWEEN -60 AND 60
       AND NOT EXISTS (SELECT 1 FROM memberships n WHERE n.member_id = mo.id AND n.status = 'active' AND n.start_date > mo.end_date)`, [gymId]);
  let sent = 0;
  let queued = 0;
  for (const m of members) {
    let kind: "before" | "today" | "after" | null = null;
    let marker = 0;
    if (m.days_left === 0 && cfg.daysBefore.includes(0)) kind = "today";
    else if (m.days_left > 0 && cfg.daysBefore.includes(m.days_left)) { kind = "before"; marker = m.days_left; }
    else if (m.days_left < 0 && cfg.afterExpiryDays.includes(-m.days_left)) { kind = "after"; marker = -m.days_left; }
    if (!kind) continue;
    const body = reminderText(lang, kind, { name: m.first_name, plan: m.plan_name, gym: gym.name, date: m.end_date, days: Math.max(0, m.days_left) }, lang === "ar" ? cfg.templateAr : cfg.templateEn);
    const row = await sendWhatsApp(db, {
      gymId, memberId: m.id, phone: m.phone, kind: kind === "after" ? "winback" : "reminder_expiry", body,
      dedupeKey: `rem:${m.membership_id}:${kind}:${marker}`,
      template: { name: kind === "after" ? "gms_winback" : "gms_renewal_reminder", lang, params: [m.first_name, gym.name, m.end_date] },
    });
    if (row?.status === "sent") sent++;
    else if (row) queued++;
  }
  return { sent, queued };
}

async function forEachGym(fn: (id: string) => Promise<unknown>) {
  const gyms = await many(db, "SELECT id FROM gyms WHERE saas_status <> 'suspended'");
  for (const g of gyms) {
    try {
      await fn(g.id);
    } catch (e) {
      console.error(`[jobs] gym ${g.id}:`, (e as Error).message);
    }
  }
}

let timers: NodeJS.Timeout[] = [];

export function startJobs() {
  const every = (ms: number, key: number, fn: () => Promise<void>) => {
    const run = () => withLock(key, fn).catch((e) => console.error("[jobs]", e.message));
    timers.push(setTimeout(run, 5_000));
    timers.push(setInterval(run, ms));
  };
  // class sessions for the next 2 weeks + housekeeping
  every(30 * 60_000, 9101, async () => {
    await forEachGym((id) => ensureSessions(db, id));
    await db.query("DELETE FROM sessions WHERE expires_at < now()");
    await db.query("DELETE FROM login_attempts WHERE window_start < now() - interval '1 day'");
  });
  // reminders: hourly check, sends only between 10:00 and 20:00 Beirut time
  every(60 * 60_000, 9102, async () => {
    const h = await one(db, "SELECT extract(hour FROM now() AT TIME ZONE 'Asia/Beirut')::int AS h");
    if (h.h < 10 || h.h >= 20) return;
    await forEachGym((id) => runReminders(id));
  });
  // churn: rescore every 6 hours; retrain once a day (night, Beirut time)
  every(6 * 3600_000, 9103, async () => {
    const h = await one(db, "SELECT extract(hour FROM now() AT TIME ZONE 'Asia/Beirut')::int AS h");
    await forEachGym(async (id) => {
      const m = await one(db, "SELECT trained_at FROM ai_models WHERE gym_id = $1", [id]);
      if (!m || (h.h < 6 && Date.now() - new Date(m.trained_at).getTime() > 20 * 3600_000)) await trainForGym(id);
      await scoreGym(id);
    });
  });
}

export function stopJobs() {
  timers.forEach((t) => clearTimeout(t));
  timers = [];
}
