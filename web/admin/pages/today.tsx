import React from "react";
import { get } from "../../shared/api.ts";
import { Empty, Icon, Loader, Status, tx, useAsync, waLink } from "../../shared/ui.tsx";
import { Bars, Heatmap, Line } from "../../shared/charts.tsx";
import { WEEKDAYS, fmtDate, fmtTime, money, t } from "../../shared/i18n.ts";
import { Link, can, moduleOn, useApp } from "../app.tsx";

/** The five things that turn an empty account into a gym that runs on GMS. Disappears once all are done. */
function GettingStarted({ setup }: { setup?: Record<string, boolean> }) {
  if (!setup) return null;
  const steps: [string, string, string][] = [
    ["logo", "Add your logo", "/settings"],
    ["prices", "Check your prices", "/settings?tab=plans"],
    ["members", "Add or import your members", "/members"],
    ["payment", "Record a first payment", "/members"],
    ["checkin", "Check a first member in", "/checkin"],
  ];
  const left = steps.filter(([k]) => !setup[k]);
  if (!left.length) return null;
  return (
    <section className="start" aria-label={t("Getting started")}>
      <div><b>{t("Getting started")}</b><span>{t("{a} of {b} done", { a: steps.length - left.length, b: steps.length })}</span></div>
      <ul>
        {steps.map(([k, label, to]) => (
          <li key={k} data-done={setup[k] ? "" : undefined}>{setup[k] ? <span><Icon name="check" />{t(label)}</span> : <Link to={to}>{t(label)}</Link>}</li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Today answers one question: what should I do now?
 * A sentence for the day, then at most three things to act on, each with the people
 * concerned and a WhatsApp message ready to send. Charts sit folded at the bottom.
 */
export function TodayPage() {
  const { me } = useApp();
  const gymName = me.gym?.name ?? "";
  const state = useAsync(() => get("/api/dashboard"), []);
  const owing = useAsync(() => get("/api/members?balance=1&sort=balance&limit=4"), []);
  const away = useAsync(() => get("/api/members?risk=1&sort=risk&limit=4"), []);
  const daysLeft = (n: number) => (n <= 0 ? t("Ends today") : n === 1 ? t("1 day left") : t("{n} days left", { n }));
  const first = (m: any) => m.first_name;
  const msg = {
    renew: (m: any) => t("Hi {name}, your membership at {gym} ends on {date}. Pass by any time to renew.", { name: first(m), gym: gymName, date: fmtDate(m.end_date) }),
    owes: (m: any) => t("Hi {name}, a small reminder: {amount} is still open on your membership at {gym}. Thank you!", { name: first(m), gym: gymName, amount: money(m.balance_usd) }),
    away: (m: any) => t("Hi {name}, we haven't seen you at {gym} for a while. Everything okay? We'd love to see you back.", { name: first(m), gym: gymName }),
  };
  const People = ({ rows, total, text, more }: { rows: any[]; total: number; text: (m: any) => string; more: string }) => (
    <div className="todo-people">
      {rows.map((m) => (
        <span key={m.id} className="person">
          <Link to={`/members/${m.id}`}>{m.first_name} {m.last_name}</Link>
          {waLink(m.phone, text(m)) && <a href={waLink(m.phone, text(m))} target="_blank" rel="noreferrer" aria-label={t("Message {name} on WhatsApp", { name: m.first_name })}><Icon name="whatsapp" /></a>}
        </span>
      ))}
      {total > rows.length && <Link className="person-more" to={more}>{t("and {n} more", { n: total - rows.length })}</Link>}
    </div>
  );
  return (
    <div className="page">
      <Loader state={state}>
        {(d: any) => {
          const k = d.kpi;
          const counts = owing.data?.counts ?? {};
          const total = ["active", "expiring", "frozen", "expired"].reduce((s, x) => s + (counts[x] ?? 0), 0) || 1;
          const owingRows: any[] = owing.data?.rows ?? [];
          const awayRows: any[] = away.data?.rows ?? [];
          const todos: React.ReactNode[] = [];
          if (Number(k.outstanding_usd) > 0 && owingRows.length) {
            todos.push(
              <li key="owe">
                <div><h3>{tx("Collect {amount} still owed", { amount: money(k.outstanding_usd) })}</h3><p>{t("Ask at their next visit, or send a reminder now.")}</p></div>
                <People rows={owingRows} total={Number(owing.data?.total ?? 0)} text={msg.owes} more="/members?balance=1" />
              </li>,
            );
          }
          if (d.expiring.length) {
            todos.push(
              <li key="renew">
                <div><h3>{tx("{n} memberships end this week", { n: k.expiring_7d || d.expiring.length })}</h3><p>{t("A reminder before the last day is what brings most people back.")}</p></div>
                <People rows={d.expiring.slice(0, 4)} total={d.expiring.length} text={msg.renew} more="/members?status=expiring" />
              </li>,
            );
          }
          if (awayRows.length) {
            todos.push(
              <li key="away">
                <div><h3>{tx("{n} members stopped coming", { n: Number(away.data?.total ?? awayRows.length) })}</h3><p>{t("A personal message this week is the cheapest way to keep them.")}</p></div>
                <People rows={awayRows} total={Number(away.data?.total ?? 0)} text={msg.away} more="/members?risk=1" />
              </li>,
            );
          }
          const showMoney = k.revenue_month != null;
          const growth = k.revenue_last_month_same_period ? Math.round(((k.revenue_month - k.revenue_last_month_same_period) / k.revenue_last_month_same_period) * 100) : null;
          return (
            <>
              <header className="today-head">
                <p className="today-date">{fmtDate(new Date(), { weekday: "long", day: "numeric", month: "long" })}</p>
                <h1 className="headline-sentence">
                  {k.revenue_today != null
                    ? tx("{n} check-ins so far today and {amount} collected.", { n: k.checkins_today, amount: money(k.revenue_today) })
                    : tx("{n} check-ins so far today.", { n: k.checkins_today })}
                </h1>
              </header>

              {can(me, "owner", "manager") && <GettingStarted setup={me.gym?.setup} />}

              <section className="todo" aria-labelledby="todo-h">
                <h2 id="todo-h">{t("To do today")}</h2>
                {todos.length ? <ol>{todos}</ol> : <p className="todo-none">{t("Nothing urgent. Everyone is paid up and nobody is about to leave.")}</p>}
              </section>

              <section className="figures" style={{ gridTemplateColumns: `repeat(${showMoney ? 3 : 2}, minmax(0,1fr))` }}>
                <div className="figure">
                  <span className="label">{t("Active members")}</span>
                  <span className="value num-display">{k.active_members}</span>
                  <div className="membar" role="img" aria-label={t("Members by status")}>
                    {(["active", "expiring", "frozen", "expired"] as const).map((s) => counts[s] ? (
                      <span key={s} style={{ flex: counts[s] / total, background: `var(--plate-${{ active: "green", expiring: "yellow", frozen: "blue", expired: "red" }[s]})` }} title={`${t(s)}: ${counts[s]}`} />
                    ) : null)}
                  </div>
                  <div className="membar-legend">
                    {(["expiring", "frozen", "expired"] as const).filter((s) => counts[s]).map((s) => (
                      <Link key={s} to={`/members?status=${s}`} style={{ textDecoration: "none" }}><Status s={s} label={`${counts[s]} ${t(s)}`} /></Link>
                    ))}
                  </div>
                </div>
                <div className="figure">
                  <span className="label">{t("Still owed to you")}</span>
                  <span className="value num-display">{money(k.outstanding_usd)}</span>
                  <Link className="delta" to="/members?balance=1">{t("See who owes")}</Link>
                </div>
                {showMoney && (
                  <div className="figure">
                    <span className="label">{t("Collected this month")}</span>
                    <span className="value num-display">{money(k.revenue_month)}</span>
                    {growth != null && <span className="delta">{t("{pct} compared with the same days last month", { pct: `${growth >= 0 ? "+" : "−"}${Math.abs(growth)}%` })}</span>}
                  </div>
                )}
              </section>

              <div className="cols">
                <section className="panel">
                  <header><h2>{t("Ending this week")}<span className="muted">{d.expiring.length}</span></h2><Link className="btn small ghost" to="/members?status=expiring">{t("See all")}</Link></header>
                  {d.expiring.length ? (
                    <div className="list">
                      {d.expiring.map((m: any) => (
                        <Link key={m.id} to={`/members/${m.id}`} style={{ textDecoration: "none" }}>
                          <span className="plate" data-s="expiring" />
                          <span className="grow who"><b>{m.first_name} {m.last_name}</b><small>{m.plan_name}</small></span>
                          {Number(m.balance_usd) > 0 && <span className="money-neg">{t("{amount} owed", { amount: money(m.balance_usd) })}</span>}
                          <span className="left" data-today={m.days_left <= 0 ? "" : undefined}>{daysLeft(m.days_left)}</span>
                        </Link>
                      ))}
                    </div>
                  ) : <Empty title={t("No membership ends in the next 7 days")} />}
                </section>
                <div className="stack">
                  {moduleOn(me, "classes") && (
                    <section className="panel">
                      <header><h2>{t("Classes today")}</h2><Link className="btn small ghost" to="/classes">{t("Schedule")}</Link></header>
                      {d.todayClasses.length ? (
                        <div className="list">
                          {d.todayClasses.map((c: any) => (
                            <div key={c.id}>
                              <span className="class-chip" style={{ background: c.color }} />
                              <span className="grow who"><b>{c.class_name}</b><small>{fmtTime(c.starts_at)}{c.coach_name ? `, ${c.coach_name}` : ""}</small></span>
                              <span className="num-display tally">{c.booked}<small>/ {c.capacity}</small></span>
                            </div>
                          ))}
                        </div>
                      ) : <Empty title={t("No classes today")} />}
                    </section>
                  )}
                  {d.birthdays.length > 0 && (
                    <section className="panel">
                      <header><h2>{t("Birthdays today")}</h2></header>
                      <div className="list">
                        {d.birthdays.map((b: any) => (
                          <div key={b.id}>
                            <Link className="grow" to={`/members/${b.id}`}>{b.first_name} {b.last_name}</Link>
                            {waLink(b.phone, "") && <a className="btn small" href={waLink(b.phone, t("Happy birthday {name}! From all of us at {gym}.", { name: b.first_name, gym: gymName }))} target="_blank" rel="noreferrer"><Icon name="whatsapp" />{t("Wish")}</a>}
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                  {moduleOn(me, "shop") && d.lowStock?.length > 0 && (
                    <section className="panel">
                      <header><h2>{t("Low stock")}</h2><Link className="btn small ghost" to="/shop">{t("Shop")}</Link></header>
                      <div className="list">
                        {d.lowStock.slice(0, 6).map((p: any) => (
                          <div key={p.id}><span className="plate" data-s={p.stock <= 0 ? "denied" : "warn"} /><span className="grow">{p.name}</span><span className={p.stock <= 0 ? "money-neg" : "ink-2"}>{p.stock <= 0 ? t("Out of stock") : t("{n} left", { n: p.stock })}</span></div>
                        ))}
                      </div>
                    </section>
                  )}
                </div>
              </div>

              <details className="trends">
                <summary>{t("Charts: when members come, and how the months compare")}</summary>
                <div className="cols">
                  <section className="panel">
                    <header><h2>{t("When members come")}</h2><span className="muted">{t("last 8 weeks")}</span></header>
                    <div className="body"><Heatmap cells={d.heat} days={WEEKDAYS.map((w) => t(w))} /></div>
                  </section>
                  <section className="panel">
                    <header><h2>{t("Check-ins")}</h2><span className="muted">{t("last 30 days")}</span></header>
                    <div className="body">
                      <Line title={t("Daily check-ins")} height={140} labels={d.daily.map((x: any) => fmtDate(x.day))} values={d.daily.map((x: any) => x.checkins)} />
                      <p className="panel-note">{t("{avg} a day on average", { avg: k.checkins_avg_30d })}</p>
                    </div>
                  </section>
                </div>
                {can(me, "owner", "manager") && d.revenueMonths.length > 0 && (
                  <section className="panel">
                    <header><h2>{moduleOn(me, "expenses") ? t("Money in and money out") : t("Money in")}</h2><span className="muted">{t("last 12 months")}</span></header>
                    <div className="body">
                      <Bars title={t("Money in and money out by month")} height={240} highlight={d.revenueMonths.length - 1} labels={d.revenueMonths.map((m: any) => fmtDate(m.month + "-15", { month: "short" }))}
                        series={[
                          { name: t("Money in"), values: d.revenueMonths.map((m: any) => Number(m.revenue)), color: "var(--series-1)" },
                          ...(moduleOn(me, "expenses") ? [{ name: t("Money out"), values: d.revenueMonths.map((m: any) => Number(m.expenses)), color: "var(--series-2)" }] : []),
                        ]} />
                    </div>
                  </section>
                )}
              </details>
            </>
          );
        }}
      </Loader>
    </div>
  );
}
