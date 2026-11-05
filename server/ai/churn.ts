/**
 * Churn prediction — "which members are about to leave, and why?"
 *
 * Per-gym model, trained on the gym's own history:
 *   sample  = a past membership, observed 14 days before its end date
 *   label   = 1 if the member did NOT start a new membership within 30 days after it ended
 *   model   = L2-regularised logistic regression on standardised behavioural features
 * Until a gym has enough history (new client), a calibrated expert prior is used
 * so scores are meaningful from the first week. Every score comes with the
 * human-readable reasons that drive it (feature contributions).
 */
import { db, many, type Queryable } from "../db/index.ts";

export const FEATURES = [
  "days_since_last_visit",
  "visits_last_14",
  "visit_trend",
  "days_to_expiry",
  "tenure_months",
  "renewals",
  "has_pt",
  "unpaid_balance",
  "no_show_rate",
  "plan_length_days",
] as const;
type Feature = (typeof FEATURES)[number];
export type FeatureVector = Record<Feature, number>;

export interface ChurnModel {
  kind: "logreg" | "prior";
  means: number[];
  stds: number[];
  weights: number[];
  bias: number;
}

/** Expert prior: sensible signs and magnitudes, already on standardised scale. */
export const PRIOR: ChurnModel = {
  kind: "prior",
  means: [7, 6, 0, 30, 6, 1.5, 0.1, 0.1, 0.1, 60],
  stds: [8, 4, 4, 30, 8, 2, 0.3, 0.3, 0.2, 80],
  weights: [1.25, -0.9, -0.55, -0.7, -0.35, -0.6, -0.45, 0.35, 0.3, -0.25],
  bias: -0.6,
};

const DAY = 86400000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const dayNum = (s: string) => Date.parse(s + "T00:00:00Z") / DAY;

interface History {
  memberships: Map<string, { start: string; end: string; created: number }[]>;
  checkins: Map<string, number[]>; // sorted epoch days
  pt: Map<string, { created: number; total: number; used: number }[]>;
  payments: Map<string, { at: number; usd: number }[]>;
  charges: Map<string, { at: number; usd: number }[]>;
  bookings: Map<string, { at: number; status: string }[]>;
}

async function loadHistory(q: Queryable, gymId: string): Promise<History> {
  const [ms, ck, pt, pay, bk] = await Promise.all([
    many(q, `SELECT member_id, start_date::text AS s, end_date::text AS e, price_usd, extract(epoch FROM created_at)::float8 AS c FROM memberships WHERE gym_id = $1 AND status = 'active' ORDER BY start_date`, [gymId]),
    many(q, `SELECT member_id, floor(extract(epoch FROM at) / 86400)::int AS d FROM checkins WHERE gym_id = $1 AND result = 'ok' ORDER BY at`, [gymId]),
    many(q, `SELECT member_id, extract(epoch FROM created_at)::float8 AS c, sessions_total, sessions_used, price_usd FROM pt_packages WHERE gym_id = $1`, [gymId]),
    many(q, `SELECT member_id, extract(epoch FROM paid_at)::float8 AS c, amount_usd FROM payments WHERE gym_id = $1 AND voided_at IS NULL AND member_id IS NOT NULL`, [gymId]),
    many(q, `SELECT b.member_id, extract(epoch FROM s.starts_at)::float8 AS c, b.status FROM bookings b JOIN class_sessions s ON s.id = b.session_id WHERE b.gym_id = $1 AND b.status IN ('attended','no_show')`, [gymId]),
  ]);
  const h: History = { memberships: new Map(), checkins: new Map(), pt: new Map(), payments: new Map(), charges: new Map(), bookings: new Map() };
  const push = <T>(m: Map<string, T[]>, k: string, v: T) => (m.get(k) ?? m.set(k, []).get(k)!).push(v);
  for (const r of ms) {
    push(h.memberships, r.member_id, { start: r.s, end: r.e, created: r.c / 86400 });
    push(h.charges, r.member_id, { at: r.c / 86400, usd: Number(r.price_usd) });
  }
  for (const r of ck) push(h.checkins, r.member_id, r.d);
  for (const r of pt) {
    push(h.pt, r.member_id, { created: r.c / 86400, total: r.sessions_total, used: r.sessions_used });
    push(h.charges, r.member_id, { at: r.c / 86400, usd: Number(r.price_usd) });
  }
  for (const r of pay) push(h.payments, r.member_id, { at: r.c / 86400, usd: Number(r.amount_usd) });
  for (const r of bk) push(h.bookings, r.member_id, { at: r.c / 86400, status: r.status });
  return h;
}

function countBetween(sorted: number[], from: number, to: number) {
  let n = 0;
  for (const d of sorted) {
    if (d >= to) break;
    if (d >= from) n++;
  }
  return n;
}

/** Features of a member as of day `t` (epoch days), relative to the membership ending at `end`. */
export function featuresAt(h: History, memberId: string, t: number, end: string, start: string): FeatureVector {
  const ck = h.checkins.get(memberId) ?? [];
  const before = ck.filter((d) => d <= t);
  const last = before.length ? before[before.length - 1] : null;
  const firstMs = (h.memberships.get(memberId) ?? [])[0];
  const tenureDays = firstMs ? Math.max(0, t - dayNum(firstMs.start)) : 0;
  const renewals = (h.memberships.get(memberId) ?? []).filter((m) => dayNum(m.start) <= t).length - 1;
  const pt = (h.pt.get(memberId) ?? []).some((p) => p.created <= t && p.used < p.total);
  const charged = (h.charges.get(memberId) ?? []).filter((c) => c.at <= t).reduce((s, c) => s + c.usd, 0);
  const paid = (h.payments.get(memberId) ?? []).filter((p) => p.at <= t).reduce((s, p) => s + p.usd, 0);
  const bk = (h.bookings.get(memberId) ?? []).filter((b) => b.at <= t && b.at > t - 60);
  const noShow = bk.length ? bk.filter((b) => b.status === "no_show").length / bk.length : 0;
  const v14 = countBetween(ck, t - 13, t + 1);
  const v28 = countBetween(ck, t - 27, t - 13);
  return {
    days_since_last_visit: Math.min(last === null ? 60 : t - last, 60),
    visits_last_14: v14,
    visit_trend: v14 - v28,
    days_to_expiry: Math.max(-30, Math.min(dayNum(end) - t, 120)),
    tenure_months: Math.min(tenureDays / 30, 36),
    renewals: Math.max(0, Math.min(renewals, 12)),
    has_pt: pt ? 1 : 0,
    unpaid_balance: charged - paid > 1 ? 1 : 0,
    no_show_rate: noShow,
    plan_length_days: Math.min(dayNum(end) - dayNum(start) + 1, 365),
  };
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export function predict(model: ChurnModel, f: FeatureVector) {
  let z = model.bias;
  const contributions: { feature: Feature; value: number; impact: number }[] = [];
  FEATURES.forEach((name, i) => {
    const x = (f[name] - model.means[i]) / (model.stds[i] || 1);
    const impact = model.weights[i] * x;
    z += impact;
    contributions.push({ feature: name, value: f[name], impact });
  });
  return { score: sigmoid(z), contributions: contributions.sort((a, b) => b.impact - a.impact) };
}

/** Trains a logistic regression with L2 and returns it with a holdout AUC. Pure TypeScript, no ML library. */
export function trainLogReg(X: number[][], y: number[], opts = { l2: 0.05, lr: 0.3, epochs: 600, seed: 7 }) {
  const n = X.length;
  const k = X[0].length;
  const means = Array.from({ length: k }, (_, j) => X.reduce((s, r) => s + r[j], 0) / n);
  const stds = Array.from({ length: k }, (_, j) => Math.sqrt(X.reduce((s, r) => s + (r[j] - means[j]) ** 2, 0) / n) || 1);
  const Z = X.map((r) => r.map((v, j) => (v - means[j]) / stds[j]));

  // deterministic shuffle → 75/25 split
  let s = opts.seed;
  const rand = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const cut = Math.max(1, Math.floor(n * 0.75));
  const tr = idx.slice(0, cut);
  const te = idx.slice(cut);

  const fit = (rows: number[]) => {
    const w = new Array(k).fill(0);
    let b = Math.log((rows.reduce((a, i) => a + y[i], 0) + 1) / (rows.length - rows.reduce((a, i) => a + y[i], 0) + 1));
    for (let e = 0; e < opts.epochs; e++) {
      const gw = new Array(k).fill(0);
      let gb = 0;
      for (const i of rows) {
        const p = sigmoid(b + Z[i].reduce((acc, v, j) => acc + v * w[j], 0));
        const err = p - y[i];
        gb += err;
        for (let j = 0; j < k; j++) gw[j] += err * Z[i][j];
      }
      b -= (opts.lr * gb) / rows.length;
      for (let j = 0; j < k; j++) w[j] -= opts.lr * (gw[j] / rows.length + opts.l2 * w[j]);
    }
    return { w, b };
  };

  const evalModel = fit(tr);
  const scores = te.map((i) => ({ p: sigmoid(evalModel.b + Z[i].reduce((a, v, j) => a + v * evalModel.w[j], 0)), y: y[i] }));
  const auc = rocAuc(scores);
  const accuracy = scores.length ? scores.filter((x) => (x.p >= 0.5 ? 1 : 0) === x.y).length / scores.length : null;
  const final = fit(idx); // refit on all data
  return { model: { kind: "logreg" as const, means, stds, weights: final.w, bias: final.b }, metrics: { auc, accuracy, samples: n, positives: y.filter(Boolean).length, holdout: te.length } };
}

export function rocAuc(scores: { p: number; y: number }[]): number | null {
  const pos = scores.filter((s) => s.y === 1);
  const neg = scores.filter((s) => s.y === 0);
  if (!pos.length || !neg.length) return null;
  let wins = 0;
  for (const a of pos) for (const b of neg) wins += a.p > b.p ? 1 : a.p === b.p ? 0.5 : 0;
  return Math.round((wins / (pos.length * neg.length)) * 1000) / 1000;
}

function buildTrainingSet(h: History, todayNum: number) {
  const X: number[][] = [];
  const y: number[] = [];
  for (const [memberId, list] of h.memberships) {
    for (const m of list) {
      const end = dayNum(m.end);
      const len = end - dayNum(m.start) + 1;
      // observable outcome: ended 30+ days ago, last year, and long enough to be a real membership
      if (end > todayNum - 30 || end < todayNum - 400 || len < 20) continue;
      const renewed = list.some((n) => n !== m && dayNum(n.start) > dayNum(m.start) && dayNum(n.start) <= end + 30);
      const t = end - 14;
      const f = featuresAt(h, memberId, t, m.end, m.start);
      X.push(FEATURES.map((k) => f[k]));
      y.push(renewed ? 0 : 1);
    }
  }
  return { X, y };
}

export async function trainForGym(gymId: string) {
  const h = await loadHistory(db, gymId);
  const todayNum = Math.floor(Date.now() / DAY);
  const { X, y } = buildTrainingSet(h, todayNum);
  const pos = y.filter(Boolean).length;
  let model: ChurnModel = PRIOR;
  let metrics: any = { samples: X.length, positives: pos, auc: null, note: "Not enough history yet: using the expert prior (needs 60+ finished memberships)." };
  if (X.length >= 60 && pos >= 10 && X.length - pos >= 10) {
    const t = trainLogReg(X, y);
    metrics = t.metrics;
    // only trust the gym-specific model if it beats chance on the holdout
    if ((t.metrics.auc ?? 0) >= 0.6) model = t.model;
    else metrics.note = "Gym model was not better than the prior on holdout; keeping the prior.";
  }
  await db.query(
    `INSERT INTO ai_models (gym_id, kind, params, metrics, trained_at) VALUES ($1,$2,$3,$4, now())
     ON CONFLICT (gym_id) DO UPDATE SET kind = EXCLUDED.kind, params = EXCLUDED.params, metrics = EXCLUDED.metrics, trained_at = now()`,
    [gymId, model.kind, model, metrics],
  );
  return { kind: model.kind, metrics, weights: Object.fromEntries(FEATURES.map((f, i) => [f, Math.round(model.weights[i] * 1000) / 1000])) };
}

export async function loadModel(gymId: string): Promise<ChurnModel> {
  const r = await db.query("SELECT params FROM ai_models WHERE gym_id = $1", [gymId]);
  return (r.rows[0]?.params as ChurnModel) ?? PRIOR;
}

const REASONS: Record<Feature, (v: number, up: boolean) => string | null> = {
  days_since_last_visit: (v, up) => (up && v >= 7 ? (v >= 60 ? "No visit in 60+ days, or never came" : `No visit in ${Math.round(v)} days`) : null),
  visits_last_14: (v, up) => (up ? (v === 0 ? "No visits in the last 2 weeks" : `Only ${v} visit(s) in the last 2 weeks`) : null),
  visit_trend: (v, up) => (up && v < 0 ? `Visits dropped by ${Math.abs(v)} vs. the previous 2 weeks` : null),
  days_to_expiry: (v, up) => (up && v <= 14 ? (v < 0 ? `Membership expired ${Math.abs(v)} day(s) ago` : `Membership ends in ${v} day(s)`) : null),
  tenure_months: (v, up) => (up && v < 3 ? "New member (first months are the riskiest)" : null),
  renewals: (v, up) => (up && v === 0 ? "Has never renewed" : null),
  has_pt: (v, up) => (up && v === 0 ? "No personal training package" : null),
  unpaid_balance: (v, up) => (up && v > 0 ? "Has an unpaid balance" : null),
  no_show_rate: (v, up) => (up && v > 0.2 ? `Misses ${Math.round(v * 100)}% of booked classes` : null),
  plan_length_days: (v, up) => (up && v <= 31 ? "On a short (monthly) plan" : null),
};

/** Scores every current member of a gym and stores the results. */
export async function scoreGym(gymId: string) {
  const model = await loadModel(gymId);
  const h = await loadHistory(db, gymId);
  const members = await many(db, `SELECT id, start_date::text AS s, end_date::text AS e FROM member_overview
                                    WHERE gym_id = $1 AND archived_at IS NULL AND membership_id IS NOT NULL AND (status IN ('active','expiring') OR (status = 'expired' AND days_left >= -30))`, [gymId]);
  const todayNum = Math.floor(Date.now() / DAY);
  let n = 0;
  await db.query("DELETE FROM churn_scores WHERE gym_id = $1", [gymId]);
  for (const m of members) {
    const f = featuresAt(h, m.id, todayNum, m.e, m.s);
    const { score, contributions } = predict(model, f);
    const drivers = contributions.filter((c) => c.impact > 0.15).map((c) => c.feature);
    // "no visit in N days" already says "no visits in the last 2 weeks"
    const shown = f.days_since_last_visit >= 14 ? drivers.filter((d) => d !== "visits_last_14") : drivers;
    const reasons = shown.map((d) => REASONS[d](f[d], true)).filter(Boolean).slice(0, 3);
    await db.query(
      `INSERT INTO churn_scores (member_id, gym_id, score, factors, model, computed_at) VALUES ($1,$2,$3,$4,$5, now())`,
      [m.id, gymId, Math.round(score * 10000) / 10000, { reasons, features: f }, model.kind],
    );
    n++;
  }
  return { scored: n, model: model.kind, at: iso(new Date()) };
}
