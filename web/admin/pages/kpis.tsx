/**
 * Key numbers: the health of the gym in one screen.
 * Top: what to do now (ranked by money at stake). Then the headline KPIs, then every KPI
 * by theme, each rated against fitness-industry benchmarks with the reason it matters.
 */
import React, { useState } from "react";
import { get } from "../../shared/api.ts";
import { Icon, Loader, Segmented, useAsync } from "../../shared/ui.tsx";
import { money, t } from "../../shared/i18n.ts";
import { Link } from "../app.tsx";

type Kpi = {
  key: string; group: string; label: string; value: number | null; prev: number | null; unit: string;
  higherIsBetter: boolean; status: "good" | "watch" | "bad" | "info"; target: string; why: string; headline?: boolean;
};

const GROUPS: { key: string; title: string; sub: string }[] = [
  { key: "members", title: "Members & retention", sub: "Are people joining, staying and coming back?" },
  { key: "money", title: "Money", sub: "What comes in, what's left, what each member is worth" },
  { key: "engagement", title: "Engagement & operations", sub: "How much members use the gym, classes and coaches" },
  { key: "ai", title: "AI predictions", sub: "What the churn model expects next, from your own history" },
];

export function fmtKpi(v: number | null, unit: string) {
  if (v == null) return "—";
  if (unit === "usd") return money(Math.abs(v) >= 100 ? Math.round(v) : v, "USD");
  if (unit === "pct") return `${v}%`;
  if (unit === "months") return `${v} mo`;
  if (unit === "per_week") return `${v}/wk`;
  return Number.isInteger(v) ? v.toLocaleString("en-US") : String(v);
}

function Trend({ k }: { k: Kpi }) {
  if (k.value == null || k.prev == null) return <span className="kpi-trend muted">{k.prev == null && k.group !== "ai" ? "no earlier data" : ""}</span>;
  const diff = k.value - k.prev;
  if (Math.abs(diff) < 1e-9) return <span className="kpi-trend muted">= same as before</span>;
  const better = diff > 0 === k.higherIsBetter;
  const rel = k.unit === "pct" ? `${diff > 0 ? "+" : ""}${Math.round(diff * 10) / 10} pts` : k.prev > 0 && k.value >= 0 ? `${diff > 0 ? "+" : ""}${Math.round((diff / Math.abs(k.prev)) * 100)}%` : `${diff > 0 ? "+" : ""}${fmtKpi(diff, k.unit)}`;
  return <span className={`kpi-trend ${better ? "up" : "down"}`} title={`Before: ${fmtKpi(k.prev, k.unit)}`}>{diff > 0 ? "▲" : "▼"} {rel}</span>;
}

const STATUS_LABEL = { good: "On track", watch: "Watch", bad: "Act now", info: "" } as const;
const PLATE = { good: "ok", watch: "warn", bad: "denied", info: "info" } as const;

function KpiTile({ k }: { k: Kpi; key?: React.Key }) {
  return (
    <div className="kpi-tile" data-s={k.status}>
      <div className="kpi-top"><span className="label">{t(k.label)}</span>{k.status !== "info" && <span className="kpi-status"><span className="plate" data-s={PLATE[k.status]} />{STATUS_LABEL[k.status]}</span>}</div>
      <div className="value num-display">{fmtKpi(k.value, k.unit)}</div>
      <Trend k={k} />
      <p className="kpi-why">{k.why}</p>
      <small className="muted">Target: {k.target}</small>
    </div>
  );
}

function KpiRow({ k }: { k: Kpi; key?: React.Key }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={open ? "open" : ""}>
      <button className="kpi-row" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="plate" data-s={PLATE[k.status]} title={STATUS_LABEL[k.status]} />
        <span className="kpi-name">{t(k.label)}</span>
        <span className="kpi-val num-display">{fmtKpi(k.value, k.unit)}</span>
        <Trend k={k} />
        <span className="kpi-target muted">{k.target}</span>
        <Icon name="chevron" width={16} height={16} className="kpi-chev" />
      </button>
      {open && <p className="kpi-why-row">{k.why}{k.prev != null && <> Before: <b>{fmtKpi(k.prev, k.unit)}</b>.</>}</p>}
    </li>
  );
}

export function KpisView() {
  const [period, setPeriod] = useState<"month" | "last_month" | "90d">("month");
  const state = useAsync(() => get(`/api/kpis?period=${period}`), [period]);
  return (
    <div className="stack">
      <div className="spread">
        <p className="ink-2" style={{ maxWidth: "70ch", margin: 0 }}>Each number is compared with the same number of days just before, and rated against what healthy gyms reach. Click a row to see why it matters.</p>
        <Segmented label="Period" value={period} onChange={setPeriod} options={[{ value: "month", label: "This month" }, { value: "last_month", label: "Last month" }, { value: "90d", label: "Last 90 days" }]} />
      </div>
      <Loader state={state}>
        {(d: any) => {
          const kpis: Kpi[] = d.kpis;
          const head = kpis.filter((k) => k.headline);
          const counts = { bad: kpis.filter((k) => k.status === "bad").length, watch: kpis.filter((k) => k.status === "watch").length, good: kpis.filter((k) => k.status === "good").length };
          return (
            <>
              <section className="panel focus">
                <header>
                  <h2><Icon name="spark" width={18} height={18} style={{ verticalAlign: -3, marginInlineEnd: 6 }} />Focus now</h2>
                  <span className="muted">{counts.bad} to act on · {counts.watch} to watch · {counts.good} on track</span>
                </header>
                {d.focus.length ? (
                  <ol className="focus-list">
                    {d.focus.map((f: any, i: number) => (
                      <li key={f.key}>
                        <span className="focus-n">{i + 1}</span>
                        <div className="grow">
                          <b>{f.title}</b>
                          <p>{f.detail}</p>
                          {f.members?.length > 0 && (
                            <div className="focus-people">{f.members.map((m: any) => <Link key={m.id} to={`/members/${m.id}`} className="chip">{m.name}</Link>)}</div>
                          )}
                        </div>
                        {f.impact_usd ? <span className="focus-impact num-display" title="Money at stake">{money(f.impact_usd)}</span> : null}
                        <Link to={f.link} className="btn small">Open</Link>
                      </li>
                    ))}
                  </ol>
                ) : <div className="body muted">Nothing urgent. Well done.</div>}
              </section>

              <div className="kpi-tiles">{head.map((k) => <KpiTile key={k.key} k={k} />)}</div>

              {GROUPS.map((g) => (
                <section key={g.key} className="panel">
                  <header><div><h2>{g.title}</h2><small className="muted">{g.sub}</small></div></header>
                  <ul className="kpi-list">{kpis.filter((k) => k.group === g.key).map((k) => <KpiRow key={k.key} k={k} />)}</ul>
                </section>
              ))}
              <p className="muted" style={{ fontSize: "var(--step--1)" }}>Period {d.from} → {d.to}, compared with {d.previous.from} → {d.previous.to}. Benchmarks: members who train 2+ times a week are about half as likely to cancel; the average membership lasts 7–8 months; gyms lose 30–40% of members a year.</p>
            </>
          );
        }}
      </Loader>
    </div>
  );
}
