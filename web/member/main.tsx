/** Member app (PWA), served at /m/<gym-slug>. */
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { get, post } from "../shared/api.ts";
import { Icon, Spinner, Toasts, toastError } from "../shared/ui.tsx";
import { getLang, setLang, t, useLang } from "../shared/i18n.ts";
import { disablePush } from "./push.ts";
import { HomeView, ProductSheet } from "./home.tsx";
import { AskView, ClassesView, CoachView, InboxView, MeView, ProgressView, SettingsView, ShopView } from "./screens.tsx";
import type { View } from "./ui.tsx";
import { InstallPage, InstallSheet, isInstalled } from "./install.tsx";

const slug = location.pathname.split("/")[2] ?? "";
const MAIN: View[] = ["home", "classes", "coach", "shop", "me"];
const SUB: View[] = ["inbox", "progress", "settings", "ask"];
// links from older notifications
const LEGACY: Record<string, View> = { pass: "home", history: "me" };

function brandInk(hex: string) {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) > 0.45 ? "#121821" : "#ffffff";
}

function GymTop({ gym, onBell, unread = 0 }: { gym: any; onBell?: () => void; unread?: number }) {
  const lang = useLang();
  return (
    <div className="m-top">
      <div className="logo">{gym.has_logo ? <img src={`/api/public/gyms/${gym.slug}/logo`} alt="" /> : gym.name[0]}</div>
      <div style={{ flex: 1, minWidth: 0 }}><b>{lang === "ar" && gym.name_ar ? gym.name_ar : gym.name}</b>{gym.tagline && <small>{gym.tagline}</small>}</div>
      {!onBell && <button className="m-btn ghost" style={{ padding: "8px 12px" }} onClick={() => setLang(getLang() === "ar" ? "en" : "ar")}>{getLang() === "ar" ? "EN" : "ع"}</button>}
      {onBell && (
        <button className="m-icon bell" onClick={onBell} aria-label={`${t("Notifications")}${unread ? ` (${unread})` : ""}`}>
          <Icon name="bell" width={22} height={22} />{unread > 0 && <span className="dot">{unread > 9 ? "9+" : unread}</span>}
        </button>
      )}
    </div>
  );
}

function Login({ gym, onDone, onJoin }: { gym: any; onDone: () => void; onJoin?: () => void }) {
  const [install, setInstall] = useState(false);
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
        try { await post(`/api/m/${slug}/login`, { phone, pin }); onDone(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
      }}>
        <h1>{t("Welcome")}.</h1>
        <label className="stack-s"><span className="m-muted">{t("Phone")}</span><input className="m-input" inputMode="tel" autoComplete="tel" placeholder="03 123 456" value={phone} onChange={(e) => setPhone(e.target.value)} required /></label>
        <label className="stack-s"><span className="m-muted">{t("PIN")}</span><input className="m-input pin" type="password" inputMode="numeric" autoComplete="current-password" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} required /></label>
        {err && <p className="m-error" role="alert">{err}</p>}
        <button className="m-btn block" disabled={busy} style={{ minHeight: 52 }}>{busy ? "…" : t("Sign in")}</button>
        <p className="m-muted" style={{ fontSize: "0.9rem" }}>{t("Ask reception for your PIN")}{gym.whatsapp ? <> · <a href={`https://wa.me/${gym.whatsapp.replace(/\D/g, "")}`}>{t("WhatsApp")}</a></> : null}</p>
        {onJoin && <button type="button" className="m-link" onClick={onJoin}>{t("Not a member yet? Leave your number")}</button>}
        {!isInstalled() && <button type="button" className="m-btn ghost block" onClick={() => setInstall(true)}><Icon name="phone" width={18} height={18} style={{ marginInlineEnd: 8 }} />{t("Install the app on this phone")}</button>}
      </form>
      <InstallSheet gym={gym} open={install} onClose={() => setInstall(false)} />
    </div>
  );
}

/** Opened from a friend's invite link: leave your name and number, reception calls you. */
function Join({ gym, refCode, onSignIn }: { gym: any; refCode: string | null; onSignIn: () => void }) {
  const [f, setF] = useState({ name: "", phone: "", interest: "" });
  const [done, setDone] = useState<null | "ok">(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="m-app">
      <GymTop gym={gym} />
      {done ? (
        <div className="m-login">
          <h1>{t("Thanks! 🙌")}</h1>
          <p className="m-muted">{t("{gym} will call you soon. You can also message them on WhatsApp.", { gym: gym.name })}</p>
          {gym.whatsapp && done === "ok" && <a className="m-btn block" href={`https://wa.me/${gym.whatsapp.replace(/\D/g, "")}`}><Icon name="whatsapp" width={18} height={18} style={{ marginInlineEnd: 6 }} />{t("WhatsApp")}</a>}
          <button className="m-btn ghost block" onClick={onSignIn}>{t("Sign in")}</button>
        </div>
      ) : (
        <form className="m-login" onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try { await post(`/api/public/gyms/${slug}/join`, { ...f, interest: f.interest || null, ref: refCode }); setDone("ok"); } catch (err) { toastError(err); } finally { setBusy(false); }
        }}>
          <h1>{refCode ? t("A friend invited you to {gym}", { gym: gym.name }) : t("Join {gym}", { gym: gym.name })}</h1>
          <p className="m-muted" style={{ margin: 0 }}>{t("Leave your name and number: the gym will call you to plan a visit.")}</p>
          <label className="stack-s"><span className="m-muted">{t("Your name")}</span><input className="m-input" autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} dir="auto" /></label>
          <label className="stack-s"><span className="m-muted">{t("Phone")}</span><input className="m-input" inputMode="tel" autoComplete="tel" placeholder="03 123 456" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} required /></label>
          <label className="stack-s"><span className="m-muted">{t("What are you interested in? (optional)")}</span>
            <select className="m-input" value={f.interest} onChange={(e) => setF({ ...f, interest: e.target.value })}>
              <option value="">—</option>{["Weight loss", "Muscle gain", "Classes", "Personal training", "Just fitness"].map((x) => <option key={x} value={x}>{t(x)}</option>)}
            </select></label>
          <button className="m-btn block" disabled={busy} style={{ minHeight: 52 }}>{busy ? "…" : t("Send")}</button>
          <button type="button" className="m-link" onClick={onSignIn}>{t("Already a member? Sign in")}</button>
        </form>
      )}
    </div>
  );
}

function App() {
  useLang();
  const params = new URLSearchParams(location.search);
  const refCode = params.get("ref");
  const [gym, setGym] = useState<any>(null);
  const [gymErr, setGymErr] = useState(false);
  const [me, setMe] = useState<any>(undefined);
  const [joining, setJoining] = useState(!!refCode);
  const [installPage, setInstallPage] = useState(location.pathname.split("/")[3] === "install");
  const initial = (() => {
    const q = params.get("tab") ?? "";
    return LEGACY[q] ?? ([...MAIN, ...SUB] as string[]).find((x) => x === q) as View ?? "home";
  })();
  const [view, setView] = useState<View>(initial);
  const [back, setBack] = useState<View>("home");
  const [product, setProduct] = useState<any>(null);
  const [shopKey, setShopKey] = useState(0);
  const go = (v: View) => {
    if (SUB.includes(v)) setBack(MAIN.includes(view) ? view : back);
    setView(v);
    window.scrollTo(0, 0);
    history.replaceState(null, "", `/m/${slug}${v === "home" ? "" : `?tab=${v}`}`);
  };
  const loadMe = () => get("/api/m/me").then((r) => (r.gym.slug === slug ? setMe(r) : setMe(null)), () => setMe(null));
  const openProduct = async (p: any) => {
    if (typeof p !== "string") return setProduct(p);
    try { const shop = await get("/api/m/shop"); setProduct(shop.products.find((x: any) => x.id === p) ?? null); } catch (e) { toastError(e); }
  };
  useEffect(() => {
    get(`/api/public/gyms/${slug}`).then((g) => {
      setGym(g);
      document.documentElement.style.setProperty("--brand", g.brand_color);
      document.documentElement.style.setProperty("--brand-ink", brandInk(g.brand_color));
      document.title = g.name;
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#121821");
    }, () => setGymErr(true));
    loadMe();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { scope: "/m/" }).catch(() => {});
  }, []);
  if (gymErr) return <div className="m-login"><h1>{t("Gym not found.")}</h1><p className="m-muted">{t("Check the link your gym sent you.")}</p></div>;
  if (!gym || me === undefined) return <div className="m-login" style={{ minHeight: "100vh", justifyItems: "center" }}><Spinner /></div>;
  if (installPage) return <InstallPage gym={gym} onContinue={() => { setInstallPage(false); history.replaceState(null, "", `/m/${slug}`); }} />;
  if (!me) {
    if (joining) return <Join gym={gym} refCode={refCode} onSignIn={() => { setJoining(false); history.replaceState(null, "", `/m/${slug}`); }} />;
    return <Login gym={gym} onDone={loadMe} onJoin={() => setJoining(true)} />;
  }
  const f = me.features;
  const tabs: { key: View; label: string; icon: string; show: boolean }[] = [
    { key: "home", label: t("Home"), icon: "home", show: true },
    { key: "classes", label: t("Classes"), icon: "calendar", show: f.classes },
    { key: "coach", label: t("Coach"), icon: "dumbbell", show: f.pt },
    { key: "shop", label: t("Shop"), icon: "bag", show: f.shop },
    { key: "me", label: t("Me"), icon: "user", show: true },
  ];
  const shown = tabs.filter((x) => x.show);
  const current = shown.some((x) => x.key === view) || SUB.includes(view) ? view : "home";
  const logout = async () => { await disablePush().catch(() => {}); await post("/api/m/logout"); setMe(null); };
  return (
    <div className="m-app">
      {MAIN.includes(current) && <GymTop gym={gym} unread={me.unread} onBell={() => go("inbox")} />}
      {current === "home" && <HomeView me={me} go={go} openProduct={openProduct} />}
      {current === "classes" && <ClassesView />}
      {current === "coach" && <CoachView />}
      {current === "shop" && <ShopView openProduct={openProduct} refreshKey={shopKey} />}
      {current === "me" && <MeView me={me} go={go} />}
      {current === "inbox" && <InboxView onBack={() => go(back)} go={go} onRead={() => setMe((m: any) => ({ ...m, unread: 0 }))} />}
      {current === "progress" && <ProgressView onBack={() => go(back)} />}
      {current === "settings" && <SettingsView me={me} onBack={() => go(back)} onPrefs={loadMe} onLogout={logout} />}
      {current === "ask" && <AskView gym={gym} onBack={() => go(back)} />}
      <ProductSheet product={product} onClose={() => setProduct(null)} onOrdered={() => { setProduct(null); setShopKey((k) => k + 1); if (current !== "shop") go("shop"); }} />
      <nav className="m-nav"><div style={{ gridTemplateColumns: `repeat(${shown.length}, 1fr)` }}>
        {shown.map((x) => (
          <button key={x.key} aria-current={current === x.key ? "page" : undefined} onClick={() => { go(x.key); if (x.key === "home") loadMe(); }}>
            <Icon name={x.icon} /><span>{x.label}</span>
          </button>
        ))}
      </div></nav>
    </div>
  );
}

document.body.classList.add("member");
createRoot(document.getElementById("root")!).render(<><App /><Toasts /></>);
