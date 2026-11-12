/** Member app screens other than Home. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { get, post, put } from "../shared/api.ts";
import { Icon, Spinner, toast, toastError, useAsync } from "../shared/ui.tsx";
import { WEEKDAYS, fmtDate, fmtTime, getLang, money, setLang, t } from "../shared/i18n.ts";
import { Bar, Section, Sheet, SubHeader, Thumb, View, minutes, when } from "./ui.tsx";
import { currentSubscription, disablePush, enablePush, pushSupport } from "./push.ts";
import { InstallSheet, isInstalled } from "./install.tsx";

const nameOf = (x: any) => (getLang() === "ar" && x.name_ar ? x.name_ar : x.name);
const dayKey = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

// ===================== classes =====================

export function ClassesView() {
  const state = useAsync(() => get("/api/m/classes"), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  if (!state.data) return <div className="m-body"><Spinner /></div>;
  const all: any[] = state.data;
  const days = [...new Set(all.map((c) => dayKey(c.starts_at)))];
  const current = day && days.includes(day) ? day : days[0];
  const mine = all.filter((c) => c.my_booking_id);
  const act = async (id: string, fn: () => Promise<any>, msg: string) => {
    setBusy(id);
    try { await fn(); toast(msg); state.reload(); } catch (e) { toastError(e); } finally { setBusy(null); }
  };
  return (
    <div className="m-body">
      <h1 className="m-hello">{t("Classes")}</h1>
      {mine.length > 0 && (
        <Section title={t("My bookings")}>
          <div className="m-list">
            {mine.map((c) => (
              <div key={c.id} className="m-next">
                <span className="bar" style={{ background: c.color }} />
                <span className="grow"><b>{nameOf(c)}</b><small>{when(c.starts_at)} · {minutes(c.duration_min)}</small></span>
                <span className="m-tag">{c.my_status === "waitlist" ? t("Waitlist") : t("Booked")}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
      {days.length === 0 ? <p className="m-muted">{t("No classes this week")}</p> : (
        <>
          <div className="m-days" role="tablist">
            {days.map((k) => {
              const d = new Date(k + "T12:00:00");
              return (
                <button key={k} role="tab" aria-selected={k === current} className={k === current ? "on" : ""} onClick={() => setDay(k)}>
                  <small>{d.toLocaleDateString(getLang() === "ar" ? "ar-LB" : "en-GB", { weekday: "short" })}</small><b>{d.getDate()}</b>
                </button>
              );
            })}
          </div>
          <div className="m-list">
            {all.filter((c) => dayKey(c.starts_at) === current).map((c) => {
              const full = c.booked >= c.capacity;
              const left = Math.max(0, c.capacity - c.booked);
              return (
                <div key={c.id} className="m-class2">
                  <span className="bar" style={{ background: c.color }} />
                  <button className="m-class2-main" onClick={() => setOpen(open === c.id ? null : c.id)} aria-expanded={open === c.id}>
                    <span className="m-class2-time"><b>{fmtTime(c.starts_at)}</b><small>{minutes(c.duration_min)}</small></span>
                    <span className="grow">
                      <b>{nameOf(c)}{c.women_only ? <span className="m-tag">{t("Ladies")}</span> : null}</b>
                      <small>{[c.coach_name, c.room].filter(Boolean).join(" · ")}{c.coach_name || c.room ? " · " : ""}{full ? t("Full") : t("{n} spots left", { n: left })}</small>
                    </span>
                  </button>
                  {c.my_booking_id ? (
                    <button className="m-btn ghost" disabled={busy === c.id} onClick={() => act(c.id, () => post(`/api/m/bookings/${c.my_booking_id}/cancel`), t("Booking cancelled"))}>{c.my_status === "waitlist" ? t("Leave waitlist") : t("Cancel")}</button>
                  ) : (
                    <button className="m-btn" disabled={busy === c.id} onClick={() => act(c.id, () => post(`/api/m/classes/${c.id}/book`), full ? t("You're on the waitlist") : t("Booked"))}>{full ? t("Waitlist") : t("Book")}</button>
                  )}
                  {open === c.id && <p className="m-class2-more">{c.description || t("No description.")} <br /><span className="m-muted">{fmtDate(c.starts_at, { weekday: "long", day: "numeric", month: "long" })} · {fmtTime(c.starts_at)} – {fmtTime(c.ends_at)}</span></p>}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ===================== personal training =====================

export function CoachView() {
  const state = useAsync(() => get("/api/m/pt"), []);
  const [booking, setBooking] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (!state.data) return <div className="m-body"><Spinner /></div>;
  const d = state.data;
  return (
    <div className="m-body">
      <h1 className="m-hello">{t("Personal training")}</h1>
      {d.packages.length === 0 && d.upcoming.length === 0 && <p className="m-muted">{t("You don't have a PT package. Ask reception about personal training.")}</p>}
      {d.packages.map((p: any) => (
        <section key={p.id} className="m-card m-pt">
          <div className="m-pt-head">
            <span className="m-avatar">{(p.coach_name ?? "?")[0]}</span>
            <span className="grow"><b>{p.coach_name ?? t("Coach to be assigned")}</b><small className="m-muted">{p.title} · {minutes(p.session_min)}</small></span>
          </div>
          <div className="m-pt-count">
            <Bar value={p.sessions_used} goal={p.sessions_total} />
            <small className="m-muted">{t("{used} of {total} done", { used: p.sessions_used, total: p.sessions_total })} · <b className="m-text">{t("{n} to book", { n: p.bookable })}</b>{p.expires_on ? ` · ${t("valid until")} ${fmtDate(p.expires_on)}` : ""}</small>
          </div>
          {d.settings.memberBooking && p.coach_id && p.coach_has_hours && p.bookable > 0 && <button className="m-btn block" onClick={() => setBooking(p)}><Icon name="calendar" width={18} height={18} style={{ marginInlineEnd: 6 }} />{t("Book a session")}</button>}
          {d.settings.memberBooking && p.coach_id && !p.coach_has_hours && <p className="m-muted" style={{ margin: 0 }}>{t("Your coach hasn't published their hours yet. Message them or reception.")}</p>}
          {p.bookable === 0 && <p className="m-muted" style={{ margin: 0 }}>{t("All your sessions are booked.")}</p>}
        </section>
      ))}
      {d.upcoming.length > 0 && (
        <Section title={t("Coming up")}>
          <div className="m-list">
            {d.upcoming.map((s: any) => (
              <div key={s.id} className="m-next">
                <span className="bar" style={{ background: "var(--brand)" }} />
                <span className="grow"><b>{when(s.starts_at)}</b><small>{minutes(s.duration_min)}{s.coach_name ? ` · ${s.coach_name}` : ""}</small></span>
                {s.can_cancel ? (
                  <button className="m-btn ghost" disabled={busy === s.id} onClick={async () => {
                    if (!confirm(t("Cancel this session? It goes back to your package."))) return;
                    setBusy(s.id);
                    try { await post(`/api/m/pt/sessions/${s.id}/cancel`); toast(t("Session cancelled")); state.reload(); } catch (e) { toastError(e); } finally { setBusy(null); }
                  }}>{t("Cancel")}</button>
                ) : <small className="m-muted" style={{ maxWidth: 110, textAlign: "end" }}>{t("Too late to cancel in the app")}</small>}
              </div>
            ))}
          </div>
          <small className="m-muted">{t("Free cancellation up to {h} hours before.", { h: d.settings.cancelHours })}</small>
        </Section>
      )}
      {d.past.length > 0 && (
        <Section title={t("Done")}>
          <div className="m-card"><div className="rows">{d.past.map((s: any) => <div key={s.id}><span style={{ flex: 1 }}>{fmtDate(s.starts_at, { weekday: "short", day: "numeric", month: "short" })} · {fmtTime(s.starts_at)}</span><span className="m-muted">{s.status === "no_show" ? t("missed") : `✓ ${s.coach_name ?? ""}`}</span></div>)}</div></div>
        </Section>
      )}
      {booking && <BookPt pkg={booking} days={d.settings.bookAheadDays} onClose={(done) => { setBooking(null); if (done) state.reload(); }} />}
    </div>
  );
}

/** Pick one or several times with your coach (back-to-back is fine), within the sessions left. */
function BookPt({ pkg, onClose }: { pkg: any; days: number; onClose: (done: boolean) => void }) {
  const slots = useAsync(() => get(`/api/m/pt/slots?package_id=${pkg.id}`), [pkg.id]);
  const [picked, setPicked] = useState<string[]>([]);
  const [day, setDay] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const byDay = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const s of slots.data ?? []) m.set(dayKey(s.starts_at), [...(m.get(dayKey(s.starts_at)) ?? []), s.starts_at]);
    return m;
  }, [slots.data]);
  const days = [...byDay.keys()];
  const current = day && byDay.has(day) ? day : days[0];
  const toggle = (iso: string) => {
    if (picked.includes(iso)) return setPicked(picked.filter((x) => x !== iso));
    if (picked.length >= pkg.bookable) return toast(t("You have {n} sessions left to book", { n: pkg.bookable }), "error");
    setPicked([...picked, iso].sort());
  };
  return (
    <Sheet open onClose={() => onClose(false)} title={t("Book with {coach}", { coach: pkg.coach_name ?? "" })}
      footer={<button className="m-btn block" disabled={!picked.length || busy} onClick={async () => {
        setBusy(true);
        try {
          const r = await post("/api/m/pt/book", { package_id: pkg.id, starts: picked });
          toast(r.sessions.length > 1 ? t("{n} sessions booked", { n: r.sessions.length }) : t("Session booked"));
          onClose(true);
        } catch (e: any) { toastError(e); if (e.code === "slot_taken") { setPicked([]); slots.reload(); } } finally { setBusy(false); }
      }}>{picked.length ? (picked.length > 1 ? t("Book {n} sessions", { n: picked.length }) : t("Book this session")) : t("Choose a time")}</button>}>
      {!slots.data ? <Spinner /> : days.length === 0 ? <p className="m-muted">{t("No free time with your coach in the coming days. Message them or reception.")}</p> : (
        <div className="stack-s">
          <p className="m-muted" style={{ margin: 0 }}>{t("{min} per session · {n} left to book. Pick two in a row for a longer session.", { min: minutes(pkg.session_min), n: pkg.bookable })}</p>
          <div className="m-days">
            {days.map((k) => {
              const d = new Date(k + "T12:00:00");
              const n = picked.filter((p) => dayKey(p) === k).length;
              return (
                <button key={k} className={k === current ? "on" : ""} onClick={() => setDay(k)}>
                  <small>{d.toLocaleDateString(getLang() === "ar" ? "ar-LB" : "en-GB", { weekday: "short" })}</small><b>{d.getDate()}</b>{n > 0 && <i className="m-dot" />}
                </button>
              );
            })}
          </div>
          <div className="m-slots">
            {(byDay.get(current!) ?? []).map((iso) => (
              <button key={iso} className={picked.includes(iso) ? "on" : ""} aria-pressed={picked.includes(iso)} onClick={() => toggle(iso)}>{fmtTime(iso)}</button>
            ))}
          </div>
          {picked.length > 0 && <div className="m-picked">{picked.map((p) => <span key={p} className="m-tag">{when(p)}</span>)}</div>}
        </div>
      )}
    </Sheet>
  );
}

// ===================== shop =====================

const CATS: Record<string, string> = { supplements: "Supplements", drinks: "Drinks", snacks: "Snacks", accessories: "Accessories", apparel: "Apparel", other: "Other" };

export function ShopView({ openProduct, refreshKey }: { openProduct: (p: any) => void; refreshKey: number }) {
  const state = useAsync(() => get("/api/m/shop"), [refreshKey]);
  const [cat, setCat] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);
  if (!state.data) return <div className="m-body"><Spinner /></div>;
  const d = state.data;
  const cats = ["all", ...Object.keys(CATS).filter((c) => d.products.some((p: any) => p.category === c))];
  const list = d.products.filter((p: any) => cat === "all" || p.category === cat);
  const bundles = list.filter((p: any) => p.kind === "bundle");
  const items = list.filter((p: any) => p.kind !== "bundle");
  return (
    <div className="m-body">
      <h1 className="m-hello">{t("Shop")}</h1>
      <p className="m-muted" style={{ margin: "-6px 0 0" }}>{t("Tap “I want it” and pick it up at reception. You pay there.")}</p>
      {d.requests.length > 0 && (
        <Section title={t("My orders")}>
          <div className="m-card"><div className="rows">
            {d.requests.map((r: any) => (
              <div key={r.id}>
                <span className="plate" data-s={r.status === "ready" ? "ok" : r.status === "pending" ? "warn" : r.status === "collected" ? "frozen" : "expired"} />
                <span style={{ flex: 1 }}>{r.qty} × {r.name}<br /><small className="m-muted">{r.status === "ready" ? t("Ready at reception") : r.status === "pending" ? t("Being prepared") : r.status === "collected" ? t("Collected") : t("Cancelled")}</small></span>
                {r.status === "pending" && <button className="m-btn ghost" disabled={busy === r.id} onClick={async () => { setBusy(r.id); try { await post(`/api/m/shop/requests/${r.id}/cancel`); state.reload(); } catch (e) { toastError(e); } finally { setBusy(null); } }}>{t("Cancel")}</button>}
              </div>
            ))}
          </div></div>
        </Section>
      )}
      <div className="m-chips">{cats.map((c) => <button key={c} className={cat === c ? "on" : ""} onClick={() => setCat(c)}>{c === "all" ? t("All") : t(CATS[c])}</button>)}</div>
      {bundles.length > 0 && (
        <Section title={t("Bundles")}>
          <div className="m-list">{bundles.map((p: any) => (
            <button key={p.id} className="m-bundle" onClick={() => openProduct(p)}>
              <Thumb src={p.has_image ? `/api/public/products/${p.id}/image` : null} icon="gift" />
              <span className="grow"><b dir="auto">{nameOf(p)}</b><small className="m-muted">{p.contents}</small><span className="m-price">{money(p.price, p.currency)}</span></span>
              {!p.in_stock && <span className="m-tag">{t("out of stock")}</span>}
            </button>
          ))}</div>
        </Section>
      )}
      <div className="m-grid">
        {items.map((p: any) => (
          <button key={p.id} className="m-product" onClick={() => openProduct(p)} disabled={false}>
            <Thumb src={p.has_image ? `/api/public/products/${p.id}/image` : null} label={nameOf(p)} />
            <b dir="auto">{nameOf(p)}</b>
            <span className="m-price">{money(p.price, p.currency)}</span>
            {!p.in_stock ? <small className="m-muted">{t("out of stock")}</small> : p.low ? <small className="m-warn">{t("Few left")}</small> : null}
          </button>
        ))}
      </div>
      {!list.length && <p className="m-muted">{t("Nothing here yet.")}</p>}
    </div>
  );
}

// ===================== me =====================

export function MeView({ me, go }: { me: any; go: (v: View) => void }) {
  const state = useAsync(() => get("/api/m/history"), []);
  const ref = useAsync(() => (me.features.referrals ? get("/api/m/referral") : Promise.resolve({ enabled: false })), []);
  const m = me.member;
  const d = state.data;
  return (
    <div className="m-body">
      <div className="m-profile">
        <span className="m-avatar big">{m.first_name[0]}{m.last_name?.[0] ?? ""}</span>
        <span className="grow"><h1 className="m-hello" style={{ fontSize: "var(--step-2)" }}>{m.first_name} {m.last_name}</h1>
          <small className="m-muted">#{m.code}{m.member_since ? ` · ${t("member since")} ${fmtDate(m.member_since, { month: "long", year: "numeric" })}` : ""}</small></span>
        <button className="m-icon" onClick={() => go("settings")} aria-label={t("Settings")}><Icon name="settings" width={22} height={22} /></button>
      </div>

      <div className="m-tiles">
        {me.features.badges && <button className="m-tile" onClick={() => go("progress")}><Icon name="trophy" width={22} height={22} /><b>{t("Progress")}</b><small>{t("Badges, streaks, challenges")}</small></button>}
        <button className="m-tile" onClick={() => go("settings")}><Icon name="settings" width={22} height={22} /><b>{t("Settings")}</b><small>{t("PIN, notifications, language")}</small></button>
      </div>

      {ref.data?.enabled && <InviteCard r={ref.data} />}

      {!d ? <Spinner /> : (
        <>
          <Section title={t("Classes")}>
            <div className="m-card"><div className="rows">
              {d.classes.upcoming.slice(0, 5).map((c: any) => (
                <div key={c.booking_id}><span className="plate" data-s={c.status === "waitlist" ? "warn" : "ok"} /><span style={{ flex: 1 }}><b>{nameOf(c)}</b><br /><small className="m-muted">{when(c.starts_at)} · {minutes(c.duration_min)}</small></span><span className="m-tag">{c.status === "waitlist" ? t("Waitlist") : t("Booked")}</span></div>
              ))}
              {d.classes.attended[0] && (
                <div><span className="plate" data-s="frozen" /><span style={{ flex: 1 }}><b>{nameOf(d.classes.attended[0])}</b><br /><small className="m-muted">{t("Last class you attended")} · {fmtDate(d.classes.attended[0].starts_at, { weekday: "short", day: "numeric", month: "short" })} · {minutes(d.classes.attended[0].duration_min)}</small></span></div>
              )}
              {!d.classes.upcoming.length && !d.classes.attended.length && <div className="m-muted">{t("No classes yet.")}</div>}
              {!d.classes.upcoming.length && d.classes.attended.length > 0 && <div><span className="m-muted" style={{ flex: 1 }}>{t("Nothing booked.")}</span><button className="m-btn ghost" onClick={() => go("classes")}>{t("Book a class")}</button></div>}
            </div></div>
          </Section>

          {d.programs.length > 0 && (
            <Section title={t("Programs")}>
              <div className="m-card">{d.programs.map((p: any) => (
                <details key={p.id} style={{ borderTop: "1px solid var(--hair)" }}><summary style={{ padding: "12px 16px", cursor: "pointer" }}><b>{p.title}</b> <span className="m-muted">· {p.coach_name ?? ""}</span></summary><div className="m-program" dir="auto">{p.content}</div></details>
              ))}</div>
            </Section>
          )}

          <Section title={t("Membership")}>
            <div className="m-card"><div className="rows">
              {d.memberships.map((x: any, i: number) => <div key={i}><span style={{ flex: 1 }}>{x.plan_name}</span><span className="m-muted">{fmtDate(x.start_date)} → {fmtDate(x.end_date)}</span></div>)}
              {!d.memberships.length && <div className="m-muted">—</div>}
            </div></div>
          </Section>

          <Section title={t("Payments")}>
            <div className="m-card"><div className="rows">
              {d.payments.slice(0, 8).map((p: any) => (
                <div key={p.receipt_no}><span style={{ flex: 1 }}>{money(p.amount, p.currency)}<br /><small className="m-muted">{fmtDate(p.paid_at, { day: "numeric", month: "short", year: "numeric" })} · {t(p.method)}</small></span>
                  <a className="m-btn ghost" href={`/r/${p.public_token}`} target="_blank" rel="noreferrer">{t("Receipt")}</a></div>
              ))}
              {!d.payments.length && <div className="m-muted">{t("Nothing yet.")}</div>}
            </div></div>
          </Section>

          <Section title={t("Visits")}>
            <div className="m-card"><div className="rows">
              {d.checkins.slice(0, 10).map((c: any, i: number) => <div key={i}><span style={{ flex: 1 }}>{fmtDate(c.at, { weekday: "short", day: "numeric", month: "short" })}</span><span className="m-muted">{fmtTime(c.at)}</span></div>)}
              {!d.checkins.length && <div className="m-muted">{t("No visits yet.")}</div>}
            </div></div>
          </Section>
        </>
      )}
      <GymInfo gym={me.gym} />
    </div>
  );
}

function InviteCard({ r }: { r: any }) {
  const url = `${location.origin}${r.path}`;
  const text = t("Join me at {gym}! Leave your number here and they'll call you: {url}", { gym: r.gym, url });
  const canShare = typeof navigator.share === "function";
  return (
    <section className="m-invite">
      <div className="row" style={{ alignItems: "flex-start" }}>
        <Icon name="gift" width={26} height={26} />
        <div className="grow">
          <b>{t("Invite a friend")}</b>
          <p className="m-muted" style={{ margin: "2px 0 0" }}>{r.reward ? t("When they join, you get: {reward}", { reward: r.reward }) : t("Train together: share your link.")}</p>
          {(r.joined > 0 || r.pending > 0) && <small className="m-muted">{t("{j} joined · {p} waiting", { j: r.joined, p: r.pending })}</small>}
        </div>
      </div>
      <div className="row">
        <a className="m-btn grow" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer"><Icon name="whatsapp" width={18} height={18} style={{ marginInlineEnd: 6 }} />{t("WhatsApp")}</a>
        <button className="m-btn ghost" onClick={async () => {
          try { if (canShare) await navigator.share({ text, url }); else { await navigator.clipboard.writeText(url); toast(t("Link copied")); } } catch { /* cancelled */ }
        }}>{canShare ? t("Share") : t("Copy link")}</button>
      </div>
    </section>
  );
}

function GymInfo({ gym }: { gym: any }) {
  return (
    <Section title={t("Opening hours")}>
      <div className="m-card"><div className="rows">
        {(gym.hours ?? []).map((h: any) => <div key={h.day}><span style={{ flex: 1 }}>{t(WEEKDAYS[h.day])}</span><span className="m-muted">{h.closed ? "—" : `${h.open} – ${h.close}`}</span></div>)}
        {gym.ladiesHours?.length > 0 && <div><span style={{ flex: 1 }}>{t("Ladies hours")}</span><span className="m-muted" style={{ textAlign: "end" }}>{gym.ladiesHours.map((h: any) => `${t(WEEKDAYS[h.day])} ${h.from}–${h.to}`).join(", ")}</span></div>}
        {(gym.whatsapp || gym.phone) && <div><span style={{ flex: 1 }}>{t("Contact")}</span><a className="m-btn ghost" href={`https://wa.me/${(gym.whatsapp ?? gym.phone).replace(/\D/g, "")}`}>{t("WhatsApp")}</a></div>}
        {gym.address && <div><span style={{ flex: 1 }}>{t("Address")}</span><span className="m-muted" style={{ textAlign: "end" }} dir="auto">{gym.address}{gym.city ? `, ${gym.city}` : ""}</span></div>}
      </div></div>
    </Section>
  );
}

// ===================== settings =====================

const CATEGORY_LABEL: Record<string, string> = { classes: "Classes and training", membership: "My membership", payments: "Payments and orders", progress: "Badges, challenges and friends", news: "Gym news and offers" };

export function SettingsView({ me, onBack, onPrefs, onLogout }: { me: any; onBack: () => void; onPrefs: () => void; onLogout: () => void }) {
  const notes = useAsync(() => get("/api/m/notifications"), []);
  const [device, setDevice] = useState<"on" | "off" | "na">("na");
  const [busy, setBusy] = useState(false);
  const [pin, setPin] = useState({ current: "", next: "", again: "" });
  const [goal, setGoal] = useState<number>(me.prefs.weeklyGoal);
  const [hidden, setHidden] = useState<boolean>(me.prefs.hideOnLeaderboard);
  const refreshDevice = () => {
    if (pushSupport() !== "ok") return setDevice("na");
    currentSubscription().then((s) => setDevice(s && Notification.permission === "granted" ? "on" : "off"), () => setDevice("off"));
  };
  useEffect(refreshDevice, []);
  const savePrefs = async (patch: any) => { try { await put("/api/m/prefs", patch); onPrefs(); } catch (e) { toastError(e); } };
  return (
    <div className="m-body">
      <SubHeader title={t("Settings")} onBack={onBack} />

      {notes.data?.enabled && (
        <Section title={t("Notifications")}>
          <div className="m-card"><div className="rows">
            <div>
              <span style={{ flex: 1 }}>{device === "on" ? t("On this phone: on") : device === "na" ? (pushSupport() === "ios_install" ? t("On iPhone: add the app to your home screen first (Share → Add to Home Screen), then open it from there.") : t("This browser can't receive notifications.")) : t("On this phone: off")}</span>
              {device !== "na" && <button className={`m-btn ${device === "on" ? "ghost" : ""}`} disabled={busy} onClick={async () => {
                setBusy(true);
                try {
                  if (device === "on") { await disablePush(); toast(t("Notifications are off")); }
                  else { const r = await enablePush(); if (r === "denied") toast(t("Notifications are blocked for this site. Allow them in your browser settings."), "error"); else if (r === "on") toast(t("Notifications are on")); }
                } catch (e) { toastError(e); } finally { setBusy(false); refreshDevice(); }
              }}>{device === "on" ? t("Turn off") : t("Turn on")}</button>}
            </div>
            {notes.data.categories.map((c: any) => (
              <div key={c.key}>
                <label className="check m-switch" style={{ flex: 1 }}>
                  <span style={{ flex: 1 }}>{t(CATEGORY_LABEL[c.key] ?? c.key)}</span>
                  <input type="checkbox" role="switch" checked={c.on} onChange={async (e) => { try { await put("/api/m/notifications/prefs", { [c.key]: e.target.checked }); notes.reload(); } catch (err) { toastError(err); } }} />
                </label>
              </div>
            ))}
          </div></div>
        </Section>
      )}

      <Section title={t("My goal")}>
        <div className="m-card"><div className="rows">
          <div style={{ display: "grid", gap: 10 }}>
            <span>{t("Visits per week")}</span>
            <div className="m-seg">{[1, 2, 3, 4, 5, 6].map((n) => <button key={n} className={goal === n ? "on" : ""} aria-pressed={goal === n} onClick={() => { setGoal(n); savePrefs({ weeklyGoal: n }); }}>{n}</button>)}</div>
            <small className="m-muted">{t("Members who train twice a week or more stick with it far more often.")}</small>
          </div>
          {me.features.leaderboard && (
            <div><label className="check m-switch" style={{ flex: 1 }}><span style={{ flex: 1 }}>{t("Show me on challenge leaderboards")}<br /><small className="m-muted">{t("Only your first name and initial")}</small></span>
              <input type="checkbox" role="switch" checked={!hidden} onChange={(e) => { setHidden(!e.target.checked); savePrefs({ hideOnLeaderboard: !e.target.checked }); }} /></label></div>
          )}
        </div></div>
      </Section>

      {me.features?.telegram && (
        <Section title={t("Telegram")}>
          {me.telegram_linked ? (
            <p className="m-muted">{t("Connected. Your reminders come on Telegram, and you can ask the gym's assistant there.")}</p>
          ) : (
            <div className="m-stack-s">
              <p className="m-muted">{t("Get your reminders on Telegram, and ask the gym anything there.")}</p>
              <button className="m-btn" onClick={async () => { try { const r = await post<any>("/api/m/telegram"); location.href = r.url; } catch (e) { toastError(e); } }}>{t("Connect Telegram")}</button>
            </div>
          )}
        </Section>
      )}

      <Section title={t("Language")}>
        <div className="m-seg">
          <button className={getLang() === "en" ? "on" : ""} onClick={() => setLang("en")}>{t("English")}</button>
          <button className={getLang() === "ar" ? "on" : ""} onClick={() => setLang("ar")}>العربية</button>
        </div>
      </Section>

      <Section title={t("Change PIN")}>
        <form className="m-card" onSubmit={async (e) => {
          e.preventDefault();
          if (pin.next !== pin.again) return toast(t("The two new PINs are different"), "error");
          try { await put("/api/m/pin", { current: pin.current, next: pin.next }); toast(t("PIN changed")); setPin({ current: "", next: "", again: "" }); } catch (err) { toastError(err); }
        }}>
          <div className="rows">
            <div><input className="m-input pin-s" type="password" inputMode="numeric" autoComplete="current-password" placeholder={t("Current PIN")} maxLength={6} value={pin.current} onChange={(e) => setPin({ ...pin, current: e.target.value.replace(/\D/g, "") })} /></div>
            <div><input className="m-input pin-s" type="password" inputMode="numeric" autoComplete="new-password" placeholder={t("New PIN (6 digits)")} maxLength={6} value={pin.next} onChange={(e) => setPin({ ...pin, next: e.target.value.replace(/\D/g, "") })} /></div>
            <div><input className="m-input pin-s" type="password" inputMode="numeric" autoComplete="new-password" placeholder={t("New PIN again")} maxLength={6} value={pin.again} onChange={(e) => setPin({ ...pin, again: e.target.value.replace(/\D/g, "") })} /></div>
            <div><button className="m-btn block" disabled={pin.current.length < 4 || pin.next.length < 6 || pin.again.length < 6}>{t("Save")}</button></div>
          </div>
        </form>
      </Section>

      <InstallRow gym={me.gym} />
      <button className="m-btn ghost block" onClick={onLogout}><Icon name="logout" width={18} height={18} style={{ marginInlineEnd: 8 }} />{t("Sign out")}</button>
    </div>
  );
}

function InstallRow({ gym }: { gym: any }) {
  const [open, setOpen] = useState(false);
  if (isInstalled()) return null;
  return (
    <div className="install">
      <Icon name="phone" width={22} height={22} />
      <div style={{ flex: 1 }}><b>{t("Install the app")}</b><div className="m-muted" style={{ fontSize: "0.85rem" }}>{t("Add to home screen for one-tap access")}</div></div>
      <button className="m-btn" onClick={() => setOpen(true)}>{t("How?")}</button>
      <InstallSheet gym={gym} open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

// ===================== progress =====================

export function ProgressView({ onBack }: { onBack: () => void }) {
  const state = useAsync(() => get("/api/m/progress"), []);
  const [badge, setBadge] = useState<any>(null);
  if (!state.data) return <div className="m-body"><SubHeader title={t("Progress")} onBack={onBack} /><Spinner /></div>;
  const d = state.data;
  const max = Math.max(d.stats.weeklyGoal, ...d.weeks.map((w: any) => w.visits), 1);
  const earned = d.badges.filter((b: any) => b.earned_at);
  return (
    <div className="m-body">
      <SubHeader title={t("Progress")} onBack={onBack} />
      <div className="m-stats">
        <div className="m-stat"><span className="num-display">{d.stats.visits}</span><small>{t("visits in total")}</small></div>
        <div className="m-stat"><span className="num-display">{d.stats.currentStreak}</span><small>{t("week streak")}</small></div>
        <div className="m-stat"><span className="num-display">{d.stats.bestStreak}</span><small>{t("best streak")}</small></div>
      </div>
      <Section title={t("Last 12 weeks")}>
        <div className="m-weeks" role="img" aria-label={t("Visits per week")}>
          <span className="m-goal-line" style={{ bottom: `${(d.stats.weeklyGoal / max) * 100}%` }}><small>{t("goal")} {d.stats.weeklyGoal}</small></span>
          {d.weeks.map((w: any) => (
            <span key={w.week} className="m-week-col" title={`${fmtDate(w.week)}: ${w.visits}`}>
              <i style={{ height: `${(w.visits / max) * 100}%`, background: w.visits >= d.stats.weeklyGoal ? "var(--plate-green)" : undefined }} />
            </span>
          ))}
        </div>
      </Section>

      {d.challenges.map((c: any) => (
        <section key={c.id} className="m-card m-pt">
          <div className="row"><Icon name="trophy" width={20} height={20} /><b className="grow" dir="auto">{c.title}</b>{c.progress >= c.target && <span className="m-tag ok">{t("Done")}</span>}</div>
          {c.description && <p className="m-muted" style={{ margin: 0 }} dir="auto">{c.description}</p>}
          <Bar value={c.progress} goal={c.target} />
          <small className="m-muted">{Math.min(c.progress, c.target)} / {c.target} {c.metric === "classes" ? t("classes") : t("days")} · {fmtDate(c.starts_on)} → {fmtDate(c.ends_on)}{c.reward ? ` · ${t("Prize")}: ${c.reward}` : ""}</small>
          {c.leaderboard && c.leaderboard.top.length > 0 && (
            <ol className="m-board">
              {c.leaderboard.top.map((r: any, i: number) => (
                <li key={i} className={r.me ? "me" : ""}><span className="rank">{r.rank}</span><span className="grow">{r.me ? t("You") : r.name}</span><b>{r.score}</b>{r.done && <span aria-label={t("Done")}>✓</span>}</li>
              ))}
              {c.leaderboard.me && !c.leaderboard.top.some((r: any) => r.me) && <li className="me"><span className="rank">{c.leaderboard.me.rank}</span><span className="grow">{t("You")}</span><b>{c.leaderboard.me.score}</b></li>}
            </ol>
          )}
          {c.leaderboard && <small className="m-muted">{t("{n} members taking part", { n: c.leaderboard.participants })}{d.hidden ? ` · ${t("you're hidden from others")}` : ""}</small>}
        </section>
      ))}

      {d.badges.length > 0 && (
        <Section title={`${t("Badges")} · ${earned.length}/${d.badges.length}`}>
          <div className="m-badges">
            {d.badges.map((b: any) => (
              <button key={b.key} className={`m-badge-tile ${b.earned_at ? "on" : ""}`} onClick={() => setBadge(b)}>
                <span className="icon" aria-hidden>{b.earned_at ? b.icon : <Icon name="lock" width={20} height={20} />}</span>
                <b>{t(b.label)}</b>
                {!b.earned_at && <Bar value={b.progress} goal={b.goal} />}
              </button>
            ))}
          </div>
        </Section>
      )}
      <Sheet open={!!badge} onClose={() => setBadge(null)} title={badge ? t(badge.label) : ""}>
        {badge && (
          <div className="m-detail" style={{ textAlign: "center", justifyItems: "center" }}>
            <span className="m-badge-big">{badge.earned_at ? badge.icon : <Icon name="lock" width={34} height={34} />}</span>
            <p>{t(badge.detail)}</p>
            {badge.earned_at ? <p className="m-muted">{t("Earned on")} {fmtDate(badge.earned_at, { day: "numeric", month: "long", year: "numeric" })}</p>
              : <><Bar value={badge.progress} goal={badge.goal} /><p className="m-muted">{badge.progress} / {badge.goal}</p></>}
          </div>
        )}
      </Sheet>
    </div>
  );
}

// ===================== inbox =====================

export function InboxView({ onBack, onRead, go }: { onBack: () => void; onRead: () => void; go: (v: View) => void }) {
  const state = useAsync(() => get("/api/m/notifications"), []);
  useEffect(() => { post("/api/m/notifications/read").then(onRead, () => {}); }, []);
  return (
    <div className="m-body">
      <SubHeader title={t("Notifications")} onBack={onBack} right={<button className="m-icon" onClick={() => go("settings")} aria-label={t("Settings")}><Icon name="settings" width={20} height={20} /></button>} />
      {!state.data ? <Spinner /> : state.data.rows.length ? (
        <div className="m-card"><div className="rows">
          {state.data.rows.map((n: any) => (
            <div key={n.id} style={{ alignItems: "flex-start" }}>
              <span className="plate" data-s={n.read_at ? "frozen" : "ok"} style={{ marginTop: 6 }} />
              <div style={{ flex: 1 }} dir="auto">
                <b>{n.title}</b>
                <div className="m-muted">{n.body}</div>
                <small className="m-muted">{fmtDate(n.created_at, { weekday: "short", day: "numeric", month: "short" })} {fmtTime(n.created_at)}</small>
              </div>
              {n.url?.startsWith("/r/") && <a className="m-btn ghost" href={n.url}>{t("View")}</a>}
            </div>
          ))}
        </div></div>
      ) : <p className="m-muted">{t("Nothing yet.")}</p>}
    </div>
  );
}

// ===================== assistant =====================

export function AskView({ gym, onBack }: { gym: any; onBack: () => void }) {
  const [log, setLog] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [log]);
  const send = async (q: string) => {
    if (!q.trim()) return;
    const history = log.slice(-6);
    setLog((l) => [...l, { role: "user", content: q }]);
    setText("");
    setBusy(true);
    try {
      const r = await post("/api/m/ask", { text: q, history });
      setLog((l) => [...l, { role: "assistant", content: r.reply }]);
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <div className="m-body">
      <SubHeader title={t("Ask the gym")} onBack={onBack} />
      {log.length === 0 && (
        <div className="chips">
          {["When does my membership end?", "Adesh l ishtirak 3 ashhor?", "شو برنامج الحصص بكرا؟", "Can I freeze my membership?"].map((q) => <button key={q} onClick={() => send(q)} dir="auto">{q}</button>)}
        </div>
      )}
      <div className="chat">
        {log.map((m, i) => <div key={i} className={`b ${m.role === "user" ? "me" : "bot"}`} dir="auto">{m.content}</div>)}
        {busy && <div className="b bot m-muted">…</div>}
        <div ref={end} />
      </div>
      <form style={{ display: "flex", gap: 8 }} onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <input className="m-input" value={text} onChange={(e) => setText(e.target.value)} placeholder={`${gym.name}…`} dir="auto" aria-label={t("Ask the gym")} />
        <button className="m-btn" disabled={busy || !text.trim()} aria-label={t("Send")}><Icon name="send" width={20} height={20} /></button>
      </form>
    </div>
  );
}
