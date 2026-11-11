/**
 * Keeping the desk working when the internet drops.
 *
 * While online, the member list is copied to this device every few minutes. If a check-in
 * cannot reach the server, it is decided from that copy, stored here with its real time,
 * and sent as soon as the connection is back. Payments are never taken offline: money
 * needs a receipt number from the server.
 */
import { useSyncExternalStore } from "react";
import { ApiError, get, post } from "../shared/api.ts";

interface CachedMember { id: string; code: number; first_name: string; last_name: string; status: string; end_date: string | null; plan_name: string | null; qr_token: string }
interface Queued { ref: { token?: string; code?: number; member_id?: string }; at: string }

const K_MEMBERS = "gms.offline.members";
const K_QUEUE = "gms.offline.queue";
const read = <T,>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(k) ?? "") as T; } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } };

let online = typeof navigator === "undefined" ? true : navigator.onLine;
let queued = read<Queued[]>(K_QUEUE, []).length;
let snap = { online, queued };
const subs = new Set<() => void>();
const emit = () => { snap = { online, queued }; subs.forEach((f) => f()); };

export const isNetworkError = (e: unknown) => !(e instanceof ApiError);

export function setOnline(v: boolean) {
  if (online === v) return;
  online = v;
  emit();
  if (v) flush();
}
window.addEventListener("online", () => setOnline(true));
window.addEventListener("offline", () => setOnline(false));

export function useConnection() {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => snap);
}

/** Copies the member list to this device. Called at start and every ten minutes. */
export async function refreshOfflineMembers() {
  try {
    write(K_MEMBERS, await get<CachedMember[]>("/api/offline/members"));
    setOnline(true);
  } catch (e) {
    if (isNetworkError(e)) setOnline(false);
  }
}

export function searchOffline(q: string): CachedMember[] {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  return read<CachedMember[]>(K_MEMBERS, []).filter((m) => `${m.first_name} ${m.last_name}`.toLowerCase().includes(s) || String(m.code) === s).slice(0, 6);
}

/** Decides a check-in from the copy on this device and keeps it to send later. Null when the member is unknown here. */
export function checkinOffline(ref: Queued["ref"]) {
  const list = read<CachedMember[]>(K_MEMBERS, []);
  const tok = ref.token?.trim().replace(/^GMS:/i, "");
  const m = list.find((x) => (ref.member_id && x.id === ref.member_id) || (ref.code && x.code === ref.code) || (tok && x.qr_token === tok));
  if (!m) return null;
  const q = read<Queued[]>(K_QUEUE, []);
  q.push({ ref: { member_id: m.id }, at: new Date().toISOString() });
  write(K_QUEUE, q);
  queued = q.length;
  emit();
  const daysLeft = m.end_date ? Math.round((new Date(m.end_date + "T23:59:59").getTime() - Date.now()) / 86400_000) : null;
  const ok = (m.status === "active" || m.status === "expiring") && (daysLeft == null || daysLeft >= 0);
  return {
    result: ok ? ("ok" as const) : ("denied" as const),
    reason: ok ? null : m.status === "frozen" ? "frozen" : m.status === "none" ? "no_membership" : "expired",
    warnings: ["saved_offline"],
    member: { ...m, days_left: daysLeft, visits_total: null, visits_used: 0, balance_usd: 0 },
  };
}

let flushing = false;
/** Sends the check-ins taken offline. Stops at the first network failure and keeps the rest. */
export async function flush() {
  if (flushing) return;
  flushing = true;
  try {
    let q = read<Queued[]>(K_QUEUE, []);
    while (q.length) {
      try {
        await post("/api/checkin", { ...q[0].ref, at: q[0].at });
      } catch (e) {
        if (isNetworkError(e)) { setOnline(false); break; }
        // refused by the server (member deleted, etc.): nothing to retry
      }
      q = q.slice(1);
      write(K_QUEUE, q);
      queued = q.length;
      emit();
    }
  } finally {
    flushing = false;
  }
}
