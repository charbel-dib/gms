/**
 * Installing the gym's app without the App Store or Google Play.
 *  - Android (Chrome, Samsung Internet, Edge…): one tap on "Install"; Chrome turns it into a real app (WebAPK).
 *  - iPhone/iPad: Share → Add to Home Screen (Apple has no install button), shown step by step.
 *  - Inside Instagram / Facebook / TikTok: those browsers can't install apps → open in Safari or Chrome first.
 *  - Computer: a QR code to open the link on the phone.
 */
import React, { useEffect, useState, useSyncExternalStore } from "react";
import { Icon, toast } from "../shared/ui.tsx";
import { t } from "../shared/i18n.ts";
import { qrSvg } from "../shared/qr.ts";
import { Sheet } from "./ui.tsx";

// The install prompt can fire before React renders: catch it as soon as the script loads.
let deferred: any = null;
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e: any) => { e.preventDefault(); deferred = e; notify(); });
  window.addEventListener("appinstalled", () => { deferred = null; installedNow = true; notify(); });
}
let installedNow = false;
function useDeferredPrompt() {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => deferred);
}

export type Platform = {
  os: "ios" | "android" | "desktop";
  browser: "safari" | "chrome" | "samsung" | "firefox" | "edge" | "inapp" | "other";
  inApp: string | null;
  standalone: boolean;
};

export function detectPlatform(ua = navigator.userAgent): Platform {
  // iPadOS 13+ says "Macintosh": a touch screen tells it apart
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const android = /Android/.test(ua);
  const inApp = /Instagram/.test(ua) ? "Instagram" : /FBAN|FBAV|FB_IAB/.test(ua) ? "Facebook" : /TikTok|musical_ly|BytedanceWebview/.test(ua) ? "TikTok"
    : /Snapchat/.test(ua) ? "Snapchat" : /LinkedInApp/.test(ua) ? "LinkedIn" : /\bwv\b/.test(ua) && android ? "app" : null;
  const browser: Platform["browser"] = inApp ? "inapp"
    : /SamsungBrowser/.test(ua) ? "samsung" : /EdgA|EdgiOS|Edg\//.test(ua) ? "edge" : /FxiOS|Firefox/.test(ua) ? "firefox"
    : /CriOS|Chrome/.test(ua) ? "chrome" : /Safari/.test(ua) ? "safari" : "other";
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;
  return { os: ios ? "ios" : android ? "android" : "desktop", browser, inApp, standalone };
}

export const isInstalled = () => detectPlatform().standalone;

/** The iOS "Share" glyph, drawn so members recognise it. */
const ShareGlyph = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 3v12M8 7l4-4 4 4" /><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
  </svg>
);
const PlusSquare = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M12 8v8M8 12h8" /></svg>
);
const Dots = ({ vertical }: { vertical?: boolean }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>{vertical ? <><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" /></> : <><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></>}</svg>
);

function Steps({ steps }: { steps: { icon?: React.ReactNode; text: React.ReactNode }[] }) {
  return (
    <ol className="i-steps">
      {steps.map((s, i) => (
        <li key={i}><span className="i-n">{i + 1}</span><span className="grow">{s.text}</span>{s.icon && <span className="i-glyph">{s.icon}</span>}</li>
      ))}
    </ol>
  );
}

/** The right instructions for this phone and browser. */
export function InstallGuide({ gym, link, onSignIn }: { gym: any; link: string; onSignIn?: () => void }) {
  const p = detectPlatform();
  const prompt = useDeferredPrompt();
  const [done, setDone] = useState(installedNow);
  useEffect(() => { if (installedNow) setDone(true); }, [prompt]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); toast(t("Link copied")); } catch { window.prompt(t("Copy this link"), link); }
  };

  if (p.standalone) {
    return <div className="i-done"><span className="i-check">✓</span><b>{t("You're using the app.")}</b>{onSignIn && <button className="m-btn block" onClick={onSignIn}>{t("Continue")}</button>}</div>;
  }
  if (done) {
    return (
      <div className="i-done">
        <span className="i-check">✓</span>
        <b>{t("Installed")}</b>
        <p className="m-muted">{t("Open {gym} from your home screen and sign in with your phone and PIN.", { gym: gym.name })}</p>
      </div>
    );
  }

  let body: React.ReactNode;
  if (p.browser === "inapp") {
    body = (
      <>
        <p className="i-lead">{t("{app}'s browser can't install apps. Open this page in {browser} first.", { app: p.inApp === "app" ? t("This app") : p.inApp ?? "", browser: p.os === "ios" ? "Safari" : "Chrome" })}</p>
        <Steps steps={p.os === "ios"
          ? [{ text: t("Tap ⋯ or the share button in the corner"), icon: <Dots /> }, { text: t("Choose “Open in Safari” (or “Open in external browser”)") }, { text: t("Then follow the steps shown there") }]
          : [{ text: t("Tap ⋮ in the top corner"), icon: <Dots vertical /> }, { text: t("Choose “Open in Chrome” (or “Open in browser”)") }, { text: t("Then tap “Install”") }]} />
        <button className="m-btn ghost block" onClick={copy}>{t("Copy the link instead")}</button>
      </>
    );
  } else if (p.os === "ios") {
    body = (
      <>
        <p className="i-lead">{t("On iPhone, apps from your gym are added from {browser}: no App Store needed, it takes 10 seconds.", { browser: p.browser === "safari" ? "Safari" : t("the browser") })}</p>
        <Steps steps={[
          { text: p.browser === "safari" ? t("Tap the Share button at the bottom of the screen (on the newest iPhones: tap ⋯ first, then Share)") : t("Tap the Share button (next to the address bar)"), icon: <ShareGlyph /> },
          { text: t("Scroll down and tap “Add to Home Screen”"), icon: <PlusSquare /> },
          { text: t("Tap “Add” at the top right") },
          { text: t("Open {gym} from your home screen and sign in", { gym: gym.name }) },
        ]} />
        {p.browser !== "safari" && <p className="m-muted i-note">{t("Don't see “Add to Home Screen”? Open this link in Safari: it always works there.")} <button className="m-link" onClick={copy}>{t("Copy link")}</button></p>}
        <div className="i-arrow" aria-hidden><span>{t("The Share button is down here")}</span><ShareGlyph /></div>
      </>
    );
  } else if (p.os === "android") {
    body = prompt ? (
      <>
        <p className="i-lead">{t("One tap and {gym} is on your home screen, like any app.", { gym: gym.name })}</p>
        <button className="m-btn block i-big" onClick={async () => {
          prompt.prompt();
          const r = await prompt.userChoice.catch(() => null);
          deferred = null; notify();
          if (r?.outcome === "accepted") setDone(true);
        }}><Icon name="download" width={20} height={20} style={{ marginInlineEnd: 8 }} />{t("Install the app")}</button>
      </>
    ) : (
      <>
        <p className="i-lead">{t("Add {gym} to your home screen, like any app: no Play Store needed.", { gym: gym.name })}</p>
        <Steps steps={[
          { text: p.browser === "samsung" ? t("Tap the menu ☰ at the bottom") : p.browser === "firefox" ? t("Tap ⋮ in the corner") : t("Tap ⋮ at the top right"), icon: <Dots vertical /> },
          { text: t("Tap “Install app” or “Add to Home screen”"), icon: <PlusSquare /> },
          { text: t("Confirm, then open {gym} from your home screen", { gym: gym.name }) },
        ]} />
      </>
    );
  } else {
    body = (
      <>
        <p className="i-lead">{t("Scan this code with your phone's camera to get the app on your phone.")}</p>
        <div className="i-qr" dangerouslySetInnerHTML={{ __html: qrSvg(link) }} />
        <p className="m-muted i-note" style={{ textAlign: "center" }}>{link}</p>
        {prompt && <button className="m-btn ghost block" onClick={() => prompt.prompt()}>{t("Install on this computer")}</button>}
      </>
    );
  }
  return <div className="i-guide">{body}</div>;
}

/** Full page at /m/<gym>/install: the link sent by WhatsApp and printed on the reception poster. */
export function InstallPage({ gym, onContinue }: { gym: any; onContinue: () => void }) {
  const link = `${location.origin}/m/${gym.slug}/install`;
  return (
    <div className="m-app">
      <div className="i-hero">
        <div className="i-icon">{gym.has_app_icon ? <img src={`/api/public/gyms/${gym.slug}/app-icon/192`} alt="" /> : gym.has_logo ? <img src={`/api/public/gyms/${gym.slug}/logo`} alt="" /> : <span>{gym.name[0]}</span>}</div>
        <h1>{t("Get the {gym} app", { gym: gym.name })}</h1>
        <p className="m-muted">{t("Your entry QR code, classes, personal training and offers. Free, on any phone.")}</p>
      </div>
      <div className="m-body" style={{ paddingTop: 0 }}>
        <InstallGuide gym={gym} link={link} onSignIn={onContinue} />
        <button className="m-link" style={{ justifySelf: "center" }} onClick={onContinue}>{t("Continue in the browser")}</button>
      </div>
    </div>
  );
}

/** The same guide in a bottom sheet, from the sign-in screen, Home and Settings. */
export function InstallSheet({ gym, open, onClose }: { gym: any; open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title={t("Install the app")}>
      <InstallGuide gym={gym} link={`${location.origin}/m/${gym.slug}/install`} />
    </Sheet>
  );
}

/** Small card offering to install, until the member installs or closes it. */
export function InstallCard({ gym }: { gym: any }) {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(() => { try { return isInstalled() || localStorage.getItem("gms.install.dismissed") === "1"; } catch { return isInstalled(); } });
  if (hidden) return null;
  return (
    <>
      <div className="install">
        <Icon name="phone" width={22} height={22} />
        <div style={{ flex: 1 }}><b>{t("Install the app")}</b><div className="m-muted" style={{ fontSize: "0.85rem" }}>{t("One tap from your home screen, no store needed.")}</div></div>
        <button className="m-btn" onClick={() => setOpen(true)}>{t("How?")}</button>
        <button className="m-icon" onClick={() => { try { localStorage.setItem("gms.install.dismissed", "1"); } catch { /* ignore */ } setHidden(true); }} aria-label={t("Close")}><Icon name="x" width={16} height={16} /></button>
      </div>
      <InstallSheet gym={gym} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
