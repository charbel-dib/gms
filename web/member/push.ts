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

async function registration() {
  return (await navigator.serviceWorker.getRegistration("/m/")) ?? navigator.serviceWorker.register("/sw.js", { scope: "/m/" });
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
