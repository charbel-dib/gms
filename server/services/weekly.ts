/**
 * The week in numbers, written for a phone screen. Sent on Telegram every Monday morning to owners and managers
 * who connected, and on demand with /summary. The operator gets the same for the whole platform.
 */
import { config } from "../config.ts";
import { db, many, one } from "../db/index.ts";
import { notifyOperator, tgSend } from "./telegram.ts";

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export async function gymWeekText(gymId: string): Promise<string> {
  const g = await one(db, "SELECT name, name_ar, locale FROM gyms WHERE id = $1", [gymId]);
  const s = await one(db, `SELECT
      (SELECT count(*) FROM checkins WHERE gym_id = $1 AND result = 'ok' AND at > now() - interval '7 days')::int AS visits,
      (SELECT count(*) FROM checkins WHERE gym_id = $1 AND result = 'ok' AND at > now() - interval '14 days' AND at <= now() - interval '7 days')::int AS visits_prev,
      (SELECT coalesce(sum(amount_usd), 0) FROM payments WHERE gym_id = $1 AND voided_at IS NULL AND paid_at > now() - interval '7 days')::float AS collected,
      (SELECT coalesce(sum(balance_usd), 0) FROM member_overview WHERE gym_id = $1 AND archived_at IS NULL AND balance_usd > 0)::float AS owed,
      (SELECT count(*) FROM member_overview WHERE gym_id = $1 AND archived_at IS NULL AND balance_usd > 0)::int AS owing,
      (SELECT count(*) FROM member_overview WHERE gym_id = $1 AND archived_at IS NULL AND status IN ('active','expiring') AND end_date BETWEEN current_date AND current_date + 6)::int AS ending,
      (SELECT count(*) FROM member_overview WHERE gym_id = $1 AND archived_at IS NULL AND churn_score >= 0.6 AND status IN ('active','expiring'))::int AS away,
      (SELECT count(*) FROM members WHERE gym_id = $1 AND created_at > now() - interval '7 days')::int AS joined`, [gymId]);
  const pct = s.visits_prev > 0 ? Math.round(((s.visits - s.visits_prev) / s.visits_prev) * 100) : null;
  const sign = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n)}%`;
  if (g.locale === "ar") {
    return [
      `${g.name_ar || g.name}، جمعتك بالأرقام`,
      "",
      `${s.visits} زيارة${pct != null ? ` (${sign(pct)} عن الجمعة اللي قبلها)` : ""}`,
      `${usd(s.collected)} مقبوضين`,
      s.owing ? `${usd(s.owed)} بعدهم عند ${s.owing} مشترك` : "ما حدا عليه مصاري",
      `${s.ending} اشتراك بيخلصوا بالسبع أيام الجايين`,
      s.away ? `${s.away} مشترك بطّلوا يجوا` : "ما حدا بطّل يجي",
      s.joined ? `${s.joined} مشترك جديد` : "",
      "",
      `افتح GMS: ${config.publicUrl}/`,
    ].filter((l, i, a) => l !== "" || (a[i - 1] ?? "") !== "").join("\n");
  }
  return [
    `${g.name}, your week`,
    "",
    `${s.visits} visits${pct != null ? ` (${sign(pct)} on the week before)` : ""}`,
    `${usd(s.collected)} collected`,
    s.owing ? `${usd(s.owed)} still owed by ${s.owing} member${s.owing === 1 ? "" : "s"}` : "Nobody owes money",
    `${s.ending} membership${s.ending === 1 ? "" : "s"} end in the next 7 days`,
    s.away ? `${s.away} member${s.away === 1 ? "" : "s"} stopped coming` : "Nobody stopped coming",
    s.joined ? `${s.joined} new member${s.joined === 1 ? "" : "s"}` : "",
    "",
    `Open GMS: ${config.publicUrl}/`,
  ].filter((l, i, a) => l !== "" || (a[i - 1] ?? "") !== "").join("\n");
}

export async function platformWeekText(): Promise<string> {
  const s = await one(db, `SELECT
      count(*) FILTER (WHERE archived_at IS NULL AND NOT is_demo)::int AS gyms,
      count(*) FILTER (WHERE archived_at IS NULL AND NOT is_demo AND saas_status = 'active')::int AS paying,
      count(*) FILTER (WHERE archived_at IS NULL AND NOT is_demo AND saas_status = 'trial')::int AS trial,
      coalesce(sum(saas_price_usd) FILTER (WHERE archived_at IS NULL AND NOT is_demo AND saas_status = 'active'), 0)::float AS mrr,
      count(*) FILTER (WHERE archived_at IS NULL AND NOT is_demo AND saas_status = 'past_due')::int AS late
    FROM gyms`);
  const quiet = await many(db, `SELECT g.name FROM gyms g WHERE g.archived_at IS NULL AND NOT g.is_demo
      AND NOT EXISTS (SELECT 1 FROM checkins c WHERE c.gym_id = g.id AND c.at > now() - interval '7 days') ORDER BY g.name LIMIT 8`);
  const req = await one(db, "SELECT count(*)::int AS n FROM demo_requests WHERE created_at > now() - interval '7 days'");
  return [
    "GMS, your week",
    "",
    `${s.gyms} gyms: ${s.paying} paying, ${s.trial} on the free month${s.late ? `, ${s.late} late` : ""}`,
    `${usd(s.mrr)} a month`,
    `${req.n} trial request${req.n === 1 ? "" : "s"} this week`,
    quiet.length ? `No check-in for a week: ${quiet.map((q) => q.name).join(", ")}` : "Every gym checked members in this week",
    "",
    `${config.publicUrl}/`,
  ].join("\n");
}

/** Called every hour; sends on Monday from 9:00 Beirut time, once per person per Monday. */
export async function sendWeeklySummaries() {
  const t = await one(db, "SELECT extract(isodow FROM now() AT TIME ZONE 'Asia/Beirut')::int AS dow, extract(hour FROM now() AT TIME ZONE 'Asia/Beirut')::int AS h, (now() AT TIME ZONE 'Asia/Beirut')::date AS today");
  if (t.dow !== 1 || t.h < 9) return 0;
  return sendSummariesNow(t.today);
}

export async function sendSummariesNow(today?: string) {
  const day = today ?? (await one(db, "SELECT (now() AT TIME ZONE 'Asia/Beirut')::date::text AS d")).d;
  const due = await many(db, `
    SELECT l.id, l.chat_id::text AS chat, l.gym_id, u.role FROM telegram_links l JOIN users u ON u.id = l.user_id
     LEFT JOIN gyms g ON g.id = l.gym_id
     WHERE u.active AND (l.last_summary_on IS NULL OR l.last_summary_on < $1::date)
       AND (u.role = 'superadmin' OR (u.role IN ('owner','manager') AND g.archived_at IS NULL AND g.saas_status <> 'suspended'))`, [day]);
  let sent = 0;
  for (const d of due) {
    try {
      await tgSend(d.chat, d.role === "superadmin" ? await platformWeekText() : await gymWeekText(d.gym_id));
      await db.query("UPDATE telegram_links SET last_summary_on = $2::date WHERE id = $1", [d.id, day]);
      sent++;
    } catch (e: any) {
      console.error("[weekly]", e.message);
    }
  }
  return sent;
}

export { notifyOperator };
