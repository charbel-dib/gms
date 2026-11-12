/**
 * Member notifications: every notification is stored (the member's in-app inbox)
 * and pushed to the member's devices that turned notifications on.
 *
 * Control, from broadest to finest:
 *   gym plan (member app module) → gym settings (on/off, each type, timing, quiet hours)
 *   → member preferences (4 categories) → each device subscription.
 * Scheduled kinds (reminders, expiry, announcements) wait for the end of quiet hours;
 * transactional ones (payment, waitlist spot, cancelled class) go out at once.
 */
import { db, many, one, type Queryable } from "../db/index.ts";
import { sendPush } from "./webpush.ts";

export const NOTIFICATION_TYPES = {
  class_reminder: { category: "classes", scheduled: true, label: "Class reminder", help: "Before a class the member booked" },
  pt_reminder: { category: "classes", scheduled: true, label: "Personal training reminder", help: "Before a planned PT session" },
  waitlist: { category: "classes", scheduled: false, label: "Spot freed on the waitlist", help: "When the member moves from the waitlist to booked" },
  class_cancelled: { category: "classes", scheduled: false, label: "Class cancelled", help: "When the gym cancels a class the member booked" },
  expiry: { category: "membership", scheduled: true, label: "Membership ending", help: "7 days and 1 day before, and on the last day" },
  winback: { category: "membership", scheduled: true, label: "Membership expired", help: "A few days after it ended, to invite them back" },
  receipt: { category: "payments", scheduled: false, label: "Payment receipt", help: "After each payment, with the receipt" },
  announcement: { category: "news", scheduled: true, label: "Gym announcements", help: "Messages you send to a group of members" },
  offer: { category: "news", scheduled: true, label: "New offers", help: "When you publish an offer and choose to tell members" },
  request_ready: { category: "payments", scheduled: false, label: "Order ready", help: "When a product the member asked for in the app is ready at reception" },
  badge: { category: "progress", scheduled: true, label: "Badges", help: "When the member earns a badge (10th visit, 4-week streak…)" },
  challenge: { category: "progress", scheduled: true, label: "Challenges", help: "When a challenge starts and when the member completes it" },
  referral: { category: "progress", scheduled: true, label: "Friend joined", help: "When a friend the member invited becomes a member" },
} as const;
export type NotificationKind = keyof typeof NOTIFICATION_TYPES;
export const NOTIFICATION_CATEGORIES = ["classes", "membership", "payments", "progress", "news"] as const;

export interface PushSettings {
  enabled: boolean;
  classReminderHours: number;
  ptReminderHours: number;
  quietFrom: string; // "22:00"
  quietTo: string; // "08:00"
  types: Partial<Record<NotificationKind, boolean>>;
}

export const DEFAULT_PUSH: PushSettings = { enabled: true, classReminderHours: 2, ptReminderHours: 3, quietFrom: "22:00", quietTo: "08:00", types: {} };

export function pushSettings(settings: any): PushSettings {
  const s = settings?.push ?? {};
  return { ...DEFAULT_PUSH, ...s, types: { ...(s.types ?? {}) } };
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};

/** Local wall-clock minutes in a timezone. */
function localMinutes(tz: string, at = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const h = Number(parts.find((p) => p.type === "hour")!.value);
  const m = Number(parts.find((p) => p.type === "minute")!.value);
  return h * 60 + m;
}

/** Minutes to wait until quiet hours end (0 if not in quiet hours). Handles ranges crossing midnight. */
export function quietDelayMinutes(nowMin: number, from: string, to: string): number {
  const f = toMin(from), t = toMin(to);
  if (f === t) return 0;
  const inQuiet = f < t ? nowMin >= f && nowMin < t : nowMin >= f || nowMin < t;
  if (!inQuiet) return 0;
  return (t - nowMin + 1440) % 1440;
}

export interface NotifyInput {
  gymId: string;
  memberId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  /** path inside the site, e.g. /r/<token>; default: the member app, optionally on a tab */
  url?: string;
  tab?: "home" | "classes" | "coach" | "shop" | "me" | "progress" | "inbox";
  dedupeKey?: string;
  createdBy?: string | null;
  /** ignore quiet hours (tests sent by staff) */
  immediate?: boolean;
}

/** Stores a notification and schedules its delivery. Returns the row, or null when settings say not to send. */
export async function notify(q: Queryable, n: NotifyInput) {
  const ctx = await one(
    q,
    `SELECT g.slug, g.timezone, g.modules, g.settings, g.saas_status, m.notify_prefs, m.archived_at
       FROM gyms g JOIN members m ON m.gym_id = g.id WHERE g.id = $1 AND m.id = $2`,
    [n.gymId, n.memberId],
  );
  if (!ctx || ctx.archived_at || ctx.saas_status === "suspended") return null;
  if (ctx.modules?.memberApp === false) return null;
  const ps = pushSettings(ctx.settings);
  const type = NOTIFICATION_TYPES[n.kind];
  if (!ps.enabled || ps.types[n.kind] === false) return null;
  if (ctx.notify_prefs?.[type.category] === false) return null;
  const delay = type.scheduled && !n.immediate ? quietDelayMinutes(localMinutes(ctx.timezone), ps.quietFrom, ps.quietTo) : 0;
  const url = n.url ?? `/m/${ctx.slug}${n.tab && n.tab !== "home" ? `?tab=${n.tab}` : ""}`;
  const row = await one(
    q,
    `INSERT INTO notifications (gym_id, member_id, kind, title, body, url, dedupe_key, send_after, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now() + ($8 || ' minutes')::interval, $9)
     ON CONFLICT (gym_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
     RETURNING *`,
    [n.gymId, n.memberId, n.kind, n.title.slice(0, 120), n.body.slice(0, 500), url, n.dedupeKey ?? null, String(delay), n.createdBy ?? null],
  );
  if (row && delay === 0) kick();
  return row;
}

// ---------- delivery ----------

let timer: NodeJS.Timeout | null = null;
let running = false;

/** Process the queue soon (after the current transaction has committed). */
export function kick() {
  if (process.env.PUSH_DISABLED === "true") return;
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    processQueue().catch((e) => console.error("[push]", e.message));
  }, 150);
  timer.unref?.();
}

/** Sends due notifications. Safe with several app servers: rows are leased with SKIP LOCKED. */
export async function processQueue(limit = 200): Promise<{ sent: number; noDevice: number; failed: number }> {
  const out = { sent: 0, noDevice: 0, failed: 0 };
  if (running) return out;
  running = true;
  try {
    const rows = await many(
      db,
      `UPDATE notifications SET send_after = now() + interval '5 minutes'
        WHERE id IN (SELECT id FROM notifications WHERE status = 'queued' AND send_after <= now() ORDER BY send_after LIMIT $1 FOR UPDATE SKIP LOCKED)
        RETURNING id, gym_id, member_id, kind, title, body, url,
                  (SELECT slug FROM gyms WHERE id = notifications.gym_id) AS slug,
                  (SELECT logo IS NOT NULL FROM gyms WHERE id = notifications.gym_id) AS has_logo`,
      [limit],
    );
    for (const n of rows) {
      const subs = await many(db, "SELECT id, endpoint, p256dh, auth, failures FROM push_subscriptions WHERE member_id = $1", [n.member_id]);
      if (!subs.length) {
        await db.query("UPDATE notifications SET status = 'no_device', sent_at = now(), send_after = now() WHERE id = $1", [n.id]);
        out.noDevice++;
        continue;
      }
      const message = {
        title: n.title, body: n.body, url: n.url, tag: `${n.kind}-${n.id}`, id: n.id,
        icon: n.has_logo ? `/api/public/gyms/${n.slug}/logo` : "/icon-192.png", badge: "/icon-192.png",
      };
      let ok = 0;
      for (const s of subs) {
        const r = await sendPush(s, message, { urgency: n.kind === "receipt" || n.kind === "announcement" ? "normal" : "high", topic: n.kind });
        if (r.ok) {
          ok++;
          await db.query("UPDATE push_subscriptions SET failures = 0, last_ok_at = now() WHERE id = $1", [s.id]);
        } else if (r.gone || s.failures >= 4) {
          await db.query("DELETE FROM push_subscriptions WHERE id = $1", [s.id]);
        } else {
          await db.query("UPDATE push_subscriptions SET failures = failures + 1 WHERE id = $1", [s.id]);
        }
      }
      const remaining = await one(db, "SELECT count(*)::int AS n FROM push_subscriptions WHERE member_id = $1", [n.member_id]);
      const status = ok > 0 ? "sent" : remaining.n === 0 ? "no_device" : "failed";
      await db.query("UPDATE notifications SET status = $2, devices = $3, sent_at = now(), send_after = now() WHERE id = $1", [n.id, status, ok]);
      if (status === "sent") out.sent++;
      else if (status === "no_device") out.noDevice++;
      else out.failed++;
    }
  } finally {
    running = false;
  }
  return out;
}

// ---------- scheduled reminders ----------

/** Class and PT reminders for every gym. Idempotent (one per booking/session). */
export async function scheduleReminders() {
  const gyms = await many(db, `SELECT id, settings FROM gyms WHERE saas_status <> 'suspended' AND archived_at IS NULL AND coalesce((modules->>'memberApp')::boolean, true)`);
  let created = 0;
  for (const g of gyms) {
    const ps = pushSettings(g.settings);
    if (!ps.enabled) continue;
    if (ps.types.class_reminder !== false) {
      const due = await many(db, `
        SELECT b.id, b.member_id, ct.name, s.starts_at, to_char(s.starts_at AT TIME ZONE gy.timezone, 'HH24:MI') AS hhmm, us.name AS coach
          FROM bookings b JOIN class_sessions s ON s.id = b.session_id JOIN class_types ct ON ct.id = s.class_type_id
          JOIN gyms gy ON gy.id = s.gym_id LEFT JOIN users us ON us.id = s.coach_id
         WHERE b.gym_id = $1 AND b.status = 'booked' AND NOT s.cancelled
           AND s.starts_at > now() + interval '10 minutes' AND s.starts_at <= now() + ($2 || ' hours')::interval
           AND b.created_at < s.starts_at - interval '45 minutes'`, [g.id, String(ps.classReminderHours)]);
      for (const b of due) {
        const r = await notify(db, {
          gymId: g.id, memberId: b.member_id, kind: "class_reminder", tab: "classes", dedupeKey: `class:${b.id}`,
          title: `${b.name} at ${b.hhmm} 💪`, body: `Your class starts at ${b.hhmm}${b.coach ? ` with ${b.coach}` : ""}. Can't make it? Cancel in the app so someone else can come.`,
        });
        if (r) created++;
      }
    }
    if (ps.types.pt_reminder !== false) {
      const due = await many(db, `
        SELECT ps.id, ps.member_id, to_char(ps.starts_at AT TIME ZONE gy.timezone, 'HH24:MI') AS hhmm, us.name AS coach
          FROM pt_sessions ps JOIN gyms gy ON gy.id = ps.gym_id LEFT JOIN users us ON us.id = ps.coach_id
         WHERE ps.gym_id = $1 AND ps.status = 'scheduled'
           AND ps.starts_at > now() + interval '10 minutes' AND ps.starts_at <= now() + ($2 || ' hours')::interval`, [g.id, String(ps.ptReminderHours)]);
      for (const s of due) {
        const r = await notify(db, {
          gymId: g.id, memberId: s.member_id, kind: "pt_reminder", dedupeKey: `pt:${s.id}`,
          title: `Training at ${s.hhmm}`, body: `Your personal training session${s.coach ? ` with ${s.coach}` : ""} is at ${s.hhmm} today.`,
        });
        if (r) created++;
      }
    }
  }
  return created;
}

/** Membership ending / expired notifications (7, 1, 0 days before; 3 days after). */
export async function scheduleExpiryNotices() {
  const rows = await many(db, `
    SELECT mo.id, mo.gym_id, mo.first_name, mo.plan_name, mo.end_date::text AS end_date, mo.days_left, mo.membership_id
      FROM member_overview mo JOIN gyms g ON g.id = mo.gym_id
     WHERE mo.archived_at IS NULL AND g.saas_status <> 'suspended' AND mo.days_left IN (7, 1, 0, -3)
       AND mo.status IN ('active','expiring','expired')
       AND NOT EXISTS (SELECT 1 FROM memberships n WHERE n.member_id = mo.id AND n.status = 'active' AND n.start_date > mo.end_date)
       AND EXISTS (SELECT 1 FROM push_subscriptions ps WHERE ps.member_id = mo.id)`);
  let created = 0;
  for (const m of rows) {
    const after = m.days_left < 0;
    const r = await notify(db, after
      ? { gymId: m.gym_id, memberId: m.id, kind: "winback", dedupeKey: `push-exp:${m.membership_id}:after`,
          title: "We miss you 💪", body: `Your ${m.plan_name} membership ended on ${m.end_date}. Renew at reception and get back on track.` }
      : { gymId: m.gym_id, memberId: m.id, kind: "expiry", dedupeKey: `push-exp:${m.membership_id}:${m.days_left}`,
          title: m.days_left === 0 ? "Your membership ends today" : `Your membership ends in ${m.days_left} day${m.days_left > 1 ? "s" : ""}`,
          body: `${m.plan_name} — last day ${m.end_date}. Renew at reception so you don't miss a session.` });
    if (r) created++;
  }
  return created;
}
