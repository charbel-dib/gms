import React, { useState } from "react";
import { get, post, put } from "../../shared/api.ts";
import { Empty, Field, Icon, Loader, Modal, Tabs, useAction, useAsync, useDebounced } from "../../shared/ui.tsx";
import { fmtDate, fmtTime, money, t } from "../../shared/i18n.ts";
import { Link, can, useApp } from "../app.tsx";
import { PaymentFields, emptyPayment, toPaymentBody } from "./forms.tsx";

export function CoachingPage() {
  const { me } = useApp();
  const [tab, setTab] = useState<"sessions" | "packages">("sessions");
  const sessions = useAsync(() => get("/api/pt/sessions"), [tab]);
  const packages = useAsync(() => get("/api/pt/packages"), [tab]);
  const [newPkg, setNewPkg] = useState(false);
  const [plan, setPlan] = useState<any>(null);
  const { run } = useAction();
  const mark = async (id: string, status: string) => { await run(() => put(`/api/pt/sessions/${id}`, { status })); sessions.reload(); packages.reload(); };
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{t("Personal training")}</h1><p>{me.user.role === "coach" ? "Your clients and sessions." : "Packages, sessions and coach performance."}</p></div>
        {can(me, "owner", "manager", "reception") && <button className="btn primary" onClick={() => setNewPkg(true)}><Icon name="plus" />Sell a PT package</button>}
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "sessions", label: "Sessions" }, { value: "packages", label: "Packages" }]} />
      {tab === "sessions" && (
        <Loader state={sessions}>
          {(list: any[]) => list.length ? (
            <div className="table-wrap"><table className="data">
              <thead><tr><th>When</th><th>Client</th><th>Coach</th><th>Package</th><th /></tr></thead>
              <tbody>{list.map((s) => (
                <tr key={s.id}>
                  <td>{fmtDate(s.starts_at, { weekday: "short", day: "numeric", month: "short" })} {fmtTime(s.starts_at)}</td>
                  <td><Link to={`/members/${s.member_id}`}>{s.first_name} {s.last_name}</Link></td>
                  <td>{s.coach_name ?? "—"}</td>
                  <td>{s.title} <small className="muted">{s.sessions_used}/{s.sessions_total}</small></td>
                  <td className="r">{s.status === "scheduled" ? (
                    <><button className="btn small" onClick={() => mark(s.id, "done")}><Icon name="check" />Done</button>{" "}
                      <button className="btn small" onClick={() => mark(s.id, "no_show")}>No-show</button>{" "}
                      <button className="btn small ghost" onClick={() => mark(s.id, "cancelled")}>{t("Cancel")}</button></>
                  ) : <span className="tag">{s.status.replace("_", " ")}</span>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : <Empty title="No sessions planned." >Plan a session from a package in the Packages tab.</Empty>}
        </Loader>
      )}
      {tab === "packages" && (
        <Loader state={packages}>
          {(list: any[]) => list.length ? (
            <div className="table-wrap"><table className="data">
              <thead><tr><th>Client</th><th>Package</th><th>Coach</th><th>Used</th><th className="r">Paid</th><th /></tr></thead>
              <tbody>{list.map((p) => (
                <tr key={p.id}>
                  <td><Link to={`/members/${p.member_id}`}>{p.first_name} {p.last_name}</Link></td>
                  <td>{p.title}{p.expires_on && <small className="muted"> · until {fmtDate(p.expires_on)}</small>}</td>
                  <td>{p.coach_name ?? "—"}</td>
                  <td><span className="num-display" style={{ fontSize: "1.15rem" }}>{p.sessions_used}/{p.sessions_total}</span></td>
                  <td className="r">{money(p.paid_usd)} <small className="muted">/ {money(p.price, p.currency)}</small></td>
                  <td className="r">{p.sessions_used < p.sessions_total && <button className="btn small" onClick={() => setPlan(p)}>Plan a session</button>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : <Empty title="No PT packages yet." />}
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
  const [f, setF] = useState({ coach_id: "", title: "10 PT sessions", sessions_total: "10", price: "150", currency: "USD" as "USD" | "LBP", expires_on: "" });
  const [pay, setPay] = useState(emptyPayment());
  const { busy, run } = useAction();
  return (
    <Modal title="Sell a PT package" open={open} onClose={onClose} wide
      footer={<button className="btn primary" disabled={busy || !member} onClick={async () => {
        const r = await run(() => post("/api/pt/packages", { member_id: member.id, coach_id: f.coach_id || null, title: f.title, sessions_total: Number(f.sessions_total), price: Number(f.price), currency: f.currency, expires_on: f.expires_on || null, payment: toPaymentBody(pay) }), "Package sold");
        if (r) { setMember(null); onClose(); }
      }}>Confirm sale</button>}>
      {!member ? (
        <Field label="Member"><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, phone or number" autoFocus /></Field>
      ) : <div className="spread"><b>{member.first_name} {member.last_name}</b><button className="btn small ghost" onClick={() => setMember(null)}>Change</button></div>}
      {!member && found.data?.rows?.map((m: any) => <button key={m.id} className="btn ghost" style={{ justifyContent: "flex-start" }} onClick={() => setMember(m)}>{m.first_name} {m.last_name} <small className="muted">#{m.code}</small></button>)}
      <div className="grid-2">
        <Field label="Coach"><select className="input" value={f.coach_id} onChange={(e) => setF({ ...f, coach_id: e.target.value })}><option value="">—</option>{staff.data?.filter((u: any) => u.role !== "reception").map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
        <Field label="Title"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Sessions"><input className="input" type="number" value={f.sessions_total} onChange={(e) => setF({ ...f, sessions_total: e.target.value })} /></Field>
        <Field label={`Price (${f.currency})`}><input className="input" inputMode="decimal" value={f.price} onChange={(e) => { setF({ ...f, price: e.target.value }); setPay({ ...pay, amount: e.target.value }); }} /></Field>
        <Field label="Valid until (optional)"><input className="input" type="date" value={f.expires_on} onChange={(e) => setF({ ...f, expires_on: e.target.value })} /></Field>
      </div>
      <b>Payment now</b>
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
      }}>Plan session</button>}>
      <Field label="Date and time"><input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
    </Modal>
  );
}
