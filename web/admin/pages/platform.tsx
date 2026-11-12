/** GMS platform console for the GMS operator (super-admin). */
import React, { useState } from "react";
import { api, get, post, put, setGymOverride } from "../../shared/api.ts";
import { Field, Icon, Loader, Modal, Tabs, toast, useAction, useAsync, waLink } from "../../shared/ui.tsx";
import { fmtDate, money, relDays } from "../../shared/i18n.ts";
import { navigate, useApp } from "../app.tsx";
import { AccountModal } from "../account.tsx";

const STEP_LABEL: Record<string, string> = { logo: "logo", prices: "prices", members: "members", payment: "first payment", checkin: "first check-in" };
const today = () => new Date().toISOString().slice(0, 10);
const daysUntil = (d: string) => Math.round((new Date(String(d).slice(0, 10) + "T00:00:00Z").getTime() - new Date(today() + "T00:00:00Z").getTime()) / 86400_000);

/**
 * What needs the operator today, worked out from the gym list: who owes, whose trial is ending,
 * who is stuck setting up, who went quiet. Demo gyms are left out.
 */
function needs(rows: any[]) {
  const out: { g: any; kind: "money" | "trial" | "setup" | "quiet"; text: string; msg: string }[] = [];
  for (const g of rows.filter((x) => !x.is_demo && x.saas_status !== "suspended")) {
    const missing = Object.entries(g.setup ?? {}).filter(([, v]) => !v).map(([k]) => STEP_LABEL[k] ?? k);
    if (g.saas_status === "past_due" || (g.saas_status === "active" && g.saas_paid_until && daysUntil(g.saas_paid_until) < 0)) {
      out.push({ g, kind: "money", text: g.saas_paid_until ? `Paid until ${fmtDate(g.saas_paid_until)}: ${money(g.saas_price_usd)} is due` : `${money(g.saas_price_usd)} is due`, msg: `Hello, this is Charbel from GMS. A reminder that this month's GMS subscription for ${g.name} (${money(g.saas_price_usd)}) is due. Thank you!` });
    } else if (g.saas_status === "active" && g.saas_paid_until && daysUntil(g.saas_paid_until) <= 5) {
      out.push({ g, kind: "money", text: `Renews in ${daysUntil(g.saas_paid_until)} days (${money(g.saas_price_usd)})`, msg: `Hello, this is Charbel from GMS. Your GMS subscription for ${g.name} renews on ${fmtDate(g.saas_paid_until)} (${money(g.saas_price_usd)}).` });
    }
    if (g.saas_status === "trial" && g.trial_ends_at && daysUntil(g.trial_ends_at) <= 7) {
      const d = daysUntil(g.trial_ends_at);
      out.push({ g, kind: "trial", text: d < 0 ? `Free month ended ${-d} days ago` : `Free month ends in ${d} days`, msg: `Hello, this is Charbel from GMS. Your free month for ${g.name} ${d < 0 ? "has ended" : `ends on ${fmtDate(g.trial_ends_at)}`}. How is it going? I can pass by or call to answer any question.` });
    }
    if (missing.length) {
      out.push({ g, kind: "setup", text: `Still to do: ${missing.join(", ")}`, msg: `Hello, this is Charbel from GMS. I saw ${g.name} is not fully set up yet (${missing.join(", ")}). Want me to do it with you? It takes ten minutes.` });
    } else if (g.checkins_7d === 0) {
      out.push({ g, kind: "quiet", text: `No check-in for a week${g.last_checkin ? ` (last one ${relDays(g.last_checkin)})` : ""}`, msg: `Hello, this is Charbel from GMS. I noticed ${g.name} has not used check-in this week. Is anything blocking you? I'm here to help.` });
    }
  }
  const order = { money: 0, trial: 1, quiet: 2, setup: 3 };
  return out.sort((a, b) => order[a.kind] - order[b.kind]);
}

const STATUS_PLATE: Record<string, string> = { active: "ok", trial: "warn", past_due: "denied", suspended: "frozen" };

const ARCHIVE_REASONS = ["Stopped paying", "Gym closed", "Went back to notebook or Excel", "Moved to another software", "Free month not continued", "Test or duplicate"];

export function PlatformPage() {
  // "current" is the gyms you work with; archived gyms keep all their data and can be restored
  const [view, setView] = useState<"current" | "archived">("current");
  // the answer remembers which list it is, so the old list never shows under the new tab while the next one loads
  const state = useAsync(() => get(`/api/admin/gyms${view === "archived" ? "?archived=1" : ""}`).then((d: any) => ({ ...d, view })), [view]);
  const [archiving, setArchiving] = useState<any>(null);
  const [deleting, setDeleting] = useState<any>(null);
  const templates = useAsync(() => get("/api/admin/templates"), []);
  const [creating, setCreating] = useState(false);
  const [f, setF] = useState<any>({ template: "classic", level: "essential", saas_plan: "starter", brand_color: "#E4572E", demo_data: false });
  const [created, setCreated] = useState<any>(null);
  const [edit, setEdit] = useState<any>(null);
  const [wa, setWa] = useState<any>(null);
  const [account, setAccount] = useState(false);
  const { me } = useApp();
  const { busy, run } = useAction();
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Your gyms</h1><p>Who needs you today, then every gym you look after.</p></div>
        <div className="row">
          <a className="btn ghost small" href="/?site=1" target="_blank" rel="noreferrer">Website</a>
          <button className="btn ghost small" onClick={() => navigate("/developers")}>API reference</button>
          <button className="btn ghost small" onClick={() => setAccount(true)}>Your account</button>
          <button className="btn ghost small" onClick={async () => { await post("/api/auth/logout"); location.href = "/login"; }}>Sign out</button>
          <button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" />New gym</button>
        </div>
      </div>
      {!me.user.totp_enabled && (
        <div className="panel" style={{ padding: "12px 16px", borderColor: "var(--plate-yellow, #d99a00)" }}>
          <b>Turn on two-step sign-in.</b> This account can open every gym's data: a password alone is not enough protection. <button className="btn small" onClick={() => setAccount(true)}>Set it up</button>
        </div>
      )}
      <AccountModal open={account} onClose={() => setAccount(false)} />
      <DemoRequests />
      <Loader state={state}>
        {(d: any) => (
          <>
            <Tabs value={view} onChange={setView} tabs={[
              { value: "current", label: `Your gyms${d.view === "current" ? ` (${d.rows.length})` : ""}` },
              { value: "archived", label: `Archived (${d.totals.archived})` },
            ]} />
            {d.view === "current" && (() => {
              const list = needs(d.rows);
              return (
                <section className="panel" style={{ marginBottom: 24 }}>
                  <header><h2>Needs you today<span className="muted">{list.length}</span></h2></header>
                  {list.length ? (
                    <div className="list">
                      {list.map((n, i) => (
                        <div key={i}>
                          <span className="plate" data-s={n.kind === "money" ? "denied" : n.kind === "setup" ? "frozen" : "warn"} />
                          <span className="grow who"><b>{n.g.name}</b><small>{n.text}</small></span>
                          {waLink(n.g.owner_phone ?? n.g.phone, n.msg) ? <a className="btn small" href={waLink(n.g.owner_phone ?? n.g.phone, n.msg)} target="_blank" rel="noreferrer"><Icon name="whatsapp" />Message the owner</a> : <span className="muted">no phone on file</span>}
                          {n.kind === "money" || n.kind === "trial" ? <button className="btn small" onClick={() => setEdit({ ...n.g })}>Billing</button> : <button className="btn small" onClick={() => { setGymOverride(n.g.id); location.href = "/"; }}>Open</button>}
                        </div>
                      ))}
                    </div>
                  ) : <div className="body muted">Nothing. Every gym is paid up, set up and checking members in.</div>}
                </section>
              );
            })()}
            {d.view === "current" && <div className="figures">
              <div className="figure"><span className="label">Gyms</span><span className="value num-display">{d.totals.gyms}</span></div>
              <div className="figure"><span className="label">Paying</span><span className="value num-display">{d.totals.active}</span></div>
              <div className="figure"><span className="label">In trial</span><span className="value num-display">{d.totals.trial}</span></div>
              <div className="figure"><span className="label">Monthly recurring revenue</span><span className="value num-display">{money(d.totals.mrr)}</span></div>
            </div>}
            {d.view === "archived" && (
              d.rows.length ? (
                <div className="table-wrap"><table className="data">
                  <thead><tr><th>Gym</th><th>Archived</th><th>Reason</th><th>Members kept</th><th /></tr></thead>
                  <tbody>{d.rows.map((g: any) => (
                    <tr key={g.id}>
                      <td><span className="who"><b>{g.name}</b><small>/{g.slug} · {g.city ?? ""} · {g.owner_email}</small></span></td>
                      <td className="ink-2">{fmtDate(g.archived_at)}</td>
                      <td style={{ maxWidth: 320, whiteSpace: "normal" }}>{g.archived_reason}</td>
                      <td>{g.active_members}</td>
                      <td className="r">
                        <button className="btn small" onClick={() => { setGymOverride(g.id); location.href = "/members"; }}>Look inside</button>{" "}
                        <button className="btn small danger" onClick={() => setDeleting({ ...g, typed: "" })}>Delete for good</button>{" "}
                        <button className="btn small primary" disabled={busy} onClick={async () => {
                          const r = await run(() => post(`/api/admin/gyms/${g.id}/restore`));
                          if (r) { toast(`${g.name} is back in your gyms`); state.reload(); }
                        }}>Restore</button>
                      </td>
                    </tr>
                  ))}</tbody>
                </table></div>
              ) : <div className="panel body muted" style={{ marginTop: 16 }}>No archived gym. When a gym leaves GMS, archive it from your list: its data is kept and you can restore it any day.</div>
            )}
            {d.view === "current" && <div className="table-wrap"><table className="data">
              <thead><tr><th>Gym</th><th>Status</th><th>Plan</th><th>Set up</th><th>Active members</th><th>Check-ins, 7 days</th><th>Last sign-in</th><th /></tr></thead>
              <tbody>{d.rows.map((g: any) => (
                <tr key={g.id}>
                  <td><span className="who"><b>{g.name}{g.is_demo && <span className="tag" style={{ marginInlineStart: 6 }}>demo</span>}</b><small>/{g.slug} · {g.city ?? ""} · {g.owner_email}</small></span></td>
                  <td><span className="status"><span className="plate" data-s={STATUS_PLATE[g.saas_status]} />{g.saas_status.replace("_", " ")}</span>{g.saas_status === "trial" && g.trial_ends_at && <small className="muted"> until {fmtDate(g.trial_ends_at)}</small>}</td>
                  <td><span style={{ textTransform: "capitalize" }}>{g.saas_plan}</span>, {money(g.saas_price_usd)}<br /><small className="muted">{g.level ?? "full"} level</small></td>
                  <td>{(() => { const v = Object.values(g.setup ?? {}); const done = v.filter(Boolean).length; return done === v.length ? <span className="muted">done</span> : <b>{done} of {v.length}</b>; })()}</td>
                  <td>{g.active_members}</td><td>{g.checkins_7d}</td><td className="ink-2">{relDays(g.last_login)}</td>
                  <td className="r">
                    <button className="btn small" onClick={() => setEdit({ ...g })}>Billing</button>{" "}
                    <button className="btn small" onClick={() => setWa({ id: g.id, name: g.name, phoneNumberId: g.wa_phone_number_id ?? "", businessNumber: g.wa_business_number ?? "", hasToken: g.wa_has_token, token: "" })}><Icon name="whatsapp" />{g.wa_phone_number_id ? "Connected" : "WhatsApp"}</button>{" "}
                    <button className="btn small" onClick={() => setArchiving({ ...g, reason: "", other: "" })}>Archive</button>{" "}
                    <button className="btn small primary" onClick={() => { setGymOverride(g.id); location.href = "/"; }}>Open</button>
                  </td>
                </tr>
              ))}</tbody>
            </table></div>}
          </>
        )}
      </Loader>

      <Modal title="New gym" open={creating} onClose={() => setCreating(false)} wide
        footer={<button className="btn primary" disabled={busy || !f.name || !f.slug || !f.owner_email || !f.owner_name} onClick={async () => {
          const r = await run(() => post("/api/admin/gyms", f));
          if (r) { setCreated(r); setCreating(false); state.reload(); }
        }}>{busy ? "Creating…" : "Create gym"}</button>}>
        <Field label="Start from template">
          <div className="grid-2">{templates.data?.map((t: any) => (
            <label key={t.key} className="panel check" style={{ padding: 14, alignItems: "flex-start", borderColor: f.template === t.key ? "var(--brand)" : undefined }}>
              <input type="radio" name="tpl" checked={f.template === t.key} onChange={() => setF({ ...f, template: t.key })} />
              <span className="who"><b>{t.label}</b><small style={{ whiteSpace: "normal" }}>{t.description}</small></span>
            </label>
          ))}</div>
        </Field>
        <Field label="What they see at the start" hint="Start small. The owner can switch more on later in Settings.">
          <div className="grid-2" style={{ gridTemplateColumns: "repeat(3, minmax(0,1fr))" }}>{([["essential", "Essential", "Members, door, cash, WhatsApp"], ["studio", "Studio", "+ classes, training, member app"], ["full", "Everything", "+ shop, expenses, follow-up"]] as const).map(([k, title, desc]) => (
            <label key={k} className="panel check" style={{ padding: 14, alignItems: "flex-start", borderColor: f.level === k ? "var(--brand)" : undefined }}>
              <input type="radio" name="lvl" checked={f.level === k} onChange={() => setF({ ...f, level: k, saas_plan: k !== "essential" && f.saas_plan === "starter" ? "pro" : f.saas_plan })} />
              <span className="who"><b>{title}</b><small style={{ whiteSpace: "normal" }}>{desc}</small></span>
            </label>
          ))}</div>
        </Field>
        <div className="grid-2">
          <Field label="Gym name"><input className="input" value={f.name ?? ""} onChange={(e) => setF({ ...f, name: e.target.value, slug: f.slugTouched ? f.slug : e.target.value.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) })} /></Field>
          <Field label="Web address" hint={`${location.host}/m/${f.slug || "…"}`}><input className="input" value={f.slug ?? ""} onChange={(e) => setF({ ...f, slug: e.target.value, slugTouched: true })} /></Field>
          <Field label="City"><input className="input" value={f.city ?? ""} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
          <Field label="Brand colour"><input type="color" value={f.brand_color} onChange={(e) => setF({ ...f, brand_color: e.target.value })} style={{ width: 54, height: 40, border: 0, background: "none" }} /></Field>
          <Field label="Owner name"><input className="input" value={f.owner_name ?? ""} onChange={(e) => setF({ ...f, owner_name: e.target.value })} /></Field>
          <Field label="Owner email (login)"><input className="input" type="email" value={f.owner_email ?? ""} onChange={(e) => setF({ ...f, owner_email: e.target.value })} /></Field>
          <Field label="Owner WhatsApp" hint="Used for your follow-up messages"><input className="input" value={f.owner_phone ?? ""} onChange={(e) => setF({ ...f, owner_phone: e.target.value })} placeholder="+961 71 234 567" /></Field>
          <Field label="GMS plan" hint={f.level !== "essential" && f.saas_plan === "starter" ? "Starter does not include classes, training or the member app" : undefined}><select className="input" value={f.saas_plan} onChange={(e) => setF({ ...f, saas_plan: e.target.value })}><option value="starter">Starter · $29/month</option><option value="pro">Pro · $59/month</option><option value="elite">Elite · $99/month</option></select></Field>
        </div>
        <label className="check"><input type="checkbox" checked={f.demo_data} onChange={(e) => setF({ ...f, demo_data: e.target.checked })} /> Fill with realistic demo data (for sales demos only)</label>
      </Modal>

      {created && (
        <Modal title="Gym created" open onClose={() => setCreated(null)} footer={<button className="btn primary" onClick={() => setCreated(null)}>Done</button>}>
          <p>Send these to the owner. They choose their own password at the first sign-in.</p>
          <p>Login: <b>{created.ownerEmail}</b></p>
          <p>Temporary password: <b className="num-display" style={{ fontSize: "1.6rem", userSelect: "all" }}>{created.temporaryPassword}</b></p>
          <p>Sign-in page: <b>{location.origin}</b></p>
        </Modal>
      )}

      {wa && (
        <Modal title={`WhatsApp · ${wa.name}`} open onClose={() => setWa(null)}
          footer={<>
            {wa.hasToken && <button className="btn danger" disabled={busy} onClick={async () => { if (await run(() => put(`/api/admin/gyms/${wa.id}/whatsapp`, { phoneNumberId: null, token: "" }), "Disconnected")) { setWa(null); state.reload(); } }}>Disconnect</button>}
            <button className="btn primary" disabled={busy} onClick={async () => {
              const r = await run(() => put(`/api/admin/gyms/${wa.id}/whatsapp`, { phoneNumberId: wa.phoneNumberId.trim() || null, businessNumber: wa.businessNumber.trim() || null, ...(wa.token ? { token: wa.token } : {}) }), "Saved");
              if (r) { setWa(null); state.reload(); }
            }}>Save</button></>}>
          <p className="ink-2" style={{ marginTop: 0 }}>The gym's own WhatsApp Business number on Meta's Cloud API. A number can belong to one gym only, and it always sends with that gym's token.</p>
          <div className="grid-2">
            <Field label="Phone number ID (Meta)"><input className="input" inputMode="numeric" value={wa.phoneNumberId} onChange={(e) => setWa({ ...wa, phoneNumberId: e.target.value })} /></Field>
            <Field label="Business number"><input className="input" value={wa.businessNumber} onChange={(e) => setWa({ ...wa, businessNumber: e.target.value })} placeholder="+961 …" /></Field>
          </div>
          <Field label="Access token" hint={wa.hasToken ? "A token is saved (hidden). Paste a new one to replace it." : "Stored encrypted; never shown again."}><input className="input" type="password" value={wa.token} onChange={(e) => setWa({ ...wa, token: e.target.value })} /></Field>
          <p className="muted" style={{ fontSize: "0.85rem" }}>Webhook URL for Meta: <code>{location.origin}/api/webhooks/whatsapp</code></p>
        </Modal>
      )}

      {archiving && (() => {
        const reason = archiving.reason === "Other" ? archiving.other.trim() : [archiving.reason, archiving.other.trim()].filter(Boolean).join(": ");
        return (
          <Modal title={`Archive ${archiving.name}`} open onClose={() => setArchiving(null)}
            footer={<>
              <button className="btn" onClick={() => setArchiving(null)}>Cancel</button>
              <button className="btn primary" disabled={busy || reason.length < 2} onClick={async () => {
                const r = await run(() => post(`/api/admin/gyms/${archiving.id}/archive`, { reason }));
                if (r) { toast(`${archiving.name} archived. You can restore it from Archived.`); setArchiving(null); state.reload(); }
              }}>Archive the gym</button>
            </>}>
            <p style={{ marginBottom: 12 }}>The gym leaves your list. Its team and members are signed out and can no longer sign in, and reminders stop. <b>Nothing is deleted:</b> restore it any day and it comes back exactly as it was.</p>
            {/* a group of buttons, not a <label>: a label would press its first button on any click */}
            <div className="field" role="group" aria-labelledby="arch-why">
              <span id="arch-why">Why is it leaving?</span>
              <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                {[...ARCHIVE_REASONS, "Other"].map((x) => (
                  <button key={x} type="button" className="chip" aria-pressed={archiving.reason === x} onClick={() => setArchiving({ ...archiving, reason: x })}>{x}</button>
                ))}
              </div>
            </div>
            <Field label={archiving.reason === "Other" ? "Reason" : "Details (optional)"}>
              <textarea className="input" rows={3} maxLength={400} value={archiving.other} placeholder="What they said, what could bring them back…" onChange={(e) => setArchiving({ ...archiving, other: e.target.value })} />
            </Field>
          </Modal>
        );
      })()}

      {deleting && (
        <Modal title={`Delete ${deleting.name} for good`} open onClose={() => setDeleting(null)}
          footer={<>
            <button className="btn" onClick={() => setDeleting(null)}>Keep it archived</button>
            <button className="btn primary" style={{ background: "var(--plate-red)", borderColor: "var(--plate-red)" }} disabled={busy || deleting.typed.trim() !== deleting.slug} onClick={async () => {
              const r = await run(() => api(`/api/admin/gyms/${deleting.id}`, { method: "DELETE", body: { confirm: deleting.typed.trim() } }));
              if (r) { toast(`${deleting.name} was deleted`); setDeleting(null); state.reload(); }
            }}>Delete everything</button>
          </>}>
          <div className="panel" style={{ padding: "12px 16px", borderColor: "var(--plate-red)", marginBottom: 14 }}>
            <b>This cannot be undone.</b> Every member, membership, payment and receipt, check-in, class, message and staff account of this gym is erased. Nobody, not even GMS support, can bring it back.
          </div>
          <p className="muted" style={{ marginBottom: 12 }}>If the gym might come back, or if you may need its numbers one day, keep it archived instead. To keep a copy, use “Look inside”, then export the members to Excel first.</p>
          <Field label={`To confirm, type the gym's address: ${deleting.slug}`}>
            <input className="input" autoComplete="off" value={deleting.typed} onChange={(e) => setDeleting({ ...deleting, typed: e.target.value })} placeholder={deleting.slug} />
          </Field>
        </Modal>
      )}

      {edit && (
        <Modal title={`Billing · ${edit.name}`} open onClose={() => setEdit(null)}
          footer={<>
            <button className="btn" onClick={async () => { const r = await run(() => post(`/api/admin/gyms/${edit.id}/reset-owner`)); if (r) toast(`New owner password: ${r.temporaryPassword}`); }}>Reset owner password</button>
            <button className="btn primary" disabled={busy} onClick={async () => {
              const r = await run(() => put(`/api/admin/gyms/${edit.id}`, { saas_status: edit.saas_status, saas_plan: edit.saas_plan, saas_price_usd: Number(edit.saas_price_usd), saas_paid_until: edit.saas_paid_until || null }), "Saved");
              if (r) { setEdit(null); state.reload(); }
            }}>Save</button></>}>
          <div className="grid-2">
            <Field label="Status"><select className="input" value={edit.saas_status} onChange={(e) => setEdit({ ...edit, saas_status: e.target.value })}>{["trial", "active", "past_due", "suspended"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select></Field>
            <Field label="Plan"><select className="input" value={edit.saas_plan} onChange={(e) => setEdit({ ...edit, saas_plan: e.target.value })}>{["starter", "pro", "elite"].map((s) => <option key={s}>{s}</option>)}</select></Field>
            <Field label="Monthly price ($)"><input className="input" value={edit.saas_price_usd} onChange={(e) => setEdit({ ...edit, saas_price_usd: e.target.value })} /></Field>
            <Field label="Paid until"><input className="input" type="date" value={edit.saas_paid_until ?? ""} onChange={(e) => setEdit({ ...edit, saas_paid_until: e.target.value })} /></Field>
          </div>
          <p className="muted" style={{ fontSize: "0.85rem" }}>Suspended gyms cannot sign in and their member app goes offline; data is kept. A gym that left GMS is better archived: it leaves your list and keeps its data.</p>
        </Modal>
      )}
    </div>
  );
}

const DEMO_STATUS: Record<string, { label: string; plate: string }> = {
  new: { label: "New", plate: "warn" }, contacted: { label: "Contacted", plate: "frozen" }, demo_booked: { label: "Demo booked", plate: "ok" },
  won: { label: "Signed", plate: "ok" }, lost: { label: "Lost", plate: "expired" },
};

/** Requests sent from the "Book a demo" form of the GMS website. */
function DemoRequests() {
  const state = useAsync(() => get("/api/admin/demo-requests"), []);
  const { run } = useAction();
  return (
    <Loader state={state}>
      {(rows: any[]) => (
        <section className="panel">
          <header><h2>Demo requests from the website</h2><span className="muted">{rows.filter((r) => r.status === "new").length} new</span></header>
          {rows.length ? (
            <div className="table-wrap" style={{ border: 0 }}><table className="data">
              <thead><tr><th>Received</th><th>Gym</th><th>Contact</th><th>Size</th><th>Message</th><th>Status</th><th /></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id}>
                  <td>{fmtDate(r.created_at, { day: "numeric", month: "short" })}<br /><small className="muted">{relDays(r.created_at)}</small></td>
                  <td><b>{r.gym_name}</b>{r.city && <><br /><small className="muted">{r.city}</small></>}</td>
                  <td>{r.name}<br /><small className="muted">{r.phone}{r.email ? ` · ${r.email}` : ""}</small></td>
                  <td>{r.members ?? "—"}</td>
                  <td style={{ maxWidth: 280 }}><small>{r.message ?? ""}</small></td>
                  <td>
                    <select className="input" value={r.status} aria-label="Status" onChange={async (e) => { if (await run(() => put(`/api/admin/demo-requests/${r.id}`, { status: e.target.value }), "Updated")) state.reload(); }}>
                      {Object.entries(DEMO_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                  </td>
                  <td className="r"><a className="btn small" href={`https://wa.me/${r.phone.replace(/\D/g, "")}?text=${encodeURIComponent(`Hi ${r.name.split(" ")[0]}, it's GMS — thanks for your request! When would suit you for a 20-minute demo at ${r.gym_name}?`)}`} target="_blank" rel="noreferrer"><Icon name="whatsapp" />WhatsApp</a></td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : <div className="body muted">No requests yet. They arrive here from the “Book a demo” form on the website.</div>}
        </section>
      )}
    </Loader>
  );
}
