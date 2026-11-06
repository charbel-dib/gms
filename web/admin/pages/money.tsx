import React, { useState } from "react";
import { del, get, post } from "../../shared/api.ts";
import { Empty, Field, Icon, Loader, Modal, Segmented, useAction, useAsync } from "../../shared/ui.tsx";
import { Bars } from "../../shared/charts.tsx";
import { fmtDate, fmtTime, money, t } from "../../shared/i18n.ts";
import { Link, can, useApp } from "../app.tsx";
import { openReceipt } from "../receipt.tsx";
import { openFinanceReport } from "../report.tsx";

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => today().slice(0, 8) + "01";
const lastMonth = () => {
  const end = new Date(monthStart() + "T00:00:00Z");
  end.setUTCDate(0);
  const to = end.toISOString().slice(0, 10);
  return { from: to.slice(0, 8) + "01", to };
};

export function PaymentsPage() {
  const { me } = useApp();
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const state = useAsync(() => get(`/api/payments?from=${from}&to=${to}`), [from, to]);
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{t("Payments")}</h1><p>Every payment gets a numbered receipt. Voided payments stay visible for the audit trail.</p></div>
        <div className="row">
          <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" style={{ width: 160 }} />
          <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" style={{ width: 160 }} />
          {can(me, "owner", "manager") && <button className="btn primary" disabled={!from || !to || to < from} onClick={() => openFinanceReport(from, to)}><Icon name="file" />Export report</button>}
        </div>
      </div>
      <Loader state={state}>
        {(d: any) => (
          <>
            <div className="figures">
              <div className="figure"><span className="label">Total</span><span className="value num-display">{money(d.totals.usd)}</span><span className="delta">{d.rows.filter((r: any) => !r.voided_at).length} payments</span></div>
              <div className="figure"><span className="label">Cash in dollars</span><span className="value num-display">{money(d.rows.filter((r: any) => !r.voided_at && r.method === "cash" && r.currency === "USD").reduce((s: number, r: any) => s + Number(r.amount), 0))}</span><span className="delta">count the drawer against this</span></div>
              <div className="figure"><span className="label">Cash in lira</span><span className="value num-display" style={{ fontSize: "var(--step-3)" }}>{money(d.rows.filter((r: any) => !r.voided_at && r.method === "cash" && r.currency === "LBP").reduce((s: number, r: any) => s + Number(r.amount), 0), "LBP")}</span></div>
              <div className="figure"><span className="label">Whish / OMT / card</span><span className="value num-display">{money(["whish", "omt", "card", "bank"].reduce((s, m) => s + (d.totals.byMethod[m] ?? 0), 0))}</span></div>
            </div>
            {d.rows.length ? (
              <div className="table-wrap"><table className="data">
                <thead><tr><th>Receipt</th><th>Time</th><th>Member</th><th>{t("Method")}</th><th>By</th><th className="r">{t("Amount")}</th><th /></tr></thead>
                <tbody>{d.rows.map((p: any) => (
                  <tr key={p.id} style={p.voided_at ? { opacity: 0.45, textDecoration: "line-through" } : undefined}>
                    <td>#{p.receipt_no}</td>
                    <td>{fmtDate(p.paid_at)} {fmtTime(p.paid_at)}</td>
                    <td>{p.member_id ? <Link to={`/members/${p.member_id}`}>{p.first_name} {p.last_name}</Link> : "—"}</td>
                    <td>{t(p.method)}{p.reference ? <small className="muted"> · {p.reference}</small> : ""}</td>
                    <td className="ink-2">{p.received_by_name ?? "—"}</td>
                    <td className="r">{money(p.amount, p.currency)}{p.currency === "LBP" && <small className="muted"> ≈ {money(p.amount_usd)}</small>}</td>
                    <td className="r"><button className="btn small ghost" onClick={() => openReceipt(p.id)} aria-label="Receipt"><Icon name="receipt" /></button></td>
                  </tr>
                ))}</tbody>
              </table></div>
            ) : <Empty title="No payment in this period." />}
          </>
        )}
      </Loader>
    </div>
  );
}

const CATS = ["rent", "salaries", "generator", "electricity", "equipment", "maintenance", "marketing", "supplies", "other"];

export function ExpensesPage() {
  const state = useAsync(() => get("/api/expenses"), []);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ category: "generator", amount: "", currency: "USD" as "USD" | "LBP", spent_on: today(), note: "" });
  const { busy, run } = useAction();
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{t("Expenses")}</h1><p>Rent, salaries, generator and diesel: so Reports can show your real profit.</p></div>
        <button className="btn primary" onClick={() => setOpen(true)}><Icon name="plus" />Add an expense</button>
      </div>
      <Loader state={state}>
        {(list: any[]) => list.length ? (
          <div className="table-wrap"><table className="data">
            <thead><tr><th>Date</th><th>Category</th><th>Note</th><th className="r">{t("Amount")}</th><th /></tr></thead>
            <tbody>{list.map((e) => (
              <tr key={e.id}>
                <td>{fmtDate(e.spent_on, { day: "numeric", month: "short", year: "numeric" })}</td>
                <td style={{ textTransform: "capitalize" }}>{e.category}</td>
                <td className="ink-2">{e.note ?? ""}</td>
                <td className="r">{money(e.amount, e.currency)}{e.currency === "LBP" && <small className="muted"> ≈ {money(e.amount_usd)}</small>}</td>
                <td className="r"><button className="btn small ghost danger" onClick={async () => { if (confirm("Delete this expense?")) { await run(() => del(`/api/expenses/${e.id}`)); state.reload(); } }}>{t("Delete")}</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty title="No expense recorded yet." />}
      </Loader>
      <Modal title="Add an expense" open={open} onClose={() => setOpen(false)}
        footer={<button className="btn primary" disabled={busy || !Number(f.amount)} onClick={async () => {
          const r = await run(() => post("/api/expenses", { ...f, amount: Number(f.amount), note: f.note || null }), "Expense saved");
          if (r) { setOpen(false); setF({ ...f, amount: "", note: "" }); state.reload(); }
        }}>{t("Save")}</button>}>
        <div className="grid-2">
          <Field label="Category"><select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} style={{ textTransform: "capitalize" }}>{CATS.map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
          <Field label="Date"><input className="input" type="date" value={f.spent_on} onChange={(e) => setF({ ...f, spent_on: e.target.value })} /></Field>
          <Field label={t("Amount")}><input className="input" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, "") })} /></Field>
          <Field label={t("Currency")}><Segmented label={t("Currency")} value={f.currency} onChange={(c) => setF({ ...f, currency: c })} options={[{ value: "USD", label: "USD" }, { value: "LBP", label: "LBP" }]} /></Field>
        </div>
        <Field label={t("Notes")}><input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. 400L diesel" /></Field>
      </Modal>
    </div>
  );
}

export function ReportsPage() {
  const { me } = useApp();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const fin = useAsync(() => get(`/api/reports/finance?from=${from}&to=${to}`), [from, to]);
  const coaches = useAsync(() => get(`/api/reports/coaches?from=${from}&to=${to}`), [from, to]);
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{t("Reports")}</h1><p>Money in, money out, and how your coaches perform.</p></div>
        <div className="row">
          <Segmented label="Period" value={from === monthStart() && to === today() ? "month" : from === lastMonth().from && to === lastMonth().to ? "last" : "custom"} onChange={(v) => {
            if (v === "month") { setFrom(monthStart()); setTo(today()); }
            if (v === "last") { setFrom(lastMonth().from); setTo(lastMonth().to); }
          }} options={[{ value: "month", label: "This month" }, { value: "last", label: "Last month" }, { value: "custom", label: "Custom" }]} />
          <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" style={{ width: 160 }} />
          <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" style={{ width: 160 }} />
          <button className="btn primary" disabled={!from || !to || to < from} onClick={() => openFinanceReport(from, to)}><Icon name="file" />Export report</button>
        </div>
      </div>
      <Loader state={fin}>
        {(d: any) => (
          <>
            <div className="figures">
              <div className="figure"><span className="label">Revenue</span><span className="value num-display">{money(d.revenue)}</span></div>
              <div className="figure"><span className="label">Expenses</span><span className="value num-display">{money(d.expenses_total)}</span></div>
              <div className="figure"><span className="label">Profit</span><span className="value num-display" style={{ color: d.profit < 0 ? "var(--plate-red)" : undefined }}>{money(d.profit)}</span></div>
              <div className="figure"><span className="label">Cash in the drawer today</span><span className="value num-display" style={{ fontSize: "var(--step-3)" }}>{d.cashDrawer.length ? d.cashDrawer.map((c: any) => money(c.amount, c.currency)).join(" + ") : "—"}</span></div>
            </div>
            <div className="cols">
              <section className="panel">
                <header><h2>Revenue by day</h2></header>
                <div className="body">{d.daily.length ? <Bars title="Revenue by day" labels={d.daily.map((x: any) => fmtDate(x.day))} series={[{ name: "Revenue", values: d.daily.map((x: any) => Number(x.usd)), color: "var(--series-1)" }]} /> : <Empty title="No revenue in this period." />}</div>
              </section>
              <div className="stack">
                <section className="panel">
                  <header><h2>By payment method</h2></header>
                  <div className="list">{d.byMethod.map((x: any) => <div key={x.method}><span className="grow">{t(x.method)} <small className="muted">· {x.n}</small></span><b>{money(x.usd)}</b></div>)}</div>
                </section>
                <section className="panel">
                  <header><h2>By source</h2></header>
                  <div className="list">{d.byKind.map((x: any) => <div key={x.kind}><span className="grow" style={{ textTransform: "capitalize" }}>{x.kind.replace("_", " ")}</span><b>{money(x.usd)}</b></div>)}</div>
                </section>
                <section className="panel">
                  <header><h2>Expenses</h2></header>
                  <div className="list">{d.expenses.length ? d.expenses.map((x: any) => <div key={x.category}><span className="grow" style={{ textTransform: "capitalize" }}>{x.category}</span><b>{money(x.usd)}</b></div>) : <div className="muted">None recorded</div>}</div>
                </section>
              </div>
            </div>
          </>
        )}
      </Loader>
      {can(me, "owner", "manager") && (
        <section className="panel">
          <header><h2>Coaches</h2><span className="muted">commission = PT revenue × coach's %</span></header>
          <Loader state={coaches}>
            {(list: any[]) => (
              <div className="table-wrap" style={{ border: 0 }}><table className="data">
                <thead><tr><th>Coach</th><th>PT sessions</th><th>Classes</th><th>Avg attendance</th><th>Active clients</th><th className="r">PT revenue</th><th className="r">Commission</th></tr></thead>
                <tbody>{list.map((c) => (
                  <tr key={c.id}><td>{c.name}</td><td>{c.pt_done}</td><td>{c.classes_taught}</td><td>{c.avg_attendance}</td><td>{c.active_clients}</td><td className="r">{money(c.pt_revenue)}</td><td className="r"><b>{money(c.commission_usd)}</b> <small className="muted">{Number(c.commission_pct)}%</small></td></tr>
                ))}</tbody>
              </table></div>
            )}
          </Loader>
        </section>
      )}
    </div>
  );
}
