import React, { useState } from "react";
import { del, get, post, put } from "../../shared/api.ts";
import { Empty, Field, Icon, Loader, Modal, Tabs, toast, useAction, useAsync, useDebounced } from "../../shared/ui.tsx";
import { fmtDate, fmtTime, money, t } from "../../shared/i18n.ts";
import { Link, can, useApp } from "../app.tsx";
import { PaymentFields, emptyPayment, toPaymentBody } from "./forms.tsx";
import { openReceipt } from "../receipt.tsx";

/** A coach's own month: sessions, classes and PT earnings (never the gym's figures). */
function MyMonth() {
  const state = useAsync(() => get("/api/reports/coaches"), []);
  const r = state.data?.[0];
  if (!r) return null;
  return (
    <div className="figures">
      <div className="figure"><span className="label">{t("PT sessions done this month")}</span><span className="value num-display">{r.pt_done}</span></div>
      <div className="figure"><span className="label">{t("Classes taught")}</span><span className="value num-display">{r.classes_taught}</span></div>
      <div className="figure"><span className="label">{t("Active PT clients")}</span><span className="value num-display">{r.active_clients}</span></div>
      <div className="figure"><span className="label">{t("Your PT sales this month")}</span><span className="value num-display">{money(r.pt_revenue)}</span></div>
      {Number(r.commission_pct) > 0 && <div className="figure"><span className="label">{t("Your commission (")}{Number(r.commission_pct)}%)</span><span className="value num-display">{money(r.commission_usd)}</span></div>}
    </div>
  );
}

export function CoachingPage() {
  const { me } = useApp();
  const [tab, setTab] = useState<"sessions" | "packages" | "availability">("sessions");
  const sessions = useAsync(() => get("/api/pt/sessions"), [tab]);
  const packages = useAsync(() => get("/api/pt/packages"), [tab]);
  const [newPkg, setNewPkg] = useState(false);
  const [plan, setPlan] = useState<any>(null);
  const { run } = useAction();
  const mark = async (id: string, status: string) => { await run(() => put(`/api/pt/sessions/${id}`, { status })); sessions.reload(); packages.reload(); };
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{t("Personal training")}</h1><p>{me.user.role === "coach" ? t("Your clients and sessions.") : t("Packages, sessions and coach performance.")}</p></div>
        {can(me, "owner", "manager", "reception") && <button className="btn primary" onClick={() => setNewPkg(true)}><Icon name="plus" />{t("Sell a PT package")}</button>}
      </div>
      {me.user.role === "coach" && <MyMonth />}
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "sessions", label: t("Sessions") }, { value: "packages", label: t("Packages") }, { value: "availability", label: me.user.role === "coach" ? "My hours" : "Coach hours" }]} />
      {tab === "availability" && <Availability />}
      {tab === "sessions" && (
        <Loader state={sessions}>
          {(list: any[]) => list.length ? (
            <div className="table-wrap"><table className="data">
              <thead><tr><th>{t("When")}</th><th>{t("Client")}</th><th>{t("Coach")}</th><th>{t("Package")}</th><th /></tr></thead>
              <tbody>{list.map((s) => (
                <tr key={s.id}>
                  <td>{fmtDate(s.starts_at, { weekday: "short", day: "numeric", month: "short" })} {fmtTime(s.starts_at)}</td>
                  <td><Link to={`/members/${s.member_id}`}>{s.first_name} {s.last_name}</Link></td>
                  <td>{s.coach_name ?? "—"}</td>
                  <td>{s.title} <small className="muted">{s.sessions_used}/{s.sessions_total} · {s.duration_min} min{s.booked_by === "member" ? t(" · booked in the app") : ""}</small></td>
                  <td className="r">{s.status === "scheduled" ? (
                    <><button className="btn small" onClick={() => mark(s.id, "done")}><Icon name="check" />{t("Done")}</button>{" "}
                      <button className="btn small" onClick={() => mark(s.id, "no_show")}>{t("No-show")}</button>{" "}
                      <button className="btn small ghost" onClick={() => mark(s.id, "cancelled")}>{t("Cancel")}</button></>
                  ) : <span className="tag">{s.status.replace("_", " ")}</span>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : <Empty title={t("No sessions planned.")} >{t("Plan a session from a package in the Packages tab.")}</Empty>}
        </Loader>
      )}
      {tab === "packages" && (
        <Loader state={packages}>
          {(list: any[]) => list.length ? (
            <div className="table-wrap"><table className="data">
              <thead><tr><th>{t("Client")}</th><th>{t("Package")}</th><th>{t("Coach")}</th><th>{t("Used")}</th><th className="r">{t("Paid")}</th><th /></tr></thead>
              <tbody>{list.map((p) => (
                <tr key={p.id}>
                  <td><Link to={`/members/${p.member_id}`}>{p.first_name} {p.last_name}</Link></td>
                  <td>{p.title}{p.expires_on && <small className="muted"> {t("· until")}{" "}{fmtDate(p.expires_on)}</small>}</td>
                  <td>{p.coach_name ?? "—"}</td>
                  <td><span className="num-display" style={{ fontSize: "1.15rem" }}>{p.sessions_used}/{p.sessions_total}</span></td>
                  <td className="r">{money(p.paid_usd)} <small className="muted">/ {money(p.price, p.currency)}</small></td>
                  <td className="r">{p.sessions_used < p.sessions_total && <button className="btn small" onClick={() => setPlan(p)}>{t("Plan a session")}</button>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : <Empty title={t("No PT packages yet.")} />}
        </Loader>
      )}
      <NewPackageModal open={newPkg} onClose={() => { setNewPkg(false); packages.reload(); }} />
      {plan && <PlanSessionModal p={plan} onClose={() => { setPlan(null); sessions.reload(); }} />}
    </div>
  );
}

function NewPackageModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const staff = useAsync(() => get("/api/staff"), []);
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const found = useAsync(() => (dq.length >= 2 ? get(`/api/members?q=${encodeURIComponent(dq)}&limit=5`) : Promise.resolve({ rows: [] })), [dq]);
  const [member, setMember] = useState<any>(null);
  const [f, setF] = useState({ coach_id: "", title: t("10 PT sessions"), sessions_total: "10", session_min: "60", price: "150", currency: "USD" as "USD" | "LBP", expires_on: "" });
  const [pay, setPay] = useState(emptyPayment());
  const { busy, run } = useAction();
  return (
    <Modal title={t("Sell a PT package")} open={open} onClose={onClose} wide
      footer={<button className="btn primary" disabled={busy || !member} onClick={async () => {
        const r = await run(() => post("/api/pt/packages", { member_id: member.id, coach_id: f.coach_id || null, title: f.title, sessions_total: Number(f.sessions_total), session_min: Number(f.session_min), price: Number(f.price), currency: f.currency, expires_on: f.expires_on || null, payment: toPaymentBody(pay) }), "Package sold");
        if (r) { setMember(null); onClose(); if (r.payment) openReceipt(r.payment.id); }
      }}>{t("Confirm sale")}</button>}>
      {!member ? (
        <Field label={t("Member")}><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Name, phone or number")} autoFocus /></Field>
      ) : <div className="spread"><b>{member.first_name} {member.last_name}</b><button className="btn small ghost" onClick={() => setMember(null)}>{t("Change")}</button></div>}
      {!member && found.data?.rows?.map((m: any) => <button key={m.id} className="btn ghost" style={{ justifyContent: "flex-start" }} onClick={() => setMember(m)}>{m.first_name} {m.last_name} <small className="muted">#{m.code}</small></button>)}
      <div className="grid-2">
        <Field label={t("Coach")}><select className="input" value={f.coach_id} onChange={(e) => setF({ ...f, coach_id: e.target.value })}><option value="">—</option>{staff.data?.filter((u: any) => u.role !== "reception").map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
        <Field label={t("Title")}><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label={t("Sessions")}><input className="input" type="number" value={f.sessions_total} onChange={(e) => setF({ ...f, sessions_total: e.target.value })} /></Field>
        <Field label={t("Minutes per session")} hint={t("Members book slots of this length in the app")}><select className="input" value={f.session_min} onChange={(e) => setF({ ...f, session_min: e.target.value })}>{[30, 45, 60, 75, 90].map((m) => <option key={m} value={m}>{m} min</option>)}</select></Field>
        <Field label={`Price (${f.currency})`}><input className="input" inputMode="decimal" value={f.price} onChange={(e) => { setF({ ...f, price: e.target.value }); setPay({ ...pay, amount: e.target.value }); }} /></Field>
        <Field label={t("Valid until (optional)")}><input className="input" type="date" value={f.expires_on} onChange={(e) => setF({ ...f, expires_on: e.target.value })} /></Field>
      </div>
      <b>{t("Payment now")}</b>
      <PaymentFields value={pay} onChange={setPay} suggestUsd={Number(f.price)} />
    </Modal>
  );
}

function PlanSessionModal({ p, onClose }: { p: any; onClose: () => void }) {
  const [when, setWhen] = useState("");
  const { busy, run } = useAction();
  return (
    <Modal title={`Plan a session · ${p.first_name}`} open onClose={onClose}
      footer={<button className="btn primary" disabled={busy || !when} onClick={async () => {
        const r = await run(() => post("/api/pt/sessions", { package_id: p.id, starts_at: new Date(when).toISOString() }), "Session planned");
        if (r) onClose();
      }}>{t("Plan session")}</button>}>
      <Field label={t("Date and time")}><input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
    </Modal>
  );
}

// ---------------- coach availability (for booking from the member app) ----------------

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

function Availability() {
  const { me } = useApp();
  const boss = can(me, "owner", "manager");
  const [coachId, setCoachId] = useState<string>("");
  const state = useAsync(() => get(`/api/pt/availability${coachId ? `?coach_id=${coachId}` : ""}`), [coachId]);
  const [draft, setDraft] = useState<any[] | null>(null);
  const [off, setOff] = useState({ day: "", from: "", to: "", note: "" });
  const { busy, run } = useAction();
  return (
    <Loader state={state}>
      {(d: any) => {
        if (!d.coach_id) return <Empty title={t("No coach yet.")}>{t("Add a coach in Settings → Team, then set their hours here.")}</Empty>;
        const windows: any[] = draft ?? d.windows;
        const dirty = draft != null;
        const update = (list: any[]) => setDraft(list);
        const hours = windows.reduce((s, w) => s + (toMin(w.end_time) - toMin(w.start_time)) / 60, 0);
        return (
          <div className="stack">
            <div className="spread">
              <div className="row">
                {boss && d.coaches.length > 1 && (
                  <select className="input" value={d.coach_id} onChange={(e) => { setDraft(null); setCoachId(e.target.value); }} aria-label={t("Coach")} style={{ minWidth: 200 }}>
                    {d.coaches.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}
                <span className="muted">{Math.round(hours)} {t("h a week ·")}{" "}{d.upcoming} {t("sessions booked ahead")}</span>
              </div>
              <div className="row">
                {dirty && <button className="btn ghost" onClick={() => setDraft(null)}>{t("Undo")}</button>}
                <button className="btn primary" disabled={!dirty || busy} onClick={async () => {
                  if (await run(() => put(`/api/pt/availability/${d.coach_id}`, { windows: windows.map(({ weekday, start_time, end_time }) => ({ weekday, start_time, end_time })) }), "Hours saved")) { setDraft(null); state.reload(); }
                }}>{t("Save")}</button>
              </div>
            </div>
            <p className="ink-2" style={{ margin: 0 }}>{t("Members with a PT package see their coach's free times in these hours, minus sessions already booked, classes the coach teaches and time off.")}</p>
            <section className="panel">
              <div className="week-hours">
                {DAY_ORDER.map((wd) => {
                  const list = windows.map((w, i) => ({ ...w, i })).filter((w) => w.weekday === wd).sort((a, b) => a.start_time.localeCompare(b.start_time));
                  return (
                    <div key={wd} className="day-row">
                      <b>{t(DAYS[wd])}</b>
                      <div className="ranges">
                        {list.length === 0 && <span className="muted">{t("Not available")}</span>}
                        {list.map((w) => (
                          <span key={w.i} className="range">
                            <input type="time" className="input" value={w.start_time} step={900} onChange={(e) => update(windows.map((x, j) => (j === w.i ? { ...x, start_time: e.target.value } : x)))} aria-label={t("From")} />
                            <span>–</span>
                            <input type="time" className="input" value={w.end_time} step={900} onChange={(e) => update(windows.map((x, j) => (j === w.i ? { ...x, end_time: e.target.value } : x)))} aria-label={t("To")} />
                            <button className="btn small ghost" onClick={() => update(windows.filter((_, j) => j !== w.i))} aria-label={t("Remove")}><Icon name="x" /></button>
                          </span>
                        ))}
                      </div>
                      <div className="row">
                        <button className="btn small" onClick={() => update([...windows, { weekday: wd, start_time: list.length ? "16:00" : "08:00", end_time: list.length ? "20:00" : "12:00" }])}><Icon name="plus" />{t("Add")}</button>
                        {list.length > 0 && wd !== 0 && <button className="btn small ghost" title={t("Copy to the other weekdays")} onClick={() => {
                          const others = [1, 2, 3, 4, 5].filter((x) => x !== wd);
                          update([...windows.filter((w) => !others.includes(w.weekday)), ...others.flatMap((x) => list.map((w) => ({ weekday: x, start_time: w.start_time, end_time: w.end_time })))]);
                        }}>{t("Copy to Mon–Fri")}</button>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
            <section className="panel">
              <header><h2>{t("Time off")}</h2><span className="muted">{t("Holidays, a blocked afternoon")}</span></header>
              <div className="body stack">
                {d.timeOff.length > 0 && (
                  <div className="list">{d.timeOff.map((o: any) => (
                    <div key={o.id}><span className="grow">{fmtDate(o.starts_at, { weekday: "short", day: "numeric", month: "short" })} {fmtTime(o.starts_at)} → {fmtDate(o.ends_at, { weekday: "short", day: "numeric", month: "short" })} {fmtTime(o.ends_at)}{o.note ? <small className="muted"> · {o.note}</small> : null}</span>
                      <button className="btn small ghost" onClick={async () => { if (await run(() => del(`/api/pt/time-off/${o.id}`), "Removed")) state.reload(); }}>{t("Remove")}</button></div>
                  ))}</div>
                )}
                <form className="row" style={{ flexWrap: "wrap" }} onSubmit={async (e) => {
                  e.preventDefault();
                  const starts = new Date(`${off.day}T${off.from || "00:00"}`), ends = new Date(`${off.day}T${off.to || "23:59"}`);
                  const r = await run(() => post("/api/pt/time-off", { coach_id: d.coach_id, starts_at: starts.toISOString(), ends_at: ends.toISOString(), note: off.note || null }), "Time off added");
                  if (r) { if (r.sessions_to_move) toast(`${r.sessions_to_move} session(s) already booked in that time: move them in Sessions`, "error"); setOff({ day: "", from: "", to: "", note: "" }); state.reload(); }
                }}>
                  <input className="input" type="date" value={off.day} onChange={(e) => setOff({ ...off, day: e.target.value })} required aria-label={t("Day")} style={{ width: 160 }} />
                  <input className="input" type="time" value={off.from} onChange={(e) => setOff({ ...off, from: e.target.value })} aria-label={t("From (empty = all day)")} style={{ width: 120 }} />
                  <input className="input" type="time" value={off.to} onChange={(e) => setOff({ ...off, to: e.target.value })} aria-label={t("To")} style={{ width: 120 }} />
                  <input className="input" value={off.note} onChange={(e) => setOff({ ...off, note: e.target.value })} placeholder={t("Reason (optional)")} style={{ flex: 1, minWidth: 160 }} />
                  <button className="btn" disabled={busy || !off.day}>{t("Block")}</button>
                </form>
                <small className="muted">{t("Leave the times empty to block the whole day.")}</small>
              </div>
            </section>
            {boss && <BookingRules />}
          </div>
        );
      }}
    </Loader>
  );
}

const toMin = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + (m || 0); };

function BookingRules() {
  const gym = useAsync(() => get("/api/gym"), []);
  const { busy, run } = useAction();
  return (
    <Loader state={gym}>
      {(g: any) => {
        const pt = { memberBooking: true, cancelHours: 12, bookAheadDays: 14, minNoticeHours: 3, ...(g.settings?.pt ?? {}) };
        const save = async (patch: any) => { if (await run(() => put("/api/gym", { settings: { pt: patch } }), t("Saved"))) gym.reload(); };
        return (
          <section className="panel">
            <header><h2>{t("Booking from the member app")}</h2></header>
            <div className="body grid-2">
              <label className="check" style={{ gridColumn: "1 / -1" }}><input type="checkbox" checked={pt.memberBooking} disabled={busy} onChange={(e) => save({ memberBooking: e.target.checked })} /> {t("Members with a PT package can book their sessions in the app")}</label>
              <Field label={t("Free cancellation until")} hint={t("After that, the member must message the coach or reception")}>
                <select className="input" value={pt.cancelHours} disabled={busy} onChange={(e) => save({ cancelHours: Number(e.target.value) })}>{[2, 6, 12, 24, 48].map((h) => <option key={h} value={h}>{h} {t("hours before")}</option>)}</select>
              </Field>
              <Field label={t("Book at the latest")}>
                <select className="input" value={pt.minNoticeHours} disabled={busy} onChange={(e) => save({ minNoticeHours: Number(e.target.value) })}>{[1, 2, 3, 6, 12, 24].map((h) => <option key={h} value={h}>{h} hour{h > 1 ? "s" : ""} before</option>)}</select>
              </Field>
              <Field label={t("Book up to")}>
                <select className="input" value={pt.bookAheadDays} disabled={busy} onChange={(e) => save({ bookAheadDays: Number(e.target.value) })}>{[7, 14, 21, 30].map((d) => <option key={d} value={d}>{d} {t("days ahead")}</option>)}</select>
              </Field>
            </div>
          </section>
        );
      }}
    </Loader>
  );
}
