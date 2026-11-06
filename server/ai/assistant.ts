/**
 * "Ask your gym" — an analyst for the owner that answers from the gym's own data.
 * With an Anthropic API key: the model picks tools (KPIs, revenue, members,
 * attendance, classes, coaches, churn, knowledge) and writes the answer in the
 * owner's language (English, Arabic, Arabizi or French).
 * Without a key: a deterministic intent router answers the most common questions,
 * so the feature still works in a demo or offline.
 */
import { db, many, one } from "../db/index.ts";
import { dashboard } from "../modules/business.ts";
import { runWithTools, llmEnabled, type Tool } from "./llm.ts";
import { retrieve } from "./rag.ts";
import { FEATURES } from "./churn.ts";
import { hasElite } from "../services/plans.ts";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function gymTools(gymId: string): Tool[] {
  return [
    {
      name: "get_kpis",
      description: "Current key metrics: active/frozen/expiring members, revenue this month and today (USD), MRR, outstanding balances, check-ins, renewal rate, members at risk.",
      input_schema: { type: "object", properties: {} },
      run: async () => (await dashboard(gymId)).kpi,
    },
    {
      name: "revenue",
      description: "Revenue (USD) between two dates, split by payment method, by kind (memberships / personal training) and by day, plus expenses and profit.",
      input_schema: { type: "object", properties: { from: { type: "string", description: "YYYY-MM-DD" }, to: { type: "string", description: "YYYY-MM-DD" } }, required: ["from", "to"] },
      run: async ({ from, to }) => {
        const p = [gymId, from, to];
        const range = "(p.paid_at AT TIME ZONE g.timezone)::date BETWEEN $2 AND $3";
        const [byMethod, byKind, exp] = await Promise.all([
          many(db, `SELECT method, round(sum(amount_usd),2) AS usd, count(*)::int AS n FROM payments p JOIN gyms g ON g.id=p.gym_id WHERE p.gym_id=$1 AND voided_at IS NULL AND ${range} GROUP BY 1`, p),
          many(db, `SELECT CASE WHEN membership_id IS NOT NULL THEN 'memberships' WHEN pt_package_id IS NOT NULL THEN 'personal_training' WHEN sale_id IS NOT NULL THEN 'shop' ELSE 'other' END AS kind, round(sum(amount_usd),2) AS usd FROM payments p JOIN gyms g ON g.id=p.gym_id WHERE p.gym_id=$1 AND voided_at IS NULL AND ${range} GROUP BY 1`, p),
          many(db, `SELECT category, round(sum(amount_usd),2) AS usd FROM expenses WHERE gym_id=$1 AND spent_on BETWEEN $2 AND $3 GROUP BY 1`, p),
        ]);
        const revenue = byMethod.reduce((s, x) => s + Number(x.usd), 0);
        const expenses = exp.reduce((s, x) => s + Number(x.usd), 0);
        return { from, to, revenue_usd: revenue, expenses_usd: expenses, profit_usd: revenue - expenses, byMethod, byKind, expensesByCategory: exp };
      },
    },
    {
      name: "list_members",
      description: "Lists members by segment. segment: expiring (ends within 7 days), expired_recent (ended in last 30 days, not renewed), at_risk (high churn score), unpaid (balance owed), new (joined last 30 days), top_visitors (most visits last 30 days), inactive (active membership but no visit in 14+ days).",
      input_schema: { type: "object", properties: { segment: { type: "string", enum: ["expiring", "expired_recent", "at_risk", "unpaid", "new", "top_visitors", "inactive"] }, limit: { type: "number" } }, required: ["segment"] },
      run: async ({ segment, limit }) => listSegment(gymId, segment, Math.min(Number(limit) || 15, 50)),
    },
    {
      name: "attendance",
      description: "Check-in patterns over the last N days: busiest weekdays and hours, daily average, unique visitors.",
      input_schema: { type: "object", properties: { days: { type: "number" } } },
      run: async ({ days }) => attendance(gymId, Math.min(Number(days) || 28, 180)),
    },
    {
      name: "class_stats",
      description: "Group class performance over the last N days: per class type, sessions held, average booked, average attended, fill rate, no-show rate.",
      input_schema: { type: "object", properties: { days: { type: "number" } } },
      run: async ({ days }) => many(db, `
        SELECT ct.name, count(DISTINCT s.id)::int AS sessions,
               round(avg(x.booked), 1) AS avg_booked, round(avg(x.attended), 1) AS avg_attended,
               round(100 * avg(x.booked::numeric / s.capacity), 0) AS fill_rate_pct,
               round(100 * sum(x.no_show)::numeric / nullif(sum(x.booked), 0), 0) AS no_show_pct
          FROM class_sessions s JOIN class_types ct ON ct.id = s.class_type_id
          CROSS JOIN LATERAL (SELECT count(*) FILTER (WHERE b.status IN ('booked','attended','no_show')) AS booked,
                                     count(*) FILTER (WHERE b.status = 'attended') AS attended,
                                     count(*) FILTER (WHERE b.status = 'no_show') AS no_show
                                FROM bookings b WHERE b.session_id = s.id) x
         WHERE s.gym_id = $1 AND NOT s.cancelled AND s.starts_at < now() AND s.starts_at > now() - ($2 || ' days')::interval
         GROUP BY ct.name ORDER BY fill_rate_pct DESC NULLS LAST`, [gymId, String(Math.min(Number(days) || 30, 365))]),
    },
    {
      name: "coaches",
      description: "Per coach over the last 30 days: PT sessions done, classes taught, PT revenue, active PT clients.",
      input_schema: { type: "object", properties: {} },
      run: async () => many(db, `
        SELECT us.name,
               (SELECT count(*) FROM pt_sessions ps WHERE ps.coach_id = us.id AND ps.status='done' AND ps.starts_at > now() - interval '30 days')::int AS pt_done,
               (SELECT count(*) FROM class_sessions s WHERE s.coach_id = us.id AND NOT s.cancelled AND s.starts_at BETWEEN now() - interval '30 days' AND now())::int AS classes,
               (SELECT coalesce(round(sum(p.amount_usd),2),0) FROM payments p JOIN pt_packages pk ON pk.id = p.pt_package_id WHERE pk.coach_id = us.id AND p.voided_at IS NULL AND p.paid_at > now() - interval '30 days') AS pt_revenue_usd,
               (SELECT count(DISTINCT member_id) FROM pt_packages pk WHERE pk.coach_id = us.id AND pk.sessions_used < pk.sessions_total)::int AS active_clients
          FROM users us WHERE us.gym_id = $1 AND us.active AND us.role IN ('coach','manager','owner') ORDER BY pt_revenue_usd DESC`, [gymId]),
    },
    {
      name: "churn_model",
      description: "Information about the churn prediction model: type, accuracy (AUC), number of training samples, and which behaviours most increase the risk of leaving.",
      input_schema: { type: "object", properties: {} },
      run: async () => {
        const m = await one(db, "SELECT kind, params, metrics, trained_at FROM ai_models WHERE gym_id = $1", [gymId]);
        if (!m) return { kind: "prior", note: "Model not trained yet" };
        const drivers = FEATURES.map((f, i) => ({ feature: f, weight: Math.round(m.params.weights[i] * 100) / 100 })).sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
        return { kind: m.kind, metrics: m.metrics, trained_at: m.trained_at, drivers };
      },
    },
    {
      name: "search_gym_knowledge",
      description: "Searches the gym's own information: prices, plans, opening and ladies hours, class schedule, rules, policies, contact.",
      input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      run: async ({ query }) => (await retrieve(gymId, String(query), 4)).map((r) => ({ title: r.doc.title, text: r.doc.body })),
    },
  ];
}

async function listSegment(gymId: string, segment: string, limit: number) {
  const base = `SELECT code, first_name || ' ' || last_name AS name, phone, plan_name, end_date, days_left, balance_usd, round(churn_score, 2) AS churn_score,
                       (now()::date - last_checkin::date) AS days_since_visit FROM member_overview WHERE gym_id = $1 AND archived_at IS NULL`;
  const q: Record<string, string> = {
    expiring: `${base} AND status = 'expiring' ORDER BY end_date`,
    expired_recent: `${base} AND status = 'expired' AND days_left >= -30 ORDER BY end_date DESC`,
    at_risk: `${base} AND churn_score >= 0.6 AND status IN ('active','expiring') ORDER BY churn_score DESC`,
    unpaid: `${base} AND balance_usd > 0.009 ORDER BY balance_usd DESC`,
    new: `${base} AND created_at > now() - interval '30 days' ORDER BY created_at DESC`,
    inactive: `${base} AND status IN ('active','expiring') AND (last_checkin IS NULL OR last_checkin < now() - interval '14 days') ORDER BY last_checkin NULLS FIRST`,
    top_visitors: `SELECT m.code, m.first_name || ' ' || m.last_name AS name, count(*)::int AS visits_30d FROM checkins c JOIN members m ON m.id = c.member_id
                    WHERE c.gym_id = $1 AND c.result = 'ok' AND c.at > now() - interval '30 days' GROUP BY m.id ORDER BY visits_30d DESC`,
  };
  const sql = q[segment];
  if (!sql) throw new Error("unknown segment");
  return many(db, `${sql} LIMIT ${limit}`, [gymId]);
}

async function attendance(gymId: string, days: number) {
  const rows = await many(db, `
    SELECT extract(dow FROM c.at AT TIME ZONE g.timezone)::int AS dow, extract(hour FROM c.at AT TIME ZONE g.timezone)::int AS hour, count(*)::int AS n, count(DISTINCT c.member_id)::int AS u
      FROM checkins c JOIN gyms g ON g.id = c.gym_id WHERE c.gym_id = $1 AND c.result = 'ok' AND c.at > now() - ($2 || ' days')::interval GROUP BY 1, 2`, [gymId, String(days)]);
  const byDay = new Array(7).fill(0);
  const byHour = new Array(24).fill(0);
  let total = 0;
  for (const r of rows) {
    byDay[r.dow] += r.n;
    byHour[r.hour] += r.n;
    total += r.n;
  }
  const uniq = await one(db, `SELECT count(DISTINCT member_id)::int AS n FROM checkins WHERE gym_id = $1 AND result = 'ok' AND at > now() - ($2 || ' days')::interval`, [gymId, String(days)]);
  const topHours = byHour.map((n, h) => ({ hour: `${String(h).padStart(2, "0")}:00`, checkins: n })).sort((a, b) => b.checkins - a.checkins).slice(0, 4);
  const quietHours = byHour.map((n, h) => ({ hour: `${String(h).padStart(2, "0")}:00`, checkins: n })).filter((x) => x.checkins > 0).sort((a, b) => a.checkins - b.checkins).slice(0, 3);
  return {
    days, total_checkins: total, daily_average: Math.round((total / days) * 10) / 10, unique_visitors: uniq.n,
    by_weekday: byDay.map((n, d) => ({ day: DAYS[d], checkins: n })), busiest_hours: topHours, quietest_open_hours: quietHours,
  };
}

const SYSTEM = (gymName: string, today: string) => `You are the data analyst of "${gymName}", a gym in Lebanon, inside the GMS management software.
Today is ${today}. Money is in USD unless stated. Answer the owner's question using ONLY the tools' data: never invent numbers.
Reply in the language and script the owner used (English, French, Arabic, or Lebanese Arabizi). Be concise and practical:
lead with the answer, give the key numbers, then 1–3 concrete actions the owner can take (e.g. who to call, which class to move).
Use short bullet lists or a compact table when listing members. If data is missing, say what is missing.`;

export async function askGym(gymId: string, question: string, history: { role: "user" | "assistant"; content: string }[] = []) {
  const gym = await one(db, "SELECT name, (now() AT TIME ZONE timezone)::date::text AS today FROM gyms WHERE id = $1", [gymId]);
  if (llmEnabled() && (await hasElite(db, gymId))) {
    const { text, toolsUsed } = await runWithTools({
      system: SYSTEM(gym.name, gym.today),
      messages: [...history.slice(-6), { role: "user", content: question }],
      tools: gymTools(gymId),
    });
    return { answer: text, toolsUsed: toolsUsed.map((t) => t.name), mode: "llm" as const };
  }
  return offlineAnswer(gymId, question, gym.today);
}

// ---------- offline mode ----------

const INTENTS: { key: string; words: RegExp }[] = [
  { key: "revenue", words: /revenue|income|money|sales|earn|profit|chiffre|recette|argent|dakhl|ma2bud|مدخول|ارباح|أرباح|مبيعات|مصاري|masari/i },
  { key: "expiring", words: /expir|renew|end(s|ing)?|جدد|تجديد|بيخلص|bi5las|byekhlas|ينتهي|fin d/i },
  { key: "at_risk", words: /risk|churn|leave|leaving|quit|lose|خطر|يتركو|يفلو|yfello|perdre|quitter/i },
  { key: "unpaid", words: /unpaid|owe|debt|balance|dayn|deyn|دين|ديون|مكسور|impay|dette/i },
  { key: "attendance", words: /busy|peak|hour|crowd|attendance|zahme|za7me|زحمة|عجقة|3aj2a|affluence|heure|ساعات|visits?/i },
  { key: "classes", words: /class|zumba|spinning|pilates|wod|حصص|حصة|cours/i },
  { key: "coaches", words: /coach|trainer|pt\b|مدرب|entraîneur/i },
  { key: "inactive", words: /inactive|not coming|absent|ما عم يجو|ma 3am yijo|disparu/i },
];

function fmtUsd(n: number) {
  return `$${Math.round(Number(n)).toLocaleString("en-US")}`;
}

async function offlineAnswer(gymId: string, question: string, today: string) {
  const intent = INTENTS.find((i) => i.words.test(question))?.key ?? "overview";
  const tools = Object.fromEntries(gymTools(gymId).map((t) => [t.name, t]));
  const monthStart = today.slice(0, 8) + "01";
  const lines: string[] = [];
  const used: string[] = [];
  const memberLine = (m: any) => `• #${m.code} ${m.name}${m.phone ? ` (${m.phone})` : ""}${m.days_left != null ? ` — ${m.days_left >= 0 ? `${m.days_left} day(s) left` : `expired ${-m.days_left} day(s) ago`}` : ""}${Number(m.balance_usd) > 0 ? ` — owes ${fmtUsd(m.balance_usd)}` : ""}`;

  if (intent === "revenue") {
    const r: any = await tools.revenue.run({ from: monthStart, to: today });
    used.push("revenue");
    lines.push(`Revenue this month (since ${monthStart}): **${fmtUsd(r.revenue_usd)}**, expenses ${fmtUsd(r.expenses_usd)}, profit **${fmtUsd(r.profit_usd)}**.`);
    if (r.byMethod.length) lines.push("By method: " + r.byMethod.map((m: any) => `${m.method} ${fmtUsd(m.usd)}`).join(", ") + ".");
    if (r.byKind.length) lines.push("By source: " + r.byKind.map((m: any) => `${m.kind.replace("_", " ")} ${fmtUsd(m.usd)}`).join(", ") + ".");
  } else if (["expiring", "at_risk", "unpaid", "inactive"].includes(intent)) {
    const seg = intent;
    const rows: any[] = await listSegment(gymId, seg, 15);
    used.push("list_members");
    const title = { expiring: "Memberships ending in the next 7 days", at_risk: "Members at high risk of leaving", unpaid: "Members with an unpaid balance", inactive: "Active members who stopped coming (14+ days)" }[seg];
    lines.push(`**${title}: ${rows.length}**`);
    lines.push(...rows.map(memberLine));
    if (rows.length) lines.push(seg === "unpaid" ? "Tip: send a polite WhatsApp reminder from the Messages page." : "Tip: one personal WhatsApp message today is the best way to keep them. Use the AI win-back draft on their profile.");
  } else if (intent === "attendance") {
    const a: any = await tools.attendance.run({ days: 28 });
    used.push("attendance");
    lines.push(`Last 4 weeks: ${a.total_checkins} check-ins, ${a.daily_average}/day on average, ${a.unique_visitors} different members.`);
    lines.push("Busiest hours: " + a.busiest_hours.map((h: any) => `${h.hour} (${h.checkins})`).join(", ") + ".");
    const days = [...a.by_weekday].sort((x: any, y: any) => y.checkins - x.checkins);
    lines.push(`Busiest day: ${days[0].day}; quietest: ${days[days.length - 1].day}.`);
    if (a.quietest_open_hours.length) lines.push("Quiet hours to fill with an off-peak offer: " + a.quietest_open_hours.map((h: any) => h.hour).join(", ") + ".");
  } else if (intent === "classes") {
    const rows: any[] = (await tools.class_stats.run({ days: 30 })) as any[];
    used.push("class_stats");
    lines.push("**Classes, last 30 days**");
    lines.push(...rows.map((c) => `• ${c.name}: ${c.sessions} sessions, ${c.avg_attended ?? 0} attended on average, ${c.fill_rate_pct ?? 0}% full, ${c.no_show_pct ?? 0}% no-shows`));
    if (!rows.length) lines.push("No classes recorded yet.");
  } else if (intent === "coaches") {
    const rows: any[] = (await tools.coaches.run({})) as any[];
    used.push("coaches");
    lines.push("**Coaches, last 30 days**");
    lines.push(...rows.map((c) => `• ${c.name}: ${c.pt_done} PT sessions, ${c.classes} classes, ${fmtUsd(c.pt_revenue_usd)} PT revenue, ${c.active_clients} active clients`));
  } else {
    const k: any = await tools.get_kpis.run({});
    used.push("get_kpis");
    lines.push(`**${k.active_members} active members** (${k.frozen_members} frozen). ${k.expiring_7d} memberships end this week, ${k.expired_30d} expired in the last 30 days without renewing.`);
    if (k.revenue_month != null) lines.push(`Revenue this month: ${fmtUsd(k.revenue_month)} (same period last month: ${fmtUsd(k.revenue_last_month_same_period)}). Monthly recurring revenue: ${fmtUsd(k.mrr)}.`);
    lines.push(`${k.at_risk} members are at high risk of leaving${k.mrr_at_risk ? ` (${fmtUsd(k.mrr_at_risk)}/month at stake)` : ""}. Outstanding balances: ${fmtUsd(k.outstanding_usd)}.`);
    lines.push(`Today: ${k.checkins_today} check-ins (average ${k.checkins_avg_30d}/day).`);
  }
  lines.push("\n_Offline mode: connect an AI key in the server settings for free-form questions in Arabic, Arabizi, French or English._");
  return { answer: lines.join("\n"), toolsUsed: used, mode: "offline" as const };
}
