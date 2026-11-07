import { z } from "zod";
import { db, one, many, audit } from "../db/index.ts";
import { requireStaff } from "../auth.ts";
import { bad, notFound, zCurrency, zDate, zId, zMoney, zPhone, type Router } from "../http.ts";
import { gymRate, gymToday, toUsd } from "../services/money.ts";
import { lowStock } from "./shop.ts";
import { financeData, financeWorkbook, renderFinanceHtml, reportFileName } from "../services/finreport.ts";

export async function dashboard(gymId: string) {
  const q = db;
  const [kpi, revenueMonths, heat, daily, expiring, birthdays, todayClasses, newMembers] = await Promise.all([
    one(q, `
      WITH g AS (SELECT timezone, (now() AT TIME ZONE timezone)::date AS today FROM gyms WHERE id = $1),
      mo AS (SELECT * FROM member_overview WHERE gym_id = $1 AND archived_at IS NULL)
      SELECT
        (SELECT count(*) FROM mo WHERE status IN ('active','expiring'))::int AS active_members,
        (SELECT count(*) FROM mo WHERE status = 'frozen')::int AS frozen_members,
        (SELECT count(*) FROM mo WHERE status = 'expiring')::int AS expiring_7d,
        (SELECT count(*) FROM mo WHERE status = 'expired' AND days_left >= -30)::int AS expired_30d,
        (SELECT count(*) FROM mo WHERE churn_score >= 0.6 AND status IN ('active','expiring'))::int AS at_risk,
        (SELECT coalesce(sum(balance_usd), 0) FROM mo WHERE balance_usd > 0) AS outstanding_usd,
        (SELECT count(*) FROM checkins c, g WHERE c.gym_id = $1 AND c.result = 'ok' AND (c.at AT TIME ZONE g.timezone)::date = g.today)::int AS checkins_today,
        (SELECT round(count(*) / 30.0, 1) FROM checkins c WHERE c.gym_id = $1 AND c.result = 'ok' AND c.at > now() - interval '30 days') AS checkins_avg_30d,
        (SELECT coalesce(sum(amount_usd), 0) FROM payments p, g WHERE p.gym_id = $1 AND p.voided_at IS NULL
           AND date_trunc('month', p.paid_at AT TIME ZONE g.timezone) = date_trunc('month', g.today::timestamp)) AS revenue_month,
        (SELECT coalesce(sum(amount_usd), 0) FROM payments p, g WHERE p.gym_id = $1 AND p.voided_at IS NULL
           AND (p.paid_at AT TIME ZONE g.timezone)::date BETWEEN (date_trunc('month', g.today::timestamp) - interval '1 month')::date
                                                     AND (g.today - interval '1 month')::date) AS revenue_last_month_same_period,
        (SELECT coalesce(sum(amount_usd), 0) FROM payments p, g WHERE p.gym_id = $1 AND p.voided_at IS NULL
           AND (p.paid_at AT TIME ZONE g.timezone)::date = g.today) AS revenue_today,
        (SELECT coalesce(round(sum(ms.price_usd * 30.0 / greatest(ms.end_date - ms.start_date + 1, 30)), 2), 0)
           FROM memberships ms, g WHERE ms.gym_id = $1 AND ms.status = 'active' AND g.today BETWEEN ms.start_date AND ms.end_date) AS mrr,
        (SELECT coalesce(round(sum(ms.price_usd * 30.0 / greatest(ms.end_date - ms.start_date + 1, 30)), 2), 0)
           FROM memberships ms JOIN mo ON mo.membership_id = ms.id WHERE mo.churn_score >= 0.6 AND mo.status IN ('active','expiring')) AS mrr_at_risk,
        (SELECT round(100.0 * count(*) FILTER (WHERE renewed) / nullif(count(*), 0), 1) FROM (
            SELECT EXISTS (SELECT 1 FROM memberships n WHERE n.member_id = ms.member_id AND n.status = 'active' AND n.start_date > ms.start_date AND n.start_date <= ms.end_date + 30) AS renewed
              FROM memberships ms, g
             WHERE ms.gym_id = $1 AND ms.status = 'active' AND ms.end_date BETWEEN g.today - 60 AND g.today - 1 AND ms.end_date - ms.start_date >= 20) x) AS renewal_rate_pct
    `, [gymId]),
    many(q, `
      WITH g AS (SELECT timezone, (now() AT TIME ZONE timezone)::date AS today FROM gyms WHERE id = $1)
      SELECT to_char(m, 'YYYY-MM') AS month,
             coalesce((SELECT sum(amount_usd) FROM payments p WHERE p.gym_id = $1 AND p.voided_at IS NULL AND date_trunc('month', p.paid_at AT TIME ZONE g.timezone) = m), 0) AS revenue,
             coalesce((SELECT sum(amount_usd) FROM expenses e WHERE e.gym_id = $1 AND date_trunc('month', e.spent_on::timestamp) = m), 0) AS expenses
        FROM g, generate_series(date_trunc('month', g.today::timestamp) - interval '11 months', date_trunc('month', g.today::timestamp), interval '1 month') m
       ORDER BY m`, [gymId]),
    many(q, `
      SELECT extract(dow FROM c.at AT TIME ZONE g.timezone)::int AS dow, extract(hour FROM c.at AT TIME ZONE g.timezone)::int AS hour, count(*)::int AS n
        FROM checkins c JOIN gyms g ON g.id = c.gym_id
       WHERE c.gym_id = $1 AND c.result = 'ok' AND c.at > now() - interval '56 days'
       GROUP BY 1, 2`, [gymId]),
    many(q, `
      WITH g AS (SELECT timezone, (now() AT TIME ZONE timezone)::date AS today FROM gyms WHERE id = $1)
      SELECT d::date::text AS day,
             (SELECT count(*) FROM checkins c WHERE c.gym_id = $1 AND c.result = 'ok' AND (c.at AT TIME ZONE g.timezone)::date = d::date)::int AS checkins
        FROM g, generate_series(g.today - 29, g.today, interval '1 day') d ORDER BY d`, [gymId]),
    many(q, `SELECT id, code, first_name, last_name, phone, plan_name, end_date, days_left, balance_usd FROM member_overview
              WHERE gym_id = $1 AND archived_at IS NULL AND status = 'expiring' ORDER BY end_date LIMIT 12`, [gymId]),
    many(q, `SELECT m.id, m.first_name, m.last_name, m.phone FROM members m JOIN gyms g ON g.id = m.gym_id
              WHERE m.gym_id = $1 AND m.archived_at IS NULL AND m.birth_date IS NOT NULL
                AND to_char(m.birth_date, 'MM-DD') = to_char(now() AT TIME ZONE g.timezone, 'MM-DD') LIMIT 20`, [gymId]),
    many(q, `SELECT s.id, s.starts_at, s.capacity, ct.name AS class_name, ct.color, us.name AS coach_name,
                    (SELECT count(*) FROM bookings b WHERE b.session_id = s.id AND b.status IN ('booked','attended'))::int AS booked
               FROM class_sessions s JOIN gyms g ON g.id = s.gym_id JOIN class_types ct ON ct.id = s.class_type_id LEFT JOIN users us ON us.id = s.coach_id
              WHERE s.gym_id = $1 AND NOT s.cancelled AND (s.starts_at AT TIME ZONE g.timezone)::date = (now() AT TIME ZONE g.timezone)::date
              ORDER BY s.starts_at`, [gymId]),
    many(q, `
      WITH g AS (SELECT timezone, (now() AT TIME ZONE timezone)::date AS today FROM gyms WHERE id = $1)
      SELECT to_char(m, 'YYYY-MM') AS month,
             (SELECT count(*) FROM members x WHERE x.gym_id = $1 AND date_trunc('month', x.created_at AT TIME ZONE g.timezone) = m)::int AS new_members
        FROM g, generate_series(date_trunc('month', g.today::timestamp) - interval '5 months', date_trunc('month', g.today::timestamp), interval '1 month') m
       ORDER BY m`, [gymId]),
  ]);
  const [lowStockList, shopToday] = await Promise.all([
    lowStock(db, gymId),
    one(db, `SELECT count(*)::int AS sales, coalesce(sum(total_usd), 0) AS revenue FROM sales s JOIN gyms g ON g.id = s.gym_id
              WHERE s.gym_id = $1 AND s.status <> 'void' AND (s.sold_at AT TIME ZONE g.timezone)::date = (now() AT TIME ZONE g.timezone)::date`, [gymId]),
  ]);
  return { kpi, revenueMonths, heat, daily, expiring, birthdays, todayClasses, newMembers, lowStock: lowStockList, shopToday };
}

const EXPENSE_CATEGORIES = ["rent", "salaries", "generator", "electricity", "equipment", "maintenance", "marketing", "supplies", "other"] as const;

export function registerBusiness(r: Router) {
  r.get("/api/dashboard", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager", "reception"]);
    const d = await dashboard(u.gymId);
    if (u.role === "reception") {
      // reception sees operations, not the gym's finances
      const { kpi, ...rest } = d;
      return { ...rest, revenueMonths: [], kpi: { ...kpi, revenue_month: null, revenue_last_month_same_period: null, mrr: null, mrr_at_risk: null } };
    }
    return d;
  });

  r.get("/api/reports/finance", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const today = await gymToday(db, u.gymId);
    const from = zDate.parse(ctx.query.get("from") ?? today.slice(0, 8) + "01");
    const to = zDate.parse(ctx.query.get("to") ?? today);
    const params = [u.gymId, from, to];
    const range = `(p.paid_at AT TIME ZONE g.timezone)::date BETWEEN $2 AND $3`;
    const [byMethod, byCurrency, byKind, expenses, daily, cashDrawer] = await Promise.all([
      many(db, `SELECT method, round(sum(amount_usd), 2) AS usd, count(*)::int AS n FROM payments p JOIN gyms g ON g.id = p.gym_id WHERE p.gym_id = $1 AND p.voided_at IS NULL AND ${range} GROUP BY method ORDER BY usd DESC`, params),
      many(db, `SELECT currency, sum(amount) AS amount, round(sum(amount_usd), 2) AS usd FROM payments p JOIN gyms g ON g.id = p.gym_id WHERE p.gym_id = $1 AND p.voided_at IS NULL AND ${range} GROUP BY currency`, params),
      many(db, `SELECT CASE WHEN membership_id IS NOT NULL THEN 'memberships' WHEN pt_package_id IS NOT NULL THEN 'personal_training' WHEN sale_id IS NOT NULL THEN 'shop' ELSE 'other' END AS kind,
                       round(sum(amount_usd), 2) AS usd FROM payments p JOIN gyms g ON g.id = p.gym_id WHERE p.gym_id = $1 AND p.voided_at IS NULL AND ${range} GROUP BY 1 ORDER BY usd DESC`, params),
      many(db, `SELECT category, round(sum(amount_usd), 2) AS usd FROM expenses WHERE gym_id = $1 AND spent_on BETWEEN $2 AND $3 GROUP BY category ORDER BY usd DESC`, params),
      many(db, `SELECT (p.paid_at AT TIME ZONE g.timezone)::date::text AS day, round(sum(amount_usd), 2) AS usd FROM payments p JOIN gyms g ON g.id = p.gym_id WHERE p.gym_id = $1 AND p.voided_at IS NULL AND ${range} GROUP BY 1 ORDER BY 1`, params),
      many(db, `SELECT currency, sum(amount) AS amount, count(*)::int AS n FROM payments p JOIN gyms g ON g.id = p.gym_id
                 WHERE p.gym_id = $1 AND p.voided_at IS NULL AND p.method = 'cash' AND (p.paid_at AT TIME ZONE g.timezone)::date = $2::date GROUP BY currency`, [u.gymId, today]),
    ]);
    const revenue = byMethod.reduce((s, x) => s + Number(x.usd), 0);
    const spent = expenses.reduce((s, x) => s + Number(x.usd), 0);
    return { from, to, revenue: Math.round(revenue * 100) / 100, expenses_total: Math.round(spent * 100) / 100, profit: Math.round((revenue - spent) * 100) / 100, byMethod, byCurrency, byKind, expenses, daily, cashDrawer };
  });

  /** Financial report of a period, as an A4 page (preview, print, save as PDF). */
  r.get("/api/reports/finance/report", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const today = await gymToday(db, u.gymId);
    const from = zDate.parse(ctx.query.get("from") ?? today.slice(0, 8) + "01");
    const to = zDate.parse(ctx.query.get("to") ?? today);
    if (to < from) throw bad("invalid_period", "The end date is before the start date");
    const d = await financeData(u.gymId, from, to);
    await audit(db, u.gymId, u.id, "report.finance.view", "report", undefined, { from, to });
    return { html: renderFinanceHtml(d), filename: reportFileName(d.gym.name, d.from, d.to, "pdf"), from: d.from, to: d.to };
  });

  /** The same report as an Excel workbook: summary and every transaction. */
  r.get("/api/reports/finance/report.xlsx", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const today = await gymToday(db, u.gymId);
    const from = zDate.parse(ctx.query.get("from") ?? today.slice(0, 8) + "01");
    const to = zDate.parse(ctx.query.get("to") ?? today);
    if (to < from) throw bad("invalid_period", "The end date is before the start date");
    const d = await financeData(u.gymId, from, to);
    const file = financeWorkbook(d);
    await audit(db, u.gymId, u.id, "report.finance.export", "report", undefined, { from, to });
    ctx.res.writeHead(200, {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${reportFileName(d.gym.name, d.from, d.to, "xlsx")}"`,
      "Content-Length": file.length,
      "Cache-Control": "private, no-store",
    });
    ctx.res.end(file);
    return undefined;
  });

  r.get("/api/reports/coaches", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const today = await gymToday(db, u.gymId);
    const from = zDate.parse(ctx.query.get("from") ?? today.slice(0, 8) + "01");
    const to = zDate.parse(ctx.query.get("to") ?? today);
    return many(db, `
      SELECT us.id, us.name, us.commission_pct,
             (SELECT count(*) FROM pt_sessions ps WHERE ps.coach_id = us.id AND ps.status = 'done' AND ps.starts_at::date BETWEEN $2 AND $3)::int AS pt_done,
             (SELECT count(*) FROM class_sessions s WHERE s.coach_id = us.id AND NOT s.cancelled AND s.starts_at < now() AND s.starts_at::date BETWEEN $2 AND $3)::int AS classes_taught,
             (SELECT coalesce(round(avg(x.n), 1), 0) FROM (SELECT count(*) FILTER (WHERE b.status = 'attended') AS n FROM class_sessions s LEFT JOIN bookings b ON b.session_id = s.id
                 WHERE s.coach_id = us.id AND NOT s.cancelled AND s.starts_at < now() AND s.starts_at::date BETWEEN $2 AND $3 GROUP BY s.id) x) AS avg_attendance,
             (SELECT coalesce(round(sum(p.amount_usd), 2), 0) FROM payments p JOIN pt_packages pk ON pk.id = p.pt_package_id
                 WHERE pk.coach_id = us.id AND p.voided_at IS NULL AND p.paid_at::date BETWEEN $2 AND $3) AS pt_revenue,
             (SELECT count(DISTINCT pk.member_id) FROM pt_packages pk WHERE pk.coach_id = us.id AND pk.sessions_used < pk.sessions_total)::int AS active_clients
        FROM users us WHERE us.gym_id = $1 AND us.active AND (us.role = 'coach' OR EXISTS (SELECT 1 FROM pt_packages pk WHERE pk.coach_id = us.id) OR EXISTS (SELECT 1 FROM class_sessions cs WHERE cs.coach_id = us.id))
       ORDER BY pt_revenue DESC, name`, [u.gymId, from, to]).then((rows) =>
      rows.map((x) => ({ ...x, commission_usd: Math.round(Number(x.pt_revenue) * Number(x.commission_pct)) / 100 })));
  });

  // ---- expenses ----
  const expenseSchema = z.object({ category: z.enum(EXPENSE_CATEGORIES), amount: zMoney.refine((n) => n > 0), currency: zCurrency, spent_on: zDate, note: z.string().max(300).nullable().optional() });
  r.get("/api/expenses", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    return many(db, "SELECT e.*, us.name AS created_by_name FROM expenses e LEFT JOIN users us ON us.id = e.created_by WHERE e.gym_id = $1 ORDER BY spent_on DESC, created_at DESC LIMIT 300", [u.gymId]);
  });
  r.post("/api/expenses", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const b = await ctx.body(expenseSchema);
    const rate = await gymRate(db, u.gymId);
    const row = await one(db, `INSERT INTO expenses (gym_id, category, amount, currency, lbp_rate, amount_usd, spent_on, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [u.gymId, b.category, b.amount, b.currency, rate, toUsd(b.amount, b.currency, rate), b.spent_on, b.note ?? null, u.id]);
    await audit(db, u.gymId, u.id, "expense.create", "expense", row.id, b);
    return row;
  });
  r.del("/api/expenses/:id", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const r2 = await db.query("DELETE FROM expenses WHERE id = $1 AND gym_id = $2", [zId.parse(ctx.params.id), u.gymId]);
    if (!r2.rowCount) throw notFound("expense");
    await audit(db, u.gymId, u.id, "expense.delete", "expense", ctx.params.id);
    return { ok: true };
  });

  // ---- leads (prospects from Instagram, walk-ins, referrals) ----
  const leadSchema = z.object({
    name: z.string().trim().min(1).max(80), phone: zPhone.nullable().optional(), source: z.string().max(40).nullable().optional(),
    status: z.enum(["new", "contacted", "trial", "converted", "lost"]).default("new"), interest: z.string().max(80).nullable().optional(),
    notes: z.string().max(1000).nullable().optional(), follow_up_on: zDate.nullable().optional(),
    referred_by: zId.nullable().optional(), // the member who sent them; credited when they join
  });
  const checkReferrer = async (gymId: string, id: string | null | undefined) => {
    if (id && !(await one(db, "SELECT 1 FROM members WHERE id = $1 AND gym_id = $2", [id, gymId]))) throw bad("unknown_referrer", "The member who referred them was not found");
  };
  r.get("/api/leads", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager", "reception"]);
    return many(db, "SELECT l.*, r.first_name || ' ' || r.last_name AS referrer_name FROM leads l LEFT JOIN members r ON r.id = l.referred_by WHERE l.gym_id = $1 ORDER BY (status IN ('converted','lost')), follow_up_on NULLS LAST, created_at DESC LIMIT 500", [u.gymId]);
  });
  r.post("/api/leads", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager", "reception"]);
    const b = await ctx.body(leadSchema);
    await checkReferrer(u.gymId, b.referred_by);
    return one(db, "INSERT INTO leads (gym_id, name, phone, source, status, interest, notes, follow_up_on, referred_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
      [u.gymId, b.name, b.phone ?? null, b.referred_by ? "referral" : b.source ?? null, b.status, b.interest ?? null, b.notes ?? null, b.follow_up_on ?? null, b.referred_by ?? null]);
  });
  r.put("/api/leads/:id", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager", "reception"]);
    const b = await ctx.body(leadSchema);
    await checkReferrer(u.gymId, b.referred_by);
    // referred_by left out of the body keeps the current referrer
    const row = await one(db, "UPDATE leads SET name=$3, phone=$4, source=$5, status=$6, interest=$7, notes=$8, follow_up_on=$9, referred_by = CASE WHEN $10 THEN $11::uuid ELSE referred_by END WHERE id=$1 AND gym_id=$2 RETURNING *",
      [zId.parse(ctx.params.id), u.gymId, b.name, b.phone ?? null, b.source ?? null, b.status, b.interest ?? null, b.notes ?? null, b.follow_up_on ?? null, b.referred_by !== undefined, b.referred_by ?? null]);
    if (!row) throw notFound("lead");
    return row;
  });
}
