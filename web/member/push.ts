/** Browser side of push notifications for the member app. */
import { get, post } from "../shared/api.ts";

export type PushSupport = "ok" | "ios_install" | "unsupported";

export function pushSupport(): PushSupport {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;
  if (ios && !standalone) return "ios_install"; // iOS only allows push for home-screen apps (16.4+)
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  return "ok";
}

/**
 * The service worker of a gym's app works on that gym's pages only (/m/<slug>), the same scope as the app's manifest.
 * Android shows a notification under the installed app (its name and icon) only when the service worker that
 * received it has the app's scope; with one service worker for every gym (/m/, before November 2026),
 * notifications showed up as coming from Chrome.
 */
const slug = location.pathname.split("/")[2] ?? "";
const scope = () => `/m/${slug}`;

async function registration() {
  const want = new URL(scope(), location.origin).href;
  const regs = await navigator.serviceWorker.getRegistrations();
  return regs.find((r) => r.scope === want) ?? navigator.serviceWorker.register("/sw.js", { scope: scope() });
}

/**
 * Called when the app opens with a signed-in member: registers this gym's service worker, moves a subscription
 * made under the old shared one (/m/) to it, and tells the server about the device again (it may have been
 * dropped after failures). Asks nothing: it only acts when notifications are already allowed.
 */
export async function setupPush(signedIn: boolean) {
  if (!("serviceWorker" in navigator)) return;
  const reg = await registration();
  if (!signedIn || pushSupport() !== "ok") return;
  const old = (await navigator.serviceWorker.getRegistrations()).find((r) => r.scope === location.origin + "/m/");
  let wasOn = false;
  if (old) {
    const sub = await old.pushManager.getSubscription().catch(() => null);
    if (sub) {
      wasOn = true;
      await post("/api/m/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe().catch(() => false);
    }
    await old.unregister().catch(() => false);
  }
  if (Notification.permission !== "granted") return;
  const sub = await reg.pushManager.getSubscription().catch(() => null);
  if (sub) await post("/api/m/push/subscribe", sub.toJSON()).catch(() => {});
  else if (wasOn) await enablePush().catch(() => {});
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== "ok") return null;
  const reg = await registration();
  return reg.pushManager.getSubscription();
}

function keyBytes(b64url: string) {
  const raw = atob(b64url.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Asks permission (must be called from a tap), subscribes, and registers the device with the server. */
export async function enablePush(): Promise<"on" | "denied" | "unsupported"> {
  if (pushSupport() !== "ok") return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const { publicKey } = await get<{ publicKey: string }>("/api/m/push/key");
  let sub = await reg.pushManager.getSubscription();
  if (sub) {
    // keys changed on the server (new deployment with new keys): start over
    const current = sub.options?.applicationServerKey ? btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : publicKey;
    if (current !== publicKey) { await sub.unsubscribe(); sub = null; }
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  await post("/api/m/push/subscribe", sub.toJSON());
  return "on";
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await post("/api/m/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe();
}
