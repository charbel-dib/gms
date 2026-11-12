/**
 * Member app: what members see and do in their gym's app, beyond their pass.
 * Offers (with photo, linked to a product or a plan), monthly challenges with a leaderboard,
 * referrals (who brings friends) and the engagement switches.
 */
import React, { useState } from "react";
import { del, get, post, put } from "../../shared/api.ts";
import { Empty, Field, Icon, Loader, Modal, Segmented, Tabs, toast, toastError, useAction, useAsync } from "../../shared/ui.tsx";
import { fmtDate, money, t } from "../../shared/i18n.ts";
import { shrinkImage } from "../../shared/image.ts";
import { qrSvg } from "../../shared/qr.ts";
import { Link, useApp } from "../app.tsx";

type Tab = "install" | "offers" | "challenges" | "referrals" | "settings";
const today = () => new Date().toISOString().slice(0, 10);
const monthEnd = () => { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth() + 1, 0)).toISOString().slice(0, 10); };
const monthName = () => new Date().toLocaleDateString("en-GB", { month: "long" });

export function MemberAppPage() {
  const { me } = useApp();
  const [tab, setTab] = useState<Tab>("install");
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{t("Member app")}</h1><p>{t("What your members find in their app besides their pass: offers, challenges and invites for friends.")}</p></div>
        {me.gym && <a className="btn" href={`/m/${me.gym.slug}`} target="_blank" rel="noreferrer"><Icon name="phone" />{t("Open the app")}</a>}
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: "install", label: t("Get the app") },
        { value: "offers", label: t("Offers") },
        { value: "challenges", label: t("Challenges") },
        { value: "referrals", label: t("Referrals") },
        { value: "settings", label: t("Settings") },
      ]} />
      {tab === "install" && <GetTheApp />}
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
  if (!o.active) return { s: "frozen", label: t("Hidden") };
  if (o.starts_on && o.starts_on > d) return { s: "warn", label: `From ${fmtDate(o.starts_on)}` };
  if (o.ends_on && o.ends_on < d) return { s: "expired", label: t("Ended") };
  return { s: "ok", label: o.ends_on ? `Until ${fmtDate(o.ends_on)}` : "Live" };
}

function Offers() {
  const state = useAsync(() => get("/api/offers"), []);
  const [edit, setEdit] = useState<any>(null);
  return (
    <div className="stack">
      <div className="spread">
        <p className="ink-2" style={{ margin: 0, maxWidth: "70ch" }}>{t("Live offers appear at the top of the app's home screen. Link one to a product (members can tap “I want it”) or to a plan.")}</p>
        <button className="btn primary" onClick={() => setEdit({ title: "", body: "", badge: "", kind: "offer", product_id: "", plan_id: "", starts_on: "", ends_on: monthEnd(), active: true, notify: false })}><Icon name="plus" />{t("New offer")}</button>
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
                    <small className="muted">{o.product_name ? `Product: ${o.product_name}` : o.plan_name ? `Plan: ${o.plan_name}` : o.kind === "event" ? t("Event") : o.kind === "news" ? t("News") : t("Offer")}</small>
                    <span className="offer-state"><span className="plate" data-s={st.s} />{st.label}</span>
                  </div>
                </button>
              );
            })}
          </div>
        ) : <Empty title={t("No offers yet.")}>{t("Try “-10% on protein this month” or “Bring a friend on Saturdays”.")}</Empty>}
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
    <Modal title={f.id ? t("Edit offer") : t("New offer")} open onClose={() => onClose(false)} wide
      footer={<>
        {f.id && <button className="btn ghost" disabled={busy} onClick={async () => { if (confirm(t("Delete this offer?")) && await run(() => del(`/api/offers/${f.id}`), "Deleted")) onClose(true); }}>{t("Delete")}</button>}
        <span className="grow" />
        <button className="btn primary" disabled={busy || !f.title.trim()} onClick={save}>{f.id ? t("Save") : t("Publish")}</button>
      </>}>
      <div className="grid-2">
        <Field label={t("Title")}><input className="input" value={f.title} onChange={(e) => set("title", e.target.value)} placeholder={t("-15% on all protein")} autoFocus maxLength={80} /></Field>
        <Field label={t("Label on the card")} hint={t("Short: -15%, NEW, FREE, 2 for 1")}><input className="input" value={f.badge} onChange={(e) => set("badge", e.target.value)} maxLength={14} /></Field>
      </div>
      <Field label={t("Text")}><textarea className="input" rows={3} value={f.body} onChange={(e) => set("body", e.target.value)} placeholder={t("Until the end of the month, at reception or with “I want it” in the app.")} maxLength={600} dir="auto" /></Field>
      <div className="grid-3">
        <Field label={t("Type")}><Segmented label={t("Type")} value={f.kind} onChange={(v) => set("kind", v)} options={[{ value: "offer", label: t("Offer") }, { value: "event", label: t("Event") }, { value: "news", label: t("News") }]} /></Field>
        <Field label={t("Starts")}><input className="input" type="date" value={f.starts_on} onChange={(e) => set("starts_on", e.target.value)} /></Field>
        <Field label={t("Ends")}><input className="input" type="date" value={f.ends_on} onChange={(e) => set("ends_on", e.target.value)} /></Field>
      </div>
      <div className="grid-2">
        <Field label={t("Linked product")} hint={t("Members can ask for it from the offer")}>
          <select className="input" value={f.product_id} onChange={(e) => setF({ ...f, product_id: e.target.value, plan_id: e.target.value ? "" : f.plan_id })}>
            <option value="">{t("None")}</option>
            {(products.data ?? []).filter((p: any) => p.active).map((p: any) => <option key={p.id} value={p.id}>{p.name}{p.kind === "bundle" ? " (bundle)" : ""} · {money(p.price, p.currency)}</option>)}
          </select>
        </Field>
        <Field label={t("Linked plan")}>
          <select className="input" value={f.plan_id} onChange={(e) => setF({ ...f, plan_id: e.target.value, product_id: e.target.value ? "" : f.product_id })}>
            <option value="">{t("None")}</option>
            {(plans.data ?? []).filter((p: any) => p.active).map((p: any) => <option key={p.id} value={p.id}>{p.name} · {money(p.price, p.currency)}</option>)}
          </select>
        </Field>
      </div>
      <Field label={t("Picture")} hint={t("Optional. A photo of the product or the event; resized automatically.")}>
        <div className="row">
          {(image || (image === undefined && f.has_image)) && <img className="thumb" src={image ?? `/api/public/offers/${f.id}/image`} alt="" />}
          <input type="file" accept="image/*" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; try { setImage(await shrinkImage(file)); } catch (err) { toastError(err); } }} />
          {(image || (image === undefined && f.has_image)) && <button className="btn small ghost" onClick={() => setImage(null)}>{t("Remove")}</button>}
        </div>
      </Field>
      <label className="check"><input type="checkbox" checked={!!f.active} onChange={(e) => set("active", e.target.checked)} /> {t("Show in the app")}</label>
      {!f.id && <label className="check"><input type="checkbox" checked={!!f.notify} onChange={(e) => set("notify", e.target.checked)} /> {t("Also send a notification to members with the app (respects quiet hours)")}</label>}
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
        <p className="ink-2" style={{ margin: 0, maxWidth: "70ch" }}>{t("Every member takes part automatically and sees their progress and rank in the app (first name and initial; members can hide). Visits count once per day.")}</p>
        <button className="btn primary" onClick={() => setEdit({ title: `12 days in ${monthName()}`, description: "", metric: "visits", target: 12, starts_on: start, ends_on: monthEnd(), reward: "", active: true, notify: true })}><Icon name="plus" />{t("New challenge")}</button>
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
                      <small className="muted">{c.target} {c.metric === "classes" ? "classes" : t("days at the gym")} · {fmtDate(c.starts_on)} → {fmtDate(c.ends_on)}{c.reward ? ` · Reward: ${c.reward}` : ""}</small>
                      <div className="row" style={{ gap: 16, marginTop: 6 }}>
                        <span><b className="num-display">{c.participants}</b> <small className="muted">{t("taking part")}</small></span>
                        <span><b className="num-display">{c.finished}</b> <small className="muted">finished</small></span>
                        {c.leaders.length > 0 && <span className="muted" style={{ fontSize: "var(--step--1)" }}>{t("Leading:")}{" "}{c.leaders.map((l: any) => `${l.name} (${l.score})`).join(", ")}</span>}
                      </div>
                    </div>
                    <div className="row">
                      <button className="btn small" onClick={() => setBoard(c)}><Icon name="trophy" />{t("Leaderboard")}</button>
                      <button className="btn small ghost" onClick={() => setEdit({ ...c, description: c.description ?? "", reward: c.reward ?? "" })}>{t("Edit")}</button>
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        ) : <Empty title={t("No challenge yet.")}>{t("A monthly challenge (“12 days in")}{" "}{monthName()}{t("”) is the simplest way to make members come more often.")}</Empty>}
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
    <Modal title={f.id ? t("Edit challenge") : t("New challenge")} open onClose={() => onClose(false)}
      footer={<>
        {f.id && <button className="btn ghost" disabled={busy} onClick={async () => { if (confirm(t("Delete this challenge?")) && await run(() => del(`/api/challenges/${f.id}`), "Deleted")) onClose(true); }}>{t("Delete")}</button>}
        <span className="grow" />
        <button className="btn primary" disabled={busy || !f.title.trim() || !Number(f.target) || !f.starts_on || !f.ends_on} onClick={save}>{f.id ? t("Save") : t("Start")}</button>
      </>}>
      {!f.id && (
        <div className="row" style={{ flexWrap: "wrap" }}>
          <span className="muted" style={{ fontSize: "var(--step--1)" }}>{t("Ideas:")}</span>
          <button className="chip" onClick={() => setF({ ...f, title: `12 days in ${monthName()}`, metric: "visits", target: 12 })}>{t("12 days this month")}</button>
          <button className="chip" onClick={() => setF({ ...f, title: `8 classes in ${monthName()}`, metric: "classes", target: 8 })}>{t("8 classes this month")}</button>
          <button className="chip" onClick={() => setF({ ...f, title: t("20 days before summer"), metric: "visits", target: 20 })}>{t("20 days")}</button>
        </div>
      )}
      <Field label={t("Title")}><input className="input" value={f.title} onChange={(e) => set("title", e.target.value)} maxLength={80} /></Field>
      <div className="grid-2">
        <Field label={t("Counts")}><Segmented label={t("Counts")} value={f.metric} onChange={(v) => set("metric", v)} options={[{ value: "visits", label: t("Days at the gym") }, { value: "classes", label: t("Classes attended") }]} /></Field>
        <Field label={t("Target")}><input className="input" inputMode="numeric" value={f.target} onChange={(e) => set("target", e.target.value.replace(/\D/g, ""))} /></Field>
        <Field label={t("Starts")}><input className="input" type="date" value={f.starts_on} onChange={(e) => set("starts_on", e.target.value)} /></Field>
        <Field label={t("Ends")}><input className="input" type="date" value={f.ends_on} onChange={(e) => set("ends_on", e.target.value)} /></Field>
      </div>
      <Field label={t("Reward")} hint={t("Optional, shown to members: free shaker, 1 free week, a spot on our Instagram…")}><input className="input" value={f.reward} onChange={(e) => set("reward", e.target.value)} maxLength={120} /></Field>
      <Field label={t("Description")}><textarea className="input" rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} maxLength={400} dir="auto" /></Field>
      <label className="check"><input type="checkbox" checked={!!f.active} onChange={(e) => set("active", e.target.checked)} /> {t("Active")}</label>
      {!f.id && <label className="check"><input type="checkbox" checked={!!f.notify} onChange={(e) => set("notify", e.target.checked)} /> {t("Tell members with the app")}</label>}
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
            <thead><tr><th>#</th><th>{t("Member")}</th><th className="r">{c.metric === "classes" ? t("Classes") : t("Days")}</th><th /></tr></thead>
            <tbody>{d.top.map((r: any) => (
              <tr key={r.id}><td>{r.rank}</td><td><Link to={`/members/${r.id}`}>{r.name}</Link>{r.hidden && <small className="muted"> {t("· hidden in the app")}</small>}</td>
                <td className="r num-display">{r.score}</td><td>{r.done && <span className="tag">finished</span>}</td></tr>
            ))}</tbody>
          </table></div>
        ) : <Empty title={t("Nobody has started yet.")} />}
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
            <div className="figure"><span className="label">{t("Friends invited")}</span><span className="value num-display">{d.totals.leads}</span></div>
            <div className="figure"><span className="label">{t("Became members")}</span><span className="value num-display">{d.totals.joined}</span></div>
            <div className="figure"><span className="label">{t("Members who invite")}</span><span className="value num-display">{d.referrers.length}</span></div>
          </div>
          <p className="ink-2" style={{ margin: 0 }}>{t("Each member has an invite link in the app. The friend leaves their name and number, it arrives in")}{" "}<Link to="/leads">{t("Leads")}</Link>{t(", and when reception creates the member with the same phone the referrer is credited and told.")}</p>
          <div className="cols">
            <section className="panel">
              <header><h2>{t("Top referrers")}</h2></header>
              {d.referrers.length ? (
                <div className="list">{d.referrers.map((r: any) => (
                  <div key={r.id}><Link className="grow" to={`/members/${r.id}`}>{r.first_name} {r.last_name} <small className="muted">#{r.code}</small></Link>
                    <span className="muted" style={{ fontSize: "var(--step--1)" }}>{r.pending ? `${r.pending} to call · ` : ""}</span><b>{r.joined} joined</b></div>
                ))}</div>
              ) : <div className="body muted">{t("No invitations yet.")}</div>}
            </section>
            <section className="panel">
              <header><h2>{t("Latest invitations")}</h2></header>
              {d.recent.length ? (
                <div className="list">{d.recent.map((l: any) => (
                  <div key={l.id}><span className="grow">{l.name} <small className="muted">{l.phone}</small><br /><small className="muted">by {l.referrer} · {fmtDate(l.created_at)}</small></span>
                    <span className="tag">{l.status === "converted" ? "joined" : l.status}</span></div>
                ))}</div>
              ) : <div className="body muted">{t("Nothing yet.")}</div>}
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
        const extras = (g.settings?.level ?? "full") === "full";
        const e = { badges: extras, challenges: extras, leaderboard: extras, referrals: extras, referralReward: "", ...(g.settings?.engage ?? {}) };
        const save = async (patch: any) => { if (await run(() => put("/api/gym", { settings: { engage: patch } }), t("Saved"))) { gym.reload(); reloadMe?.(); } };
        const Toggle = ({ k, label, hint }: { k: string; label: string; hint: string }) => (
          <label className="check setting-row"><input type="checkbox" checked={!!e[k]} disabled={busy} onChange={(ev) => save({ [k]: ev.target.checked })} />
            <span><b>{label}</b><br /><small className="muted">{hint}</small></span></label>
        );
        return (
          <section className="panel" style={{ maxWidth: 720 }}>
            <header><h2>{t("What the app offers")}</h2><span className="muted">{t("Turn off anything your gym doesn't want")}</span></header>
            <div className="body stack">
              <Toggle k="badges" label={t("Badges")} hint={t("Earned automatically: first visit, 10 visits, 4-week streak, early bird… Members are told when they earn one.")} />
              <Toggle k="challenges" label={t("Challenges")} hint={t("Monthly goals you set, with progress in the app.")} />
              <Toggle k="leaderboard" label={t("Leaderboards")} hint={t("Ranking inside challenges (first name and initial). Members can hide themselves.")} />
              <Toggle k="referrals" label={t("Invite a friend")} hint={t("Each member gets a link to invite friends; their details arrive in Leads.")} />
              <Field label={t("Reward for bringing a friend")} hint={t("Shown in the app and in the thank-you notification. You give it at reception.")}>
                <form className="row" onSubmit={(ev) => { ev.preventDefault(); save({ referralReward: String(new FormData(ev.currentTarget).get("reward") ?? "") }); }}>
                  <input className="input" name="reward" defaultValue={e.referralReward} placeholder={t("1 free week")} maxLength={120} style={{ flex: 1 }} />
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

// ---------------- getting the app on members' phones ----------------

/** Draws the square app icon: the logo on white (or the initial on the brand colour), with room for round masks. */
async function drawIcon(gym: any, size: number): Promise<string> {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const brand = /^#[0-9a-f]{6}$/i.test(gym.brand_color ?? "") ? gym.brand_color : "#e4572e";
  if (gym.has_logo) {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("The logo can't be read")); i.src = `/api/public/gyms/${gym.slug}/logo?${Date.now()}`; });
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);
    // Android cuts icons into circles: keep the logo inside the middle 70%
    const box = size * 0.7;
    const scale = Math.min(box / img.naturalWidth, box / img.naturalHeight);
    const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
  } else {
    ctx.fillStyle = brand;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#ffffff";
    ctx.font = `600 ${Math.round(size * 0.5)}px Alexandria, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText((gym.name ?? "G").trim()[0].toUpperCase(), size / 2, size / 2 + size * 0.03);
  }
  return c.toDataURL("image/png");
}

function posterHtml(gym: any, link: string) {
  const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const brand = /^#[0-9a-f]{6}$/i.test(gym.brand_color ?? "") ? gym.brand_color : "#e4572e";
  const icon = gym.has_app_icon ? `/api/public/gyms/${gym.slug}/app-icon/512` : gym.has_logo ? `/api/public/gyms/${gym.slug}/logo` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(gym.name)} app poster</title><style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; } body { margin: 0; font-family: "Segoe UI", Inter, system-ui, Arial, sans-serif; color: #1a2230; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .p { width: 210mm; height: 297mm; padding: 18mm 18mm 14mm; display: flex; flex-direction: column; align-items: center; text-align: center; border-top: 14mm solid ${brand}; }
  .icon { width: 30mm; height: 30mm; border-radius: 7mm; overflow: hidden; background: ${brand}; color: #fff; font: 800 18mm/30mm system-ui; box-shadow: 0 2mm 6mm rgba(0,0,0,.15); }
  .icon img { width: 100%; height: 100%; object-fit: cover; background: #fff; }
  h1 { font-size: 30pt; margin: 9mm 0 2mm; line-height: 1.05; } .ar { font-size: 20pt; margin: 0 0 3mm; direction: rtl; font-weight: 700; }
  .sub { font-size: 13pt; color: #4b5566; margin: 0; max-width: 140mm; }
  .qr { width: 92mm; height: 92mm; margin: 9mm 0 4mm; padding: 4mm; border: 1.2mm solid #1a2230; border-radius: 6mm; } .qr svg { width: 100%; height: 100%; }
  .scan { font-size: 15pt; font-weight: 700; margin: 0; } .url { font-size: 11pt; color: #4b5566; margin: 2mm 0 0; }
  .how { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; width: 100%; margin-top: auto; text-align: left; }
  .how div { border: 0.4mm solid #dde1e6; border-radius: 4mm; padding: 5mm 6mm; } .how b { font-size: 12pt; } .how ol { margin: 2mm 0 0; padding-left: 5mm; font-size: 10.5pt; line-height: 1.55; color: #4b5566; }
  </style></head><body><div class="p">
  <div class="icon">${icon ? `<img src="${icon}" alt="">` : esc(gym.name[0] ?? "G")}</div>
  <h1>Get the ${esc(gym.name)} app</h1>
  <p class="ar">حمّل تطبيق النادي</p>
  <p class="sub">Your entry QR code, classes, personal training and offers. Free, no App Store needed.</p>
  <div class="qr">${qrSvg(link)}</div>
  <p class="scan">Scan with your phone camera</p><p class="url">${esc(link)}</p>
  <div class="how">
    <div><b>iPhone</b><ol><li>Open the link in Safari</li><li>Tap Share, then “Add to Home Screen”</li><li>Open the app and sign in with the PIN from reception</li></ol></div>
    <div><b>Android</b><ol><li>Open the link in Chrome</li><li>Tap “Install the app”</li><li>Open the app and sign in with the PIN from reception</li></ol></div>
  </div></div></body></html>`;
}

function GetTheApp() {
  const { me, reloadMe } = useApp();
  const gym = useAsync(() => get("/api/public/gyms/" + me.gym!.slug), [me.gym?.slug]);
  const [poster, setPoster] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const { busy, run } = useAction();
  const frame = React.useRef<HTMLIFrameElement>(null);
  const link = `${location.origin}/m/${me.gym!.slug}/install`;
  return (
    <Loader state={gym}>
      {(g: any) => (
        <div className="cols">
          <section className="panel">
            <header><h2>{t("Members install the app from a link")}</h2></header>
            <div className="body stack">
              <p className="ink-2" style={{ margin: 0 }}>{t("No App Store or Play Store: the link opens a page that shows each member the right steps for their phone. On Android it's one tap on “Install”; on iPhone it's Share, then “Add to Home Screen”. The app then opens from their home screen with your name and icon.")}</p>
              <div className="row" style={{ alignItems: "center", gap: 18, flexWrap: "wrap" }}>
                <div className="install-qr" dangerouslySetInnerHTML={{ __html: qrSvg(link) }} />
                <div className="stack-s" style={{ flex: 1, minWidth: 220 }}>
                  <code className="install-link">{link}</code>
                  <div className="row" style={{ flexWrap: "wrap" }}>
                    <button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(link); toast(t("Link copied")); } catch { prompt("Copy this link", link); } }}>{t("Copy link")}</button>
                    <button className="btn primary" onClick={() => setPoster(true)}><Icon name="print" />{t("Print the poster")}</button>
                    <a className="btn ghost" href={link} target="_blank" rel="noreferrer">{t("Open")}</a>
                  </div>
                  <small className="muted">{t("The link is also in the WhatsApp message sent with each member's PIN (Members → App access).")}</small>
                </div>
              </div>
            </div>
          </section>
          <section className="panel">
            <header><h2>{t("App icon")}</h2></header>
            <div className="body stack">
              <p className="ink-2" style={{ margin: 0 }}>{t("What members see on their home screen. Made from your logo")}{g.has_logo ? "" : t(" (none yet: your initial on your colour is used)")}.</p>
              <div className="row" style={{ alignItems: "center", gap: 16 }}>
                <img className="app-icon-preview" src={preview ?? (g.has_app_icon ? `/api/public/gyms/${g.slug}/app-icon/512?v=${g.icon_version}` : "/icon-192.png")} alt="App icon" />
                <div className="stack-s">
                  <b>{g.name}</b>
                  <small className="muted">{g.has_app_icon || preview ? t("Your gym's icon") : t("Default GMS icon for now")}</small>
                </div>
              </div>
              <div className="row">
                <button className="btn primary" disabled={busy} onClick={async () => {
                  try {
                    const [icon512, icon192] = [await drawIcon(g, 512), await drawIcon(g, 192)];
                    setPreview(icon512);
                    if (await run(() => put("/api/gym/app-icon", { icon512, icon192 }), "App icon saved")) { gym.reload(); reloadMe?.(); }
                  } catch (e) { toastError(e); }
                }}>{g.has_app_icon ? t("Make it again") : t("Make the app icon")}</button>
              </div>
              <small className="muted">{t("Change the logo in Settings → Gym, then make the icon again. Members who already installed the app get the new icon after a while.")}</small>
            </div>
          </section>
          <Modal title={t("Poster for reception")} open={poster} onClose={() => setPoster(false)} wide
            footer={<button className="btn primary" onClick={() => frame.current?.contentWindow?.print()}><Icon name="print" />{t("Print")}</button>}>
            {poster && <iframe ref={frame} title={t("Poster")} srcDoc={posterHtml(g, link)} className="report-frame" />}
          </Modal>
        </div>
      )}
    </Loader>
  );
}
