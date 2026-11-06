/**
 * Financial report for a period: one data set, two outputs.
 *  - an A4 HTML report with the gym's logo (previewed in the app, printed or saved as PDF);
 *  - an Excel workbook with the summary and every transaction, for the accountant.
 * All amounts in USD at the rate of each transaction; LBP actually collected is shown too.
 */
import { db, many, one } from "../db/index.ts";
import { escapeHtml as e } from "./text.ts";
import { daysBetween, measures, previousPeriod } from "../modules/kpis.ts";
import { gymToday } from "./money.ts";
import { workbook, type Sheet } from "./xlsx.ts";

const usd = (n: unknown) => `$${Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const usd2 = (n: unknown) => `$${Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const lbp = (n: unknown) => `${Math.round(Number(n ?? 0)).toLocaleString("en-US")} LBP`;
const r2 = (n: number) => Math.round(n * 100) / 100;
const change = (a: number, b: number) => (b ? Math.round(((a - b) / Math.abs(b)) * 1000) / 10 : null);

const KIND_LABEL: Record<string, string> = { memberships: "Memberships", personal_training: "Personal training", shop: "Shop", other: "Other" };
const METHOD_LABEL: Record<string, string> = { cash: "Cash", whish: "Whish", omt: "OMT", card: "Card", bank: "Bank transfer", other: "Other" };

export async function financeData(gymId: string, from: string, to: string) {
  const today = await gymToday(db, gymId);
  const end = to > today ? today : to;
  const prevP = previousPeriod(from, end);
  const p = [gymId, from, end];
  const range = "(py.paid_at AT TIME ZONE g.timezone)::date BETWEEN $2 AND $3";
  const kind = `CASE WHEN py.membership_id IS NOT NULL THEN 'memberships' WHEN py.pt_package_id IS NOT NULL THEN 'personal_training' WHEN py.sale_id IS NOT NULL THEN 'shop' ELSE 'other' END`;
  const [gym, cur, prev, byKind, byKindPrev, byMethod, byCurrency, byPlan, byCoach, expenses, shop, topProducts, debtors, outstanding, series, payments, expenseRows, sales, membershipsSold] = await Promise.all([
    one(db, `SELECT name, name_ar, address, city, phone, email, brand_color, logo, logo_mime FROM gyms WHERE id = $1`, [gymId]),
    measures(gymId, from, end, today),
    measures(gymId, prevP.from, prevP.to, today),
    many(db, `SELECT ${kind} AS kind, round(sum(amount_usd), 2) AS usd, count(*)::int AS n FROM payments py JOIN gyms g ON g.id = py.gym_id WHERE py.gym_id = $1 AND py.voided_at IS NULL AND ${range} GROUP BY 1 ORDER BY 2 DESC`, p),
    many(db, `SELECT ${kind} AS kind, round(sum(amount_usd), 2) AS usd FROM payments py JOIN gyms g ON g.id = py.gym_id WHERE py.gym_id = $1 AND py.voided_at IS NULL AND ${range} GROUP BY 1`, [gymId, prevP.from, prevP.to]),
    many(db, `SELECT method, round(sum(amount_usd), 2) AS usd, count(*)::int AS n FROM payments py JOIN gyms g ON g.id = py.gym_id WHERE py.gym_id = $1 AND py.voided_at IS NULL AND ${range} GROUP BY 1 ORDER BY 2 DESC`, p),
    many(db, `SELECT currency, sum(amount) AS amount, round(sum(amount_usd), 2) AS usd, count(*)::int AS n FROM payments py JOIN gyms g ON g.id = py.gym_id WHERE py.gym_id = $1 AND py.voided_at IS NULL AND ${range} GROUP BY 1 ORDER BY 1 DESC`, p),
    many(db, `SELECT ms.plan_name AS plan, count(DISTINCT ms.id)::int AS sold, round(sum(py.amount_usd), 2) AS usd
                FROM payments py JOIN gyms g ON g.id = py.gym_id JOIN memberships ms ON ms.id = py.membership_id
               WHERE py.gym_id = $1 AND py.voided_at IS NULL AND ${range} GROUP BY 1 ORDER BY 3 DESC LIMIT 12`, p),
    many(db, `SELECT coalesce(us.name, 'No coach') AS coach, coalesce(us.commission_pct, 0) AS commission_pct, round(sum(py.amount_usd), 2) AS usd,
                     (SELECT count(*) FROM pt_sessions ps JOIN gyms g2 ON g2.id = ps.gym_id WHERE ps.gym_id = $1 AND ps.coach_id IS NOT DISTINCT FROM pk.coach_id AND ps.status = 'done'
                         AND (ps.starts_at AT TIME ZONE g2.timezone)::date BETWEEN $2 AND $3)::int AS sessions
                FROM payments py JOIN gyms g ON g.id = py.gym_id JOIN pt_packages pk ON pk.id = py.pt_package_id LEFT JOIN users us ON us.id = pk.coach_id
               WHERE py.gym_id = $1 AND py.voided_at IS NULL AND ${range} GROUP BY us.name, us.commission_pct, pk.coach_id ORDER BY 3 DESC`, p),
    many(db, `SELECT category, round(sum(amount_usd), 2) AS usd, count(*)::int AS n FROM expenses WHERE gym_id = $1 AND spent_on BETWEEN $2 AND $3 GROUP BY 1 ORDER BY 2 DESC`, p),
    one(db, `SELECT count(*)::int AS sales, coalesce(sum(total_usd), 0) AS revenue, coalesce(sum(cost_usd), 0) AS cost, coalesce(sum(discount_usd), 0) AS discounts,
                    coalesce(sum(total_usd) FILTER (WHERE status = 'on_account'), 0) AS on_account
               FROM sales s JOIN gyms g ON g.id = s.gym_id WHERE s.gym_id = $1 AND s.status <> 'void' AND (s.sold_at AT TIME ZONE g.timezone)::date BETWEEN $2 AND $3`, p),
    many(db, `SELECT si.name, sum(si.qty)::int AS qty, round(sum(si.line_total_usd), 2) AS revenue, round(sum(si.line_total_usd - si.unit_cost_usd * si.qty), 2) AS margin
                FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN gyms g ON g.id = s.gym_id
               WHERE s.gym_id = $1 AND s.status <> 'void' AND (s.sold_at AT TIME ZONE g.timezone)::date BETWEEN $2 AND $3 GROUP BY si.name ORDER BY 3 DESC LIMIT 8`, p),
    many(db, `SELECT code, first_name || ' ' || last_name AS name, phone, balance_usd, status FROM member_overview WHERE gym_id = $1 AND archived_at IS NULL AND balance_usd > 0.5 ORDER BY balance_usd DESC LIMIT 500`, [gymId]),
    one(db, `SELECT coalesce(sum(balance_usd), 0) AS total, count(*)::int AS n FROM member_overview WHERE gym_id = $1 AND archived_at IS NULL AND balance_usd > 0.5`, [gymId]),
    // daily for up to two months, monthly beyond
    daysBetween(from, end) <= 62
      ? many(db, `WITH g AS (SELECT timezone FROM gyms WHERE id = $1)
                  SELECT d::date::text AS label,
                         coalesce((SELECT sum(amount_usd) FROM payments py WHERE py.gym_id = $1 AND py.voided_at IS NULL AND (py.paid_at AT TIME ZONE g.timezone)::date = d::date), 0) AS revenue,
                         coalesce((SELECT sum(amount_usd) FROM expenses x WHERE x.gym_id = $1 AND x.spent_on = d::date), 0) AS expenses
                    FROM g, generate_series($2::date, $3::date, interval '1 day') d ORDER BY d`, p)
      : many(db, `WITH g AS (SELECT timezone FROM gyms WHERE id = $1)
                  SELECT to_char(m, 'YYYY-MM') AS label,
                         coalesce((SELECT sum(amount_usd) FROM payments py WHERE py.gym_id = $1 AND py.voided_at IS NULL AND (py.paid_at AT TIME ZONE g.timezone)::date BETWEEN greatest(m::date, $2::date) AND least((m + interval '1 month - 1 day')::date, $3::date)), 0) AS revenue,
                         coalesce((SELECT sum(amount_usd) FROM expenses x WHERE x.gym_id = $1 AND x.spent_on BETWEEN greatest(m::date, $2::date) AND least((m + interval '1 month - 1 day')::date, $3::date)), 0) AS expenses
                    FROM g, generate_series(date_trunc('month', $2::date), date_trunc('month', $3::date), interval '1 month') m ORDER BY m`, p),
    many(db, `SELECT (py.paid_at AT TIME ZONE g.timezone) AS at, py.receipt_no, m.code, nullif(trim(coalesce(m.first_name, '') || ' ' || coalesce(m.last_name, '')), '') AS member,
                     ${kind} AS kind, coalesce(ms.plan_name, pk.title, CASE WHEN s.sale_no IS NOT NULL THEN 'Shop sale #' || s.sale_no END, py.note) AS detail,
                     py.method, py.currency, py.amount, py.lbp_rate, py.amount_usd, us.name AS received_by, py.reference
                FROM payments py JOIN gyms g ON g.id = py.gym_id LEFT JOIN members m ON m.id = py.member_id
                LEFT JOIN memberships ms ON ms.id = py.membership_id LEFT JOIN pt_packages pk ON pk.id = py.pt_package_id LEFT JOIN sales s ON s.id = py.sale_id
                LEFT JOIN users us ON us.id = py.received_by
               WHERE py.gym_id = $1 AND py.voided_at IS NULL AND ${range} ORDER BY py.paid_at`, p),
    many(db, `SELECT spent_on::text AS day, category, note, currency, amount, amount_usd FROM expenses WHERE gym_id = $1 AND spent_on BETWEEN $2 AND $3 ORDER BY spent_on`, p),
    many(db, `SELECT (s.sold_at AT TIME ZONE g.timezone) AS at, s.sale_no, coalesce(nullif(trim(coalesce(m.first_name, '') || ' ' || coalesce(m.last_name, '')), ''), s.customer_name, 'Walk-in') AS customer,
                     (SELECT string_agg(si.qty || ' × ' || si.name, ', ' ORDER BY si.name) FROM sale_items si WHERE si.sale_id = s.id) AS items,
                     s.discount_usd, s.total_usd, s.cost_usd, s.status
                FROM sales s JOIN gyms g ON g.id = s.gym_id LEFT JOIN members m ON m.id = s.member_id
               WHERE s.gym_id = $1 AND s.status <> 'void' AND (s.sold_at AT TIME ZONE g.timezone)::date BETWEEN $2 AND $3 ORDER BY s.sold_at`, p),
    many(db, `SELECT (ms.created_at AT TIME ZONE g.timezone)::date::text AS day, m.code, m.first_name || ' ' || m.last_name AS member, ms.plan_name, ms.start_date::text AS start_date, ms.end_date::text AS end_date, ms.price_usd,
                     (SELECT coalesce(sum(amount_usd), 0) FROM payments WHERE membership_id = ms.id AND voided_at IS NULL) AS paid_usd
                FROM memberships ms JOIN gyms g ON g.id = ms.gym_id JOIN members m ON m.id = ms.member_id
               WHERE ms.gym_id = $1 AND ms.status = 'active' AND (ms.created_at AT TIME ZONE g.timezone)::date BETWEEN $2 AND $3 ORDER BY ms.created_at`, p),
  ]);
  const prevKind = new Map(byKindPrev.map((x) => [x.kind, Number(x.usd)]));
  return {
    gym, from, to: end, previous: prevP, generated: today, cur, prev,
    revenue: r2(cur.revenue), expenses: r2(cur.expenses), profit: r2(cur.revenue - cur.expenses),
    byKind: byKind.map((x) => ({ ...x, usd: Number(x.usd), prev: prevKind.get(x.kind) ?? 0 })),
    byMethod, byCurrency, byPlan, byCoach, expensesByCategory: expenses, shop, topProducts,
    debtors, outstanding, series, payments, expenseRows, sales, membershipsSold,
  };
}
export type FinanceData = Awaited<ReturnType<typeof financeData>>;

function longDate(iso: string) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
const shortDate = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
export function periodLabel(from: string, to: string) {
  const f = new Date(from + "T00:00:00Z"), t = new Date(to + "T00:00:00Z");
  const lastDay = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  if (from.endsWith("-01") && from.slice(0, 7) === to.slice(0, 7) && t.getUTCDate() === lastDay) {
    return f.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  }
  return `${longDate(from)} – ${longDate(to)}`;
}

function delta(a: number, b: number, higherIsBetter = true) {
  const c = change(a, b);
  if (c == null) return `<span class="d">new</span>`;
  const good = c === 0 ? null : (c > 0) === higherIsBetter;
  return `<span class="d ${good == null ? "" : good ? "up" : "down"}">${c > 0 ? "▲" : c < 0 ? "▼" : "="} ${Math.abs(c)}%</span>`;
}

/** Bars of revenue (and expenses) for each day or month. */
function chart(series: { label: string; revenue: any; expenses: any }[], color: string) {
  const W = 680, H = 170, pad = { l: 44, r: 6, t: 10, b: 22 };
  const max = Math.max(1, ...series.map((s) => Math.max(Number(s.revenue), Number(s.expenses))));
  const step = 10 ** Math.floor(Math.log10(max));
  const top = Math.ceil(max / step) * step;
  const n = series.length;
  const bw = (W - pad.l - pad.r) / n;
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / top);
  const grid = [0, 0.5, 1].map((f) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(top * f)}" y2="${y(top * f)}" stroke="#e3e6eb"/><text x="${pad.l - 6}" y="${y(top * f) + 3}" text-anchor="end">${usd(top * f)}</text>`).join("");
  const labelEvery = Math.ceil(n / 12);
  const bars = series.map((s, i) => {
    const x = pad.l + i * bw;
    const rv = Number(s.revenue), ex = Number(s.expenses);
    const inner = Math.max(1, bw * 0.72);
    const lab = s.label.length === 10 ? String(Number(s.label.slice(8))) : new Date(s.label + "-01T00:00:00Z").toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
    return `<rect x="${x + (bw - inner) / 2}" y="${y(rv)}" width="${inner * 0.62}" height="${Math.max(0, y(0) - y(rv))}" fill="${color}" rx="1.5"/>`
      + (ex ? `<rect x="${x + (bw - inner) / 2 + inner * 0.62}" y="${y(ex)}" width="${inner * 0.38}" height="${Math.max(0, y(0) - y(ex))}" fill="#9aa3af" rx="1.5"/>` : "")
      + (i % labelEvery === 0 ? `<text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${lab}</text>` : "");
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Revenue and expenses over the period">${grid}${bars}</svg>
    <div class="legend"><span><i style="background:${color}"></i>Revenue</span><span><i style="background:#9aa3af"></i>Expenses</span></div>`;
}

function bar(value: number, total: number, color: string) {
  const w = total > 0 ? Math.max(1, Math.round((100 * value) / total)) : 0;
  return `<span class="bar"><i style="width:${w}%;background:${color}"></i></span>`;
}

export function renderFinanceHtml(d: FinanceData) {
  const color = /^#[0-9a-fA-F]{6}$/.test(d.gym.brand_color ?? "") ? d.gym.brand_color : "#1a2230";
  const logo = d.gym.logo ? `<img src="data:${e(d.gym.logo_mime)};base64,${Buffer.from(d.gym.logo).toString("base64")}" alt="">` : `<div class="mono">${e(d.gym.name[0] ?? "G")}</div>`;
  const margin = d.revenue > 0 ? Math.round((1000 * d.profit) / d.revenue) / 10 : null;
  const prevProfit = d.prev.revenue - d.prev.expenses;
  const collection = d.cur.billed > 0 ? Math.round((1000 * d.cur.collected) / d.cur.billed) / 10 : null;
  const shopRev = Number(d.shop.revenue), shopCost = Number(d.shop.cost);
  const renewal = d.cur.renewalsDue ? Math.round((100 * d.cur.renewed) / d.cur.renewalsDue) : null;
  const lbpRow = d.byCurrency.find((x) => x.currency === "LBP");
  const expTotal = d.expenses;
  const rows = (list: string[]) => list.join("") || `<tr><td colspan="9" class="empty">Nothing in this period</td></tr>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${e(d.gym.name)} · Financial report · ${e(periodLabel(d.from, d.to))}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  @page { size: A4; margin: 14mm 13mm 16mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 10.5pt/1.45 "Segoe UI", Inter, system-ui, -apple-system, Roboto, Arial, sans-serif; color: #1b222c; background: #eceef1; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .doc { max-width: 210mm; margin: 0 auto; background: #fff; padding: 14mm 13mm; }
  @media screen { .doc { margin: 16px auto; box-shadow: 0 1px 3px rgba(0,0,0,.08), 0 8px 24px rgba(0,0,0,.06); } }
  @media print { body { background: #fff; } .doc { padding: 0; max-width: none; } }
  header.top { display: flex; align-items: center; gap: 14px; padding-bottom: 12px; border-bottom: 3px solid ${color}; }
  header.top img, header.top .mono { width: 52px; height: 52px; border-radius: 10px; object-fit: contain; }
  header.top .mono { background: ${color}; color: #fff; display: grid; place-items: center; font-weight: 800; font-size: 22pt; }
  header.top h1 { margin: 0; font-size: 17pt; letter-spacing: -0.01em; }
  header.top .sub { color: #5b6573; font-size: 9.5pt; }
  header.top .right { margin-inline-start: auto; text-align: end; flex: none; }
  header.top .period { font-size: 13pt; font-weight: 700; }
  h2 { font-size: 12pt; margin: 20px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #e3e6eb; break-after: avoid; }
  .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 14px; }
  .card { border: 1px solid #e3e6eb; border-radius: 8px; padding: 10px 12px; }
  .card.main { border-color: ${color}; border-width: 1.5px; }
  .card small { display: block; color: #5b6573; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .04em; font-weight: 600; }
  .card b { display: block; font-size: 16pt; letter-spacing: -0.01em; margin: 2px 0 1px; font-variant-numeric: tabular-nums; }
  .d { font-size: 8.5pt; color: #5b6573; font-weight: 600; white-space: nowrap; }
  .keep, table { break-inside: avoid; }
  tr { break-inside: avoid; }
  table.flow { break-inside: auto; }
  .d.up { color: #1e7b4f; } .d.down { color: #b4372f; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th { text-align: start; font-size: 8.5pt; color: #5b6573; text-transform: uppercase; letter-spacing: .03em; font-weight: 600; padding: 5px 6px; border-bottom: 1px solid #cfd4db; }
  td { padding: 5px 6px; border-bottom: 1px solid #eef0f3; vertical-align: middle; }
  td.r, th.r { text-align: end; }
  tr.total td { font-weight: 700; border-top: 1px solid #8a94a3; border-bottom: 0; }
  td.empty { color: #8a94a3; text-align: center; padding: 10px; }
  .bar { display: inline-block; width: 90px; height: 6px; background: #eef0f3; border-radius: 3px; vertical-align: middle; overflow: hidden; }
  .bar i { display: block; height: 100%; border-radius: 3px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
  .grid2 > section { break-inside: avoid; }
  .chart { width: 100%; height: auto; font-size: 8px; fill: #5b6573; }
  .legend { display: flex; gap: 14px; font-size: 8.5pt; color: #5b6573; margin-top: 2px; }
  .legend i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-inline-end: 5px; vertical-align: -1px; }
  .facts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0 18px; }
  .facts div { display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 1px solid #eef0f3; }
  .facts span { color: #5b6573; white-space: nowrap; margin-inline-end: 8px; }
  .facts b { white-space: nowrap; }
  .note { color: #5b6573; font-size: 8.5pt; margin-top: 18px; padding-top: 8px; border-top: 1px solid #e3e6eb; }
  .page-break { break-before: page; }
  .muted { color: #8a94a3; }
</style></head><body><div class="doc">
<header class="top">
  ${logo}
  <div><h1>${e(d.gym.name)}</h1><div class="sub">${e([d.gym.address, d.gym.city, d.gym.phone].filter(Boolean).join(" · "))}</div></div>
  <div class="right"><div class="sub">Financial report</div><div class="period">${e(periodLabel(d.from, d.to))}</div><div class="sub">vs ${e(shortDate(d.previous.from))} – ${e(shortDate(d.previous.to))}</div></div>
</header>

<div class="cards">
  <div class="card main"><small>Revenue</small><b>${usd(d.revenue)}</b>${delta(d.revenue, d.prev.revenue)}</div>
  <div class="card"><small>Expenses</small><b>${usd(d.expenses)}</b>${delta(d.expenses, d.prev.expenses, false)}</div>
  <div class="card"><small>Net profit</small><b>${usd(d.profit)}</b><span class="d">${margin == null ? "" : `${margin}% margin · `}</span>${delta(d.profit, prevProfit)}</div>
  <div class="card"><small>Collected</small><b>${collection == null ? "—" : `${collection}%`}</b><span class="d">of ${usd(d.cur.billed)} sold</span></div>
</div>

<h2>Revenue and expenses</h2>
${chart(d.series as any, color)}

<div class="grid2">
<section>
<h2>Revenue by source</h2>
<table><thead><tr><th>Source</th><th class="r">Amount</th><th></th><th class="r">vs before</th></tr></thead><tbody>
${rows(d.byKind.map((k) => `<tr><td>${e(KIND_LABEL[k.kind] ?? k.kind)}</td><td class="r">${usd2(k.usd)}</td><td>${bar(k.usd, d.revenue, color)}</td><td class="r">${delta(k.usd, k.prev)}</td></tr>`))}
<tr class="total"><td>Total</td><td class="r">${usd2(d.revenue)}</td><td></td><td class="r">${delta(d.revenue, d.prev.revenue)}</td></tr>
</tbody></table>
</section>
<section>
<h2>How members paid</h2>
<table><thead><tr><th>Method</th><th class="r">Payments</th><th class="r">Amount</th></tr></thead><tbody>
${rows(d.byMethod.map((m) => `<tr><td>${e(METHOD_LABEL[m.method] ?? m.method)}</td><td class="r">${m.n}</td><td class="r">${usd2(m.usd)}</td></tr>`))}
</tbody></table>
<table style="margin-top:10px"><thead><tr><th>Currency received</th><th class="r">Amount</th><th class="r">In USD</th></tr></thead><tbody>
${rows(d.byCurrency.map((c) => `<tr><td>${c.currency}</td><td class="r">${c.currency === "LBP" ? lbp(c.amount) : usd2(c.amount)}</td><td class="r">${usd2(c.usd)}</td></tr>`))}
</tbody></table>
</section>
</div>

<div class="grid2">
<section>
<h2>Expenses</h2>
<table><thead><tr><th>Category</th><th class="r">Amount</th><th></th></tr></thead><tbody>
${rows(d.expensesByCategory.map((x) => `<tr><td>${e(x.category[0].toUpperCase() + x.category.slice(1))}</td><td class="r">${usd2(x.usd)}</td><td>${bar(Number(x.usd), expTotal, "#9aa3af")}</td></tr>`))}
${d.expensesByCategory.length ? `<tr class="total"><td>Total</td><td class="r">${usd2(expTotal)}</td><td></td></tr>` : ""}
</tbody></table>
</section>
<section>
<h2>Memberships sold</h2>
<table><thead><tr><th>Plan</th><th class="r">Sold</th><th class="r">Collected</th></tr></thead><tbody>
${rows(d.byPlan.map((x) => `<tr><td>${e(x.plan)}</td><td class="r">${x.sold}</td><td class="r">${usd2(x.usd)}</td></tr>`))}
</tbody></table>
</section>
</div>

<section class="keep">
<h2>Members</h2>
<div class="facts">
  <div><span>Active at start</span><b>${d.cur.activeStart}</b></div>
  <div><span>Active at end</span><b>${d.cur.activeEnd}</b></div>
  <div><span>New members</span><b>${d.cur.newMembers}</b></div>
  <div><span>Left without renewing</span><b>${d.cur.lapsed}</b></div>
  <div><span>Renewal rate</span><b>${renewal == null ? "—" : renewal + "%"}</b></div>
  <div><span>Recurring revenue (MRR)</span><b>${usd(d.cur.mrrEnd)}</b></div>
</div>
</section>

<div class="grid2">
<section>
<h2>Personal training</h2>
<table><thead><tr><th>Coach</th><th class="r">Sessions done</th><th class="r">Collected</th><th class="r">Commission</th></tr></thead><tbody>
${rows(d.byCoach.map((c) => `<tr><td>${e(c.coach)}</td><td class="r">${c.sessions}</td><td class="r">${usd2(c.usd)}</td><td class="r">${usd2((Number(c.usd) * Number(c.commission_pct)) / 100)}</td></tr>`))}
</tbody></table>
</section>
<section>
<h2>Shop</h2>
<div class="facts" style="grid-template-columns:1fr 1fr">
  <div><span>Sales</span><b>${d.shop.sales}</b></div>
  <div><span>Revenue</span><b>${usd2(shopRev)}</b></div>
  <div><span>Cost of goods</span><b>${usd2(shopCost)}</b></div>
  <div><span>Gross margin</span><b>${usd2(shopRev - shopCost)}${shopRev ? ` <small class="muted">${Math.round((100 * (shopRev - shopCost)) / shopRev)}%</small>` : ""}</b></div>
</div>
<table style="margin-top:8px"><thead><tr><th>Best sellers</th><th class="r">Qty</th><th class="r">Revenue</th></tr></thead><tbody>
${rows(d.topProducts.slice(0, 6).map((x) => `<tr><td>${e(x.name)}</td><td class="r">${x.qty}</td><td class="r">${usd2(x.revenue)}</td></tr>`))}
</tbody></table>
</section>
</div>

<h2>Unpaid balances today</h2>
<p style="margin:0 0 6px">${d.outstanding.n ? `${d.outstanding.n} members owe a total of <b>${usd2(d.outstanding.total)}</b>.` : "No member owes money."}</p>
${d.debtors.length ? `<table class="flow"><thead><tr><th>#</th><th>Member</th><th>Phone</th><th class="r">Balance</th></tr></thead><tbody>
${d.debtors.slice(0, 10).map((x) => `<tr><td>${x.code}</td><td dir="auto">${e(x.name)}</td><td>${e(x.phone ?? "")}</td><td class="r">${usd2(x.balance_usd)}</td></tr>`).join("")}
</tbody></table>${d.debtors.length > 10 ? `<p class="muted">… and ${d.debtors.length - 10} more in the Excel file.</p>` : ""}` : ""}

<p class="note">All amounts in US dollars. Payments in Lebanese pounds are converted at the rate recorded with each payment${lbpRow ? ` (${lbp(lbpRow.amount)} received in cash and transfers)` : ""}. Revenue counts payments received in the period; voided payments are excluded. Profit is revenue minus the expenses recorded in GMS. Generated by GMS on ${e(longDate(d.generated))}.</p>
</div></body></html>`;
}

export function financeWorkbook(d: FinanceData): Buffer {
  const kindLabel = (k: string) => KIND_LABEL[k] ?? k;
  const sheets: Sheet[] = [
    {
      name: "Summary", title: `${d.gym.name} · Financial report · ${periodLabel(d.from, d.to)}`,
      columns: [{ header: "Figure", width: 34 }, { header: "This period", width: 16, type: "money" }, { header: "Previous period", width: 16, type: "money" }, { header: "Change %", width: 12, type: "pct" }],
      rows: [
        ["Revenue", d.revenue, d.prev.revenue, change(d.revenue, d.prev.revenue)],
        ...d.byKind.map((k) => [`  ${kindLabel(k.kind)}`, k.usd, k.prev, change(k.usd, k.prev)]),
        ["Expenses", d.expenses, d.prev.expenses, change(d.expenses, d.prev.expenses)],
        ["Net profit", d.profit, r2(d.prev.revenue - d.prev.expenses), change(d.profit, d.prev.revenue - d.prev.expenses)],
        ["Sold in the period (memberships, PT, shop)", d.cur.billed, d.prev.billed, change(d.cur.billed, d.prev.billed)],
        ["  of which collected", d.cur.collected, d.prev.collected, change(d.cur.collected, d.prev.collected)],
        ["Recurring revenue (MRR) at end", d.cur.mrrEnd, d.prev.mrrEnd, change(d.cur.mrrEnd, d.prev.mrrEnd)],
        ["Shop gross margin", r2(Number(d.shop.revenue) - Number(d.shop.cost)), null, null],
        ["Unpaid balances today", Number(d.outstanding.total), null, null],
        [`Period: ${d.from} to ${d.to} · previous: ${d.previous.from} to ${d.previous.to}`, null, null, null],
      ],
    },
    {
      name: "Payments",
      columns: [{ header: "Date", width: 17, type: "datetime" }, { header: "Receipt", width: 9, type: "int" }, { header: "Member #", width: 10, type: "int" }, { header: "Member", width: 24 },
        { header: "For", width: 18 }, { header: "Detail", width: 26 }, { header: "Method", width: 12 }, { header: "Currency", width: 9 }, { header: "Amount", width: 14, type: "money" },
        { header: "LBP rate", width: 11, type: "number" }, { header: "USD", width: 12, type: "money" }, { header: "Received by", width: 16 }, { header: "Reference", width: 14 }],
      rows: d.payments.map((x) => [x.at, x.receipt_no, x.code, x.member ?? "Walk-in", kindLabel(x.kind), x.detail, METHOD_LABEL[x.method] ?? x.method, x.currency, Number(x.amount), Number(x.lbp_rate), Number(x.amount_usd), x.received_by, x.reference]),
      totals: ["Total", null, null, null, null, null, null, null, null, null, d.revenue, null, null],
    },
    {
      name: "Expenses",
      columns: [{ header: "Date", width: 12, type: "date" }, { header: "Category", width: 16 }, { header: "Note", width: 34 }, { header: "Currency", width: 9 }, { header: "Amount", width: 14, type: "money" }, { header: "USD", width: 12, type: "money" }],
      rows: d.expenseRows.map((x) => [x.day, x.category, x.note, x.currency, Number(x.amount), Number(x.amount_usd)]),
      totals: ["Total", null, null, null, null, d.expenses],
    },
    {
      name: "Memberships sold",
      columns: [{ header: "Sold on", width: 12, type: "date" }, { header: "Member #", width: 10, type: "int" }, { header: "Member", width: 24 }, { header: "Plan", width: 20 }, { header: "Start", width: 12, type: "date" }, { header: "End", width: 12, type: "date" }, { header: "Price USD", width: 12, type: "money" }, { header: "Paid USD", width: 12, type: "money" }],
      rows: d.membershipsSold.map((x) => [x.day, x.code, x.member, x.plan_name, x.start_date, x.end_date, Number(x.price_usd), Number(x.paid_usd)]),
    },
    {
      name: "Shop sales",
      columns: [{ header: "Date", width: 17, type: "datetime" }, { header: "Sale #", width: 8, type: "int" }, { header: "Customer", width: 22 }, { header: "Items", width: 40 }, { header: "Discount", width: 11, type: "money" }, { header: "Total", width: 11, type: "money" }, { header: "Cost", width: 11, type: "money" }, { header: "Margin", width: 11, type: "money" }, { header: "Status", width: 12 }],
      rows: d.sales.map((x) => [x.at, x.sale_no, x.customer, x.items, Number(x.discount_usd), Number(x.total_usd), Number(x.cost_usd), r2(Number(x.total_usd) - Number(x.cost_usd)), x.status === "on_account" ? "On account" : "Paid"]),
      totals: ["Total", null, null, null, Number(d.shop.discounts), Number(d.shop.revenue), Number(d.shop.cost), r2(Number(d.shop.revenue) - Number(d.shop.cost)), null],
    },
    {
      name: "Unpaid balances",
      columns: [{ header: "Member #", width: 10, type: "int" }, { header: "Member", width: 26 }, { header: "Phone", width: 16 }, { header: "Status", width: 12 }, { header: "Balance USD", width: 14, type: "money" }],
      rows: d.debtors.map((x) => [x.code, x.name, x.phone, x.status, Number(x.balance_usd)]),
      totals: ["Total", null, null, null, Number(d.outstanding.total)],
    },
    {
      name: d.series[0]?.label.length === 10 ? "By day" : "By month",
      columns: [{ header: d.series[0]?.label.length === 10 ? "Day" : "Month", width: 12, type: d.series[0]?.label.length === 10 ? "date" : "text" }, { header: "Revenue USD", width: 14, type: "money" }, { header: "Expenses USD", width: 14, type: "money" }, { header: "Net USD", width: 14, type: "money" }],
      rows: d.series.map((x) => [x.label, Number(x.revenue), Number(x.expenses), r2(Number(x.revenue) - Number(x.expenses))]),
    },
  ];
  return workbook(sheets, { title: `${d.gym.name} financial report ${d.from} – ${d.to}` });
}

export function reportFileName(gymName: string, from: string, to: string, ext: string) {
  const slug = gymName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "gym";
  return `${slug}-financial-report-${from}${from === to ? "" : `-to-${to}`}.${ext}`;
}
