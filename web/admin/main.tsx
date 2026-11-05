import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { get, getGymOverride, post, setGymOverride, setUnauthorizedHandler } from "../shared/api.ts";
import { Icon, Spinner, Status, Toasts, toastError, useDebounced } from "../shared/ui.tsx";
import { getLang, setLang, t, useLang } from "../shared/i18n.ts";
import { AppCtx, Link, brandInk, can, doCheckin, looksLikeQr, moduleOn, navigate, usePath, type Me } from "./app.tsx";
import { TodayPage } from "./pages/today.tsx";
import { CheckinPage } from "./pages/checkin.tsx";
import { MembersPage, MemberPage } from "./pages/members.tsx";
import { ClassesPage } from "./pages/classes.tsx";
import { CoachingPage } from "./pages/coaching.tsx";
import { PaymentsPage, ExpensesPage, ReportsPage } from "./pages/money.tsx";
import { MessagesPage } from "./pages/messages.tsx";
import { InsightsPage } from "./pages/insights.tsx";
import { LeadsPage } from "./pages/leads.tsx";
import { SettingsPage } from "./pages/settings.tsx";
import { PlatformPage } from "./pages/platform.tsx";

function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="auth">
      <div className="auth-art">
        <div className="plates-row" aria-hidden="true">
          {[["#d1343f", 64], ["#2f6fcf", 56], ["#d99a00", 48], ["#2e8b57", 40]].map(([c, s]) => (
            <span key={c} className="plate" style={{ ["--c" as any]: c, width: s as number, height: s as number }} />
          ))}
        </div>
        <div className="stack">
          <h1>Run the gym, not the paperwork.</h1>
          <p>Memberships, check-in, classes, payments in dollars or lira, WhatsApp reminders and an assistant that knows your numbers.</p>
        </div>
        <small style={{ color: "#7f8ba0" }}>GMS · Gym Management System</small>
      </div>
      <div className="auth-form">
        <form onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr("");
          try {
            await post("/api/auth/login", { email, password });
            onDone();
          } catch (e: any) {
            setErr(e.message);
          } finally {
            setBusy(false);
          }
        }}>
          <h2>Sign in</h2>
          <label className="field"><span>Email</span><input className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></label>
          <label className="field"><span>Password</span><input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          {err && <p role="alert" style={{ color: "var(--plate-red)" }}>{err}</p>}
          <button className="btn primary block" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
          <p className="muted" style={{ fontSize: "0.85rem" }}>Forgot your password? Ask the gym owner, or GMS support, to reset it.</p>
        </form>
      </div>
    </div>
  );
}

/** The scan bar: USB QR scanners type into it; staff can also search by name, phone or number. */
function ScanBar() {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<any[]>([]);
  const [sel, setSel] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const dq = useDebounced(q, 180);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement)) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    const s = dq.trim();
    if (s.length < 2 || looksLikeQr(s)) { setItems([]); return; }
    get(`/api/members?q=${encodeURIComponent(s)}&limit=6&sort=name`).then((r) => { setItems(r.rows); setSel(0); }, () => setItems([]));
  }, [dq]);

  const checkin = async (ref: any) => {
    try {
      await doCheckin(ref);
      navigate("/checkin");
    } catch (e) {
      toastError(e);
    }
    setQ("");
    setItems([]);
  };

  return (
    <div className="scanbar">
      <Icon name="scan" />
      <input ref={ref} className="input" value={q} placeholder={t("Scan a QR code, or type a name, phone or member number")}
        aria-label={t("Scan a QR code, or type a name, phone or member number")}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
          if (e.key === "Escape") { setQ(""); setItems([]); }
          if (e.key === "Enter") {
            const s = q.trim();
            if (!s) return;
            if (looksLikeQr(s)) return checkin({ token: s });
            if (/^\d{1,7}$/.test(s)) return checkin({ code: Number(s) });
            if (items[sel]) { navigate(`/members/${items[sel].id}`); setQ(""); setItems([]); }
          }
        }} />
      <kbd>/</kbd>
      {open && items.length > 0 && (
        <div className="suggest" role="listbox">
          {items.map((m, i) => (
            <button key={m.id} role="option" aria-selected={i === sel} onMouseDown={(e) => e.preventDefault()} onClick={() => { navigate(`/members/${m.id}`); setQ(""); setItems([]); }}>
              <span className="who"><b>{m.first_name} {m.last_name}</b><small>#{m.code} · {m.phone ?? "no phone"}</small></span>
              <Status s={m.status} />
              <span className="btn small" role="button" onClick={(e) => { e.stopPropagation(); checkin({ member_id: m.id }); }}>Check in</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Shell({ me, children }: { me: Me; children: React.ReactNode }) {
  const path = usePath().split("?")[0];
  const lang = useLang();
  const gym = me.gym;
  const [outbox, setOutbox] = useState(0);
  useEffect(() => {
    if (!gym || !can(me, "owner", "manager", "reception")) return;
    const load = () => get("/api/messages?status=outbox").then((r) => setOutbox(r.counts.outbox), () => {});
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [gym?.id, path]);

  const items: { to: string; label: string; icon: string; show: boolean; count?: number }[] = [
    { to: "/", label: t("Today"), icon: "today", show: can(me, "owner", "manager", "reception") },
    { to: "/checkin", label: t("Check-in"), icon: "scan", show: true },
    { to: "/members", label: t("Members"), icon: "users", show: true },
    { to: "/classes", label: t("Classes"), icon: "calendar", show: moduleOn(me, "classes") },
    { to: "/coaching", label: t("Personal training"), icon: "dumbbell", show: moduleOn(me, "pt") },
    { to: "/payments", label: t("Payments"), icon: "card", show: can(me, "owner", "manager", "reception") },
    { to: "/messages", label: t("Messages"), icon: "message", show: moduleOn(me, "whatsapp") && can(me, "owner", "manager", "reception"), count: outbox },
    { to: "/insights", label: t("Insights"), icon: "spark", show: moduleOn(me, "ai") && can(me, "owner", "manager", "reception") },
    { to: "/reports", label: t("Reports"), icon: "chart", show: can(me, "owner", "manager") },
    { to: "/leads", label: t("Leads"), icon: "lead", show: moduleOn(me, "leads") && can(me, "owner", "manager", "reception") },
    { to: "/expenses", label: t("Expenses"), icon: "receipt", show: moduleOn(me, "expenses") && can(me, "owner", "manager") },
    { to: "/settings", label: t("Settings"), icon: "settings", show: can(me, "owner", "manager") },
  ];
  const active = (to: string) => (to === "/" ? path === "/" : path.startsWith(to));
  return (
    <div className="shell">
      <aside className="side">
        <div className="gym-id">
          <div className="logo">{gym?.has_logo ? <img src={`/api/public/gyms/${gym.slug}/logo`} alt="" /> : (gym?.name ?? "G")[0]}</div>
          <div><b>{lang === "ar" && gym?.name_ar ? gym.name_ar : gym?.name}</b><small>{me.user.name} · {me.user.role}</small></div>
        </div>
        <nav className="nav" aria-label="Main">
          {items.filter((i) => i.show).map((i) => (
            <Link key={i.to} to={i.to} aria-current={active(i.to) ? "page" : undefined}>
              <Icon name={i.icon} /> <span>{i.label}</span>
              {!!i.count && <span className="count">{i.count}</span>}
            </Link>
          ))}
          {me.user.role === "superadmin" && (
            <>
              <div className="group">GMS</div>
              <Link to="/platform" aria-current={path === "/platform" ? "page" : undefined}><Icon name="building" /> <span>{t("Platform")}</span></Link>
            </>
          )}
        </nav>
        <div className="side-foot">
          <button onClick={() => setLang(getLang() === "ar" ? "en" : "ar")}><Icon name="globe" width={16} height={16} style={{ display: "inline", verticalAlign: -3, marginInlineEnd: 6 }} />{getLang() === "ar" ? t("Switch to English") : t("Switch to Arabic")}</button>
          <button onClick={async () => { await post("/api/auth/logout"); setGymOverride(null); location.href = "/"; }}><Icon name="logout" width={16} height={16} style={{ display: "inline", verticalAlign: -3, marginInlineEnd: 6 }} />{t("Sign out")}</button>
        </div>
      </aside>
      <div className="main">
        <div className="topbar">
          <ScanBar />
          <span style={{ flex: 1 }} />
          {can(me, "owner", "manager", "reception") && <Link to="/members?new=1" className="btn primary"><Icon name="plus" />{t("Add member")}</Link>}
        </div>
        {children}
      </div>
    </div>
  );
}

function Routes({ me }: { me: Me }) {
  const full = usePath();
  const path = full.split("?")[0];
  if (path === "/platform" && me.user.role === "superadmin") return <PlatformPage />;
  if (path.startsWith("/members/")) return <MemberPage id={path.split("/")[2]} />;
  switch (path) {
    case "/": return can(me, "owner", "manager", "reception") ? <TodayPage /> : <CheckinPage />;
    case "/checkin": return <CheckinPage />;
    case "/members": return <MembersPage />;
    case "/classes": return <ClassesPage />;
    case "/coaching": return <CoachingPage />;
    case "/payments": return <PaymentsPage />;
    case "/messages": return <MessagesPage />;
    case "/insights": return <InsightsPage />;
    case "/reports": return <ReportsPage />;
    case "/leads": return <LeadsPage />;
    case "/expenses": return <ExpensesPage />;
    case "/settings": return <SettingsPage />;
    default: return <div className="page"><div className="empty"><b>This page does not exist.</b><Link className="btn" to="/">Go to Today</Link></div></div>;
  }
}

function Root() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useLang();
  const load = useCallback(async () => {
    try {
      const r = await get<Me>("/api/auth/me");
      setMe(r);
    } catch (e: any) {
      if (e.status === 401) setMe(null);
      else setMe(null);
    }
  }, []);
  useEffect(() => {
    setUnauthorizedHandler(() => setMe(null));
    load();
  }, [load]);
  useEffect(() => {
    const color = me?.gym?.brand_color ?? "#E4572E";
    document.documentElement.style.setProperty("--brand", color);
    document.documentElement.style.setProperty("--brand-ink", brandInk(color));
    document.title = me?.gym ? `${me.gym.name} · GMS` : "GMS";
  }, [me?.gym?.brand_color, me?.gym?.name]);

  if (me === undefined) return <div className="empty" style={{ minHeight: "100vh" }}><Spinner /></div>;
  if (me === null) return <Login onDone={load} />;
  if (me.user.role === "superadmin" && !me.gym) {
    return (
      <AppCtx.Provider value={{ me, reloadMe: load }}>
        <div className="shell" style={{ gridTemplateColumns: "1fr" }}><div className="main"><PlatformPage /></div></div>
      </AppCtx.Provider>
    );
  }
  return (
    <AppCtx.Provider value={{ me, reloadMe: load }}>
      <Shell me={me}><Routes me={me} /></Shell>
      {me.user.role === "superadmin" && getGymOverride() && (
        <button className="btn dark small" style={{ position: "fixed", bottom: 16, insetInlineStart: 252, zIndex: 50 }} onClick={() => { setGymOverride(null); location.href = "/platform"; }}>
          Leave {me.gym?.name}
        </button>
      )}
    </AppCtx.Provider>
  );
}

createRoot(document.getElementById("root")!).render(<><Root /><Toasts /></>);
