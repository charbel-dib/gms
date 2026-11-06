/**
 * Member app: what members see and do in their gym's app, beyond their pass.
 * Offers (with photo, linked to a product or a plan), monthly challenges with a leaderboard,
 * referrals (who brings friends) and the engagement switches.
 */
import React, { useState } from "react";
import { del, get, post, put } from "../../shared/api.ts";
import { Empty, Field, Icon, Loader, Modal, Segmented, Tabs, toastError, useAction, useAsync } from "../../shared/ui.tsx";
import { fmtDate, money, t } from "../../shared/i18n.ts";
import { shrinkImage } from "../../shared/image.ts";
import { Link, useApp } from "../app.tsx";

type Tab = "offers" | "challenges" | "referrals" | "settings";
const today = () => new Date().toISOString().slice(0, 10);
const monthEnd = () => { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth() + 1, 0)).toISOString().slice(0, 10); };
const monthName = () => new Date().toLocaleDateString("en-GB", { month: "long" });

export function MemberAppPage() {
  const { me } = useApp();
  const [tab, setTab] = useState<Tab>("offers");
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{t("Member app")}</h1><p>What your members find in their app besides their pass: offers, challenges and invites for friends.</p></div>
        {me.gym && <a className="btn" href={`/m/${me.gym.slug}`} target="_blank" rel="noreferrer"><Icon name="phone" />Open the app</a>}
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: "offers", label: "Offers" },
        { value: "challenges", label: "Challenges" },
        { value: "referrals", label: "Referrals" },
        { value: "settings", label: t("Settings") },
      ]} />
      {tab === "offers" && <Offers />}
      {tab === "challenges" && <Challenges />}
      {tab === "referrals" && <Referrals />}
      {tab === "settings" && <EngageSettings />}
    </div>
  );
}

// ---------------- offers ----------------

function offerState(o: any) {
  const d = today();
  if (!o.active) return { s: "frozen", label: "Hidden" };
  if (o.starts_on && o.starts_on > d) return { s: "warn", label: `From ${fmtDate(o.starts_on)}` };
  if (o.ends_on && o.ends_on < d) return { s: "expired", label: "Ended" };
  return { s: "ok", label: o.ends_on ? `Until ${fmtDate(o.ends_on)}` : "Live" };
}

function Offers() {
  const state = useAsync(() => get("/api/offers"), []);
  const [edit, setEdit] = useState<any>(null);
  return (
    <div className="stack">
      <div className="spread">
        <p className="ink-2" style={{ margin: 0, maxWidth: "70ch" }}>Live offers appear at the top of the app's home screen. Link one to a product (members can tap “I want it”) or to a plan.</p>
        <button className="btn primary" onClick={() => setEdit({ title: "", body: "", badge: "", kind: "offer", product_id: "", plan_id: "", starts_on: "", ends_on: monthEnd(), active: true, notify: false })}><Icon name="plus" />New offer</button>
      </div>
      <Loader state={state}>
        {(list: any[]) => list.length ? (
          <div className="offer-grid">
            {list.map((o) => {
              const st = offerState(o);
              return (
                <button key={o.id} className="offer-card" onClick={() => setEdit({ ...o, product_id: o.product_id ?? "", plan_id: o.plan_id ?? "", starts_on: o.starts_on ?? "", ends_on: o.ends_on ?? "", body: o.body ?? "", badge: o.badge ?? "" })}>
                  <div className="offer-img">{o.has_image ? <img src={`/api/public/offers/${o.id}/image?v=${encodeURIComponent(o.created_at)}`} alt="" /> : <Icon name={o.kind === "event" ? "calendar" : "tag"} width={28} height={28} />}{o.badge && <span className="offer-badge">{o.badge}</span>}</div>
                  <div className="offer-body">
                    <b>{o.title}</b>
                    <small className="muted">{o.product_name ? `Product: ${o.product_name}` : o.plan_name ? `Plan: ${o.plan_name}` : o.kind === "event" ? "Event" : o.kind === "news" ? "News" : "Offer"}</small>
                    <span className="offer-state"><span className="plate" data-s={st.s} />{st.label}</span>
                  </div>
                </button>
              );
            })}
          </div>
        ) : <Empty title="No offers yet.">Try “-10% on protein this month” or “Bring a friend on Saturdays”.</Empty>}
      </Loader>
      {edit && <OfferModal o={edit} onClose={(saved) => { setEdit(null); if (saved) state.reload(); }} />}
    </div>
  );
}

function OfferModal({ o, onClose }: { o: any; onClose: (saved: boolean) => void }) {
  const [f, setF] = useState<any>(o);
  const [image, setImage] = useState<string | null | undefined>(undefined); // undefined = unchanged
  const products = useAsync(() => get("/api/shop/products"), []);
  const plans = useAsync(() => get("/api/plans"), []);
  const { busy, run } = useAction();
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const save = async () => {
    const body = { title: f.title, body: f.body || null, badge: f.badge || null, kind: f.kind, product_id: f.product_id || null, plan_id: f.plan_id || null, starts_on: f.starts_on || null, ends_on: f.ends_on || null, active: !!f.active };
    const r = await run(() => (f.id ? put(`/api/offers/${f.id}`, body) : post("/api/offers", { ...body, notify: !!f.notify })), f.id ? t("Save") : f.notify ? "Offer published and members notified" : "Offer published");
    if (!r) return;
    const id = f.id ?? r.id;
    if (image !== undefined) { try { await put(`/api/offers/${id}/image`, { image }); } catch (e) { toastError(e); } }
    onClose(true);
  };
  return (
    <Modal title={f.id ? "Edit offer" : "New offer"} open onClose={() => onClose(false)} wide
      footer={<>
        {f.id && <button className="btn ghost" disabled={busy} onClick={async () => { if (confirm("Delete this offer?") && await run(() => del(`/api/offers/${f.id}`), "Deleted")) onClose(true); }}>Delete</button>}
        <span className="grow" />
        <button className="btn primary" disabled={busy || !f.title.trim()} onClick={save}>{f.id ? t("Save") : "Publish"}</button>
      </>}>
      <div className="grid-2">
        <Field label="Title"><input className="input" value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="-15% on all protein" autoFocus maxLength={80} /></Field>
        <Field label="Label on the card" hint="Short: -15%, NEW, FREE, 2 for 1"><input className="input" value={f.badge} onChange={(e) => set("badge", e.target.value)} maxLength={14} /></Field>
      </div>
      <Field label="Text"><textarea className="input" rows={3} value={f.body} onChange={(e) => set("body", e.target.value)} placeholder="Until the end of the month, at reception or with “I want it” in the app." maxLength={600} dir="auto" /></Field>
      <div className="grid-3">
        <Field label="Type"><Segmented label="Type" value={f.kind} onChange={(v) => set("kind", v)} options={[{ value: "offer", label: "Offer" }, { value: "event", label: "Event" }, { value: "news", label: "News" }]} /></Field>
        <Field label="Starts"><input className="input" type="date" value={f.starts_on} onChange={(e) => set("starts_on", e.target.value)} /></Field>
        <Field label="Ends"><input className="input" type="date" value={f.ends_on} onChange={(e) => set("ends_on", e.target.value)} /></Field>
      </div>
      <div className="grid-2">
        <Field label="Linked product" hint="Members can ask for it from the offer">
          <select className="input" value={f.product_id} onChange={(e) => setF({ ...f, product_id: e.target.value, plan_id: e.target.value ? "" : f.plan_id })}>
            <option value="">None</option>
            {(products.data ?? []).filter((p: any) => p.active).map((p: any) => <option key={p.id} value={p.id}>{p.name}{p.kind === "bundle" ? " (bundle)" : ""} · {money(p.price, p.currency)}</option>)}
          </select>
        </Field>
        <Field label="Linked plan">
          <select className="input" value={f.plan_id} onChange={(e) => setF({ ...f, plan_id: e.target.value, product_id: e.target.value ? "" : f.product_id })}>
            <option value="">None</option>
            {(plans.data ?? []).filter((p: any) => p.active).map((p: any) => <option key={p.id} value={p.id}>{p.name} · {money(p.price, p.currency)}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Picture" hint="Optional. A photo of the product or the event; resized automatically.">
        <div className="row">
          {(image || (image === undefined && f.has_image)) && <img className="thumb" src={image ?? `/api/public/offers/${f.id}/image`} alt="" />}
          <input type="file" accept="image/*" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; try { setImage(await shrinkImage(file)); } catch (err) { toastError(err); } }} />
          {(image || (image === undefined && f.has_image)) && <button className="btn small ghost" onClick={() => setImage(null)}>Remove</button>}
        </div>
      </Field>
      <label className="check"><input type="checkbox" checked={!!f.active} onChange={(e) => set("active", e.target.checked)} /> Show in the app</label>
      {!f.id && <label className="check"><input type="checkbox" checked={!!f.notify} onChange={(e) => set("notify", e.target.checked)} /> Also send a notification to members with the app (respects quiet hours)</label>}
    </Modal>
  );
}

// ---------------- challenges ----------------

function Challenges() {
  const state = useAsync(() => get("/api/challenges"), []);
  const [edit, setEdit] = useState<any>(null);
  const [board, setBoard] = useState<any>(null);
  const start = today().slice(0, 8) + "01";
  return (
    <div className="stack">
      <div className="spread">
        <p className="ink-2" style={{ margin: 0, maxWidth: "70ch" }}>Every member takes part automatically and sees their progress and rank in the app (first name and initial; members can hide). Visits count once per day.</p>
        <button className="btn primary" onClick={() => setEdit({ title: `12 days in ${monthName()}`, description: "", metric: "visits", target: 12, starts_on: start, ends_on: monthEnd(), reward: "", active: true, notify: true })}><Icon name="plus" />New challenge</button>
      </div>
      <Loader state={state}>
        {(list: any[]) => list.length ? (
          <div className="stack">
            {list.map((c) => {
              const live = c.active && c.starts_on <= today() && c.ends_on >= today();
              return (
                <section key={c.id} className="panel challenge-row">
                  <div className="body spread" style={{ alignItems: "flex-start" }}>
                    <div className="stack-s" style={{ gap: 4 }}>
                      <div className="row"><span className="plate" data-s={live ? "ok" : c.ends_on < today() ? "expired" : "frozen"} /><b>{c.title}</b></div>
                      <small className="muted">{c.target} {c.metric === "classes" ? "classes" : "days at the gym"} · {fmtDate(c.starts_on)} → {fmtDate(c.ends_on)}{c.reward ? ` · Reward: ${c.reward}` : ""}</small>
                      <div className="row" style={{ gap: 16, marginTop: 6 }}>
                        <span><b className="num-display">{c.participants}</b> <small className="muted">taking part</small></span>
                        <span><b className="num-display">{c.finished}</b> <small className="muted">finished</small></span>
                        {c.leaders.length > 0 && <span className="muted" style={{ fontSize: "var(--step--1)" }}>Leading: {c.leaders.map((l: any) => `${l.name} (${l.score})`).join(", ")}</span>}
                      </div>
                    </div>
                    <div className="row">
                      <button className="btn small" onClick={() => setBoard(c)}><Icon name="trophy" />Leaderboard</button>
                      <button className="btn small ghost" onClick={() => setEdit({ ...c, description: c.description ?? "", reward: c.reward ?? "" })}>Edit</button>
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        ) : <Empty title="No challenge yet.">A monthly challenge (“12 days in {monthName()}”) is the simplest way to make members come more often.</Empty>}
      </Loader>
      {edit && <ChallengeModal c={edit} onClose={(saved) => { setEdit(null); if (saved) state.reload(); }} />}
      {board && <BoardModal c={board} onClose={() => setBoard(null)} />}
    </div>
  );
}

function ChallengeModal({ c, onClose }: { c: any; onClose: (saved: boolean) => void }) {
  const [f, setF] = useState<any>(c);
  const { busy, run } = useAction();
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const save = async () => {
    const body = { title: f.title, description: f.description || null, metric: f.metric, target: Number(f.target), starts_on: f.starts_on, ends_on: f.ends_on, reward: f.reward || null, active: !!f.active };
    const r = await run(() => (f.id ? put(`/api/challenges/${f.id}`, body) : post("/api/challenges", { ...body, notify: !!f.notify })), f.id ? t("Save") : "Challenge started");
    if (r) onClose(true);
  };
  return (
    <Modal title={f.id ? "Edit challenge" : "New challenge"} open onClose={() => onClose(false)}
      footer={<>
        {f.id && <button className="btn ghost" disabled={busy} onClick={async () => { if (confirm("Delete this challenge?") && await run(() => del(`/api/challenges/${f.id}`), "Deleted")) onClose(true); }}>Delete</button>}
        <span className="grow" />
        <button className="btn primary" disabled={busy || !f.title.trim() || !Number(f.target) || !f.starts_on || !f.ends_on} onClick={save}>{f.id ? t("Save") : "Start"}</button>
      </>}>
      {!f.id && (
        <div className="row" style={{ flexWrap: "wrap" }}>
          <span className="muted" style={{ fontSize: "var(--step--1)" }}>Ideas:</span>
          <button className="chip" onClick={() => setF({ ...f, title: `12 days in ${monthName()}`, metric: "visits", target: 12 })}>12 days this month</button>
          <button className="chip" onClick={() => setF({ ...f, title: `8 classes in ${monthName()}`, metric: "classes", target: 8 })}>8 classes this month</button>
          <button className="chip" onClick={() => setF({ ...f, title: "20 days before summer", metric: "visits", target: 20 })}>20 days</button>
        </div>
      )}
      <Field label="Title"><input className="input" value={f.title} onChange={(e) => set("title", e.target.value)} maxLength={80} /></Field>
      <div className="grid-2">
        <Field label="Counts"><Segmented label="Counts" value={f.metric} onChange={(v) => set("metric", v)} options={[{ value: "visits", label: "Days at the gym" }, { value: "classes", label: "Classes attended" }]} /></Field>
        <Field label="Target"><input className="input" inputMode="numeric" value={f.target} onChange={(e) => set("target", e.target.value.replace(/\D/g, ""))} /></Field>
        <Field label="Starts"><input className="input" type="date" value={f.starts_on} onChange={(e) => set("starts_on", e.target.value)} /></Field>
        <Field label="Ends"><input className="input" type="date" value={f.ends_on} onChange={(e) => set("ends_on", e.target.value)} /></Field>
      </div>
      <Field label="Reward" hint="Optional, shown to members: free shaker, 1 free week, a spot on our Instagram…"><input className="input" value={f.reward} onChange={(e) => set("reward", e.target.value)} maxLength={120} /></Field>
      <Field label="Description"><textarea className="input" rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} maxLength={400} dir="auto" /></Field>
      <label className="check"><input type="checkbox" checked={!!f.active} onChange={(e) => set("active", e.target.checked)} /> Active</label>
      {!f.id && <label className="check"><input type="checkbox" checked={!!f.notify} onChange={(e) => set("notify", e.target.checked)} /> Tell members with the app</label>}
    </Modal>
  );
}

function BoardModal({ c, onClose }: { c: any; onClose: () => void }) {
  const state = useAsync(() => get(`/api/challenges/${c.id}/leaderboard`), [c.id]);
  return (
    <Modal title={c.title} open onClose={onClose}>
      <Loader state={state}>
        {(d: any) => d.top.length ? (
          <div className="table-wrap" style={{ maxHeight: 420, overflow: "auto" }}><table className="data">
            <thead><tr><th>#</th><th>Member</th><th className="r">{c.metric === "classes" ? "Classes" : "Days"}</th><th /></tr></thead>
            <tbody>{d.top.map((r: any) => (
              <tr key={r.id}><td>{r.rank}</td><td><Link to={`/members/${r.id}`}>{r.name}</Link>{r.hidden && <small className="muted"> · hidden in the app</small>}</td>
                <td className="r num-display">{r.score}</td><td>{r.done && <span className="tag">finished</span>}</td></tr>
            ))}</tbody>
          </table></div>
        ) : <Empty title="Nobody has started yet." />}
      </Loader>
    </Modal>
  );
}

// ---------------- referrals ----------------

function Referrals() {
  const state = useAsync(() => get("/api/referrals"), []);
  return (
    <Loader state={state}>
      {(d: any) => (
        <div className="stack">
          <div className="figures">
            <div className="figure"><span className="label">Friends invited</span><span className="value num-display">{d.totals.leads}</span></div>
            <div className="figure"><span className="label">Became members</span><span className="value num-display">{d.totals.joined}</span></div>
            <div className="figure"><span className="label">Members who invite</span><span className="value num-display">{d.referrers.length}</span></div>
          </div>
          <p className="ink-2" style={{ margin: 0 }}>Each member has an invite link in the app. The friend leaves their name and number, it arrives in <Link to="/leads">Leads</Link>, and when reception creates the member with the same phone the referrer is credited and told.</p>
          <div className="cols">
            <section className="panel">
              <header><h2>Top referrers</h2></header>
              {d.referrers.length ? (
                <div className="list">{d.referrers.map((r: any) => (
                  <div key={r.id}><Link className="grow" to={`/members/${r.id}`}>{r.first_name} {r.last_name} <small className="muted">#{r.code}</small></Link>
                    <span className="muted" style={{ fontSize: "var(--step--1)" }}>{r.pending ? `${r.pending} to call · ` : ""}</span><b>{r.joined} joined</b></div>
                ))}</div>
              ) : <div className="body muted">No invitations yet.</div>}
            </section>
            <section className="panel">
              <header><h2>Latest invitations</h2></header>
              {d.recent.length ? (
                <div className="list">{d.recent.map((l: any) => (
                  <div key={l.id}><span className="grow">{l.name} <small className="muted">{l.phone}</small><br /><small className="muted">by {l.referrer} · {fmtDate(l.created_at)}</small></span>
                    <span className="tag">{l.status === "converted" ? "joined" : l.status}</span></div>
                ))}</div>
              ) : <div className="body muted">Nothing yet.</div>}
            </section>
          </div>
        </div>
      )}
    </Loader>
  );
}

// ---------------- settings ----------------

function EngageSettings() {
  const { reloadMe } = useApp();
  const gym = useAsync(() => get("/api/gym"), []);
  const { busy, run } = useAction();
  return (
    <Loader state={gym}>
      {(g: any) => {
        const e = { badges: true, challenges: true, leaderboard: true, referrals: true, referralReward: "", ...(g.settings?.engage ?? {}) };
        const save = async (patch: any) => { if (await run(() => put("/api/gym", { settings: { engage: patch } }), t("Saved"))) { gym.reload(); reloadMe?.(); } };
        const Toggle = ({ k, label, hint }: { k: string; label: string; hint: string }) => (
          <label className="check setting-row"><input type="checkbox" checked={!!e[k]} disabled={busy} onChange={(ev) => save({ [k]: ev.target.checked })} />
            <span><b>{label}</b><br /><small className="muted">{hint}</small></span></label>
        );
        return (
          <section className="panel" style={{ maxWidth: 720 }}>
            <header><h2>What the app offers</h2><span className="muted">Turn off anything your gym doesn't want</span></header>
            <div className="body stack">
              <Toggle k="badges" label="Badges" hint="Earned automatically: first visit, 10 visits, 4-week streak, early bird… Members are told when they earn one." />
              <Toggle k="challenges" label="Challenges" hint="Monthly goals you set, with progress in the app." />
              <Toggle k="leaderboard" label="Leaderboards" hint="Ranking inside challenges (first name and initial). Members can hide themselves." />
              <Toggle k="referrals" label="Invite a friend" hint="Each member gets a link to invite friends; their details arrive in Leads." />
              <Field label="Reward for bringing a friend" hint="Shown in the app and in the thank-you notification. You give it at reception.">
                <form className="row" onSubmit={(ev) => { ev.preventDefault(); save({ referralReward: String(new FormData(ev.currentTarget).get("reward") ?? "") }); }}>
                  <input className="input" name="reward" defaultValue={e.referralReward} placeholder="1 free week" maxLength={120} style={{ flex: 1 }} />
                  <button className="btn" disabled={busy}>{t("Save")}</button>
                </form>
              </Field>
            </div>
          </section>
        );
      }}
    </Loader>
  );
}
