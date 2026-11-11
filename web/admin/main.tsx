import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { get, getGymOverride, post, setGymOverride, setUnauthorizedHandler } from "../shared/api.ts";
import { Icon, Spinner, Status, Toasts, toastError, useDebounced } from "../shared/ui.tsx";
import { getLang, setLang, t, useLang } from "../shared/i18n.ts";
import { flush, refreshOfflineMembers, useConnection } from "./offline.ts";
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
import { ReceiptHost } from "./receipt.tsx";
import { ReportHost } from "./report.tsx";
import { ShopPage } from "./pages/shop.tsx";
import { MemberAppPage } from "./pages/memberapp.tsx";
import { DevelopersPage } from "./pages/developers.tsx";
import { AccountModal, ForcePasswordChange } from "./account.tsx";

function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState<string | null>(null); // asked once the password is right and two-step sign-in is on
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
          <h1>{t("Run the gym, not the paperwork.")}</h1>
          <p>{t("Memberships, check-in, classes, payments in dollars or lira, WhatsApp reminders and an assistant that knows your numbers.")}</p>
        </div>
        <small style={{ color: "#7f8ba0" }}>{t("GMS · Gym Management System")}</small>
      </div>
      <div className="auth-form">
        <form onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr("");
          try {
            await post("/api/auth/login", { email, password, ...(code !== null ? { code } : {}) });
            onDone();
          } catch (e: any) {
            if (e.code === "code_required") { setCode(""); return; }
            setErr(e.message);
          } finally {
            setBusy(false);
          }
        }}>
          <h2>{t("Sign in")}</h2>
          <label className="field"><span>{t("Email")}</span><input className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></label>
          <label className="field"><span>{t("Password")}</span><input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          {code !== null && (
            <label className="field"><span>{t("Code from your authenticator app")}</span>
              <input className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
            </label>
          )}
          {err && <p role="alert" style={{ color: "var(--plate-red)" }}>{err}</p>}
          <button className="btn primary block" disabled={busy}>{busy ? t("Signing in…") : t("Sign in")}</button>
          <p className="muted" style={{ fontSize: "0.85rem" }}>{t("Forgot your password? Ask the gym owner, or GMS support, to reset it.")}</p>
        </form>
      </div>
    </div>
  );
}

/** The scan bar: USB QR scanners type into it; staff can also search by name, phone or number. */
function ScanBar({ canCheckin }: { canCheckin: boolean }) {
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
            if (canCheckin && looksLikeQr(s)) return checkin({ token: s });
            if (canCheckin && /^\d{1,7}$/.test(s)) return checkin({ code: Number(s) });
            if (items[sel]) { navigate(`/members/${items[sel].id}`); setQ(""); setItems([]); }
          }
        }} />
      <kbd>/</kbd>
      {open && items.length > 0 && (
        <div className="suggest" role="listbox">
          {items.map((m, i) => (
            <button key={m.id} role="option" aria-selected={i === sel} onMouseDown={(e) => e.preventDefault()} onClick={() => { navigate(`/members/${m.id}`); setQ(""); setItems([]); }}>
              <span className="who"><b>{m.first_name} {m.last_name}</b><small>#{m.code} · {m.phone ?? t("no phone")}</small></span>
              <Status s={m.status} />
              {canCheckin && <span className="btn small" role="button" onClick={(e) => { e.stopPropagation(); checkin({ member_id: m.id }); }}>{t("Check in")}</span>}
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
  const staffRole = can(me, "owner", "manager", "reception");
  const [outbox, setOutbox] = useState(0);
  useEffect(() => {
    if (!gym || !can(me, "owner", "manager", "reception")) return;
    const load = () => get("/api/messages?status=outbox").then((r) => setOutbox(r.counts.outbox), () => {});
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [gym?.id, path]);

  // keep a copy of the member list on this device, so the desk still works if the internet drops
  const conn = useConnection();
  useEffect(() => {
    if (!gym || !staffRole) return;
    refreshOfflineMembers().then(flush);
    const id = setInterval(refreshOfflineMembers, 10 * 60_000);
    return () => clearInterval(id);
  }, [gym?.id]);

  const [account, setAccount] = useState(false);
  // coaches check members in only where the gym allows it (Settings → Team)
  const checkinOn = can(me, "owner", "manager", "reception") || !!gym?.settings?.staff?.coachCheckin;
  // One entry per job, not per screen. Modules a gym has not switched on never appear.
  const staff = can(me, "owner", "manager", "reception");
  const items: { to: string; label: string; icon: string; show: boolean; count?: number; also?: string[] }[] = [
    { to: "/", label: t("Today"), icon: "today", show: staff },
    { to: "/checkin", label: t("Check-in"), icon: "scan", show: checkinOn },
    { to: "/members", label: t("Members"), icon: "users", show: true },
    { to: "/payments", label: t("Money"), icon: "card", show: staff, also: ["/reports", "/expenses"] },
    { to: "/messages", label: t("Messages"), icon: "message", show: moduleOn(me, "whatsapp") && staff, count: outbox },
    { to: "/classes", label: t("Classes"), icon: "calendar", show: moduleOn(me, "classes") },
    { to: "/coaching", label: t("Personal training"), icon: "dumbbell", show: moduleOn(me, "pt") },
    { to: "/shop", label: t("Shop"), icon: "bag", show: moduleOn(me, "shop") && staff },
    { to: "/insights", label: t("Follow-up"), icon: "spark", show: moduleOn(me, "ai") && staff },
    { to: "/leads", label: t("Interested people"), icon: "lead", show: moduleOn(me, "leads") && staff },
    { to: "/app", label: t("Member app"), icon: "phone", show: moduleOn(me, "memberApp") && can(me, "owner", "manager") },
    { to: "/settings", label: t("Settings"), icon: "settings", show: can(me, "owner", "manager") },
  ];
  const shown = items.filter((i) => i.show);
  const [more, setMore] = useState(false);
  useEffect(() => setMore(false), [path]);
  const p0 = path.split("?")[0];
  const active = (i: { to: string; also?: string[] }) => (i.to === "/" ? p0 === "/" : p0.startsWith(i.to) || !!i.also?.some((a) => p0.startsWith(a)));
  const roleLabel = t({ superadmin: "GMS", owner: "Owner", manager: "Manager", reception: "Reception", coach: "Coach" }[me.user.role]);
  const foot = (
    <>
      <button onClick={() => setAccount(true)}><Icon name="lock" /><span>{t("Your account")}</span></button>
      <button onClick={() => setLang(getLang() === "ar" ? "en" : "ar")}><Icon name="globe" /><span>{getLang() === "ar" ? t("English") : "العربية"}</span></button>
      <button onClick={async () => { await post("/api/auth/logout"); setGymOverride(null); location.href = "/login"; }}><Icon name="logout" /><span>{t("Sign out")}</span></button>
    </>
  );
  return (
    <div className="shell">
      <aside className="side">
        <div className="gym-id">
          <div className="logo">{gym?.has_logo ? <img src={`/api/public/gyms/${gym.slug}/logo`} alt="" /> : (gym?.name ?? "G")[0]}</div>
          <div><b>{lang === "ar" && gym?.name_ar ? gym.name_ar : gym?.name}</b><small>{me.user.name}, {roleLabel}</small></div>
        </div>
        <nav className="nav" aria-label={t("Main")}>
          {shown.map((i, n) => (
            <Link key={i.to} to={i.to} className={n >= 4 ? "extra" : undefined} aria-current={active(i) ? "page" : undefined}>
              <Icon name={i.icon} /> <span>{i.label}</span>
              {!!i.count && <span className="count">{i.count}</span>}
            </Link>
          ))}
          <button className="more-btn" aria-expanded={more} onClick={() => setMore(!more)}><Icon name="menu" /> <span>{t("More")}</span></button>
          {me.user.role === "superadmin" && (
            <>
              <div className="group">GMS</div>
              <Link to="/platform" aria-current={path === "/platform" ? "page" : undefined}><Icon name="building" /> <span>{t("Platform")}</span></Link>
            </>
          )}
        </nav>
        <div className="side-foot">{foot}</div>
        {more && (
          <div className="more-sheet" role="dialog" aria-label={t("More")} onClick={() => setMore(false)}>
            <div onClick={(e) => e.stopPropagation()}>
              <b>{lang === "ar" && gym?.name_ar ? gym.name_ar : gym?.name}</b>
              {shown.slice(4).map((i) => (
                <Link key={i.to} to={i.to} aria-current={active(i) ? "page" : undefined}><Icon name={i.icon} /> <span>{i.label}</span>{!!i.count && <span className="count">{i.count}</span>}</Link>
              ))}
              <hr />
              {foot}
            </div>
          </div>
        )}
      </aside>
      <AccountModal open={account} onClose={() => setAccount(false)} />
      <div className="main">
        <div className="topbar">
          <ScanBar canCheckin={checkinOn} />
          <span style={{ flex: 1 }} />
          {can(me, "owner", "manager", "reception") && <Link to="/members?new=1" className="btn primary" aria-label={t("Add member")}><Icon name="plus" /><span className="btn-label">{t("Add member")}</span></Link>}
        </div>
        {(!conn.online || conn.queued > 0) && (
          <div className="offline" role="status">
            <b>{conn.online ? t("Back online.") : t("No internet.")}</b>{" "}
            {conn.online ? t("Sending {n} check-ins taken offline…", { n: conn.queued }) : conn.queued > 0 ? t("Check-in still works: {n} saved on this device, sent when the connection is back. Write payments down and record them later.", { n: conn.queued }) : t("Check-in still works from this device. Write payments down and record them once the connection is back.")}
          </div>
        )}
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
    case "/": return can(me, "owner", "manager", "reception") ? <TodayPage /> : me.gym?.settings?.staff?.coachCheckin ? <CheckinPage /> : moduleOn(me, "pt") ? <CoachingPage /> : <ClassesPage />;
    case "/checkin": return <CheckinPage />;
    case "/members": return <MembersPage />;
    case "/classes": return <ClassesPage />;
    case "/coaching": return <CoachingPage />;
    case "/payments": return <PaymentsPage />;
    case "/shop": return <ShopPage />;
    case "/messages": return <MessagesPage />;
    case "/insights": return <InsightsPage />;
    case "/reports": return <ReportsPage />;
    case "/leads": return <LeadsPage />;
    case "/expenses": return <ExpensesPage />;
    case "/settings": return <SettingsPage />;
    case "/developers": return can(me, "owner") ? <DevelopersPage /> : null;
    case "/app": return can(me, "owner", "manager") ? <MemberAppPage /> : null;
    default: return <div className="page"><div className="empty"><b>{t("This page does not exist.")}</b><Link className="btn" to="/">{t("Go to Today")}</Link></div></div>;
  }
}

function Root() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useLang();
  const rootPath = usePath().split("?")[0];
  const load = useCallback(async () => {
    try {
      const r = await get<Me>("/api/auth/me");
      // signed in on the login address: go to the dashboard
      if (location.pathname === "/login") history.replaceState(null, "", "/");
      setMe(r);
    } catch (e: any) {
      if (e.status === 401) setMe(null);
      else setMe(null);
    }
  }, []);
  useEffect(() => {
    setUnauthorizedHandler(() => setMe(null));
    load();
    // lets the desk reopen the app without internet (see web/public/staff-sw.js)
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/staff-sw.js", { scope: "/" }).catch(() => {});
  }, [load]);
  useEffect(() => {
    const color = me?.gym?.brand_color ?? "#E4572E";
    document.documentElement.style.setProperty("--brand", color);
    document.documentElement.style.setProperty("--brand-ink", brandInk(color));
    document.title = me?.gym ? `${me.gym.name} · GMS` : "GMS";
  }, [me?.gym?.brand_color, me?.gym?.name]);

  if (me === undefined) return <div className="empty" style={{ minHeight: "100vh" }}><Spinner /></div>;
  if (me === null) return <Login onDone={load} />;
  if (me.user.must_change_password) return <ForcePasswordChange name={me.user.name} onDone={load} />;
  if (me.user.role === "superadmin" && !me.gym) {
    return (
      <AppCtx.Provider value={{ me, reloadMe: load }}>
        <div className="shell" style={{ gridTemplateColumns: "1fr" }}><div className="main">{rootPath === "/developers" ? <DevelopersPage /> : <PlatformPage />}</div></div>
      </AppCtx.Provider>
    );
  }
  return (
    <AppCtx.Provider value={{ me, reloadMe: load }}>
      <Shell me={me}><Routes me={me} /></Shell>
      <ReceiptHost />
      <ReportHost />
      {me.user.role === "superadmin" && getGymOverride() && (
        <button className="btn dark small" style={{ position: "fixed", bottom: 16, insetInlineStart: 252, zIndex: 50 }} onClick={() => { setGymOverride(null); location.href = "/platform"; }}>
          {t("Leave")}{" "}{me.gym?.name}
        </button>
      )}
    </AppCtx.Provider>
  );
}

createRoot(document.getElementById("root")!).render(<><Root /><Toasts /></>);
