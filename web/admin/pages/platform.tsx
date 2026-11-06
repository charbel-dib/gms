/** GMS platform console for the GMS operator (super-admin). */
import React, { useState } from "react";
import { get, post, put, setGymOverride } from "../../shared/api.ts";
import { Field, Icon, Loader, Modal, toast, useAction, useAsync } from "../../shared/ui.tsx";
import { fmtDate, money, relDays } from "../../shared/i18n.ts";
import { navigate } from "../app.tsx";

const STATUS_PLATE: Record<string, string> = { active: "ok", trial: "warn", past_due: "denied", suspended: "frozen" };

export function PlatformPage() {
  const state = useAsync(() => get("/api/admin/gyms"), []);
  const templates = useAsync(() => get("/api/admin/templates"), []);
  const [creating, setCreating] = useState(false);
  const [f, setF] = useState<any>({ template: "classic", saas_plan: "pro", brand_color: "#E4572E", demo_data: false });
  const [created, setCreated] = useState<any>(null);
  const [edit, setEdit] = useState<any>(null);
  const { busy, run } = useAction();
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>GMS platform</h1><p>Your clients: onboard a gym in two minutes from a template, then adapt it with them.</p></div>
        <div className="row">
          <a className="btn" href="/?site=1" target="_blank" rel="noreferrer"><Icon name="globe" />Website</a>
          <button className="btn" onClick={() => navigate("/developers")}><Icon name="code" />API reference</button>
          <button className="btn" onClick={async () => { await post("/api/auth/logout"); location.href = "/login"; }}><Icon name="logout" />Sign out</button>
          <button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" />New gym</button>
        </div>
      </div>
      <DemoRequests />
      <Loader state={state}>
        {(d: any) => (
          <>
            <div className="figures">
              <div className="figure"><span className="label">Gyms</span><span className="value num-display">{d.totals.gyms}</span></div>
              <div className="figure"><span className="label">Paying</span><span className="value num-display">{d.totals.active}</span></div>
              <div className="figure"><span className="label">In trial</span><span className="value num-display">{d.totals.trial}</span></div>
              <div className="figure"><span className="label">Monthly recurring revenue</span><span className="value num-display">{money(d.totals.mrr)}</span></div>
            </div>
            <div className="table-wrap"><table className="data">
              <thead><tr><th>Gym</th><th>Status</th><th>Plan</th><th>Active members</th><th>Check-ins 7d</th><th>Last sign-in</th><th /></tr></thead>
              <tbody>{d.rows.map((g: any) => (
                <tr key={g.id}>
                  <td><span className="who"><b>{g.name}</b><small>/{g.slug} · {g.city ?? ""} · {g.owner_email}</small></span></td>
                  <td><span className="status"><span className="plate" data-s={STATUS_PLATE[g.saas_status]} />{g.saas_status.replace("_", " ")}</span>{g.saas_status === "trial" && g.trial_ends_at && <small className="muted"> until {fmtDate(g.trial_ends_at)}</small>}</td>
                  <td style={{ textTransform: "capitalize" }}>{g.saas_plan} · {money(g.saas_price_usd)}</td>
                  <td>{g.active_members}</td><td>{g.checkins_7d}</td><td className="ink-2">{relDays(g.last_login)}</td>
                  <td className="r">
                    <button className="btn small" onClick={() => setEdit({ ...g })}>Billing</button>{" "}
                    <button className="btn small primary" onClick={() => { setGymOverride(g.id); location.href = "/"; }}>Open</button>
                  </td>
                </tr>
              ))}</tbody>
            </table></div>
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
        <div className="grid-2">
          <Field label="Gym name"><input className="input" value={f.name ?? ""} onChange={(e) => setF({ ...f, name: e.target.value, slug: f.slugTouched ? f.slug : e.target.value.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) })} /></Field>
          <Field label="Web address" hint={`${location.host}/m/${f.slug || "…"}`}><input className="input" value={f.slug ?? ""} onChange={(e) => setF({ ...f, slug: e.target.value, slugTouched: true })} /></Field>
          <Field label="City"><input className="input" value={f.city ?? ""} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
          <Field label="Brand colour"><input type="color" value={f.brand_color} onChange={(e) => setF({ ...f, brand_color: e.target.value })} style={{ width: 54, height: 40, border: 0, background: "none" }} /></Field>
          <Field label="Owner name"><input className="input" value={f.owner_name ?? ""} onChange={(e) => setF({ ...f, owner_name: e.target.value })} /></Field>
          <Field label="Owner email (login)"><input className="input" type="email" value={f.owner_email ?? ""} onChange={(e) => setF({ ...f, owner_email: e.target.value })} /></Field>
          <Field label="GMS plan"><select className="input" value={f.saas_plan} onChange={(e) => setF({ ...f, saas_plan: e.target.value })}><option value="starter">Starter · $29/month</option><option value="pro">Pro · $59/month</option><option value="elite">Elite · $99/month</option></select></Field>
        </div>
        <label className="check"><input type="checkbox" checked={f.demo_data} onChange={(e) => setF({ ...f, demo_data: e.target.checked })} /> Fill with realistic demo data (for sales demos only)</label>
      </Modal>

      {created && (
        <Modal title="Gym created" open onClose={() => setCreated(null)} footer={<button className="btn primary" onClick={() => setCreated(null)}>Done</button>}>
          <p>Send these to the owner. They should change the password after the first sign-in.</p>
          <p>Login: <b>{created.ownerEmail}</b></p>
          <p>Temporary password: <b className="num-display" style={{ fontSize: "1.6rem", userSelect: "all" }}>{created.temporaryPassword}</b></p>
          <p>Sign-in page: <b>{location.origin}</b></p>
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
          <p className="muted" style={{ fontSize: "0.85rem" }}>Suspended gyms cannot sign in and their member app goes offline; data is kept.</p>
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
