/**
 * Key performance indicators: the numbers that tell an owner whether the gym is healthy,
 * each compared with the previous period, rated against fitness-industry benchmarks,
 * and turned into a short "focus now" list ranked by money at stake.
 *
 * Benchmarks used (fitness industry, IHRSA / club-software studies):
 *  - members visiting ≥ 2×/week are ~50% less likely to cancel → "engaged members" share;
 *  - typical membership lasts 7–8 months, retention-focused gyms 12+;
 *  - annual churn 30–40% (≈ 3–4% a month);
 *  - new members visiting < 1×/week in their first weeks tend to quit by month 3 → "activation".
 */
import { db, many, one } from "../db/index.ts";
import { requireStaff } from "../auth.ts";
import { zDate, type Router } from "../http.ts";
import { gymToday } from "../services/money.ts";

type Status = "good" | "watch" | "bad" | "info";
export interface Kpi {
  key: string;
  group: "members" | "money" | "engagement" | "ai";
  label: string;
  value: number | null;
  prev: number | null;
  unit: "count" | "usd" | "pct" | "months" | "per_week";
  /** true when a higher value is better (drives the colour of the trend arrow) */
  higherIsBetter: boolean;
  status: Status;
  target: string;
  why: string;
  headline?: boolean;
}

const DAY = 86400000;
export const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / DAY) + 1;
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (a: number, b: number) => (b > 0 ? r1((100 * a) / b) : null);

/** Rates a value: `good`/`watch` are the thresholds, in the direction of `higherIsBetter`. */
export function rate(value: number | null, good: number, watch: number, higherIsBetter = true): Status {
  if (value == null || !Number.isFinite(value)) return "info";
  if (higherIsBetter) return value >= good ? "good" : value >= watch ? "watch" : "bad";
  return value <= good ? "good" : value <= watch ? "watch" : "bad";
}

/** Period helpers: "month" (this month to date), "last_month", "90d", or explicit from/to. */
export function resolvePeriod(today: string, period?: string | null, from?: string | null, to?: string | null) {
  if (from && to) return { from, to };
  if (period === "last_month") {
    const first = today.slice(0, 8) + "01";
    const lastEnd = addDays(first, -1);
    return { from: lastEnd.slice(0, 8) + "01", to: lastEnd };
  }
  if (period === "90d") return { from: addDays(today, -89), to: today };
  return { from: today.slice(0, 8) + "01", to: today };
}

/** The same number of days immediately before the period. */
export function previousPeriod(from: string, to: string) {
  const n = daysBetween(from, to);
  return { from: addDays(from, -n), to: addDays(from, -1) };
}

/** Raw measures for one period (everything the KPIs and the finance report need). */
export async function measures(gymId: string, from: string, to: string, today: string) {
  const end = to > today ? today : to;
  const days = daysBetween(from, end);
  const p = [gymId, from, end];
  const [members, money, charges, classes, pt, leads, visits] = await Promise.all([
    one(db, `
      WITH cover AS (SELECT member_id, start_date, end_date, price_usd, (end_date - start_date + 1) AS len FROM memberships WHERE gym_id = $1 AND status = 'active'),
      firsts AS (SELECT member_id, min(start_date) AS first_start FROM cover GROUP BY member_id),
      ends AS (  -- memberships that ended in the period (a week of grace) and were not followed by another
        SELECT c.member_id, max(c.end_date) AS ended FROM cover c
         WHERE c.end_date BETWEEN $2::date - 7 AND least($3::date - 7, current_date - 7)
           AND NOT EXISTS (SELECT 1 FROM cover n WHERE n.member_id = c.member_id AND n.end_date > c.end_date AND n.start_date <= c.end_date + 30)
         GROUP BY c.member_id),
      renewals AS (
        SELECT EXISTS (SELECT 1 FROM cover n WHERE n.member_id = c.member_id AND n.start_date > c.start_date AND n.start_date <= c.end_date + 30) AS renewed
          FROM cover c WHERE c.end_date BETWEEN $2::date - 7 AND least($3::date - 7, current_date - 7) AND c.len >= 20)
      SELECT
        (SELECT count(DISTINCT member_id) FROM cover WHERE $2::date BETWEEN start_date AND end_date)::int AS active_start,
        (SELECT count(DISTINCT member_id) FROM cover WHERE $3::date BETWEEN start_date AND end_date)::int AS active_end,
        (SELECT count(*) FROM firsts WHERE first_start BETWEEN $2 AND $3)::int AS new_members,
        (SELECT count(*) FROM ends)::int AS lapsed,
        (SELECT count(*) FROM renewals)::int AS renewals_due,
        (SELECT count(*) FILTER (WHERE renewed) FROM renewals)::int AS renewed,
        (SELECT count(DISTINCT n.member_id) FROM cover n WHERE n.start_date BETWEEN $2 AND $3
            AND EXISTS (SELECT 1 FROM cover o WHERE o.member_id = n.member_id AND o.end_date < n.start_date - 30)
            AND NOT EXISTS (SELECT 1 FROM cover o WHERE o.member_id = n.member_id AND o.end_date >= n.start_date - 30 AND o.start_date < n.start_date))::int AS winbacks,
        (SELECT coalesce(round(sum(price_usd * 30.0 / greatest(len, 30)), 2), 0) FROM cover WHERE $3::date BETWEEN start_date AND end_date) AS mrr_end,
        (SELECT coalesce(round(sum(price_usd * 30.0 / greatest(len, 30)), 2), 0) FROM cover WHERE $2::date BETWEEN start_date AND end_date) AS mrr_start,
        -- engaged: active at the end with 8+ visits in the 28 days before it (2 a week)
        (SELECT count(*) FROM (SELECT DISTINCT member_id FROM cover WHERE $3::date BETWEEN start_date AND end_date) a
          WHERE (SELECT count(*) FROM checkins ck WHERE ck.member_id = a.member_id AND ck.result = 'ok'
                   AND ck.at >= ($3::date - 27)::timestamptz AND ck.at < ($3::date + 1)::timestamptz) >= 8)::int AS engaged,
        -- activation: new members (14+ days in) who came at least once a week on average in their first 30 days
        (SELECT count(*) FROM firsts f WHERE f.first_start BETWEEN $2 AND $3 AND f.first_start <= current_date - 14)::int AS new_observed,
        (SELECT count(*) FROM firsts f WHERE f.first_start BETWEEN $2 AND $3 AND f.first_start <= current_date - 14
            AND (SELECT count(*) FROM checkins ck WHERE ck.member_id = f.member_id AND ck.result = 'ok'
                   AND ck.at >= f.first_start::timestamptz AND ck.at < (f.first_start + least(30, current_date - f.first_start))::timestamptz)
                >= floor(least(30, current_date - f.first_start) / 7.0))::int AS activated,
        -- lifetime of members who left in the last 12 months (first start → last end)
        (SELECT round(avg((x.last_end - x.first_start + 1) / 30.44), 1) FROM (
            SELECT c.member_id, min(c.start_date) AS first_start, max(c.end_date) AS last_end FROM cover c GROUP BY c.member_id
            HAVING max(c.end_date) BETWEEN $3::date - 365 AND least($3::date, current_date - 30)) x) AS lifetime_months
    `, p),
    one(db, `
      SELECT coalesce(sum(amount_usd), 0) AS revenue,
             coalesce(sum(amount_usd) FILTER (WHERE membership_id IS NOT NULL), 0) AS rev_memberships,
             coalesce(sum(amount_usd) FILTER (WHERE pt_package_id IS NOT NULL), 0) AS rev_pt,
             coalesce(sum(amount_usd) FILTER (WHERE sale_id IS NOT NULL), 0) AS rev_shop,
             (SELECT coalesce(sum(amount_usd), 0) FROM expenses WHERE gym_id = $1 AND spent_on BETWEEN $2 AND $3) AS expenses,
             (SELECT coalesce(sum(cost_usd), 0) FROM sales s JOIN gyms g ON g.id = s.gym_id WHERE s.gym_id = $1 AND s.status <> 'void' AND (s.sold_at AT TIME ZONE g.timezone)::date BETWEEN $2 AND $3) AS shop_cost,
             (SELECT coalesce(sum(total_usd), 0) FROM sales s JOIN gyms g ON g.id = s.gym_id WHERE s.gym_id = $1 AND s.status <> 'void' AND (s.sold_at AT TIME ZONE g.timezone)::date BETWEEN $2 AND $3) AS shop_sales
        FROM payments py JOIN gyms g ON g.id = py.gym_id
       WHERE py.gym_id = $1 AND py.voided_at IS NULL AND (py.paid_at AT TIME ZONE g.timezone)::date BETWEEN $2 AND $3`, p),
    // what was charged in the period and how much of it has been paid since
    one(db, `
      WITH g AS (SELECT timezone FROM gyms WHERE id = $1),
      c AS (
        SELECT ms.price_usd AS billed, (SELECT coalesce(sum(amount_usd), 0) FROM payments WHERE membership_id = ms.id AND voided_at IS NULL) AS paid
          FROM memberships ms, g WHERE ms.gym_id = $1 AND ms.status = 'active' AND (ms.created_at AT TIME ZONE g.timezone)::date BETWEEN $2 AND $3
        UNION ALL
        SELECT pk.price_usd, (SELECT coalesce(sum(amount_usd), 0) FROM payments WHERE pt_package_id = pk.id AND voided_at IS NULL)
          FROM pt_packages pk, g WHERE pk.gym_id = $1 AND (pk.created_at AT TIME ZONE g.timezone)::date BETWEEN $2 AND $3
        UNION ALL
        SELECT s.total_usd, (SELECT coalesce(sum(amount_usd), 0) FROM payments WHERE sale_id = s.id AND voided_at IS NULL)
          FROM sales s, g WHERE s.gym_id = $1 AND s.status <> 'void' AND (s.sold_at AT TIME ZONE g.timezone)::date BETWEEN $2 AND $3)
      SELECT coalesce(sum(billed), 0) AS billed, coalesce(sum(least(paid, billed)), 0) AS collected FROM c`, p),
    one(db, `
      WITH s AS (
        SELECT cs.id, cs.capacity,
               count(b.*) FILTER (WHERE b.status IN ('booked','attended','no_show')) AS taken,
               count(b.*) FILTER (WHERE b.status = 'attended') AS attended,
               count(b.*) FILTER (WHERE b.status = 'no_show') AS no_show,
               count(b.*) FILTER (WHERE b.status = 'waitlist') AS waitlist
          FROM class_sessions cs JOIN gyms g ON g.id = cs.gym_id LEFT JOIN bookings b ON b.session_id = cs.id
         WHERE cs.gym_id = $1 AND NOT cs.cancelled AND cs.starts_at < now() AND (cs.starts_at AT TIME ZONE g.timezone)::date BETWEEN $2 AND $3
         GROUP BY cs.id)
      SELECT count(*)::int AS sessions, coalesce(sum(capacity), 0)::int AS capacity, coalesce(sum(least(taken, capacity)), 0)::int AS taken,
             coalesce(sum(attended), 0)::int AS attended, coalesce(sum(no_show), 0)::int AS no_show,
             count(*) FILTER (WHERE waitlist > 0)::int AS with_waitlist FROM s`, p),
    one(db, `
      SELECT count(*) FILTER (WHERE ps.status = 'done')::int AS done,
             coalesce(sum(ps.duration_min) FILTER (WHERE ps.status IN ('done','scheduled','no_show')), 0)::int AS booked_min,
             (SELECT coalesce(sum(extract(epoch FROM (a.end_time - a.start_time)) / 60), 0)
                FROM coach_availability a JOIN users u ON u.id = a.coach_id AND u.active
                JOIN generate_series($2::date, $3::date, interval '1 day') d ON extract(dow FROM d) = a.weekday
               WHERE a.gym_id = $1)::int AS available_min
        FROM pt_sessions ps JOIN gyms g ON g.id = ps.gym_id
       WHERE ps.gym_id = $1 AND (ps.starts_at AT TIME ZONE g.timezone)::date BETWEEN $2 AND $3`, p),
    one(db, `
      SELECT count(*)::int AS created, count(*) FILTER (WHERE status = 'converted')::int AS converted,
             count(*) FILTER (WHERE referred_by IS NOT NULL)::int AS referred,
             (SELECT count(*) FROM members m JOIN gyms g2 ON g2.id = m.gym_id WHERE m.gym_id = $1 AND m.referred_by IS NOT NULL AND (m.created_at AT TIME ZONE g2.timezone)::date BETWEEN $2 AND $3)::int AS referred_members
        FROM leads l JOIN gyms g ON g.id = l.gym_id WHERE l.gym_id = $1 AND (l.created_at AT TIME ZONE g.timezone)::date BETWEEN $2 AND $3`, p),
    one(db, `SELECT count(*)::int AS n FROM checkins c JOIN gyms g ON g.id = c.gym_id
              WHERE c.gym_id = $1 AND c.result = 'ok' AND (c.at AT TIME ZONE g.timezone)::date BETWEEN $2 AND $3`, p),
  ]);
  const n = (x: any) => Number(x ?? 0);
  const activeAvg = (n(members.active_start) + n(members.active_end)) / 2;
  return {
    from, to: end, days,
    activeStart: n(members.active_start), activeEnd: n(members.active_end), activeAvg,
    newMembers: n(members.new_members), lapsed: n(members.lapsed), winbacks: n(members.winbacks),
    renewalsDue: n(members.renewals_due), renewed: n(members.renewed),
    engaged: n(members.engaged), newObserved: n(members.new_observed), activated: n(members.activated),
    lifetimeMonths: members.lifetime_months == null ? null : Number(members.lifetime_months),
    mrrStart: n(members.mrr_start), mrrEnd: n(members.mrr_end),
    revenue: n(money.revenue), revMemberships: n(money.rev_memberships), revPt: n(money.rev_pt), revShop: n(money.rev_shop),
    expenses: n(money.expenses), shopSales: n(money.shop_sales), shopCost: n(money.shop_cost),
    billed: n(charges.billed), collected: n(charges.collected),
    classSessions: n(classes.sessions), classCapacity: n(classes.capacity), classTaken: n(classes.taken),
    classAttended: n(classes.attended), classNoShow: n(classes.no_show), classWithWaitlist: n(classes.with_waitlist),
    ptDone: n(pt.done), ptBookedMin: n(pt.booked_min), ptAvailableMin: n(pt.available_min),
    leadsCreated: n(leads.created), leadsConverted: n(leads.converted), referredMembers: n(leads.referred_members),
    visits: n(visits.n),
  };
}
type Measures = Awaited<ReturnType<typeof measures>>;

/** Turns measures into rated KPIs (value for the period, previous period for the trend). */
export function buildKpis(m: Measures, prev: Measures, ai: { mrrAtRisk: number; atRisk: number; expectedLost30: number; expectedLostMrr30: number; auc: number | null }): Kpi[] {
  const per30 = (x: Measures, v: number) => (x.days > 0 ? (v * 30) / x.days : v);
  const churn = (x: Measures) => (x.activeStart > 0 ? r1(per30(x, (100 * x.lapsed) / x.activeStart)) : null);
  const arpm = (x: Measures) => (x.activeAvg > 0 ? r2(per30(x, x.revenue) / x.activeAvg) : null);
  const lifetime = m.lifetimeMonths;
  const visitsPerWeek = (x: Measures) => (x.activeAvg > 0 && x.days > 0 ? r1(x.visits / x.activeAvg / (x.days / 7)) : null);
  const k: Kpi[] = [];
  const add = (x: Omit<Kpi, "status"> & { rate?: [number, number] }) => {
    const { rate: thresholds, ...rest } = x;
    k.push({ ...rest, status: thresholds ? rate(x.value, thresholds[0], thresholds[1], x.higherIsBetter) : "info" });
  };

  // ---- members & retention ----
  add({ key: "active_members", group: "members", label: "Active members", value: m.activeEnd, prev: prev.activeEnd, unit: "count", higherIsBetter: true,
    target: "Growing month after month", why: "Members with a valid membership at the end of the period.", headline: true });
  add({ key: "net_growth", group: "members", label: "Net member growth", value: m.activeEnd - m.activeStart, prev: prev.activeEnd - prev.activeStart, unit: "count", higherIsBetter: true, rate: [1, 0],
    target: "Above 0", why: "Members gained minus members lost over the period. Below 0 means the gym is shrinking even if new people join." });
  add({ key: "new_members", group: "members", label: "New members", value: m.newMembers, prev: prev.newMembers, unit: "count", higherIsBetter: true,
    target: "Enough to replace those who leave", why: "People who bought their first membership in the period." });
  add({ key: "churn_rate", group: "members", label: "Monthly churn", value: churn(m), prev: churn(prev), unit: "pct", higherIsBetter: false, rate: [3, 5],
    target: "3% or less a month", why: "Share of members who left without renewing, per 30 days (memberships that ended a week before, so everyone gets a week of grace). The industry loses 30–40% a year, about 3–4% a month.", headline: true });
  add({ key: "renewal_rate", group: "members", label: "Renewal rate", value: pct(m.renewed, m.renewalsDue), prev: pct(prev.renewed, prev.renewalsDue), unit: "pct", higherIsBetter: true, rate: [70, 55],
    target: "70% or more", why: "Of the memberships that ended, how many were renewed within 30 days." });
  add({ key: "activation", group: "members", label: "New member activation", value: pct(m.activated, m.newObserved), prev: pct(prev.activated, prev.newObserved), unit: "pct", higherIsBetter: true, rate: [60, 40],
    target: "60% or more", why: "New members who came at least once a week in their first month. Those who don't usually quit by month 3, so this predicts next quarter's churn." });
  add({ key: "lifetime", group: "members", label: "Average membership lifetime", value: lifetime, prev: prev.lifetimeMonths, unit: "months", higherIsBetter: true, rate: [12, 7],
    target: "12 months or more", why: "How long members stay, from first day to leaving (members who left in the last year). The industry average is 7–8 months." });
  add({ key: "winbacks", group: "members", label: "Members won back", value: m.winbacks, prev: prev.winbacks, unit: "count", higherIsBetter: true,
    target: "Rising", why: "Former members who came back after more than a month away." });

  // ---- money ----
  add({ key: "revenue", group: "money", label: "Revenue", value: r2(m.revenue), prev: r2(prev.revenue), unit: "usd", higherIsBetter: true,
    target: "Above the previous period", why: "All payments received in the period (USD, LBP converted at the day's rate).", headline: true });
  add({ key: "mrr", group: "money", label: "Recurring revenue (MRR)", value: r2(m.mrrEnd), prev: r2(m.mrrStart), unit: "usd", higherIsBetter: true,
    target: "Growing", why: "What the active memberships are worth per month. Compared with the start of the period." });
  add({ key: "profit_margin", group: "money", label: "Profit margin", value: m.revenue > 0 ? r1((100 * (m.revenue - m.expenses)) / m.revenue) : null, prev: prev.revenue > 0 ? r1((100 * (prev.revenue - prev.expenses)) / prev.revenue) : null, unit: "pct", higherIsBetter: true, rate: [20, 5],
    target: "20% or more", why: "What is left of revenue after recorded expenses (rent, salaries, generator…). Only as accurate as the expenses entered." });
  add({ key: "arpm", group: "money", label: "Revenue per member", value: arpm(m), prev: arpm(prev), unit: "usd", higherIsBetter: true,
    target: "Rising", why: "Average monthly revenue per active member, all streams included (memberships, PT, shop)." });
  add({ key: "ltv", group: "money", label: "Member lifetime value", value: arpm(m) != null && lifetime != null ? Math.round(arpm(m)! * lifetime) : null, prev: arpm(prev) != null && prev.lifetimeMonths != null ? Math.round(arpm(prev)! * prev.lifetimeMonths) : null, unit: "usd", higherIsBetter: true,
    target: "Rising", why: "What a member brings in over their whole stay: revenue per member × average lifetime. Tells you how much a new member is worth winning." });
  add({ key: "collection_rate", group: "money", label: "Collection rate", value: pct(m.collected, m.billed), prev: pct(prev.collected, prev.billed), unit: "pct", higherIsBetter: true, rate: [95, 85],
    target: "95% or more", why: "Share of what was sold in the period (memberships, PT, shop) that has been paid so far." });
  add({ key: "secondary_revenue", group: "money", label: "Revenue beyond memberships", value: pct(m.revenue - m.revMemberships, m.revenue), prev: pct(prev.revenue - prev.revMemberships, prev.revenue), unit: "pct", higherIsBetter: true, rate: [20, 10],
    target: "20% or more", why: "Share of revenue from personal training, the shop and the rest. Strong gyms don't depend on memberships alone." });
  add({ key: "shop_margin", group: "money", label: "Shop gross margin", value: m.shopSales > 0 ? r1((100 * (m.shopSales - m.shopCost)) / m.shopSales) : null, prev: prev.shopSales > 0 ? r1((100 * (prev.shopSales - prev.shopCost)) / prev.shopSales) : null, unit: "pct", higherIsBetter: true, rate: [30, 20],
    target: "30% or more", why: "Shop sales minus the purchase cost of what was sold." });

  // ---- engagement & operations ----
  add({ key: "engaged", group: "engagement", label: "Engaged members", value: pct(m.engaged, m.activeEnd), prev: pct(prev.engaged, prev.activeEnd), unit: "pct", higherIsBetter: true, rate: [50, 35],
    target: "50% or more", why: "Active members who came 2+ times a week over the last 4 weeks. They are about half as likely to cancel.", headline: true });
  add({ key: "visits_per_week", group: "engagement", label: "Visits per member per week", value: visitsPerWeek(m), prev: visitsPerWeek(prev), unit: "per_week", higherIsBetter: true, rate: [2, 1.2],
    target: "2 or more", why: "Average check-ins per active member per week." });
  add({ key: "class_fill", group: "engagement", label: "Class fill rate", value: pct(m.classTaken, m.classCapacity), prev: pct(prev.classTaken, prev.classCapacity), unit: "pct", higherIsBetter: true, rate: [60, 40],
    target: "60–90%", why: "Spots booked out of spots offered in classes that took place. Low: too many classes or the wrong times. Always full: add a session." });
  add({ key: "no_show", group: "engagement", label: "Class no-shows", value: pct(m.classNoShow, m.classAttended + m.classNoShow), prev: pct(prev.classNoShow, prev.classAttended + prev.classNoShow), unit: "pct", higherIsBetter: false, rate: [10, 20],
    target: "10% or less", why: "Members who booked and didn't come, out of bookings marked attended or no-show." });
  add({ key: "coach_utilisation", group: "engagement", label: "Coach PT occupancy", value: m.ptAvailableMin > 0 ? pct(m.ptBookedMin, m.ptAvailableMin) : null, prev: prev.ptAvailableMin > 0 ? pct(prev.ptBookedMin, prev.ptAvailableMin) : null, unit: "pct", higherIsBetter: true, rate: [60, 35],
    target: "60% or more", why: "PT hours booked out of the hours coaches made available. Needs coach availability to be set in Personal training." });
  add({ key: "lead_conversion", group: "engagement", label: "Lead conversion", value: pct(m.leadsConverted, m.leadsCreated), prev: pct(prev.leadsConverted, prev.leadsCreated), unit: "pct", higherIsBetter: true, rate: [30, 15],
    target: "30% or more", why: "Leads received in the period that became members." });
  add({ key: "referral_share", group: "engagement", label: "New members from referrals", value: pct(m.referredMembers, m.newMembers), prev: pct(prev.referredMembers, prev.newMembers), unit: "pct", higherIsBetter: true, rate: [15, 5],
    target: "15% or more", why: "Share of new members invited by an existing member through the app. Referred members cost nothing to acquire and stay longer." });

  // ---- AI predictions ----
  add({ key: "revenue_at_risk", group: "ai", label: "Revenue at risk", value: r2(ai.mrrAtRisk), prev: null, unit: "usd", higherIsBetter: false,
    rate: m.mrrEnd > 0 ? [m.mrrEnd * 0.1, m.mrrEnd * 0.2] : undefined,
    target: "Under 10% of MRR", why: `Monthly value of the ${ai.atRisk} active members the churn model rates likely to leave (60%+).`, headline: true });
  add({ key: "expected_losses", group: "ai", label: "Expected losses, next 30 days", value: r1(ai.expectedLost30), prev: null, unit: "count", higherIsBetter: false,
    target: "As low as possible", why: `Members expected not to renew among those whose membership ends in the next 30 days (sum of their churn probabilities), worth about $${Math.round(ai.expectedLostMrr30)}/month.` });
  add({ key: "model_accuracy", group: "ai", label: "Prediction accuracy (AUC)", value: ai.auc, prev: null, unit: "count", higherIsBetter: true, rate: ai.auc == null ? undefined : [0.75, 0.65],
    target: "0.75 or more", why: ai.auc == null ? "The model is still using GMS's starting rules: your gym needs about 60 finished memberships to train its own." : "How well the model trained on your gym's history separates members who left from those who stayed (0.5 = chance, 1 = perfect)." });
  return k;
}

export interface FocusAction { key: string; title: string; detail: string; impact_usd: number | null; link: string; members?: { id: string; name: string }[] }

/** The few things worth doing now, biggest money first. */
async function focus(gymId: string, kpis: Kpi[], today: string): Promise<FocusAction[]> {
  const [risky, owing, expiring, inactiveNew, weakClasses, fullClasses, stock, leads] = await Promise.all([
    many(db, `SELECT mo.id, mo.first_name || ' ' || mo.last_name AS name, mo.churn_score,
                     round(ms.price_usd * 30.0 / greatest(ms.end_date - ms.start_date + 1, 30), 2) AS mrr
                FROM member_overview mo JOIN memberships ms ON ms.id = mo.membership_id
               WHERE mo.gym_id = $1 AND mo.archived_at IS NULL AND mo.status IN ('active','expiring') AND mo.churn_score >= 0.6
               ORDER BY mo.churn_score * ms.price_usd DESC LIMIT 50`, [gymId]),
    many(db, `SELECT id, first_name || ' ' || last_name AS name, balance_usd FROM member_overview WHERE gym_id = $1 AND archived_at IS NULL AND balance_usd > 0.5 ORDER BY balance_usd DESC LIMIT 50`, [gymId]),
    many(db, `SELECT mo.id, mo.first_name || ' ' || mo.last_name AS name, ms.price_usd FROM member_overview mo JOIN memberships ms ON ms.id = mo.membership_id
               WHERE mo.gym_id = $1 AND mo.archived_at IS NULL AND mo.status = 'expiring'
                 AND NOT EXISTS (SELECT 1 FROM memberships n WHERE n.member_id = mo.id AND n.status = 'active' AND n.start_date > mo.end_date - 1)
               ORDER BY mo.end_date LIMIT 50`, [gymId]),
    many(db, `WITH f AS (SELECT member_id, min(start_date) AS first_start FROM memberships WHERE gym_id = $1 AND status = 'active' GROUP BY member_id)
              SELECT m.id, m.first_name || ' ' || m.last_name AS name FROM f JOIN members m ON m.id = f.member_id
               WHERE m.archived_at IS NULL AND f.first_start BETWEEN $2::date - 45 AND $2::date - 10
                 AND (SELECT count(*) FROM checkins c WHERE c.member_id = m.id AND c.result = 'ok' AND c.at >= f.first_start::timestamptz) < floor(($2::date - f.first_start) / 7.0)
               ORDER BY f.first_start LIMIT 20`, [gymId, today]),
    many(db, `SELECT ct.name, to_char(cs.starts_at AT TIME ZONE g.timezone, 'Dy HH24:MI') AS slot, round(100.0 * sum(least(x.taken, cs.capacity)) / sum(cs.capacity)) AS fill, count(*)::int AS n
                FROM class_sessions cs JOIN gyms g ON g.id = cs.gym_id JOIN class_types ct ON ct.id = cs.class_type_id
                CROSS JOIN LATERAL (SELECT count(*) FILTER (WHERE b.status IN ('booked','attended','no_show')) AS taken FROM bookings b WHERE b.session_id = cs.id) x
               WHERE cs.gym_id = $1 AND NOT cs.cancelled AND cs.starts_at BETWEEN now() - interval '28 days' AND now()
               GROUP BY ct.name, 2 HAVING count(*) >= 2 AND 100.0 * sum(least(x.taken, cs.capacity)) / sum(cs.capacity) < 35
               ORDER BY fill LIMIT 3`, [gymId]),
    many(db, `SELECT ct.name, to_char(cs.starts_at AT TIME ZONE g.timezone, 'Dy HH24:MI') AS slot, count(*)::int AS n
                FROM class_sessions cs JOIN gyms g ON g.id = cs.gym_id JOIN class_types ct ON ct.id = cs.class_type_id
               WHERE cs.gym_id = $1 AND NOT cs.cancelled AND cs.starts_at BETWEEN now() - interval '28 days' AND now()
                 AND EXISTS (SELECT 1 FROM bookings b WHERE b.session_id = cs.id AND b.status = 'waitlist')
               GROUP BY ct.name, 2 HAVING count(*) >= 2 ORDER BY n DESC LIMIT 3`, [gymId]),
    one(db, `SELECT count(*) FILTER (WHERE track_stock AND stock <= low_stock_at AND kind = 'item')::int AS low,
                    count(*) FILTER (WHERE expires_on IS NOT NULL AND expires_on <= $2::date + 30 AND stock > 0)::int AS expiring,
                    coalesce(sum(stock * cost_usd) FILTER (WHERE expires_on IS NOT NULL AND expires_on <= $2::date + 30 AND stock > 0), 0) AS expiring_value
               FROM products WHERE gym_id = $1 AND active`, [gymId, today]),
    one(db, `SELECT count(*)::int AS n FROM leads WHERE gym_id = $1 AND status IN ('new','contacted','trial') AND (follow_up_on IS NULL OR follow_up_on <= $2::date) AND created_at > now() - interval '60 days'`, [gymId, today]),
  ]);
  const renewal = (kpis.find((x) => x.key === "renewal_rate")?.value ?? 70) / 100;
  const pick = (rows: any[]) => rows.slice(0, 5).map((x) => ({ id: x.id, name: x.name }));
  const out: FocusAction[] = [];
  if (risky.length) {
    const mrr = risky.reduce((s, x) => s + Number(x.mrr), 0);
    out.push({ key: "at_risk", title: `Call the ${risky.length} members most likely to leave`, detail: `They are worth $${Math.round(mrr)} a month. A personal call or a free PT session in the next week saves many of them. Start with the ones below.`, impact_usd: Math.round(mrr), link: "/insights?tab=risk", members: pick(risky) });
  }
  if (expiring.length) {
    const value = expiring.reduce((s, x) => s + Number(x.price_usd), 0);
    out.push({ key: "expiring", title: `${expiring.length} memberships end this week without a renewal`, detail: `About $${Math.round(value * (1 - renewal))} will be lost at your current renewal rate. Remind them now, before the last day.`, impact_usd: Math.round(value * (1 - renewal)), link: "/members?status=expiring", members: pick(expiring) });
  }
  if (owing.length) {
    const total = owing.reduce((s, x) => s + Number(x.balance_usd), 0);
    out.push({ key: "owing", title: `Collect $${Math.round(total)} from ${owing.length} members`, detail: "Unpaid balances on memberships, PT and shop purchases. Ask at their next check-in: the balance shows on the check-in screen.", impact_usd: Math.round(total), link: "/members?balance=1", members: pick(owing) });
  }
  if (inactiveNew.length) {
    const arpm = Number(kpis.find((x) => x.key === "arpm")?.value ?? 0);
    out.push({ key: "activation", title: `${inactiveNew.length} new members are not coming enough`, detail: "They joined in the last weeks but come less than once a week: the most likely to quit by month 3. Invite them to a class or a free check-in with a coach.", impact_usd: arpm ? Math.round(arpm * inactiveNew.length * 0.5) : null, link: "/members", members: pick(inactiveNew) });
  }
  for (const c of fullClasses) out.push({ key: `full:${c.name}:${c.slot}`, title: `${c.name} (${c.slot}) keeps a waitlist`, detail: `Members waited for a spot ${c.n} times in 4 weeks. Add a second session or a bigger room.`, impact_usd: null, link: "/classes" });
  for (const c of weakClasses) out.push({ key: `weak:${c.name}:${c.slot}`, title: `${c.name} (${c.slot}) is only ${c.fill}% full`, detail: "Over the last 4 weeks. Try another time, merge it with a similar class, or promote it in the app.", impact_usd: null, link: "/classes" });
  if (leads.n) out.push({ key: "leads", title: `${leads.n} leads are waiting for a call`, detail: "Interested people with no follow-up yet. Leads called within a day convert far more often.", impact_usd: null, link: "/leads" });
  if (stock.expiring) out.push({ key: "stock_expiring", title: `${stock.expiring} products expire within 30 days`, detail: `$${Math.round(Number(stock.expiring_value))} of stock at cost. Put them on offer in the app before they expire.`, impact_usd: Math.round(Number(stock.expiring_value)), link: "/shop?tab=products" });
  if (stock.low) out.push({ key: "stock_low", title: `${stock.low} products are running out`, detail: "Reorder before members ask for them.", impact_usd: null, link: "/shop?tab=products" });
  return out.sort((a, b) => (b.impact_usd ?? -1) - (a.impact_usd ?? -1)).slice(0, 7);
}

export async function computeKpis(gymId: string, period: { from: string; to: string }) {
  const today = await gymToday(db, gymId);
  const prevP = previousPeriod(period.from, period.to > today ? today : period.to);
  const [cur, prev, ai, model] = await Promise.all([
    measures(gymId, period.from, period.to, today),
    measures(gymId, prevP.from, prevP.to, today),
    one(db, `SELECT count(*) FILTER (WHERE mo.churn_score >= 0.6)::int AS at_risk,
                    coalesce(sum(ms.price_usd * 30.0 / greatest(ms.end_date - ms.start_date + 1, 30)) FILTER (WHERE mo.churn_score >= 0.6), 0) AS mrr_at_risk,
                    coalesce(sum(mo.churn_score) FILTER (WHERE mo.days_left BETWEEN 0 AND 30), 0) AS expected_lost,
                    coalesce(sum(mo.churn_score * ms.price_usd * 30.0 / greatest(ms.end_date - ms.start_date + 1, 30)) FILTER (WHERE mo.days_left BETWEEN 0 AND 30), 0) AS expected_lost_mrr
               FROM member_overview mo JOIN memberships ms ON ms.id = mo.membership_id
              WHERE mo.gym_id = $1 AND mo.archived_at IS NULL AND mo.status IN ('active','expiring')`, [gymId]),
    one(db, "SELECT kind, metrics FROM ai_models WHERE gym_id = $1", [gymId]),
  ]);
  const kpis = buildKpis(cur, prev, {
    atRisk: ai.at_risk, mrrAtRisk: Number(ai.mrr_at_risk), expectedLost30: Number(ai.expected_lost), expectedLostMrr30: Number(ai.expected_lost_mrr),
    auc: model?.kind === "logreg" && model.metrics?.auc != null ? Number(model.metrics.auc) : null,
  });
  return { from: cur.from, to: cur.to, previous: prevP, kpis, focus: await focus(gymId, kpis, today), measures: cur, previousMeasures: prev };
}

export function registerKpis(r: Router) {
  r.get("/api/kpis", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const today = await gymToday(db, u.gymId);
    const from = ctx.query.get("from") ? zDate.parse(ctx.query.get("from")) : null;
    const to = ctx.query.get("to") ? zDate.parse(ctx.query.get("to")) : null;
    const { measures: _m, previousMeasures: _p, ...rest } = await computeKpis(u.gymId, resolvePeriod(today, ctx.query.get("period"), from, to));
    return rest;
  });
}
