import React, { useEffect, useMemo, useState } from "react";
import { get, getGymOverride, post, put } from "../../shared/api.ts";
import { Empty, Field, Icon, Loader, Modal, Segmented, Status, Tabs, initials, toast, toastError, useAction, useAsync, useDebounced } from "../../shared/ui.tsx";
import { fmtDate, fmtTime, money, relDays, t } from "../../shared/i18n.ts";
import { qrSvg } from "../../shared/qr.ts";
import { Link, can, doCheckin, navigate, usePath, useApp } from "../app.tsx";
import { PaymentFields, ReferrerPicker, SaleFields, emptyPayment, emptySale, toPaymentBody, toSaleBody } from "./forms.tsx";
import { openReceipt } from "../receipt.tsx";

const STATUSES = ["all", "active", "expiring", "expired", "frozen", "none"] as const;

function NewMemberModal({ open, onClose, lead }: { open: boolean; onClose: () => void; lead?: any }) {
  const [f, setF] = useState({ first_name: "", last_name: "", phone: "", gender: "", birth_date: "", email: "", source: "walk-in", notes: "" });
  const [sell, setSell] = useState(true);
  const [sale, setSale] = useState(emptySale());
  const [ref, setRef] = useState<{ id: string | null; name: string | null }>({ id: null, name: null });
  const { busy, run } = useAction();
  useEffect(() => {
    if (open && lead) {
      const [first, ...rest] = String(lead.name).split(" ");
      setF((x) => ({ ...x, first_name: first, last_name: rest.join(" "), phone: lead.phone ?? "", source: lead.referred_by ? "referral" : lead.source ?? "walk-in", notes: lead.notes ?? "" }));
    }
  }, [open, lead?.id]);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const submit = async () => {
    const r = await run(() => post("/api/members", {
      ...f, phone: f.phone || null, gender: f.gender || null, birth_date: f.birth_date || null, email: f.email || null,
      membership: sell && sale.plan_id ? toSaleBody(sale) : null, lead_id: lead?.id ?? null,
      referred_by: f.source === "referral" ? ref.id : null,
    }), "Member added");
    if (r) {
      onClose();
      setF({ first_name: "", last_name: "", phone: "", gender: "", birth_date: "", email: "", source: "walk-in", notes: "" });
      setSale(emptySale());
      setRef({ id: null, name: null });
      navigate(`/members/${r.id}`);
      if (r.sale?.payment) openReceipt(r.sale.payment.id);
    }
  };
  return (
    <Modal title={t("Add member")} open={open} onClose={onClose} wide
      footer={<><button className="btn" onClick={onClose}>{t("Cancel")}</button><button className="btn primary" disabled={busy || !f.first_name} onClick={submit}>{sell && sale.plan_id ? "Add member and sell" : t("Add member")}</button></>}>
      <div className="grid-2">
        <Field label={t("First name")}><input className="input" value={f.first_name} onChange={(e) => set("first_name", e.target.value)} autoFocus required /></Field>
        <Field label={t("Last name")}><input className="input" value={f.last_name} onChange={(e) => set("last_name", e.target.value)} /></Field>
        <Field label={t("Phone")} hint="03 123 456 or +961 71 234 567. Used for WhatsApp and the member app."><input className="input" inputMode="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
        <Field label={t("Gender")}>
          <Segmented label={t("Gender")} value={f.gender as any} onChange={(v) => set("gender", v)} options={[{ value: "female", label: t("Female") }, { value: "male", label: t("Male") }]} />
        </Field>
        <Field label="Birth date"><input className="input" type="date" value={f.birth_date} onChange={(e) => set("birth_date", e.target.value)} /></Field>
        <Field label="Heard about us from">
          <select className="input" value={f.source} onChange={(e) => set("source", e.target.value)}>
            {["walk-in", "instagram", "tiktok", "referral", "google", "other"].map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
      </div>
      {f.source === "referral" && (lead?.referred_by
        ? <p className="ink-2" style={{ margin: 0 }}>Referred by <b>{lead.referrer_name ?? "a member"}</b>. They’ll be credited when you add this member.</p>
        : <ReferrerPicker value={ref.id} label={ref.name} onChange={(id, name) => setRef({ id, name })} />)}
      <label className="check"><input type="checkbox" checked={sell} onChange={(e) => setSell(e.target.checked)} /> Sell a membership now</label>
      {sell && <SaleFields value={sale} onChange={setSale} gender={f.gender || null} />}
    </Modal>
  );
}

export function MembersPage() {
  const { me } = useApp();
  const path = usePath();
  const params = new URLSearchParams(path.split("?")[1] ?? "");
  const [status, setStatus] = useState<string>(params.get("status") ?? "all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("recent");
  const [creating, setCreating] = useState(params.get("new") === "1");
  const [importing, setImporting] = useState(false);
  const dq = useDebounced(q);
  const balance = params.get("balance") === "1";
  const state = useAsync(() => get(`/api/members?limit=300&sort=${sort}${status !== "all" ? `&status=${status}` : ""}${dq ? `&q=${encodeURIComponent(dq)}` : ""}${balance ? "&balance=1" : ""}`), [status, dq, sort, balance]);
  useEffect(() => { if (params.get("new") === "1") setCreating(true); }, [path]);
  // "Make them a member" from Leads: pre-fill from that lead and credit whoever referred them
  const leadId = params.get("lead");
  const [lead, setLead] = useState<any>(null);
  useEffect(() => {
    if (!leadId) { setLead(null); return; }
    get("/api/leads").then((list: any[]) => setLead(list.find((l) => l.id === leadId) ?? null)).catch(() => {});
  }, [leadId]);
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{t("Members")}</h1><p>{state.data ? `${state.data.total} shown` : " "}{balance ? " · with an unpaid balance" : ""}</p></div>
        <div className="row">
          {can(me, "owner", "manager") && <a className="btn" href={`/api/members/export.csv${getGymOverride() ? `?gym=${getGymOverride()}` : ""}`}><Icon name="download" />Export</a>}
          {can(me, "owner", "manager") && <button className="btn" onClick={() => setImporting(true)}><Icon name="upload" />Import from Excel</button>}
          {can(me, "owner", "manager", "reception") && <button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" />{t("Add member")}</button>}
        </div>
      </div>
      <div className="spread">
        <Segmented label="Status" value={status} onChange={setStatus} options={STATUSES.map((s) => ({ value: s, label: s === "all" ? "All" : `${t(s)}${state.data?.counts?.[s] != null ? ` ${state.data.counts[s]}` : ""}` }))} />
        <div className="row">
          <input className="input" style={{ width: 240 }} placeholder={`${t("Search")}: name, phone, number`} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("Search")} />
          <select className="input" style={{ width: 170 }} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
            <option value="recent">Newest first</option><option value="name">Name</option><option value="end">Ending soonest</option>
            <option value="risk">Highest risk</option><option value="balance">Highest balance</option><option value="code">Member number</option>
          </select>
        </div>
      </div>
      <Loader state={state}>
        {(d: any) => d.rows.length ? (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>{t("Name")}</th><th>{t("Plan")}</th><th>Status</th><th>{t("Ends")}</th><th>{t("Last visit")}</th><th className="r">{t("Balance")}</th></tr></thead>
              <tbody>
                {d.rows.map((m: any) => (
                  <tr key={m.id} className="clickable" onClick={() => navigate(`/members/${m.id}`)}>
                    <td><span className="who"><b>{m.first_name} {m.last_name}</b><small>#{m.code}{m.phone ? ` · ${m.phone}` : ""}</small></span></td>
                    <td>{m.plan_name ?? <span className="muted">—</span>}{m.visits_total != null && <small className="muted"> · {m.visits_total - m.visits_used} visits left</small>}</td>
                    <td><Status s={m.status} />{m.churn_score >= 0.6 && ["active", "expiring"].includes(m.status) && <span className="tag" style={{ marginInlineStart: 6 }}>at risk</span>}</td>
                    <td>{m.end_date ? <>{fmtDate(m.end_date)} <small className="muted">{m.days_left >= 0 ? `(${m.days_left}d)` : ""}</small></> : "—"}</td>
                    <td className="ink-2">{relDays(m.last_checkin)}</td>
                    <td className="r">{Number(m.balance_usd) > 0 ? <span className="money-neg">{money(m.balance_usd)}</span> : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title={q ? "No member matches this search." : "No members here yet."} action={!q && <button className="btn primary" onClick={() => setCreating(true)}>{t("Add member")}</button>}>
            {!q && "Add your first member, or import your current list from Excel."}
          </Empty>
        )}
      </Loader>
      <NewMemberModal open={creating && (!leadId || !!lead)} lead={lead} onClose={() => { setCreating(false); if (params.get("new")) navigate("/members", true); state.reload(); }} />
      <ImportModal open={importing} onClose={() => { setImporting(false); state.reload(); }} />
    </div>
  );
}

function ImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [csv, setCsv] = useState("");
  const [report, setReport] = useState<any>(null);
  const { busy, run } = useAction();
  const go = async (dryRun: boolean) => {
    const r = await run(() => post("/api/members/import", { csv, dryRun }));
    if (r) setReport({ ...r, dryRun });
  };
  return (
    <Modal title="Import members from Excel" open={open} onClose={() => { setCsv(""); setReport(null); onClose(); }} wide
      footer={<>
        <button className="btn" disabled={!csv || busy} onClick={() => go(true)}>Check the file</button>
        <button className="btn primary" disabled={!csv || busy || !report?.dryRun} onClick={() => go(false)}>Import {report?.dryRun ? report.created : ""} members</button>
      </>}>
      <p className="ink-2">In Excel: <b>File → Save as → CSV</b>. Columns we understand: name (or first_name, last_name), phone, gender, plan, end_date (31/12/2026 or 2026-12-31), notes. Existing phone numbers are skipped.</p>
      <input type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setCsv(await f.text()); setReport(null); } }} />
      {csv && <p className="muted">{csv.split(/\r?\n/).filter(Boolean).length - 1} rows loaded.</p>}
      {report && (
        <div className="stack-s">
          <b>{report.dryRun ? `${report.created} members are ready to import.` : `${report.created} members imported.`}</b>
          {report.skipped.length > 0 && <ul className="reasons">{report.skipped.slice(0, 20).map((s: any) => <li key={s.line}>Line {s.line}: {s.reason}</li>)}</ul>}
        </div>
      )}
    </Modal>
  );
}

// ---------------- member profile ----------------

export function MemberPage({ id }: { id: string }) {
  const { me } = useApp();
  const path = usePath();
  const state = useAsync(() => get(`/api/members/${id}`), [id]);
  const [tab, setTab] = useState<"memberships" | "payments" | "visits" | "classes" | "training" | "messages">("memberships");
  const [modal, setModal] = useState<null | "sell" | "pay" | "freeze" | "edit" | "access" | "message" | "program" | "winback">(path.includes("sell=1") ? "sell" : null);
  const reload = state.reload;
  return (
    <div className="page">
      <Loader state={state}>
        {(m: any) => {
          const current = m.memberships.find((x: any) => x.id === m.membership_id);
          return (
            <>
              <div className="profile-head">
                <div className="avatar" style={{ background: m.gender === "female" ? "#6c5b7b" : "var(--rubber)" }}>{initials(m.first_name, m.last_name)}</div>
                <div className="stack-s">
                  <Link to="/members" className="muted" style={{ fontSize: "0.85rem", textDecoration: "none" }}>← {t("Members")}</Link>
                  <h1>{m.first_name} {m.last_name}</h1>
                  <div className="row ink-2">
                    <Status s={m.status} />
                    <span>#{m.code}</span>
                    {m.phone && <a href={`tel:${m.phone}`}>{m.phone}</a>}
                    {m.archived_at && <span className="tag">archived</span>}
                    {m.tags?.map((tg: string) => <span key={tg} className="tag">{tg}</span>)}
                  </div>
                </div>
                <div className="row">
                  {can(me, "owner", "manager", "reception") && <button className="btn primary" onClick={() => setModal("sell")}>{m.status === "none" ? t("Sell membership") : t("Renew")}</button>}
                  <button className="btn" onClick={async () => { try { const r = await doCheckin({ member_id: m.id }); toast(r.result === "ok" ? "Checked in" : `Refused: ${t(r.reason ?? "")}`, r.result === "ok" ? "ok" : "error"); reload(); } catch (e) { toastError(e); } }}><Icon name="scan" />Check in</button>
                  {can(me, "owner", "manager", "reception") && <button className="btn" onClick={() => setModal("pay")}><Icon name="card" />{t("Record payment")}</button>}
                </div>
              </div>

              <section className="panel">
                <dl className="facts" style={{ margin: 0 }}>
                  <div><dt>{t("Plan")}</dt><dd>{m.plan_name ?? "—"}</dd></div>
                  <div><dt>{t("Valid until")}</dt><dd>{m.end_date ? fmtDate(m.end_date, { day: "numeric", month: "short", year: "numeric" }) : "—"}{m.days_left != null && m.days_left >= 0 && <small className="muted"> · {m.days_left}d</small>}</dd></div>
                  {m.visits_total != null && <div><dt>{t("visits left")}</dt><dd>{m.visits_total - m.visits_used} / {m.visits_total}</dd></div>}
                  <div><dt>Visits, 30 days</dt><dd>{m.visits30}</dd></div>
                  <div><dt>{t("Last visit")}</dt><dd>{relDays(m.last_checkin)}</dd></div>
                  <div><dt>{t("Balance")}</dt><dd className={Number(m.balance_usd) > 0 ? "money-neg" : ""}>{Number(m.balance_usd) > 0 ? money(m.balance_usd) : "Paid"}</dd></div>
                </dl>
              </section>

              <div className="cols">
                <div className="stack">
                  <Tabs value={tab} onChange={setTab} tabs={[
                    { value: "memberships", label: `Memberships (${m.memberships.length})` },
                    { value: "payments", label: `${t("Payments")} (${m.payments.length})` },
                    { value: "visits", label: "Visits" },
                    { value: "classes", label: t("Classes") },
                    { value: "training", label: "Training" },
                    { value: "messages", label: t("Messages") },
                  ]} />
                  {tab === "memberships" && <MembershipList m={m} reload={reload} onFreeze={() => setModal("freeze")} />}
                  {tab === "payments" && (
                    m.payments.length ? (
                      <div className="table-wrap"><table className="data">
                        <thead><tr><th>Receipt</th><th>Date</th><th>{t("Method")}</th><th className="r">{t("Amount")}</th><th /></tr></thead>
                        <tbody>{m.payments.map((p: any) => (
                          <tr key={p.id} style={p.voided_at ? { opacity: 0.5, textDecoration: "line-through" } : undefined}>
                            <td>#{p.receipt_no}</td><td>{fmtDate(p.paid_at, { day: "numeric", month: "short", year: "numeric" })}</td>
                            <td>{t(p.method)}{p.reference ? <small className="muted"> · {p.reference}</small> : ""}</td>
                            <td className="r">{money(p.amount, p.currency)}{p.currency === "LBP" && <small className="muted"> ≈ {money(p.amount_usd)}</small>}</td>
                            <td className="r"><button className="btn small ghost" onClick={() => openReceipt(p.id)} aria-label="Receipt"><Icon name="receipt" /></button>
                              {!p.voided_at && can(me, "owner", "manager") && <VoidButton id={p.id} onDone={reload} />}</td>
                          </tr>
                        ))}</tbody></table></div>
                    ) : <Empty title="No payments yet." />
                  )}
                  {tab === "visits" && (
                    <div className="panel timeline">
                      {m.checkins.length ? m.checkins.map((c: any) => (
                        <div key={c.id}><span className="muted">{fmtDate(c.at)}</span><span><span className="plate" data-s={c.result === "ok" ? "ok" : "denied"} /> {c.result === "ok" ? "Entered" : `Refused: ${t(c.reason)}`}</span><span className="muted">{fmtTime(c.at)}</span></div>
                      )) : <Empty title="No visits yet." />}
                    </div>
                  )}
                  {tab === "classes" && (
                    <div className="panel timeline">
                      {m.bookings.length ? m.bookings.map((b: any) => (
                        <div key={b.id}><span className="muted">{fmtDate(b.starts_at)}</span><span>{b.class_name}</span><span className="tag">{b.status.replace("_", " ")}</span></div>
                      )) : <Empty title="No class bookings." />}
                    </div>
                  )}
                  {tab === "training" && (
                    <div className="stack">
                      {m.pt.map((p: any) => (
                        <div key={p.id} className="panel"><div className="body spread">
                          <span className="who"><b>{p.title}</b><small>{p.coach_name ?? "No coach"} · {money(p.price, p.currency)}</small></span>
                          <span className="num-display" style={{ fontSize: "1.5rem" }}>{p.sessions_used}/{p.sessions_total}</span>
                        </div></div>
                      ))}
                      <div className="spread"><b>Programs</b>{can(me, "owner", "manager", "coach") && <button className="btn small" onClick={() => setModal("program")}><Icon name="plus" />New program</button>}</div>
                      {m.programs.length ? m.programs.map((p: any) => (
                        <details key={p.id} className="panel"><summary className="body" style={{ cursor: "pointer" }}><b>{p.title}</b> <span className="muted">· {p.coach_name ?? ""} {fmtDate(p.created_at)}</span></summary>
                          <div className="body" style={{ whiteSpace: "pre-wrap", borderTop: "1px solid var(--line-2)" }}>{p.content}</div></details>
                      )) : <p className="muted">No program yet. Programs appear in the member's app.</p>}
                    </div>
                  )}
                  {tab === "messages" && (
                    <div className="stack">
                      <div className="spread">
                        <span className="ink-2"><Icon name="bell" width={16} height={16} style={{ display: "inline", verticalAlign: -3 }} /> {m.push_devices ? `Notifications on (${m.push_devices} device${m.push_devices > 1 ? "s" : ""})` : m.has_app_access ? "Notifications not turned on in the app yet" : "No app access yet"}</span>
                        {m.push_devices > 0 && <button className="btn small" onClick={async () => {
                          try { const r = await post("/api/notifications/test", { member_id: m.id }); toast(r.ok ? "Test notification delivered" : "The phone did not accept it; ask the member to turn notifications on again", r.ok ? "ok" : "error"); reload(); } catch (e) { toastError(e); }
                        }}>Send a test notification</button>}
                      </div>
                      <div className="panel timeline">
                        {[...m.messages.map((x: any) => ({ ...x, channel: "WhatsApp" })), ...m.notifications.map((x: any) => ({ ...x, channel: "App", body: `${x.title} — ${x.body}` }))]
                          .sort((a: any, b: any) => +new Date(b.created_at) - +new Date(a.created_at))
                          .map((x: any) => (
                            <div key={x.id}><span className="muted">{fmtDate(x.created_at)}</span><span style={{ whiteSpace: "pre-wrap" }} dir="auto"><small className="tag">{x.channel}</small> {x.direction === "in" ? "⬅ " : ""}{x.body}</span><span className="tag">{x.status === "no_device" ? "in app only" : x.status}{x.read_at ? " · opened" : ""}</span></div>
                          ))}
                        {!m.messages.length && !m.notifications.length && <Empty title="No messages yet." />}
                      </div>
                    </div>
                  )}
                </div>

                <aside className="stack">
                  <section className="panel">
                    <header><h2>Entry pass</h2></header>
                    <div className="body pass-card">
                      <div className="qr" dangerouslySetInnerHTML={{ __html: qrSvg(`GMS:${m.qr_token}`) }} />
                      <div className="stack-s">
                        <p className="ink-2" style={{ fontSize: "0.9rem" }}>Members show this code from their app. Printing it on a card works too.</p>
                        <button className="btn small" onClick={() => setModal("access")}><Icon name="whatsapp" />{m.has_app_access ? "Send a new app PIN" : "Give app access"}</button>
                        <button className="btn small ghost" onClick={async () => { await post(`/api/members/${m.id}/rotate-qr`); toast("New QR code issued; the old one stops working"); reload(); }}>Issue a new code</button>
                      </div>
                    </div>
                  </section>
                  {m.churn && ["active", "expiring", "expired"].includes(m.status) && (
                    <section className="panel">
                      <header><h2>Risk of leaving</h2><span className="num-display" style={{ fontSize: "1.4rem", color: m.churn.score >= 0.6 ? "var(--plate-red)" : "inherit" }}>{Math.round(m.churn.score * 100)}%</span></header>
                      <div className="body stack-s">
                        {m.churn.factors?.reasons?.length ? <ul className="reasons">{m.churn.factors.reasons.map((r: string) => <li key={r}>{r}</li>)}</ul> : <p className="muted">Coming regularly. Nothing to worry about.</p>}
                        {m.churn.score >= 0.4 && <button className="btn small" onClick={() => setModal("winback")}><Icon name="spark" />Draft a WhatsApp to bring them back</button>}
                      </div>
                    </section>
                  )}
                  <section className="panel">
                    <header><h2>Details</h2>{can(me, "owner", "manager", "reception") && <button className="btn small ghost" onClick={() => setModal("edit")}>{t("Edit")}</button>}</header>
                    <dl className="body stack-s" style={{ margin: 0 }}>
                      <div className="spread"><dt className="muted">{t("Gender")}</dt><dd style={{ margin: 0 }}>{m.gender ? t(m.gender === "female" ? "Female" : "Male") : "—"}</dd></div>
                      <div className="spread"><dt className="muted">Birthday</dt><dd style={{ margin: 0 }}>{m.birth_date ? fmtDate(m.birth_date, { day: "numeric", month: "long" }) : "—"}</dd></div>
                      <div className="spread"><dt className="muted">Email</dt><dd style={{ margin: 0 }}>{m.email ?? "—"}</dd></div>
                      <div className="spread"><dt className="muted">Source</dt><dd style={{ margin: 0 }}>{m.source ?? "—"}</dd></div>
                      {m.referrer && <div className="spread"><dt className="muted">Referred by</dt><dd style={{ margin: 0 }}><Link to={`/members/${m.referrer.id}`}>{m.referrer.first_name} {m.referrer.last_name}</Link></dd></div>}
                      {m.referred?.length > 0 && <div className="spread"><dt className="muted">Friends brought</dt><dd style={{ margin: 0, textAlign: "end" }}>{m.referred.map((x: any, i: number) => <React.Fragment key={x.id}>{i > 0 && ", "}<Link to={`/members/${x.id}`}>{x.first_name} {x.last_name}</Link></React.Fragment>)}</dd></div>}
                      <div className="spread"><dt className="muted">Member since</dt><dd style={{ margin: 0 }}>{fmtDate(m.created_at, { month: "short", year: "numeric" })}</dd></div>
                      {m.notes && <p className="ink-2" style={{ whiteSpace: "pre-wrap" }}>{m.notes}</p>}
                    </dl>
                    {m.phone && <div className="body" style={{ borderTop: "1px solid var(--line-2)" }}><button className="btn small block" onClick={() => setModal("message")}><Icon name="whatsapp" />Send a WhatsApp</button></div>}
                  </section>
                  {can(me, "owner", "manager") && (
                    <button className="btn ghost danger small" onClick={async () => {
                      if (!confirm(m.archived_at ? "Restore this member?" : "Archive this member? They disappear from lists and can no longer check in.")) return;
                      await post(`/api/members/${m.id}/archive`, { archived: !m.archived_at });
                      reload();
                    }}>{m.archived_at ? "Restore member" : "Archive member"}</button>
                  )}
                </aside>
              </div>

              <SellModal open={modal === "sell"} m={m} onClose={() => { setModal(null); if (path.includes("sell=1")) navigate(`/members/${m.id}`, true); reload(); }} />
              <PayModal open={modal === "pay"} m={m} current={current} onClose={() => { setModal(null); reload(); }} />
              <FreezeModal open={modal === "freeze"} ms={current} onClose={() => { setModal(null); reload(); }} />
              <EditModal open={modal === "edit"} m={m} onClose={() => { setModal(null); reload(); }} />
              <AccessModal open={modal === "access"} m={m} onClose={() => { setModal(null); reload(); }} />
              <MessageModal open={modal === "message" || modal === "winback"} winback={modal === "winback"} m={m} onClose={() => { setModal(null); reload(); }} />
              <ProgramModal open={modal === "program"} m={m} onClose={() => { setModal(null); reload(); }} />
            </>
          );
        }}
      </Loader>
    </div>
  );
}

function VoidButton({ id, onDone }: { id: string; onDone: () => void }) {
  return <button className="btn small ghost danger" onClick={async () => {
    const reason = prompt("Why are you voiding this payment? (kept in the audit log)");
    if (!reason) return;
    try { await post(`/api/payments/${id}/void`, { reason }); toast("Payment voided"); onDone(); } catch (e) { toastError(e); }
  }}>Void</button>;
}

function MembershipList({ m, reload, onFreeze }: { m: any; reload: () => void; onFreeze: () => void }) {
  const { me } = useApp();
  if (!m.memberships.length) return <Empty title="No membership yet." />;
  return (
    <div className="table-wrap"><table className="data">
      <thead><tr><th>{t("Plan")}</th><th>Dates</th><th>Paid</th><th /></tr></thead>
      <tbody>{m.memberships.map((ms: any) => {
        const isCurrent = ms.id === m.membership_id;
        const frozenNow = ms.frozen_from && ms.frozen_until >= new Date().toISOString().slice(0, 10);
        return (
          <tr key={ms.id} style={ms.status === "cancelled" ? { opacity: 0.5 } : undefined}>
            <td><span className="who"><b>{ms.plan_name}</b><small>{money(Number(ms.price) - Number(ms.discount), ms.currency)}{Number(ms.discount) > 0 ? ` (−${money(ms.discount, ms.currency)})` : ""}{ms.status === "cancelled" ? " · cancelled" : ""}</small></span></td>
            <td>{fmtDate(ms.start_date)} → {fmtDate(ms.end_date, { day: "numeric", month: "short", year: "numeric" })}
              {ms.frozen_from && <small className="muted"><br />Frozen {fmtDate(ms.frozen_from)} → {fmtDate(ms.frozen_until)}</small>}</td>
            <td className="muted">{ms.freeze_days_allowed ? `${ms.freeze_days_allowed - ms.freeze_days_used} freeze days left` : ""}</td>
            <td className="r">
              {isCurrent && ms.status === "active" && (frozenNow
                ? <button className="btn small" onClick={async () => { try { await post(`/api/memberships/${ms.id}/unfreeze`); toast("Membership unfrozen"); reload(); } catch (e) { toastError(e); } }}><Icon name="snow" />{t("Unfreeze")}</button>
                : <button className="btn small" onClick={onFreeze}><Icon name="snow" />{t("Freeze")}</button>)}
              {can(me, "owner", "manager") && ms.status === "active" && <button className="btn small ghost danger" onClick={async () => {
                const reason = prompt("Cancel this membership? Reason:");
                if (reason === null) return;
                await post(`/api/memberships/${ms.id}/cancel`, { reason });
                reload();
              }}>Cancel</button>}
            </td>
          </tr>
        );
      })}</tbody>
    </table></div>
  );
}

function SellModal({ open, m, onClose }: { open: boolean; m: any; onClose: () => void }) {
  const [sale, setSale] = useState(emptySale());
  const { busy, run } = useAction();
  return (
    <Modal title={`${m.status === "none" ? t("Sell membership") : t("Renew")} · ${m.first_name}`} open={open} onClose={() => { setSale(emptySale()); onClose(); }} wide
      footer={<><button className="btn" onClick={onClose}>{t("Cancel")}</button><button className="btn primary" disabled={busy || !sale.plan_id} onClick={async () => {
        const r = await run(() => post(`/api/members/${m.id}/memberships`, toSaleBody(sale)));
        if (r) {
          toast(`Membership sold: ${fmtDate(r.membership.start_date)} → ${fmtDate(r.membership.end_date)}`);
          if (r.payment) openReceipt(r.payment.id);
          setSale(emptySale());
          onClose();
        }
      }}>Confirm sale</button></>}>
      {m.end_date && m.status !== "expired" && m.status !== "none" && <p className="ink-2">The current membership ends on {fmtDate(m.end_date, { day: "numeric", month: "long" })}. The new one will start the day after, unless you pick a date.</p>}
      <SaleFields value={sale} onChange={setSale} gender={m.gender} />
    </Modal>
  );
}

function PayModal({ open, m, current, onClose }: { open: boolean; m: any; current: any; onClose: () => void }) {
  const [p, setP] = useState(emptyPayment());
  const { busy, run } = useAction();
  useEffect(() => { if (open && Number(m.balance_usd) > 0) setP({ ...emptyPayment(), amount: String(m.balance_usd) }); }, [open]);
  return (
    <Modal title={t("Record payment")} open={open} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t("Cancel")}</button><button className="btn primary" disabled={busy || !Number(p.amount)} onClick={async () => {
        const r = await run(() => post("/api/payments", { member_id: m.id, membership_id: current?.id ?? null, ...toPaymentBody(p) }), "Payment recorded");
        if (r) { openReceipt(r.id); setP(emptyPayment()); onClose(); }
      }}>Save payment</button></>}>
      {Number(m.balance_usd) > 0 && <p>Outstanding balance: <b className="money-neg">{money(m.balance_usd)}</b></p>}
      <PaymentFields value={p} onChange={setP} />
    </Modal>
  );
}

function FreezeModal({ open, ms, onClose }: { open: boolean; ms: any; onClose: () => void }) {
  const { me } = useApp();
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today);
  const [until, setUntil] = useState("");
  const [override, setOverride] = useState(false);
  const { busy, run } = useAction();
  if (!ms) return null;
  const left = ms.freeze_days_allowed - ms.freeze_days_used;
  const days = until ? Math.round((Date.parse(until) - Date.parse(from)) / 86400000) + 1 : 0;
  return (
    <Modal title={t("Freeze")} open={open} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t("Cancel")}</button><button className="btn primary" disabled={busy || days < 1} onClick={async () => {
        const r = await run(() => post(`/api/memberships/${ms.id}/freeze`, { from, until, override }), "Membership frozen");
        if (r) onClose();
      }}>Freeze {days > 0 ? `${days} day(s)` : ""}</button></>}>
      <p className="ink-2">{left > 0 ? `${left} freeze day(s) left on this membership.` : "This plan has no freeze days left."} The end date moves by the number of frozen days.</p>
      <div className="grid-2">
        <Field label="From"><input className="input" type="date" min={today} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Until (included)"><input className="input" type="date" min={from} value={until} onChange={(e) => setUntil(e.target.value)} /></Field>
      </div>
      {can(me, "owner", "manager") && days > left && <label className="check"><input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /> Allow beyond the plan's limit (recorded in the audit log)</label>}
    </Modal>
  );
}

function EditModal({ open, m, onClose }: { open: boolean; m: any; onClose: () => void }) {
  const [f, setF] = useState<any>({});
  const { busy, run } = useAction();
  useEffect(() => { if (open) setF({ referred_by: m.referrer?.id ?? null, referrer_name: m.referrer ? `${m.referrer.first_name} ${m.referrer.last_name}`.trim() : null, first_name: m.first_name, last_name: m.last_name, phone: m.phone ?? "", email: m.email ?? "", gender: m.gender ?? "", birth_date: m.birth_date ?? "", notes: m.notes ?? "", tags: (m.tags ?? []).join(", "), whatsapp_opt_in: m.whatsapp_opt_in }); }, [open]);
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  return (
    <Modal title={`${t("Edit")} · ${m.first_name}`} open={open} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t("Cancel")}</button><button className="btn primary" disabled={busy} onClick={async () => {
        const r = await run(() => put(`/api/members/${m.id}`, { ...f, referrer_name: undefined, phone: f.phone || null, email: f.email || null, gender: f.gender || null, birth_date: f.birth_date || null, tags: f.tags.split(",").map((s: string) => s.trim()).filter(Boolean) }), "Saved");
        if (r) onClose();
      }}>{t("Save")}</button></>}>
      <div className="grid-2">
        <Field label={t("First name")}><input className="input" value={f.first_name ?? ""} onChange={(e) => set("first_name", e.target.value)} /></Field>
        <Field label={t("Last name")}><input className="input" value={f.last_name ?? ""} onChange={(e) => set("last_name", e.target.value)} /></Field>
        <Field label={t("Phone")}><input className="input" value={f.phone ?? ""} onChange={(e) => set("phone", e.target.value)} /></Field>
        <Field label="Email"><input className="input" value={f.email ?? ""} onChange={(e) => set("email", e.target.value)} /></Field>
        <Field label={t("Gender")}><select className="input" value={f.gender ?? ""} onChange={(e) => set("gender", e.target.value)}><option value="">—</option><option value="female">{t("Female")}</option><option value="male">{t("Male")}</option></select></Field>
        <Field label="Birth date"><input className="input" type="date" value={f.birth_date ?? ""} onChange={(e) => set("birth_date", e.target.value)} /></Field>
      </div>
      <ReferrerPicker value={f.referred_by ?? null} label={f.referrer_name} exclude={m.id} onChange={(id, name) => setF((x: any) => ({ ...x, referred_by: id, referrer_name: name }))} />
      <Field label="Tags" hint="Comma separated, e.g. student, VIP, injury"><input className="input" value={f.tags ?? ""} onChange={(e) => set("tags", e.target.value)} /></Field>
      <Field label={t("Notes")}><textarea className="input" value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} /></Field>
      <label className="check"><input type="checkbox" checked={!!f.whatsapp_opt_in} onChange={(e) => set("whatsapp_opt_in", e.target.checked)} /> Receives WhatsApp reminders</label>
    </Modal>
  );
}

function AccessModal({ open, m, onClose }: { open: boolean; m: any; onClose: () => void }) {
  const [r, setR] = useState<any>(null);
  const { busy, run } = useAction();
  return (
    <Modal title="Member app access" open={open} onClose={() => { setR(null); onClose(); }}
      footer={r ? <a className="btn primary" href={r.whatsappLink} target="_blank" rel="noreferrer" onClick={() => setTimeout(onClose, 300)}><Icon name="whatsapp" />Send on WhatsApp</a>
        : <button className="btn primary" disabled={busy} onClick={async () => setR(await run(() => post(`/api/members/${m.id}/app-access`)))}>Create a PIN</button>}>
      {!r ? (
        <p className="ink-2">{m.first_name} will sign in to the gym's app with the phone number {m.phone ?? "(add one first)"} and a 4-digit PIN. They get their entry QR code, can book classes and see their membership. Creating a new PIN signs them out everywhere.</p>
      ) : (
        <div className="stack">
          <p>PIN for {m.first_name}: <b className="num-display" style={{ fontSize: "2rem", letterSpacing: "0.1em" }}>{r.pin}</b></p>
          <pre style={{ whiteSpace: "pre-wrap", background: "var(--surface-2)", padding: 12, borderRadius: 8, margin: 0, fontFamily: "inherit" }}>{r.text}</pre>
        </div>
      )}
    </Modal>
  );
}

function MessageModal({ open, m, onClose, winback }: { open: boolean; m: any; onClose: () => void; winback?: boolean }) {
  const [text, setText] = useState("");
  const [lang, setLang] = useState<"en" | "ar" | "arabizi" | "fr">("arabizi");
  const { busy, run } = useAction();
  const draft = async (l = lang) => { const r = await run(() => post(`/api/ai/winback/${m.id}`, { lang: l })); if (r) setText(r.text); };
  useEffect(() => { if (open && winback) draft(); if (open && !winback) setText(`Hi ${m.first_name}, `); }, [open]);
  return (
    <Modal title={winback ? `Win back ${m.first_name}` : `WhatsApp · ${m.first_name}`} open={open} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t("Cancel")}</button><button className="btn primary" disabled={busy || !text.trim()} onClick={async () => {
        const r = await run(() => post("/api/messages/send", { member_id: m.id, body: text, kind: winback ? "winback" : "manual" }));
        if (!r) return;
        if (r.link) window.open(r.link, "_blank");
        else toast("Sent on WhatsApp");
        onClose();
      }}><Icon name="whatsapp" />Send</button></>}>
      {winback && (
        <div className="spread">
          <Segmented label="Language" value={lang} onChange={(l) => { setLang(l); draft(l); }} options={[{ value: "arabizi", label: "Arabizi" }, { value: "ar", label: "عربي" }, { value: "en", label: "English" }, { value: "fr", label: "Français" }]} />
          <button className="btn small ghost" onClick={() => draft()} disabled={busy}><Icon name="refresh" />Another version</button>
        </div>
      )}
      <textarea className="input" style={{ minHeight: 140 }} value={text} onChange={(e) => setText(e.target.value)} aria-label="Message" />
      <p className="muted" style={{ fontSize: "0.85rem" }}>Without WhatsApp Business connected, this opens WhatsApp with the message ready: just press send.</p>
    </Modal>
  );
}

function ProgramModal({ open, m, onClose }: { open: boolean; m: any; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const { busy, run } = useAction();
  return (
    <Modal title={`New program · ${m.first_name}`} open={open} onClose={onClose} wide
      footer={<><button className="btn" onClick={onClose}>{t("Cancel")}</button><button className="btn primary" disabled={busy || !title || !content} onClick={async () => {
        const r = await run(() => post(`/api/members/${m.id}/programs`, { title, content }), "Program saved — visible in the member app");
        if (r) { setTitle(""); setContent(""); onClose(); }
      }}>{t("Save")}</button></>}>
      <Field label="Title"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Week 1–4 · Full body" /></Field>
      <Field label="Program"><textarea className="input" style={{ minHeight: 220 }} value={content} onChange={(e) => setContent(e.target.value)} placeholder={"Day A\n- Squat 4x8\n- Bench press 4x8\n- Row 3x10\n\nDay B\n…"} /></Field>
    </Modal>
  );
}
