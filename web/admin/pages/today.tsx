import React from "react";
import { get } from "../../shared/api.ts";
import { Empty, Icon, Loader, Status, useAsync } from "../../shared/ui.tsx";
import { Bars, Heatmap, Line } from "../../shared/charts.tsx";
import { WEEKDAYS, fmtDate, fmtTime, money, t } from "../../shared/i18n.ts";
import { Link, can, useApp } from "../app.tsx";

export function TodayPage() {
  const { me } = useApp();
  const state = useAsync(() => get("/api/dashboard"), []);
  const members = useAsync(() => get("/api/members?limit=1"), []);
  const hour = new Date().getHours();
  const hello = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{hello}, {me.user.name.split(" ")[0]}</h1>
          <p>{fmtDate(new Date(), { weekday: "long", day: "numeric", month: "long" })}</p>
        </div>
        <div className="row">
          <Link className="btn" to="/checkin"><Icon name="scan" />{t("Check-in")}</Link>
        </div>
      </div>
      <Loader state={state}>
        {(d: any) => {
          const k = d.kpi;
          const counts = members.data?.counts ?? {};
          const total = ["active", "expiring", "frozen", "expired"].reduce((s, x) => s + (counts[x] ?? 0), 0) || 1;
          const growth = k.revenue_last_month_same_period ? Math.round(((k.revenue_month - k.revenue_last_month_same_period) / k.revenue_last_month_same_period) * 100) : null;
          return (
            <>
              <section className="today-strip">
                <div className="stack">
                  <p className="headline-sentence">
                    <strong>{k.checkins_today}</strong> {k.checkins_today === 1 ? "check-in" : "check-ins"} so far today{d.shopToday?.sales > 0 && <>, <strong>{d.shopToday.sales}</strong> shop {d.shopToday.sales === 1 ? "sale" : "sales"}</>}{k.revenue_today != null && <> and <strong>{money(k.revenue_today)}</strong> collected</>}.{" "}
                    {k.expiring_7d > 0 ? <><strong>{k.expiring_7d}</strong> memberships end this week.</> : "No membership ends this week."}{" "}
                    {k.at_risk > 0 && <>{k.at_risk} members look likely to leave.</>}
                  </p>
                  <div>
                    <div className="membar" role="img" aria-label="Members by status">
                      {(["active", "expiring", "frozen", "expired"] as const).map((s) => counts[s] ? (
                        <span key={s} style={{ flex: counts[s] / total, background: `var(--plate-${{ active: "green", expiring: "yellow", frozen: "blue", expired: "red" }[s]})` }} title={`${t(s)}: ${counts[s]}`} />
                      ) : null)}
                    </div>
                    <div className="membar-legend">
                      {(["active", "expiring", "frozen", "expired"] as const).map((s) => (
                        <Link key={s} to={`/members?status=${s}`} style={{ textDecoration: "none" }}><Status s={s} label={`${counts[s] ?? 0} ${t(s)}`} /></Link>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="figures" style={{ gridTemplateColumns: "repeat(2, minmax(0,1fr))" }}>
                  <div className="figure" style={{ borderBottom: "1px solid var(--line-2)" }}>
                    <span className="label">Active members</span>
                    <span className="value num-display">{k.active_members}</span>
                    <span className="delta">{k.frozen_members} frozen</span>
                  </div>
                  <div className="figure" style={{ borderBottom: "1px solid var(--line-2)", borderInlineEnd: 0 }}>
                    <span className="label">Revenue this month</span>
                    <span className="value num-display">{k.revenue_month != null ? money(k.revenue_month) : "—"}</span>
                    <span className="delta">{growth != null ? `${growth >= 0 ? "+" : ""}${growth}% vs same days last month` : "Owner and managers only"}</span>
                  </div>
                  <div className="figure">
                    <span className="label">Renewal rate (60 days)</span>
                    <span className="value num-display">{k.renewal_rate_pct != null ? `${Math.round(k.renewal_rate_pct)}%` : "—"}</span>
                    <span className="delta">of memberships that ended</span>
                  </div>
                  <div className="figure" style={{ borderInlineEnd: 0 }}>
                    <span className="label">Unpaid balances</span>
                    <span className="value num-display">{money(k.outstanding_usd)}</span>
                    <Link className="delta" to="/members?balance=1">See who owes</Link>
                  </div>
                </div>
              </section>

              <div className="cols">
                <div className="stack">
                  <section className="panel">
                    <header><h2>Ending this week</h2><Link className="btn small ghost" to="/members?status=expiring">All</Link></header>
                    {d.expiring.length ? (
                      <div className="list">
                        {d.expiring.map((m: any) => (
                          <Link key={m.id} to={`/members/${m.id}`} style={{ textDecoration: "none" }}>
                            <span className="plate" data-s="expiring" />
                            <span className="grow who"><b>{m.first_name} {m.last_name}</b><small>{m.plan_name} · {m.days_left === 0 ? "ends today" : `${m.days_left} day(s) left`}</small></span>
                            {Number(m.balance_usd) > 0 && <span className="money-neg">{money(m.balance_usd)}</span>}
                            <span className="muted">{fmtDate(m.end_date)}</span>
                          </Link>
                        ))}
                      </div>
                    ) : <Empty title="No membership ends in the next 7 days." />}
                  </section>
                  {d.revenueMonths.length > 0 && (
                    <section className="panel">
                      <header><h2>Revenue and expenses, last 12 months</h2></header>
                      <div className="body">
                        <Bars title="Revenue and expenses by month" labels={d.revenueMonths.map((m: any) => fmtDate(m.month + "-15", { month: "short" }))}
                          series={[
                            { name: "Revenue", values: d.revenueMonths.map((m: any) => Number(m.revenue)), color: "var(--series-1)" },
                            { name: "Expenses", values: d.revenueMonths.map((m: any) => Number(m.expenses)), color: "var(--series-2)" },
                          ]} />
                      </div>
                    </section>
                  )}
                  <section className="panel">
                    <header><h2>When members come</h2><span className="muted">last 8 weeks</span></header>
                    <div className="body"><Heatmap cells={d.heat} days={WEEKDAYS.map((w) => t(w))} /></div>
                  </section>
                </div>
                <div className="stack">
                  <section className="panel">
                    <header><h2>Classes today</h2><Link className="btn small ghost" to="/classes">Schedule</Link></header>
                    {d.todayClasses.length ? (
                      <div className="list">
                        {d.todayClasses.map((c: any) => (
                          <div key={c.id}>
                            <span className="class-chip" style={{ background: c.color }} />
                            <span className="grow who"><b>{c.class_name}</b><small>{fmtTime(c.starts_at)}{c.coach_name ? ` · ${c.coach_name}` : ""}</small></span>
                            <span className="num-display" style={{ fontSize: "1.2rem" }}>{c.booked}/{c.capacity}</span>
                          </div>
                        ))}
                      </div>
                    ) : <Empty title="No classes today." />}
                  </section>
                  <section className="panel">
                    <header><h2>Check-ins, last 30 days</h2></header>
                    <div className="body">
                      <Line title="Daily check-ins" labels={d.daily.map((x: any) => fmtDate(x.day))} values={d.daily.map((x: any) => x.checkins)} />
                      <p className="muted" style={{ marginTop: 6, fontSize: "0.85rem" }}>Average {k.checkins_avg_30d} per day.</p>
                    </div>
                  </section>
                  {d.lowStock?.length > 0 && (
                    <section className="panel">
                      <header><h2>Shop: running low</h2><Link className="btn small ghost" to="/shop">Shop</Link></header>
                      <div className="list">
                        {d.lowStock.slice(0, 6).map((p: any) => (
                          <div key={p.id}><span className="plate" data-s={p.stock <= 0 ? "denied" : "warn"} /><span className="grow">{p.name}</span><b>{p.stock <= 0 ? "out" : `${p.stock} left`}</b></div>
                        ))}
                      </div>
                    </section>
                  )}
                  {d.birthdays.length > 0 && (
                    <section className="panel">
                      <header><h2>Birthdays today</h2></header>
                      <div className="list">
                        {d.birthdays.map((b: any) => (
                          <Link key={b.id} to={`/members/${b.id}`} style={{ textDecoration: "none" }}>
                            <span className="grow">{b.first_name} {b.last_name}</span>
                            {b.phone && <a className="btn small" href={`https://wa.me/${b.phone.replace(/\D/g, "")}?text=${encodeURIComponent(`Happy birthday ${b.first_name}! 🎉 From all of us at ${me.gym.name}`)}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}><Icon name="whatsapp" />Wish</a>}
                          </Link>
                        ))}
                      </div>
                    </section>
                  )}
                  {can(me, "owner", "manager") && k.at_risk > 0 && (
                    <section className="panel">
                      <header><h2>At risk of leaving</h2><Link className="btn small ghost" to="/insights">Insights</Link></header>
                      <div className="body stack-s">
                        <p><b className="num-display" style={{ fontSize: "1.6rem" }}>{k.at_risk}</b> members, about <b>{money(k.mrr_at_risk)}</b> per month of revenue.</p>
                        <p className="muted">A personal WhatsApp this week is the cheapest way to keep them.</p>
                      </div>
                    </section>
                  )}
                </div>
              </div>
            </>
          );
        }}
      </Loader>
    </div>
  );
}
