/** Member app (PWA), served at /m/<gym-slug>. */
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { get, post, put } from "../shared/api.ts";
import { Icon, Spinner, Toasts, toast, toastError, useAsync } from "../shared/ui.tsx";
import { WEEKDAYS, fmtDate, fmtTime, getLang, setLang, t, useLang } from "../shared/i18n.ts";
import { qrSvg } from "../shared/qr.ts";
import { currentSubscription, disablePush, enablePush, pushSupport } from "./push.ts";

const slug = location.pathname.split("/")[2] ?? "";

function brandInk(hex: string) {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) > 0.45 ? "#121821" : "#ffffff";
}

function GymTop({ gym, onLogout, onBell, unread = 0 }: { gym: any; onLogout?: () => void; onBell?: () => void; unread?: number }) {
  const lang = useLang();
  return (
    <div className="m-top">
      <div className="logo">{gym.has_logo ? <img src={`/api/public/gyms/${gym.slug}/logo`} alt="" /> : gym.name[0]}</div>
      <div style={{ flex: 1 }}><b>{lang === "ar" && gym.name_ar ? gym.name_ar : gym.name}</b>{gym.tagline && <small>{gym.tagline}</small>}</div>
      <button className="m-btn ghost" style={{ padding: "8px 12px" }} onClick={() => setLang(getLang() === "ar" ? "en" : "ar")}>{getLang() === "ar" ? "EN" : "ع"}</button>
      {onBell && (
        <button className="m-btn ghost bell" style={{ padding: "8px 10px" }} onClick={onBell} aria-label={`${t("Notifications")}${unread ? ` (${unread})` : ""}`}>
          <Icon name="bell" width={18} height={18} />{unread > 0 && <span className="dot">{unread > 9 ? "9+" : unread}</span>}
        </button>
      )}
      {onLogout && <button className="m-btn ghost" style={{ padding: "8px 10px" }} onClick={onLogout} aria-label="Sign out"><Icon name="logout" width={18} height={18} /></button>}
    </div>
  );
}

function Login({ gym, onDone }: { gym: any; onDone: () => void }) {
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="m-app">
      <GymTop gym={gym} />
      <form className="m-login" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr("");
        try {
          await post(`/api/m/${slug}/login`, { phone, pin });
          onDone();
        } catch (e: any) {
          setErr(e.message);
        } finally {
          setBusy(false);
        }
      }}>
        <h1>{t("Welcome")}.</h1>
        <label className="stack-s"><span className="m-muted">{t("Phone")}</span><input className="m-input" inputMode="tel" autoComplete="tel" placeholder="03 123 456" value={phone} onChange={(e) => setPhone(e.target.value)} required /></label>
        <label className="stack-s"><span className="m-muted">{t("PIN")}</span><input className="m-input pin" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} required /></label>
        {err && <p className="m-error" role="alert">{err}</p>}
        <button className="m-btn block" disabled={busy} style={{ minHeight: 52 }}>{busy ? "…" : t("Sign in")}</button>
        <p className="m-muted" style={{ fontSize: "0.9rem" }}>{t("Ask reception for your PIN")}{gym.whatsapp ? <> · <a href={`https://wa.me/${gym.whatsapp.replace(/\D/g, "")}`}>WhatsApp</a></> : null}</p>
      </form>
    </div>
  );
}

function PassTab({ me }: { me: any }) {
  const m = me.member;
  const [deferred, setDeferred] = useState<any>(null);
  useEffect(() => {
    const h = (e: any) => { e.preventDefault(); setDeferred(e); };
    window.addEventListener("beforeinstallprompt", h);
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);
  // keep the screen bright & awake while showing the pass, where supported
  useEffect(() => {
    let lock: any;
    (navigator as any).wakeLock?.request("screen").then((l: any) => (lock = l)).catch(() => {});
    return () => lock?.release?.();
  }, []);
  const status = m.status;
  const standalone = window.matchMedia("(display-mode: standalone)").matches;
  return (
    <div className="m-body">
      <h1 className="m-hello">{t("Welcome")}, {m.first_name}</h1>
      <section className="pass" data-s={status} aria-label={t("Your pass")}>
        <div className="who-line"><b>{m.first_name} {m.last_name}</b><span className="code">#{m.code}</span></div>
        <div className="qr" dangerouslySetInnerHTML={{ __html: qrSvg(`GMS:${m.qr_token}`) }} />
        <span className="m-muted" style={{ fontSize: "0.9rem" }}>{t("Show this at reception")}</span>
        <div className="pass-status">
          <span className="plate" data-s={status === "none" ? "expired" : status} />
          <div className="grow">
            <b>{t(status)}</b>
            <small>{m.plan_name ?? "—"}{m.end_date ? ` · ${t("Valid until")} ${fmtDate(m.end_date, { day: "numeric", month: "long" })}` : ""}</small>
          </div>
          {m.days_left != null && m.days_left >= 0 && <div style={{ textAlign: "end" }}><div className="days-big">{m.visits_total != null ? m.visits_total - m.visits_used : m.days_left}</div><small className="m-muted">{m.visits_total != null ? t("visits left") : t("days left")}</small></div>}
        </div>
      </section>
      {Number(m.balance_usd) > 0 && <p className="m-error">Balance to settle at reception: ${Number(m.balance_usd).toFixed(2)}</p>}
      <div className="m-stats">
        <div className="m-stat"><span className="num-display">{me.stats.visits_30d}</span><small>{t("visits this month")}</small></div>
        <div className="m-stat"><span className="num-display">{me.stats.week_streak}</span><small>{t("week streak")}</small></div>
        <div className="m-stat"><span className="num-display">{me.stats.visits_year}</span><small>visits this year</small></div>
      </div>
      {me.gym.pushEnabled && <NotifyPrompt />}
      {!standalone && (
        <div className="install">
          <Icon name="download" width={22} height={22} />
          <div style={{ flex: 1 }}><b>{t("Install the app")}</b><div className="m-muted" style={{ fontSize: "0.85rem" }}>{t("Add to home screen for one-tap access")}{!deferred && " (Share → Add to Home Screen)"}</div></div>
          {deferred && <button className="m-btn" onClick={() => { deferred.prompt(); setDeferred(null); }}>Install</button>}
        </div>
      )}
      <GymInfo gym={me.gym} />
    </div>
  );
}

/** Shown on the pass until notifications are on (or the member dismissed it). */
function NotifyPrompt() {
  const [state, setState] = useState<"hidden" | "offer" | "ios" | "denied">("hidden");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let dismissed = false;
    try { dismissed = localStorage.getItem("gms.push.dismissed") === "1"; } catch { /* ignore */ }
    if (dismissed) return;
    const support = pushSupport();
    if (support === "ios_install") return setState("ios");
    if (support !== "ok") return;
    if (Notification.permission === "denied") return setState("denied");
    currentSubscription().then((s) => setState(s && Notification.permission === "granted" ? "hidden" : "offer"), () => setState("offer"));
  }, []);
  if (state === "hidden") return null;
  const dismiss = () => { try { localStorage.setItem("gms.push.dismissed", "1"); } catch { /* ignore */ } setState("hidden"); };
  return (
    <div className="install">
      <Icon name="bell" width={22} height={22} />
      <div style={{ flex: 1 }}>
        <b>{t("Turn on notifications")}</b>
        <div className="m-muted" style={{ fontSize: "0.85rem" }}>
          {state === "ios" ? t("On iPhone: add the app to your home screen first (Share → Add to Home Screen), then open it from there.")
            : state === "denied" ? t("Notifications are blocked for this site. Allow them in your browser settings.")
            : t("Class reminders, your membership and gym news.")}
        </div>
      </div>
      {state === "offer" && <button className="m-btn" disabled={busy} onClick={async () => {
        setBusy(true);
        try {
          const r = await enablePush();
          if (r === "on") { toast(t("Notifications are on")); setState("hidden"); }
          else if (r === "denied") setState("denied");
        } catch (e) { toastError(e); } finally { setBusy(false); }
      }}>{t("Turn on")}</button>}
      <button className="m-btn ghost" style={{ padding: "8px 10px" }} onClick={dismiss} aria-label={t("Close")}><Icon name="x" width={16} height={16} /></button>
    </div>
  );
}

const CATEGORY_LABEL: Record<string, string> = { classes: "Classes and training", membership: "My membership", payments: "Payments and receipts", news: "Gym news" };

function InboxTab({ onRead }: { onRead: () => void }) {
  const state = useAsync(() => get("/api/m/notifications"), []);
  const [device, setDevice] = useState<"on" | "off" | "na">("na");
  const [busy, setBusy] = useState(false);
  const refreshDevice = () => {
    if (pushSupport() !== "ok") return setDevice("na");
    currentSubscription().then((s) => setDevice(s && Notification.permission === "granted" ? "on" : "off"), () => setDevice("off"));
  };
  useEffect(() => {
    refreshDevice();
    post("/api/m/notifications/read").then(onRead, () => {});
  }, []);
  if (!state.data) return <div className="m-body"><Spinner /></div>;
  const d = state.data;
  return (
    <div className="m-body">
      <h1 className="m-hello">{t("Notifications")}</h1>
      {d.enabled && (
        <section className="m-card">
          <header><h2>{t("On this phone")}</h2></header>
          <div className="rows">
            <div>
              <span style={{ flex: 1 }}>{device === "on" ? t("Notifications are on") : device === "na" ? (pushSupport() === "ios_install" ? t("On iPhone: add the app to your home screen first (Share → Add to Home Screen), then open it from there.") : t("This browser can't receive notifications.")) : t("Notifications are off")}</span>
              {device !== "na" && <button className={`m-btn ${device === "on" ? "ghost" : ""}`} disabled={busy} onClick={async () => {
                setBusy(true);
                try {
                  if (device === "on") { await disablePush(); toast(t("Notifications are off")); }
                  else { const r = await enablePush(); if (r === "denied") toast(t("Notifications are blocked for this site. Allow them in your browser settings."), "error"); else if (r === "on") toast(t("Notifications are on")); }
                } catch (e) { toastError(e); } finally { setBusy(false); refreshDevice(); }
              }}>{device === "on" ? t("Turn off") : t("Turn on")}</button>}
            </div>
          </div>
        </section>
      )}
      {d.enabled && d.categories.length > 0 && (
        <section className="m-card">
          <header><h2>{t("What you receive")}</h2></header>
          <div className="rows">
            {d.categories.map((c: any) => (
              <div key={c.key}>
                <label className="check" style={{ flex: 1 }}>
                  <input type="checkbox" checked={c.on} onChange={async (e) => {
                    try { await put("/api/m/notifications/prefs", { [c.key]: e.target.checked }); state.reload(); } catch (err) { toastError(err); }
                  }} />
                  {t(CATEGORY_LABEL[c.key] ?? c.key)}
                </label>
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="m-card">
        <header><h2>{t("Recent")}</h2></header>
        <div className="rows">
          {d.rows.map((n: any) => (
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
          {!d.rows.length && <div className="m-muted">{t("Nothing yet.")}</div>}
        </div>
      </section>
    </div>
  );
}

function GymInfo({ gym }: { gym: any }) {
  return (
    <section className="m-card">
      <header><h2>{t("Opening hours")}</h2></header>
      <div className="rows">
        {(gym.hours ?? []).map((h: any) => (
          <div key={h.day}><span style={{ flex: 1 }}>{t(WEEKDAYS[h.day])}</span><span className="m-muted">{h.closed ? "—" : `${h.open} – ${h.close}`}</span></div>
        ))}
        {gym.ladiesHours?.length > 0 && <div><span style={{ flex: 1 }}>{t("Ladies hours")}</span><span className="m-muted" style={{ textAlign: "end" }}>{gym.ladiesHours.map((h: any) => `${t(WEEKDAYS[h.day])} ${h.from}–${h.to}`).join(", ")}</span></div>}
        {(gym.whatsapp || gym.phone) && <div><span style={{ flex: 1 }}>{t("Contact")}</span><a className="m-btn ghost" href={`https://wa.me/${(gym.whatsapp ?? gym.phone).replace(/\D/g, "")}`}>WhatsApp</a></div>}
      </div>
    </section>
  );
}

function ClassesTab() {
  const state = useAsync(() => get("/api/m/classes"), []);
  const [busy, setBusy] = useState<string | null>(null);
  if (!state.data) return <div className="m-body"><Spinner /></div>;
  const groups = new Map<string, any[]>();
  for (const c of state.data) {
    const k = new Date(c.starts_at).toDateString();
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  const act = async (fn: () => Promise<any>, msg: string) => {
    try { await fn(); toast(msg); state.reload(); } catch (e) { toastError(e); }
  };
  return (
    <div className="m-body">
      <h1 className="m-hello">{t("Classes")}</h1>
      {groups.size === 0 && <p className="m-muted">{t("No classes this week")}</p>}
      {[...groups.entries()].map(([day, list]) => (
        <div key={day} className="stack-s">
          <div className="m-day">{fmtDate(list[0].starts_at, { weekday: "long", day: "numeric", month: "short" })}</div>
          {list.map((c) => {
            const full = c.booked >= c.capacity;
            return (
              <div key={c.id} className="m-class">
                <span className="bar" style={{ background: c.color }} />
                <div><b>{getLang() === "ar" && c.name_ar ? c.name_ar : c.name}</b><small>{fmtTime(c.starts_at)}{c.coach_name ? ` · ${c.coach_name}` : ""} · {c.booked}/{c.capacity}</small></div>
                {c.my_booking_id ? (
                  <button className="m-btn ghost" disabled={busy === c.id} onClick={() => { setBusy(c.id); act(() => post(`/api/m/bookings/${c.my_booking_id}/cancel`), t("Cancel booking")).finally(() => setBusy(null)); }}>
                    {c.my_status === "waitlist" ? t("Waitlist") : t("Booked")} ✓
                  </button>
                ) : (
                  <button className="m-btn" disabled={busy === c.id} onClick={() => { setBusy(c.id); act(() => post(`/api/m/classes/${c.id}/book`), t("Booked")).finally(() => setBusy(null)); }}>
                    {full ? t("Waitlist") : t("Book")}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function HistoryTab() {
  const state = useAsync(() => get("/api/m/history"), []);
  const [pin, setPin] = useState({ current: "", next: "" });
  if (!state.data) return <div className="m-body"><Spinner /></div>;
  const d = state.data;
  return (
    <div className="m-body">
      <h1 className="m-hello">{t("History")}</h1>
      {d.programs.length > 0 && (
        <section className="m-card"><header><h2>{t("Programs")}</h2></header>
          {d.programs.map((p: any) => (
            <details key={p.id} style={{ borderTop: "1px solid var(--hair)" }}><summary style={{ padding: "12px 16px", cursor: "pointer" }}><b>{p.title}</b> <span className="m-muted">· {p.coach_name ?? ""}</span></summary><div className="m-program">{p.content}</div></details>
          ))}
        </section>
      )}
      {d.pt.length > 0 && (
        <section className="m-card"><header><h2>{t("Personal training")}</h2></header><div className="rows">
          {d.pt.map((p: any, i: number) => <div key={i}><span style={{ flex: 1 }}>{p.title}<br /><small className="m-muted">{p.coach_name}</small></span><b>{p.sessions_total - p.sessions_used} left</b></div>)}
        </div></section>
      )}
      <section className="m-card"><header><h2>{t("Membership")}</h2></header><div className="rows">
        {d.memberships.map((m: any, i: number) => <div key={i}><span style={{ flex: 1 }}>{m.plan_name}</span><span className="m-muted">{fmtDate(m.start_date)} → {fmtDate(m.end_date)}</span></div>)}
      </div></section>
      <section className="m-card"><header><h2>Visits</h2></header><div className="rows">
        {d.checkins.slice(0, 20).map((c: any, i: number) => <div key={i}><span style={{ flex: 1 }}>{fmtDate(c.at, { weekday: "short", day: "numeric", month: "short" })}</span><span className="m-muted">{fmtTime(c.at)}</span></div>)}
        {!d.checkins.length && <div className="m-muted">No visits yet.</div>}
      </div></section>
      <section className="m-card"><header><h2>{t("Change PIN")}</h2></header>
        <form className="rows" onSubmit={async (e) => { e.preventDefault(); try { await put("/api/m/pin", pin); toast("PIN changed"); setPin({ current: "", next: "" }); } catch (err) { toastError(err); } }}>
          <div><input className="m-input" inputMode="numeric" placeholder="Current PIN" value={pin.current} onChange={(e) => setPin({ ...pin, current: e.target.value.replace(/\D/g, "") })} /></div>
          <div><input className="m-input" inputMode="numeric" placeholder="New PIN (4–6 digits)" value={pin.next} onChange={(e) => setPin({ ...pin, next: e.target.value.replace(/\D/g, "") })} /></div>
          <div><button className="m-btn block" disabled={pin.current.length < 4 || pin.next.length < 4}>{t("Save")}</button></div>
        </form>
      </section>
    </div>
  );
}

function AskTab({ gym }: { gym: any }) {
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
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="m-body">
      <h1 className="m-hello">{t("Ask the gym")}</h1>
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

function App() {
  useLang();
  const [gym, setGym] = useState<any>(null);
  const [gymErr, setGymErr] = useState(false);
  const [me, setMe] = useState<any>(undefined);
  const initialTab = (() => {
    const q = new URLSearchParams(location.search).get("tab");
    return (["classes", "history", "ask", "inbox"] as const).find((x) => x === q) ?? "pass";
  })();
  const [tab, setTab] = useState<"pass" | "classes" | "history" | "ask" | "inbox">(initialTab);
  const go = (x: typeof tab) => {
    setTab(x);
    window.scrollTo(0, 0);
    history.replaceState(null, "", `/m/${slug}${x === "pass" ? "" : `?tab=${x}`}`);
  };
  const loadMe = () => get("/api/m/me").then((r) => (r.gym.slug === slug ? setMe(r) : setMe(null)), () => setMe(null));
  useEffect(() => {
    get(`/api/public/gyms/${slug}`).then((g) => {
      setGym(g);
      document.documentElement.style.setProperty("--brand", g.brand_color);
      document.documentElement.style.setProperty("--brand-ink", brandInk(g.brand_color));
      document.title = g.name;
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#121821");
      const link = document.createElement("link");
      link.rel = "manifest";
      link.href = `/m/${slug}/manifest.webmanifest`;
      document.head.appendChild(link);
    }, () => setGymErr(true));
    loadMe();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { scope: "/m/" }).catch(() => {});
  }, []);
  if (gymErr) return <div className="m-login"><h1>Gym not found.</h1><p className="m-muted">Check the link your gym sent you.</p></div>;
  if (!gym || me === undefined) return <div className="m-login" style={{ minHeight: "100vh", justifyItems: "center" }}><Spinner /></div>;
  if (!me) return <Login gym={gym} onDone={loadMe} />;
  const tabs: { key: typeof tab; label: string; icon: string; show: boolean }[] = [
    { key: "pass", label: t("Your pass"), icon: "qr", show: true },
    { key: "classes", label: t("Classes"), icon: "calendar", show: gym.modules?.classes !== false },
    { key: "history", label: t("History"), icon: "chart", show: true },
    { key: "ask", label: t("Ask the gym"), icon: "message", show: gym.modules?.ai !== false },
  ];
  return (
    <div className="m-app">
      <GymTop gym={gym} unread={me.unread} onBell={() => go("inbox")} onLogout={async () => { await disablePush().catch(() => {}); await post("/api/m/logout"); setMe(null); }} />
      {tab === "pass" && <PassTab me={me} />}
      {tab === "classes" && <ClassesTab />}
      {tab === "history" && <HistoryTab />}
      {tab === "ask" && <AskTab gym={gym} />}
      {tab === "inbox" && <InboxTab onRead={() => setMe((m: any) => ({ ...m, unread: 0 }))} />}
      <nav className="m-nav"><div style={{ gridTemplateColumns: `repeat(${tabs.filter((x) => x.show).length}, 1fr)` }}>
        {tabs.filter((x) => x.show).map((x) => (
          <button key={x.key} aria-current={tab === x.key ? "page" : undefined} onClick={() => { go(x.key); if (x.key === "pass") loadMe(); }}>
            <Icon name={x.icon} /><span>{x.label}</span>
          </button>
        ))}
      </div></nav>
    </div>
  );
}

document.body.classList.add("member");
createRoot(document.getElementById("root")!).render(<><App /><Toasts /></>);
