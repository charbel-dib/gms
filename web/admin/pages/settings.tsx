import React, { useEffect, useState } from "react";
import { get, post, put } from "../../shared/api.ts";
import { Empty, Field, Icon, Loader, Modal, Segmented, Tabs, toast, useAction, useAsync } from "../../shared/ui.tsx";
import { WEEKDAYS, fmtDate, money, t } from "../../shared/i18n.ts";
import { qrSvg } from "../../shared/qr.ts";
import { Link, can, moduleOn, useApp } from "../app.tsx";
import { MyTelegram } from "../telegram.tsx";

type Tab = "gym" | "plans" | "staff" | "rules" | "modules" | "more";
type More = "whatsapp" | "telegram" | "app" | "notifications" | "audit";

/**
 * Five tabs an owner actually visits, in the order they set a gym up.
 * Everything rarely touched (WhatsApp connection, notification rules, activity log) sits under "Advanced".
 */
export function SettingsPage() {
  const { me } = useApp();
  const q = new URLSearchParams(location.search).get("tab") as Tab | null;
  const [tab, setTab] = useState<Tab>(q ?? "gym");
  const [more, setMore] = useState<More>("notifications");
  const moreTabs: { value: More; label: string }[] = [
    { value: "notifications", label: t("Reminders") },
    { value: "whatsapp", label: t("WhatsApp") },
    { value: "telegram", label: t("Telegram") },
    ...(moduleOn(me, "memberApp") ? [{ value: "app" as More, label: t("Member app") }] : []),
    ...(can(me, "owner") ? [{ value: "audit" as More, label: t("Activity log") }] : []),
  ];
  return (
    <div className="page">
      <div className="page-head"><div><h1>{t("Settings")}</h1><p>{t("Your gym, your prices, your rules.")}</p></div></div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: "gym", label: t("Your gym") }, { value: "plans", label: t("Prices") }, { value: "staff", label: t("Team") },
        { value: "rules", label: t("Hours and rules") }, { value: "modules", label: t("What you use") }, { value: "more", label: t("Advanced") },
      ]} />
      {tab === "gym" && <GymTab />}
      {tab === "plans" && <PlansTab />}
      {tab === "staff" && <StaffTab />}
      {tab === "rules" && <RulesTab />}
      {tab === "modules" && <ModulesTab />}
      {tab === "more" && (
        <>
          <Segmented label={t("Advanced")} value={more} onChange={setMore} options={moreTabs} />
          <div style={{ height: 16 }} />
          {more === "whatsapp" && <WhatsAppTab />}
          {more === "telegram" && <TelegramTab />}
          {more === "app" && <AppTab />}
          {more === "notifications" && <NotificationsTab />}
          {more === "audit" && <AuditTab />}
        </>
      )}
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
          <Field label={t("Gym name")}><input className="input" value={f.name ?? ""} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label={t("Name in Arabic")}><input className="input" dir="rtl" value={f.name_ar ?? ""} onChange={(e) => set("name_ar", e.target.value)} /></Field>
        </div>
        <Field label={t("Tagline")} hint={t("Shown on the member app")}><input className="input" value={f.tagline ?? ""} onChange={(e) => set("tagline", e.target.value)} /></Field>
        <div className="grid-2">
          <Field label={t("Phone")}><input className="input" value={f.phone ?? ""} onChange={(e) => set("phone", e.target.value)} /></Field>
          <Field label={t("WhatsApp number")}><input className="input" value={f.whatsapp ?? ""} onChange={(e) => set("whatsapp", e.target.value)} /></Field>
          <Field label={t("Instagram")}><input className="input" value={f.instagram ?? ""} onChange={(e) => set("instagram", e.target.value)} placeholder={t("@yourgym")} /></Field>
          <Field label={t("Email")}><input className="input" value={f.email ?? ""} onChange={(e) => set("email", e.target.value)} /></Field>
          <Field label={t("Address")}><input className="input" value={f.address ?? ""} onChange={(e) => set("address", e.target.value)} /></Field>
          <Field label={t("City")}><input className="input" value={f.city ?? ""} onChange={(e) => set("city", e.target.value)} /></Field>
        </div>
        <div className="grid-3">
          <Field label={t("Exchange rate (LBP per $)")} hint={t("Used to convert lira payments")}><input className="input" inputMode="numeric" value={f.lbp_rate ?? ""} onChange={(e) => set("lbp_rate", e.target.value)} /></Field>
          <Field label={t("Main currency")}><Segmented label={t("Main currency")} value={f.default_currency} onChange={(v) => set("default_currency", v)} options={[{ value: "USD", label: "USD" }, { value: "LBP", label: "LBP" }]} /></Field>
          <Field label={t("Language of messages")}><Segmented label={t("Language of messages")} value={f.locale} onChange={(v) => set("locale", v)} options={[{ value: "en", label: t("English") }, { value: "ar", label: "عربي" }]} /></Field>
        </div>
        <div className="row"><button className="btn primary" disabled={busy} onClick={() => save({ ...f, lbp_rate: Number(f.lbp_rate), email: f.email || null, name_ar: f.name_ar || null })}>{t("Save")}</button></div>
      </div></section>
      <section className="panel">
        <header><h2>{t("Brand")}</h2></header>
        <div className="body stack">
          <Field label={t("Brand colour")} hint={t("Buttons, the member app and receipts use it")}>
            <div className="row"><input type="color" value={f.brand_color ?? "#e4572e"} onChange={(e) => set("brand_color", e.target.value)} style={{ width: 54, height: 40, border: 0, background: "none" }} />
              <button className="btn" onClick={() => save({ brand_color: f.brand_color })}>{t("Apply colour")}</button></div>
          </Field>
          <Field label={t("Logo")} hint={t("Square PNG or JPG, under 1.5 MB")}>
            <div className="row">
              {gym.has_logo && <img src={`/api/public/gyms/${gym.slug}/logo?${Date.now()}`} alt="Current logo" style={{ width: 56, height: 56, borderRadius: 10, objectFit: "cover" }} />}
              <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const dataUrl = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(file); });
                try { await put("/api/gym/logo", { dataUrl }); toast(t("Logo updated")); await reloadMe(); } catch (err: any) { toast(err.message, "error"); }
              }} />
            </div>
          </Field>
        </div>
      </section>
    </div>
  );
}

/** New gyms start with example prices: one tap confirms them, or the owner edits them below. */
function PricesOk() {
  const { gym, busy, save } = useGymForm();
  if (gym.setup?.prices !== false) return null;
  return (
    <div className="start" style={{ marginBottom: 16 }}>
      <div><b>{t("These are example prices.")}</b><span>{t("Change them to yours, or confirm them if they are right.")}</span></div>
      <div><button className="btn" disabled={busy} onClick={() => save({ settings: { setup: { prices: true } } })}>{t("These prices are right")}</button></div>
    </div>
  );
}

function PlansTab() {
  const state = useAsync(() => get("/api/plans"), []);
  const [edit, setEdit] = useState<any>(null);
  const { busy, run } = useAction();
  return (
    <div className="stack">
      <PricesOk />
      <div className="spread"><p className="ink-2">{t("Prices can change any time; memberships already sold keep their price.")}</p><button className="btn primary" onClick={() => setEdit({ kind: "time", duration_days: 30, price: "", currency: "USD", includes_classes: true, freeze_days_allowed: 0, active: true, sort: 0 })}><Icon name="plus" />{t("New plan")}</button></div>
      <Loader state={state}>
        {(list: any[]) => (
          <div className="table-wrap"><table className="data">
            <thead><tr><th>{t("Plan")}</th><th>{t("Duration")}</th><th>{t("Includes")}</th><th className="r">{t("Price")}</th><th className="r">{t("Sold")}</th><th /></tr></thead>
            <tbody>{list.map((p) => (
              <tr key={p.id} style={!p.active ? { opacity: 0.45 } : undefined}>
                <td><b>{p.name}</b> {p.name_ar && <span className="muted">{p.name_ar}</span>}</td>
                <td>{p.kind === "visits" ? `${p.visits} visits within ${p.duration_days} days` : `${p.duration_days} days`}</td>
                <td className="ink-2">{p.includes_classes ? t("Gym + classes") : t("Gym floor")}{p.freeze_days_allowed ? ` · ${p.freeze_days_allowed} freeze days` : ""}{p.gender_restriction ? ` · ${p.gender_restriction} only` : ""}</td>
                <td className="r"><b>{money(p.price, p.currency)}</b></td>
                <td className="r">{p.sold}</td>
                <td className="r"><button className="btn small" onClick={() => setEdit({ ...p })}>{t("Edit")}</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Loader>
      {edit && (
        <Modal title={edit.id ? `Edit ${edit.name}` : t("New plan")} open onClose={() => setEdit(null)}
          footer={<button className="btn primary" disabled={busy || !edit.name || edit.price === ""} onClick={async () => {
            const body = { ...edit, price: Number(edit.price), duration_days: Number(edit.duration_days), visits: edit.kind === "visits" ? Number(edit.visits) : null, freeze_days_allowed: Number(edit.freeze_days_allowed || 0), gender_restriction: edit.gender_restriction || null, name_ar: edit.name_ar || null, sort: Number(edit.sort || 0) };
            delete body.id; delete body.gym_id; delete body.created_at; delete body.sold;
            const r = await run(() => (edit.id ? put(`/api/plans/${edit.id}`, body) : post("/api/plans", body)), t("Save"));
            if (r) { setEdit(null); state.reload(); }
          }}>{t("Save")}</button>}>
          <div className="grid-2">
            <Field label={t("Name")}><input className="input" value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder={t("1 Month")} /></Field>
            <Field label={t("Name in Arabic")}><input className="input" dir="rtl" value={edit.name_ar ?? ""} onChange={(e) => setEdit({ ...edit, name_ar: e.target.value })} /></Field>
          </div>
          <Field label={t("Type")}><Segmented label={t("Type")} value={edit.kind} onChange={(v) => setEdit({ ...edit, kind: v })} options={[{ value: "time", label: t("Unlimited for a period") }, { value: "visits", label: t("Pack of visits") }]} /></Field>
          <div className="grid-3">
            <Field label={t("Valid for (days)")}><input className="input" type="number" value={edit.duration_days} onChange={(e) => setEdit({ ...edit, duration_days: e.target.value })} /></Field>
            {edit.kind === "visits" && <Field label={t("Visits")}><input className="input" type="number" value={edit.visits ?? ""} onChange={(e) => setEdit({ ...edit, visits: e.target.value })} /></Field>}
            <Field label={t("Price")}><input className="input" inputMode="decimal" value={edit.price} onChange={(e) => setEdit({ ...edit, price: e.target.value })} /></Field>
            <Field label={t("Currency")}><Segmented label={t("Currency")} value={edit.currency} onChange={(v) => setEdit({ ...edit, currency: v })} options={[{ value: "USD", label: "USD" }, { value: "LBP", label: "LBP" }]} /></Field>
            <Field label={t("Freeze days allowed")}><input className="input" type="number" value={edit.freeze_days_allowed} onChange={(e) => setEdit({ ...edit, freeze_days_allowed: e.target.value })} /></Field>
            <Field label={t("Only for")}><select className="input" value={edit.gender_restriction ?? ""} onChange={(e) => setEdit({ ...edit, gender_restriction: e.target.value })}><option value="">{t("Everyone")}</option><option value="female">{t("Women")}</option><option value="male">{t("Men")}</option></select></Field>
          </div>
          <label className="check"><input type="checkbox" checked={!!edit.includes_classes} onChange={(e) => setEdit({ ...edit, includes_classes: e.target.checked })} /> {t("Includes group classes")}</label>
          <label className="check"><input type="checkbox" checked={!!edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> {t("On sale")}</label>
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
  const roles: Record<string, string> = { owner: "Owner — everything", manager: "Manager — everything except the activity log and other managers", reception: "Reception — members, check-in, the day's payments, no reports", coach: "Coach — own classes, PT clients, programs and own earnings" };
  const isManager = me.user.role === "manager";
  // a manager adds and edits reception and coaches; managers and owners are the owner's
  const canEdit = (u: any) => !isManager || u.id === me.user.id || (u.role !== "owner" && u.role !== "manager");
  const roleChoices = Object.entries(roles).filter(([k]) => (isManager ? k === "reception" || k === "coach" || k === edit?.role : k !== "owner" || can(me, "owner")));
  return (
    <div className="stack">
      <AccessPanel />
      <div className="spread"><p className="ink-2">{t("Each person has their own login, so the activity log shows who did what.")}</p><button className="btn primary" onClick={() => setEdit({ role: "reception", active: true, commission_pct: 0 })}><Icon name="plus" />{t("Add a team member")}</button></div>
      <Loader state={state}>
        {(list: any[]) => (
          <div className="table-wrap"><table className="data">
            <thead><tr><th>{t("Name")}</th><th>{t("Role")}</th><th>{t("Last sign-in")}</th><th /></tr></thead>
            <tbody>{list.map((u) => (
              <tr key={u.id} style={!u.active ? { opacity: 0.45 } : undefined}>
                <td><span className="who"><b>{u.name}</b><small>{u.email}</small></span></td>
                <td style={{ textTransform: "capitalize" }}>{u.role}{u.role === "coach" && Number(u.commission_pct) > 0 ? <small className="muted"> · {Number(u.commission_pct)}{t("% PT commission")}</small> : ""}</td>
                <td className="ink-2">{u.last_login_at ? fmtDate(u.last_login_at) : "never"}</td>
                <td className="r">{canEdit(u) && <button className="btn small" onClick={() => setEdit({ ...u })}>{t("Edit")}</button>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Loader>
      {edit && (
        <Modal title={edit.id ? edit.name : t("Add a team member")} open onClose={() => setEdit(null)}
          footer={<>
            {edit.id && <button className="btn" disabled={busy} onClick={async () => { const r = await run(() => put(`/api/staff/${edit.id}`, { resetPassword: true })); if (r?.temporaryPassword) { setPw(r.temporaryPassword); setEdit(null); } }}>{t("Reset password")}</button>}
            <button className="btn primary" disabled={busy || !edit.name || !edit.email} onClick={async () => {
              const body = { name: edit.name, email: edit.email, phone: edit.phone || null, role: edit.role, active: !!edit.active, bio: edit.bio || null, color: edit.color || null, commission_pct: Number(edit.commission_pct || 0) };
              const r = await run(() => (edit.id ? put(`/api/staff/${edit.id}`, body) : post("/api/staff", body)), t("Save"));
              if (r) { if (r.temporaryPassword) setPw(r.temporaryPassword); setEdit(null); state.reload(); }
            }}>{t("Save")}</button></>}>
          <div className="grid-2">
            <Field label={t("Name")}><input className="input" value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label={t("Email (login)")}><input className="input" type="email" value={edit.email ?? ""} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
            <Field label={t("Phone")}><input className="input" value={edit.phone ?? ""} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
            <Field label={t("PT commission %")}><input className="input" type="number" value={edit.commission_pct ?? 0} onChange={(e) => setEdit({ ...edit, commission_pct: e.target.value })} /></Field>
          </div>
          <Field label={t("Role")}><select className="input" value={edit.role} disabled={edit.id === me.user.id} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>{roleChoices.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          {edit.role !== "reception" && <Field label={t("Bio")} hint={t("Shown to members and known by the assistant")}><textarea className="input" value={edit.bio ?? ""} onChange={(e) => setEdit({ ...edit, bio: e.target.value })} /></Field>}
          {edit.id && <label className="check"><input type="checkbox" checked={!!edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> {t("Can sign in")}</label>}
        </Modal>
      )}
      {pw && (
        <Modal title={t("Temporary password")} open onClose={() => setPw(null)} footer={<button className="btn primary" onClick={() => setPw(null)}>{t("Done")}</button>}>
          <p>{t("Give this password to the person. They choose their own password the first time they sign in.")}</p>
          <p className="num-display" style={{ fontSize: "2rem", letterSpacing: "0.04em", userSelect: "all" }}>{pw}</p>
        </Modal>
      )}
    </div>
  );
}

/** What reception and coaches may see and do in this gym. */
function AccessPanel() {
  const { gym, busy, save } = useGymForm();
  const [a, setA] = useState({ coachMembers: "own", coachCheckin: false, receptionPaymentHistory: false, receptionMaxDiscountPct: 20, ...(gym.settings?.staff ?? {}) });
  return (
    <section className="panel">
      <header><h2>{t("What reception and coaches can do")}</h2></header>
      <div className="body stack">
        <div className="grid-2">
          <Field label={t("Coaches find")} hint={t("Coaches never see payments or what members owe; they see their own PT earnings.")}>
            <Segmented label={t("Coaches find")} value={a.coachMembers} onChange={(v) => setA({ ...a, coachMembers: v })}
              options={[{ value: "own", label: t("Their own members") }, { value: "all", label: t("All members") }]} />
          </Field>
          <Field label={t("Biggest discount reception can give")} hint={t("Above this, a manager or the owner sells it.")}>
            <div className="row"><input className="input" type="number" min={0} max={100} style={{ width: 100 }} value={a.receptionMaxDiscountPct}
              onChange={(e) => setA({ ...a, receptionMaxDiscountPct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} /><span>%</span></div>
          </Field>
        </div>
        <label className="check"><input type="checkbox" checked={a.coachCheckin} onChange={(e) => setA({ ...a, coachCheckin: e.target.checked })} /> {t("Coaches can check members in at the desk")}</label>
        <label className="check"><input type="checkbox" checked={a.receptionPaymentHistory} onChange={(e) => setA({ ...a, receptionPaymentHistory: e.target.checked })} /> {t("Reception sees past payments and sales (otherwise today and yesterday only)")}</label>
        <div><button className="btn primary" disabled={busy} onClick={() => save({ settings: { staff: a } })}>{t("Save")}</button></div>
      </div>
    </section>
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
          <header><h2>{t("Opening hours")}</h2></header>
          <div className="body stack-s">
            {hours.map((h, i) => (
              <div key={h.day} className="row">
                <span style={{ width: 90 }}>{t(WEEKDAYS[h.day])}</span>
                <label className="check"><input type="checkbox" checked={!h.closed} onChange={(e) => setHours(hours.map((x, j) => (j === i ? { ...x, closed: !e.target.checked } : x)))} /> {t("Open")}</label>
                {!h.closed && <><input className="input" type="time" style={{ width: 120 }} value={h.open} onChange={(e) => setHours(hours.map((x, j) => (j === i ? { ...x, open: e.target.value } : x)))} />–
                  <input className="input" type="time" style={{ width: 120 }} value={h.close} onChange={(e) => setHours(hours.map((x, j) => (j === i ? { ...x, close: e.target.value } : x)))} /></>}
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <header><h2>{t("Ladies-only hours")}</h2><button className="btn small" onClick={() => setLadies([...ladies, { day: 1, from: "10:00", to: "12:00" }])}><Icon name="plus" />{t("Add")}</button></header>
          <div className="body stack-s">
            {ladies.length === 0 && <p className="muted">{t("None. Men can enter during all opening hours.")}</p>}
            {ladies.map((h, i) => (
              <div key={i} className="row">
                <select className="input" style={{ width: 130 }} value={h.day} onChange={(e) => setLadies(ladies.map((x, j) => (j === i ? { ...x, day: Number(e.target.value) } : x)))}>{WEEKDAYS.map((w, d) => <option key={w} value={d}>{t(w)}</option>)}</select>
                <input className="input" type="time" style={{ width: 120 }} value={h.from} onChange={(e) => setLadies(ladies.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} />–
                <input className="input" type="time" style={{ width: 120 }} value={h.to} onChange={(e) => setLadies(ladies.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))} />
                <button className="btn small ghost" onClick={() => setLadies(ladies.filter((_, j) => j !== i))} aria-label={t("Remove")}><Icon name="x" /></button>
              </div>
            ))}
            <p className="muted" style={{ fontSize: "0.85rem" }}>{t("Check-in refuses men during these hours.")}</p>
          </div>
        </section>
      </div>
      <div className="stack">
        <section className="panel">
          <header><h2>{t("Check-in rules")}</h2></header>
          <div className="body stack">
            <Field label={t("Grace days after expiry")} hint={t("Members can still enter this many days after their membership ends (with a warning)")}><input className="input" type="number" min={0} max={30} value={ck.graceDays} onChange={(e) => setCk({ ...ck, graceDays: Number(e.target.value) })} /></Field>
            <Field label={t("Ignore repeated scans for (minutes)")}><input className="input" type="number" min={0} value={ck.cooldownMinutes} onChange={(e) => setCk({ ...ck, cooldownMinutes: Number(e.target.value) })} /></Field>
            <label className="check"><input type="checkbox" checked={ck.blockOnBalance} onChange={(e) => setCk({ ...ck, blockOnBalance: e.target.checked })} /> {t("Refuse entry when the member owes money")}</label>
          </div>
        </section>
        <section className="panel">
          <header><h2>{t("WhatsApp reminders")}</h2></header>
          <div className="body stack">
            <label className="check"><input type="checkbox" checked={rem.enabled} onChange={(e) => setRem({ ...rem, enabled: e.target.checked })} /> {t("Remind members before their membership ends")}</label>
            <Field label={t("Days before the end")} hint={t("Comma separated, 0 = on the last day")}><input className="input" value={rem.daysBefore.join(", ")} onChange={(e) => setRem({ ...rem, daysBefore: e.target.value.split(",").map((x) => Number(x.trim())).filter((x) => !Number.isNaN(x)) })} /></Field>
            <Field label={t("Win-back message, days after expiry")}><input className="input" value={rem.afterExpiryDays.join(", ")} onChange={(e) => setRem({ ...rem, afterExpiryDays: e.target.value.split(",").map((x) => Number(x.trim())).filter((x) => x > 0) })} /></Field>
            <Field label={t("Custom reminder text (optional)")} hint={t("Variables: {name} {plan} {gym} {date} {days}")}><textarea className="input" value={rem.templateEn ?? ""} onChange={(e) => setRem({ ...rem, templateEn: e.target.value })} /></Field>
          </div>
        </section>
        <button className="btn primary" disabled={busy} onClick={() => save({ settings: { hours, ladiesHours: ladies, checkin: ck, reminders: rem } })}>{t("Save hours and rules")}</button>
      </div>
    </div>
  );
}

/**
 * Telegram on or off for this gym's members, and the owner's own Telegram for the weekly summary.
 * Members who connect get their messages there; everyone else keeps WhatsApp.
 */
function TelegramTab() {
  const { gym, busy, save } = useGymForm();
  const s = useAsync(() => get("/api/telegram"), [gym.settings?.telegram?.enabled]);
  const d: any = s.data;
  const on = !!gym.settings?.telegram?.enabled;
  if (d && !d.bot) return <section className="panel"><div className="body muted">{t("Telegram isn't set up on GMS yet. Ask GMS support.")}</div></section>;
  return (
    <div className="cols">
      <section className="panel"><div className="body stack">
        <label className="check">
          <input type="checkbox" checked={on} disabled={busy} onChange={(e) => save({ settings: { telegram: { enabled: e.target.checked } } })} />
          <span className="who"><b>{t("Send members' messages on Telegram")}</b><small>{t("For members who connected their Telegram: reminders arrive by themselves, and the assistant answers their questions day and night. Everyone else keeps WhatsApp.")}</small></span>
        </label>
        {on && <p className="ink-2">{t("To connect a member, open their profile and press “Connect their Telegram”. Members can also do it from the member app, in Settings.")}</p>}
        {d && on && <p><b>{t("{n} members connected", { n: d.members })}</b>{d.bot && <span className="muted"> · @{d.bot}</span>}</p>}
      </div></section>
      <section className="panel"><header><h2>{t("Your Telegram")}</h2></header><div className="body">
        <MyTelegram purpose={t("Get your gym's week every Monday morning, and ask about your numbers any time.")} />
      </div></section>
    </div>
  );
}

function WhatsAppTab() {
  const { gym, busy, save } = useGymForm();
  const wa = gym.settings?.whatsapp ?? {};
  const [num, setNum] = useState(wa.businessNumber ?? "");
  const auto = !!(wa.phoneNumberId && wa.hasToken);
  return (
    <div className="cols">
      <section className="panel"><div className="body stack">
        <p>{t("GMS works with WhatsApp in two ways:")}</p>
        <p><b>{t("Click-to-send (active now).")}</b> {t("Reminders and messages wait in Messages; one tap opens WhatsApp on the gym's phone with the text ready. No setup, no cost.")}</p>
        <p><b>{t("Automatic (WhatsApp Business Platform).")}</b> {t("Messages go out by themselves and the assistant answers members 24/7. Needs a Meta Business account and a dedicated number. GMS support connects it for you: message us and we set it up together.")}</p>
        <Field label={t("Gym's WhatsApp number")} hint={t("Shown to members so they can message you")}><input className="input" value={num} onChange={(e) => setNum(e.target.value)} placeholder="+961 …" /></Field>
        <div><button className="btn primary" disabled={busy} onClick={() => save({ settings: { whatsapp: { businessNumber: num || null } } })}>{t("Save")}</button></div>
      </div></section>
      <section className="panel"><header><h2>{t("Status")}</h2></header><div className="body"><p><span className="plate" data-s={auto ? "ok" : "warn"} /> {auto ? t("Automatic sending is on, connected by GMS.") : t("Click-to-send mode.")}</p></div></section>
    </div>
  );
}

const LEVELS: { key: "essential" | "studio" | "full"; title: string; who: string; has: string }[] = [
  { key: "essential", title: "Essential", who: "A weights gym: memberships, the door, the cash.", has: "Members, check-in, payments, WhatsApp reminders" },
  { key: "studio", title: "Studio", who: "You also run classes or personal training.", has: "Essential, plus classes, personal training and the member app" },
  { key: "full", title: "Complete", who: "A large gym that wants every tool.", has: "Studio, plus shop, expenses, interested people and follow-up advice" },
];

function ModulesTab() {
  const { gym, busy, save } = useGymForm();
  const mods = gym.modules ?? {};
  const level = gym.settings?.level ?? "full";
  const list: [string, string, string][] = [
    ["whatsapp", "WhatsApp messages", "Reminders and group messages, sent from your own WhatsApp"],
    ["classes", "Group classes", "Weekly schedule, bookings, waiting lists"],
    ["pt", "Personal training", "Session packages, coach hours and commissions"],
    ["memberApp", "Member app", "Members see their pass, days left and classes on their phone"],
    ["expenses", "Expenses", "Rent, salaries, generator: to see what is really left"],
    ["shop", "Shop", "Drinks, supplements and accessories sold at the desk"],
    ["leads", "Interested people", "People who asked about the gym and have not joined yet"],
    ["ai", "Follow-up advice", "Who is likely to leave, and answers about your own numbers"],
  ];
  const locked = (k: string) => gym.saas_plan === "starter" && ["classes", "pt", "memberApp", "ai"].includes(k);
  return (
    <div className="stack">
      <section>
        <h2 className="section-h">{t("How much of GMS do you want to see?")}</h2>
        <p className="muted" style={{ marginBottom: 12 }}>{t("Start small. You can change this any day, and nothing you entered is ever lost.")}</p>
        <div className="levels" role="radiogroup" aria-label={t("Level")}>
          {LEVELS.map((l) => (
            <button key={l.key} role="radio" aria-checked={level === l.key} disabled={busy} onClick={() => level !== l.key && save({ level: l.key })}>
              <b>{t(l.title)}</b>
              <span>{t(l.who)}</span>
              <small>{t(l.has)}</small>
            </button>
          ))}
        </div>
      </section>
      <details className="fine-tune">
        <summary>{t("Switch single tools on or off")}</summary>
        <section className="panel"><div className="list">
          {list.map(([k, title, desc]) => (
            <label key={k} className="check" style={{ padding: "14px 18px" }}>
              <input type="checkbox" checked={mods[k] !== false && !locked(k)} disabled={busy || locked(k)} onChange={(e) => save({ modules: { [k]: e.target.checked } })} />
              <span className="who"><b>{t(title)}</b><small>{locked(k) ? t("Not included in your GMS plan") : t(desc)}</small></span>
            </label>
          ))}
        </div></section>
      </details>
    </div>
  );
}

function AppTab() {
  const { gym } = useApp().me;
  const url = `${location.origin}/m/${gym.slug}`;
  return (
    <div className="cols">
      <section className="panel"><div className="body stack">
        <p>{t("Your members' app lives at:")}</p>
        <p><a href={url} target="_blank" rel="noreferrer"><b>{url}</b></a></p>
        <p className="ink-2">{t("Members open it once, sign in with their phone and the PIN you send them from their profile, then add it to their home screen. It shows their entry QR code, membership, classes and programs, in your colours.")}</p>
        <button className="btn" onClick={() => { navigator.clipboard?.writeText(url); toast(t("Link copied")); }}>{t("Copy link")}</button>
      </div></section>
      <section className="panel"><header><h2>{t("Poster for reception")}</h2></header><div className="body stack">
        <div style={{ width: 180 }} dangerouslySetInnerHTML={{ __html: qrSvg(url) }} />
        <p className="muted">{t("Print this code at reception so members can open the app.")}</p>
        <button className="btn" onClick={() => window.print()}><Icon name="print" />{t("Print")}</button>
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
          <thead><tr><th>{t("When")}</th><th>{t("Who")}</th><th>{t("What")}</th></tr></thead>
          <tbody>{list.map((a) => (
            <tr key={a.id}><td>{fmtDate(a.at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td><td>{a.user_name ?? "—"}</td><td>{a.action === "platform.access" ? t("GMS support opened your gym") : a.action.replace(/[._]/g, " ")}{a.data?.reason ? ` · ${a.data.reason}` : ""}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </Loader>
  );
}

function NotificationsTab() {
  const { reloadMe } = useApp();
  const state = useAsync(() => get("/api/notifications/overview"), []);
  const [f, setF] = useState<any>(null);
  const { busy, run } = useAction();
  useEffect(() => { if (state.data) setF(state.data.settings); }, [state.data]);
  const save = async (next: any) => {
    setF(next);
    const r = await run(() => put("/api/gym", { settings: { push: next } }), "Notification settings saved");
    if (r) { await reloadMe(); state.reload(); }
  };
  const STATUS: Record<string, string> = { sent: "ok", queued: "warn", no_device: "frozen", failed: "denied" };
  const STATUS_LABEL: Record<string, string> = { sent: "delivered", queued: "waiting", no_device: "no device", failed: "failed" };
  return (
    <Loader state={state}>
      {(d: any) => !f ? null : (
        <div className="stack">
          {!d.memberAppOn && <p className="panel body" style={{ padding: 16 }}>{t("Notifications are sent through the member app, which is not included in this gym's plan.")}</p>}
          <div className="figures">
            <div className="figure"><span className="label">{t("Members with notifications on")}</span><span className="value num-display">{d.stats.members_with_push}</span><span className="delta">of {d.stats.members_with_app} {t("with the app ·")}{" "}{d.stats.devices} {t("device(s)")}</span></div>
            <div className="figure"><span className="label">{t("Delivered, 30 days")}</span><span className="value num-display">{d.stats.sent_30d}</span></div>
            <div className="figure"><span className="label">{t("Opened, 30 days")}</span><span className="value num-display">{d.stats.opened_30d}</span></div>
            <div className="figure"><span className="label">{t("Waiting (quiet hours)")}</span><span className="value num-display">{d.stats.waiting}</span></div>
          </div>
          <div className="cols">
            <section className="panel">
              <header><h2>{t("What members receive")}</h2>
                <label className="check"><input type="checkbox" checked={f.enabled} disabled={busy} onChange={(e) => save({ ...f, enabled: e.target.checked })} /> <b>{f.enabled ? t("On") : t("Off")}</b></label>
              </header>
              <div className="list" style={{ opacity: f.enabled ? 1 : 0.5 }}>
                {d.types.map((tp: any) => (
                  <label key={tp.key} className="check" style={{ padding: "12px 18px", alignItems: "flex-start" }}>
                    <input type="checkbox" disabled={busy || !f.enabled} checked={f.types?.[tp.key] !== false} onChange={(e) => save({ ...f, types: { ...f.types, [tp.key]: e.target.checked } })} />
                    <span className="who"><b>{tp.label}</b><small>{tp.help}{tp.scheduled ? t(" · waits for the end of quiet hours") : t(" · sent right away")}</small></span>
                  </label>
                ))}
              </div>
            </section>
            <div className="stack">
              <section className="panel">
                <header><h2>{t("Timing")}</h2></header>
                <div className="body stack">
                  <Field label={t("Class reminder, hours before")}><select className="input" value={f.classReminderHours} onChange={(e) => save({ ...f, classReminderHours: Number(e.target.value) })}>{[1, 2, 3, 4, 6, 12, 24].map((h) => <option key={h} value={h}>{h} h</option>)}</select></Field>
                  <Field label={t("Personal training reminder, hours before")}><select className="input" value={f.ptReminderHours} onChange={(e) => save({ ...f, ptReminderHours: Number(e.target.value) })}>{[1, 2, 3, 4, 6, 12, 24].map((h) => <option key={h} value={h}>{h} h</option>)}</select></Field>
                  <Field label={t("Quiet hours")} hint={t("Reminders and announcements wait until the end of quiet hours. Receipts and urgent changes still go out.")}>
                    <div className="row">
                      <input className="input" type="time" style={{ width: 130 }} value={f.quietFrom} onChange={(e) => setF({ ...f, quietFrom: e.target.value })} onBlur={() => save(f)} />–
                      <input className="input" type="time" style={{ width: 130 }} value={f.quietTo} onChange={(e) => setF({ ...f, quietTo: e.target.value })} onBlur={() => save(f)} />
                    </div>
                  </Field>
                </div>
              </section>
              <section className="panel">
                <header><h2>{t("How members turn them on")}</h2></header>
                <div className="body stack-s ink-2">
                  <p>{t("In the member app, the member taps")}{" "}<b>{t("Turn on notifications")}</b>{t(". On iPhone, the app must first be added to the home screen (Share → Add to Home Screen, iOS 16.4 or later).")}</p>
                  <p>{t("Each member can choose what they receive. To check a phone, open the member's profile and use")}{" "}<b>{t("Send a test notification")}</b>.</p>
                </div>
              </section>
            </div>
          </div>
          <section className="panel">
            <header><h2>{t("Recent notifications")}</h2></header>
            {d.recent.length ? (
              <div className="table-wrap" style={{ border: 0 }}><table className="data"><tbody>
                {d.recent.map((n: any) => (
                  <tr key={n.id}>
                    <td style={{ width: 150 }}>{fmtDate(n.created_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                    <td><Link to={`/members/${n.member_id}`}>{n.first_name} {n.last_name}</Link></td>
                    <td><b>{n.title}</b><br /><small className="muted">{n.body}</small></td>
                    <td><span className="status"><span className="plate" data-s={STATUS[n.status]} />{STATUS_LABEL[n.status]}{n.read_at ? t(" · opened") : ""}</span></td>
                  </tr>
                ))}
              </tbody></table></div>
            ) : <Empty title={t("No notification sent yet.")} />}
          </section>
        </div>
      )}
    </Loader>
  );
}
