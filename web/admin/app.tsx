/** App-wide state: current user & gym, router, check-in results. */
import React, { createContext, useContext, useSyncExternalStore } from "react";
import { post } from "../shared/api.ts";
import { checkinOffline, flush, isNetworkError, setOnline } from "./offline.ts";

export interface Me {
  user: { id: string; name: string; email: string; role: "superadmin" | "owner" | "manager" | "reception" | "coach"; gym_id: string | null; must_change_password?: boolean; totp_enabled?: boolean };
  gym: any | null;
}

export const AppCtx = createContext<{ me: Me; reloadMe: () => Promise<void> }>(null as any);
export const useApp = () => useContext(AppCtx);

export function can(me: Me, ...roles: Me["user"]["role"][]) {
  return me.user.role === "superadmin" || roles.includes(me.user.role);
}
export function moduleOn(me: Me, key: string) {
  return me.gym?.modules?.[key] !== false;
}

// ---------- router ----------
const routeSubs = new Set<() => void>();
window.addEventListener("popstate", () => routeSubs.forEach((f) => f()));
export function navigate(to: string, replace = false) {
  if (to === location.pathname + location.search) return;
  history[replace ? "replaceState" : "pushState"](null, "", to);
  routeSubs.forEach((f) => f());
  window.scrollTo(0, 0);
}
export function usePath() {
  return useSyncExternalStore((cb) => { routeSubs.add(cb); return () => routeSubs.delete(cb); }, () => location.pathname + location.search);
}
export function Link({ to, children, ...rest }: { to: string; children: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a href={to} {...rest} onClick={(e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      navigate(to);
      rest.onClick?.(e);
    }}>{children}</a>
  );
}

// ---------- check-in store (shared by the scan bar and the Check-in page) ----------
export interface CheckinResult {
  result: "ok" | "denied";
  reason: string | null;
  warnings: string[];
  duplicate?: boolean;
  member: any;
  at: number;
}
let last: CheckinResult | null = null;
let feed: CheckinResult[] = [];
const ckSubs = new Set<() => void>();
export function useCheckins() {
  const l = useSyncExternalStore((cb) => { ckSubs.add(cb); return () => ckSubs.delete(cb); }, () => last);
  const f = useSyncExternalStore((cb) => { ckSubs.add(cb); return () => ckSubs.delete(cb); }, () => feed);
  return { last: l, feed: f };
}
export async function doCheckin(ref: { token?: string; code?: number; member_id?: string }) {
  let r: CheckinResult;
  try {
    r = await post<CheckinResult>("/api/checkin", ref);
    setOnline(true);
    flush();
  } catch (e) {
    // no internet: decide from the copy on this device, and send it later
    const off = isNetworkError(e) ? checkinOffline(ref) : null;
    if (!off) throw e;
    setOnline(false);
    r = off as CheckinResult;
  }
  last = { ...r, at: Date.now() };
  feed = [last, ...feed].slice(0, 30);
  ckSubs.forEach((f) => f());
  beep(r.result === "ok" ? (r.warnings.length ? "warn" : "ok") : "denied");
  return last;
}
export function clearLast() {
  last = null;
  ckSubs.forEach((f) => f());
}

let audio: AudioContext | null = null;
function beep(kind: "ok" | "warn" | "denied") {
  try {
    audio ??= new AudioContext();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = kind === "ok" ? 880 : kind === "warn" ? 660 : 220;
    o.type = kind === "denied" ? "square" : "sine";
    g.gain.setValueAtTime(0.08, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + (kind === "denied" ? 0.45 : 0.18));
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.5);
  } catch { /* audio unavailable */ }
}

export function looksLikeQr(s: string) {
  return /^GMS:/i.test(s) || /^[0-9a-f]{24}$/i.test(s);
}

export function brandInk(hex: string) {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.45 ? "#1a2230" : "#ffffff";
}
