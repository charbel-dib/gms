import React, { useEffect, useState } from "react";
import { get, post, put } from "../../shared/api.ts";
import { Field, Icon, Loader, Modal, Segmented, Tabs, toast, useAction, useAsync } from "../../shared/ui.tsx";
import { WEEKDAYS, fmtDate, money, t } from "../../shared/i18n.ts";
import { qrSvg } from "../../shared/qr.ts";
import { can, useApp } from "../app.tsx";

type Tab = "gym" | "plans" | "staff" | "rules" | "whatsapp" | "modules" | "app" | "audit";

export function SettingsPage() {
  const { me } = useApp();
  const [tab, setTab] = useState<Tab>("gym");
  return (
    <div className="page">
      <div className="page-head"><div><h1>{t("Settings")}</h1><p>Everything here is yours to adapt: branding, prices, rules and features.</p></div></div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: "gym", label: "Gym & branding" }, { value: "plans", label: "Plans & prices" }, { value: "staff", label: "Team" },
        { value: "rules", label: "Hours & rules" }, { value: "whatsapp", label: "WhatsApp" }, { value: "modules", label: "Features" },
        { value: "app", label: "Member app" }, ...(can(me, "owner") ? [{ value: "audit" as Tab, label: "Activity log" }] : []),
      ]} />
      {tab === "gym" && <GymTab />}
      {tab === "plans" && <PlansTab />}
      {tab === "staff" && <StaffTab />}
      {tab === "rules" && <RulesTab />}
      {tab === "whatsapp" && <WhatsAppTab />}
      {tab === "modules" && <ModulesTab />}
      {tab === "app" && <AppTab />}
      {tab === "audit" && <AuditTab />}
    </div>
  );
}

function useGymForm() {
  const { me, reloadMe } = useApp();
  const { busy, run } = useAction();
  const save = async (body: any) => {
    const r = await run(() => put("/api/gym", body), "Settings saved");
    if (r) await reloadMe();
    return r;
  };
  return { gym: me.gym, busy, save };
}

function GymTab() {
  const { gym, busy, save } = useGymForm();
  const { reloadMe } = useApp();
  const [f, setF] = useState<any>({});
  useEffect(() => { setF({ name: gym.name, name_ar: gym.name_ar ?? "", tagline: gym.tagline ?? "", brand_color: gym.brand_color, phone: gym.phone ?? "", whatsapp: gym.whatsapp ?? "", email: gym.email ?? "", instagram: gym.instagram ?? "", address: gym.address ?? "", city: gym.city ?? "", lbp_rate: gym.lbp_rate, default_currency: gym.default_currency, locale: gym.locale }); }, [gym.id]);
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  return (
    <div className="cols">
      <section className="panel"><div className="body stack">
        <div className="grid-2">
          <Field label="Gym name"><input className="input" value={f.name ?? ""} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="Name in Arabic"><input className="input" dir="rtl" value={f.name_ar ?? ""} onChange={(e) => set("name_ar", e.target.value)} /></Field>
        </div>
        <Field label="Tagline" hint="Shown on the member app"><input className="input" value={f.tagline ?? ""} onChange={(e) => set("tagline", e.target.value)} /></Field>
        <div className="grid-2">
          <Field label="Phone"><input className="input" value={f.phone ?? ""} onChange={(e) => set("phone", e.target.value)} /></Field>
          <Field label="WhatsApp number"><input className="input" value={f.whatsapp ?? ""} onChange={(e) => set("whatsapp", e.target.value)} /></Field>
          <Field label="Instagram"><input className="input" value={f.instagram ?? ""} onChange={(e) => set("instagram", e.target.value)} placeholder="@yourgym" /></Field>
          <Field label="Email"><input className="input" value={f.email ?? ""} onChange={(e) => set("email", e.target.value)} /></Field>
          <Field label="Address"><input className="input" value={f.address ?? ""} onChange={(e) => set("address", e.target.value)} /></Field>
          <Field label="City"><input className="input" value={f.city ?? ""} onChange={(e) => set("city", e.target.value)} /></Field>
        </div>
        <div className="grid-3">
          <Field label="Exchange rate (LBP per $)" hint="Used to convert lira payments"><input className="input" inputMode="numeric" value={f.lbp_rate ?? ""} onChange={(e) => set("lbp_rate", e.target.value)} /></Field>
          <Field label="Main currency"><Segmented label="Main currency" value={f.default_currency} onChange={(v) => set("default_currency", v)} options={[{ value: "USD", label: "USD" }, { value: "LBP", label: "LBP" }]} /></Field>
          <Field label="Language of messages"><Segmented label="Language of messages" value={f.locale} onChange={(v) => set("locale", v)} options={[{ value: "en", label: "English" }, { value: "ar", label: "عربي" }]} /></Field>
        </div>
        <div className="row"><button className="btn primary" disabled={busy} onClick={() => save({ ...f, lbp_rate: Number(f.lbp_rate), email: f.email || null, name_ar: f.name_ar || null })}>{t("Save")}</button></div>
      </div></section>
      <section className="panel">
        <header><h2>Brand</h2></header>
        <div className="body stack">
          <Field label="Brand colour" hint="Buttons, the member app and receipts use it">
            <div className="row"><input type="color" value={f.brand_color ?? "#e4572e"} onChange={(e) => set("brand_color", e.target.value)} style={{ width: 54, height: 40, border: 0, background: "none" }} />
              <button className="btn" onClick={() => save({ brand_color: f.brand_color })}>Apply colour</button></div>
          </Field>
          <Field label="Logo" hint="Square PNG or JPG, under 1.5 MB">
            <div className="row">
              {gym.has_logo && <img src={`/api/public/gyms/${gym.slug}/logo?${Date.now()}`} alt="Current logo" style={{ width: 56, height: 56, borderRadius: 10, objectFit: "cover" }} />}
              <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const dataUrl = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(file); });
                try { await put("/api/gym/logo", { dataUrl }); toast("Logo updated"); await reloadMe(); } catch (err: any) { toast(err.message, "error"); }
              }} />
            </div>
          </Field>
        </div>
      </section>
    </div>
  );
}

function PlansTab() {
  const state = useAsync(() => get("/api/plans"), []);
  const [edit, setEdit] = useState<any>(null);
  const { busy, run } = useAction();
  return (
    <div className="stack">
      <div className="spread"><p className="ink-2">Prices can change any time; memberships already sold keep their price.</p><button className="btn primary" onClick={() => setEdit({ kind: "time", duration_days: 30, price: "", currency: "USD", includes_classes: true, freeze_days_allowed: 0, active: true, sort: 0 })}><Icon name="plus" />New plan</button></div>
      <Loader state={state}>
        {(list: any[]) => (
          <div className="table-wrap"><table className="data">
            <thead><tr><th>Plan</th><th>Duration</th><th>Includes</th><th className="r">Price</th><th className="r">Sold</th><th /></tr></thead>
            <tbody>{list.map((p) => (
              <tr key={p.id} style={!p.active ? { opacity: 0.45 } : undefined}>
                <td><b>{p.name}</b> {p.name_ar && <span className="muted">{p.name_ar}</span>}</td>
                <td>{p.kind === "visits" ? `${p.visits} visits within ${p.duration_days} days` : `${p.duration_days} days`}</td>
                <td className="ink-2">{p.includes_classes ? "Gym + classes" : "Gym floor"}{p.freeze_days_allowed ? ` · ${p.freeze_days_allowed} freeze days` : ""}{p.gender_restriction ? ` · ${p.gender_restriction} only` : ""}</td>
                <td className="r"><b>{money(p.price, p.currency)}</b></td>
                <td className="r">{p.sold}</td>
                <td className="r"><button className="btn small" onClick={() => setEdit({ ...p })}>{t("Edit")}</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Loader>
      {edit && (
        <Modal title={edit.id ? `Edit ${edit.name}` : "New plan"} open onClose={() => setEdit(null)}
          footer={<button className="btn primary" disabled={busy || !edit.name || edit.price === ""} onClick={async () => {
            const body = { ...edit, price: Number(edit.price), duration_days: Number(edit.duration_days), visits: edit.kind === "visits" ? Number(edit.visits) : null, freeze_days_allowed: Number(edit.freeze_days_allowed || 0), gender_restriction: edit.gender_restriction || null, name_ar: edit.name_ar || null, sort: Number(edit.sort || 0) };
            delete body.id; delete body.gym_id; delete body.created_at; delete body.sold;
            const r = await run(() => (edit.id ? put(`/api/plans/${edit.id}`, body) : post("/api/plans", body)), t("Save"));
            if (r) { setEdit(null); state.reload(); }
          }}>{t("Save")}</button>}>
          <div className="grid-2">
            <Field label="Name"><input className="input" value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="1 Month" /></Field>
            <Field label="Name in Arabic"><input className="input" dir="rtl" value={edit.name_ar ?? ""} onChange={(e) => setEdit({ ...edit, name_ar: e.target.value })} /></Field>
          </div>
          <Field label="Type"><Segmented label="Type" value={edit.kind} onChange={(v) => setEdit({ ...edit, kind: v })} options={[{ value: "time", label: "Unlimited for a period" }, { value: "visits", label: "Pack of visits" }]} /></Field>
          <div className="grid-3">
            <Field label="Valid for (days)"><input className="input" type="number" value={edit.duration_days} onChange={(e) => setEdit({ ...edit, duration_days: e.target.value })} /></Field>
            {edit.kind === "visits" && <Field label="Visits"><input className="input" type="number" value={edit.visits ?? ""} onChange={(e) => setEdit({ ...edit, visits: e.target.value })} /></Field>}
            <Field label="Price"><input className="input" inputMode="decimal" value={edit.price} onChange={(e) => setEdit({ ...edit, price: e.target.value })} /></Field>
            <Field label={t("Currency")}><Segmented label={t("Currency")} value={edit.currency} onChange={(v) => setEdit({ ...edit, currency: v })} options={[{ value: "USD", label: "USD" }, { value: "LBP", label: "LBP" }]} /></Field>
            <Field label="Freeze days allowed"><input className="input" type="number" value={edit.freeze_days_allowed} onChange={(e) => setEdit({ ...edit, freeze_days_allowed: e.target.value })} /></Field>
            <Field label="Only for"><select className="input" value={edit.gender_restriction ?? ""} onChange={(e) => setEdit({ ...edit, gender_restriction: e.target.value })}><option value="">Everyone</option><option value="female">Women</option><option value="male">Men</option></select></Field>
          </div>
          <label className="check"><input type="checkbox" checked={!!edit.includes_classes} onChange={(e) => setEdit({ ...edit, includes_classes: e.target.checked })} /> Includes group classes</label>
          <label className="check"><input type="checkbox" checked={!!edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> On sale</label>
        </Modal>
      )}
    </div>
  );
}

function StaffTab() {
  const { me } = useApp();
  const state = useAsync(() => get("/api/staff"), []);
  const [edit, setEdit] = useState<any>(null);
  const [pw, setPw] = useState<string | null>(null);
  const { busy, run } = useAction();
  const roles: Record<string, string> = { owner: "Owner — everything", manager: "Manager — everything except the activity log", reception: "Reception — members, check-in, payments, no reports", coach: "Coach — own classes, PT clients and programs" };
  return (
    <div className="stack">
      <div className="spread"><p className="ink-2">Each person has their own login, so the activity log shows who did what.</p><button className="btn primary" onClick={() => setEdit({ role: "reception", active: true, commission_pct: 0 })}><Icon name="plus" />Add a team member</button></div>
      <Loader state={state}>
        {(list: any[]) => (
          <div className="table-wrap"><table className="data">
            <thead><tr><th>{t("Name")}</th><th>Role</th><th>Last sign-in</th><th /></tr></thead>
            <tbody>{list.map((u) => (
              <tr key={u.id} style={!u.active ? { opacity: 0.45 } : undefined}>
                <td><span className="who"><b>{u.name}</b><small>{u.email}</small></span></td>
                <td style={{ textTransform: "capitalize" }}>{u.role}{u.role === "coach" && Number(u.commission_pct) > 0 ? <small className="muted"> · {Number(u.commission_pct)}% PT commission</small> : ""}</td>
                <td className="ink-2">{u.last_login_at ? fmtDate(u.last_login_at) : "never"}</td>
                <td className="r"><button className="btn small" onClick={() => setEdit({ ...u })}>{t("Edit")}</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Loader>
      {edit && (
        <Modal title={edit.id ? edit.name : "Add a team member"} open onClose={() => setEdit(null)}
          footer={<>
            {edit.id && <button className="btn" disabled={busy} onClick={async () => { const r = await run(() => put(`/api/staff/${edit.id}`, { resetPassword: true })); if (r?.temporaryPassword) { setPw(r.temporaryPassword); setEdit(null); } }}>Reset password</button>}
            <button className="btn primary" disabled={busy || !edit.name || !edit.email} onClick={async () => {
              const body = { name: edit.name, email: edit.email, phone: edit.phone || null, role: edit.role, active: !!edit.active, bio: edit.bio || null, color: edit.color || null, commission_pct: Number(edit.commission_pct || 0) };
              const r = await run(() => (edit.id ? put(`/api/staff/${edit.id}`, body) : post("/api/staff", body)), t("Save"));
              if (r) { if (r.temporaryPassword) setPw(r.temporaryPassword); setEdit(null); state.reload(); }
            }}>{t("Save")}</button></>}>
          <div className="grid-2">
            <Field label={t("Name")}><input className="input" value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Email (login)"><input className="input" type="email" value={edit.email ?? ""} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
            <Field label={t("Phone")}><input className="input" value={edit.phone ?? ""} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
            <Field label="PT commission %"><input className="input" type="number" value={edit.commission_pct ?? 0} onChange={(e) => setEdit({ ...edit, commission_pct: e.target.value })} /></Field>
          </div>
          <Field label="Role"><select className="input" value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>{Object.entries(roles).filter(([k]) => k !== "owner" || can(me, "owner")).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          {edit.role !== "reception" && <Field label="Bio" hint="Shown to members and known by the assistant"><textarea className="input" value={edit.bio ?? ""} onChange={(e) => setEdit({ ...edit, bio: e.target.value })} /></Field>}
          {edit.id && <label className="check"><input type="checkbox" checked={!!edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Can sign in</label>}
        </Modal>
      )}
      {pw && (
        <Modal title="Temporary password" open onClose={() => setPw(null)} footer={<button className="btn primary" onClick={() => setPw(null)}>Done</button>}>
          <p>Give this password to the person. They can change it after signing in.</p>
          <p className="num-display" style={{ fontSize: "2rem", letterSpacing: "0.04em", userSelect: "all" }}>{pw}</p>
        </Modal>
      )}
    </div>
  );
}

function RulesTab() {
  const { gym, busy, save } = useGymForm();
  const s = gym.settings ?? {};
  const [hours, setHours] = useState<any[]>(() => (s.hours?.length ? s.hours : [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: "06:00", close: "23:00" }))));
  const [ladies, setLadies] = useState<any[]>(s.ladiesHours ?? []);
  const [ck, setCk] = useState({ graceDays: 0, blockOnBalance: false, cooldownMinutes: 60, ...(s.checkin ?? {}) });
  const [rem, setRem] = useState({ enabled: true, daysBefore: [7, 1], afterExpiryDays: [3], winback: true, ...(s.reminders ?? {}) });
  return (
    <div className="cols">
      <div className="stack">
        <section className="panel">
          <header><h2>Opening hours</h2></header>
          <div className="body stack-s">
            {hours.map((h, i) => (
              <div key={h.day} className="row">
                <span style={{ width: 90 }}>{t(WEEKDAYS[h.day])}</span>
                <label className="check"><input type="checkbox" checked={!h.closed} onChange={(e) => setHours(hours.map((x, j) => (j === i ? { ...x, closed: !e.target.checked } : x)))} /> Open</label>
                {!h.closed && <><input className="input" type="time" style={{ width: 120 }} value={h.open} onChange={(e) => setHours(hours.map((x, j) => (j === i ? { ...x, open: e.target.value } : x)))} />–
                  <input className="input" type="time" style={{ width: 120 }} value={h.close} onChange={(e) => setHours(hours.map((x, j) => (j === i ? { ...x, close: e.target.value } : x)))} /></>}
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <header><h2>Ladies-only hours</h2><button className="btn small" onClick={() => setLadies([...ladies, { day: 1, from: "10:00", to: "12:00" }])}><Icon name="plus" />Add</button></header>
          <div className="body stack-s">
            {ladies.length === 0 && <p className="muted">None. Men can enter during all opening hours.</p>}
            {ladies.map((h, i) => (
              <div key={i} className="row">
                <select className="input" style={{ width: 130 }} value={h.day} onChange={(e) => setLadies(ladies.map((x, j) => (j === i ? { ...x, day: Number(e.target.value) } : x)))}>{WEEKDAYS.map((w, d) => <option key={w} value={d}>{t(w)}</option>)}</select>
                <input className="input" type="time" style={{ width: 120 }} value={h.from} onChange={(e) => setLadies(ladies.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} />–
                <input className="input" type="time" style={{ width: 120 }} value={h.to} onChange={(e) => setLadies(ladies.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))} />
                <button className="btn small ghost" onClick={() => setLadies(ladies.filter((_, j) => j !== i))} aria-label="Remove"><Icon name="x" /></button>
              </div>
            ))}
            <p className="muted" style={{ fontSize: "0.85rem" }}>Check-in refuses men during these hours.</p>
          </div>
        </section>
      </div>
      <div className="stack">
        <section className="panel">
          <header><h2>Check-in rules</h2></header>
          <div className="body stack">
            <Field label="Grace days after expiry" hint="Members can still enter this many days after their membership ends (with a warning)"><input className="input" type="number" min={0} max={30} value={ck.graceDays} onChange={(e) => setCk({ ...ck, graceDays: Number(e.target.value) })} /></Field>
            <Field label="Ignore repeated scans for (minutes)"><input className="input" type="number" min={0} value={ck.cooldownMinutes} onChange={(e) => setCk({ ...ck, cooldownMinutes: Number(e.target.value) })} /></Field>
            <label className="check"><input type="checkbox" checked={ck.blockOnBalance} onChange={(e) => setCk({ ...ck, blockOnBalance: e.target.checked })} /> Refuse entry when the member owes money</label>
          </div>
        </section>
        <section className="panel">
          <header><h2>WhatsApp reminders</h2></header>
          <div className="body stack">
            <label className="check"><input type="checkbox" checked={rem.enabled} onChange={(e) => setRem({ ...rem, enabled: e.target.checked })} /> Remind members before their membership ends</label>
            <Field label="Days before the end" hint="Comma separated, 0 = on the last day"><input className="input" value={rem.daysBefore.join(", ")} onChange={(e) => setRem({ ...rem, daysBefore: e.target.value.split(",").map((x) => Number(x.trim())).filter((x) => !Number.isNaN(x)) })} /></Field>
            <Field label="Win-back message, days after expiry"><input className="input" value={rem.afterExpiryDays.join(", ")} onChange={(e) => setRem({ ...rem, afterExpiryDays: e.target.value.split(",").map((x) => Number(x.trim())).filter((x) => x > 0) })} /></Field>
            <Field label="Custom reminder text (optional)" hint="Variables: {name} {plan} {gym} {date} {days}"><textarea className="input" value={rem.templateEn ?? ""} onChange={(e) => setRem({ ...rem, templateEn: e.target.value })} /></Field>
          </div>
        </section>
        <button className="btn primary" disabled={busy} onClick={() => save({ settings: { hours, ladiesHours: ladies, checkin: ck, reminders: rem } })}>Save hours and rules</button>
      </div>
    </div>
  );
}

function WhatsAppTab() {
  const { gym, busy, save } = useGymForm();
  const wa = gym.settings?.whatsapp ?? {};
  const [pnid, setPnid] = useState(wa.phoneNumberId ?? "");
  const [num, setNum] = useState(wa.businessNumber ?? "");
  const [token, setToken] = useState("");
  return (
    <div className="cols">
      <section className="panel"><div className="body stack">
        <p>GMS works with WhatsApp in two ways:</p>
        <p><b>Click-to-send (active now).</b> Reminders and messages wait in Messages; one tap opens WhatsApp on the gym's phone with the text ready. No setup, no cost.</p>
        <p><b>Automatic (WhatsApp Business Platform).</b> Messages go out by themselves and the assistant answers members 24/7. Needs a Meta Business account and a dedicated number. GMS support sets it up with you.</p>
        <div className="grid-2">
          <Field label="Phone number ID (Meta)"><input className="input" value={pnid} onChange={(e) => setPnid(e.target.value)} /></Field>
          <Field label="Business number"><input className="input" value={num} onChange={(e) => setNum(e.target.value)} placeholder="+961 …" /></Field>
        </div>
        <Field label="Access token" hint={wa.hasToken ? "A token is saved (hidden). Paste a new one to replace it." : "Stored encrypted; never shown again."}><input className="input" type="password" value={token} onChange={(e) => setToken(e.target.value)} /></Field>
        <div className="row">
          <button className="btn primary" disabled={busy} onClick={() => save({ settings: { whatsapp: { phoneNumberId: pnid || null, businessNumber: num || null, ...(token ? { token } : {}) } } }).then(() => setToken(""))}>{t("Save")}</button>
          {wa.hasToken && <button className="btn danger" onClick={() => save({ settings: { whatsapp: { token: "" } } })}>Disconnect</button>}
        </div>
      </div></section>
      <section className="panel"><header><h2>Status</h2></header><div className="body"><p><span className="plate" data-s={wa.phoneNumberId && wa.hasToken ? "ok" : "warn"} /> {wa.phoneNumberId && wa.hasToken ? "Automatic sending is on." : "Click-to-send mode."}</p>
        <p className="muted" style={{ marginTop: 8, fontSize: "0.85rem" }}>Webhook URL for Meta: <code>{location.origin}/api/webhooks/whatsapp</code></p></div></section>
    </div>
  );
}

function ModulesTab() {
  const { gym, busy, save } = useGymForm();
  const mods = gym.modules ?? {};
  const list: [string, string, string][] = [
    ["classes", "Group classes", "Weekly schedule, bookings, waitlists"],
    ["pt", "Personal training", "PT packages, sessions, coach commissions, programs"],
    ["memberApp", "Member app", "Entry QR, class booking, membership status on the member's phone"],
    ["whatsapp", "WhatsApp", "Reminders, win-back, broadcasts"],
    ["ai", "Insights & assistant", "Churn prediction, Ask your gym, member assistant"],
    ["leads", "Leads", "Follow-up of people who asked about the gym"],
    ["expenses", "Expenses", "Costs and profit in Reports"],
  ];
  return (
    <section className="panel"><div className="list">
      {list.map(([k, title, desc]) => (
        <label key={k} className="check" style={{ padding: "14px 18px" }}>
          <input type="checkbox" checked={mods[k] !== false} disabled={busy} onChange={(e) => save({ modules: { [k]: e.target.checked } })} />
          <span className="who"><b>{title}</b><small>{desc}</small></span>
        </label>
      ))}
    </div></section>
  );
}

function AppTab() {
  const { gym } = useApp().me;
  const url = `${location.origin}/m/${gym.slug}`;
  return (
    <div className="cols">
      <section className="panel"><div className="body stack">
        <p>Your members' app lives at:</p>
        <p><a href={url} target="_blank" rel="noreferrer"><b>{url}</b></a></p>
        <p className="ink-2">Members open it once, sign in with their phone and the PIN you send them from their profile, then add it to their home screen. It shows their entry QR code, membership, classes and programs, in your colours.</p>
        <button className="btn" onClick={() => { navigator.clipboard?.writeText(url); toast("Link copied"); }}>Copy link</button>
      </div></section>
      <section className="panel"><header><h2>Poster for reception</h2></header><div className="body stack">
        <div style={{ width: 180 }} dangerouslySetInnerHTML={{ __html: qrSvg(url) }} />
        <p className="muted">Print this code at reception so members can open the app.</p>
        <button className="btn" onClick={() => window.print()}><Icon name="print" />Print</button>
      </div></section>
    </div>
  );
}

function AuditTab() {
  const state = useAsync(() => get("/api/audit"), []);
  return (
    <Loader state={state}>
      {(list: any[]) => (
        <div className="table-wrap"><table className="data">
          <thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead>
          <tbody>{list.map((a) => (
            <tr key={a.id}><td>{fmtDate(a.at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td><td>{a.user_name ?? "—"}</td><td>{a.action.replace(/[._]/g, " ")}{a.data?.reason ? ` · ${a.data.reason}` : ""}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </Loader>
  );
}
