/**
 * What each staff role may see, as chosen by the gym (Settings → Staff access).
 * Defaults are the safe ones: coaches see their own members, reception sees today's till.
 */
import { one, type Queryable } from "../db/index.ts";
import { forbidden } from "../http.ts";
import { gymToday, addDays } from "./money.ts";

export interface StaffAccess {
  /** "own": a coach finds only their PT clients and people booked in their classes; "all": every member. */
  coachMembers: "own" | "all";
  /** coaches can check members in at the desk (gyms that open without reception) */
  coachCheckin: boolean;
  /** reception can list payments and sales of any period; otherwise today and yesterday */
  receptionPaymentHistory: boolean;
  /** biggest discount reception can give without a manager, in % of the price */
  receptionMaxDiscountPct: number;
}

export const DEFAULT_ACCESS: StaffAccess = { coachMembers: "own", coachCheckin: false, receptionPaymentHistory: false, receptionMaxDiscountPct: 20 };

export const staffAccess = (settings: any): StaffAccess => ({ ...DEFAULT_ACCESS, ...(settings?.staff ?? {}) });

export async function gymAccess(q: Queryable, gymId: string): Promise<StaffAccess> {
  const g = await one(q, "SELECT settings FROM gyms WHERE id = $1", [gymId]);
  return staffAccess(g?.settings);
}

/**
 * SQL condition: the member (column `col`) is one of the coach's members — a PT package with them,
 * or booked in one of their classes in the last 60 days or coming up. `$n` = the coach's id.
 */
export function coachMemberSql(col: string, n: number) {
  return `(EXISTS (SELECT 1 FROM pt_packages cp WHERE cp.member_id = ${col} AND cp.coach_id = $${n})
        OR EXISTS (SELECT 1 FROM bookings cb JOIN class_sessions cs ON cs.id = cb.session_id
                    WHERE cb.member_id = ${col} AND cs.coach_id = $${n} AND cb.status <> 'cancelled' AND cs.starts_at > now() - interval '60 days'))`;
}

/** Throws 403 unless this coach may open this member (always true for other roles). */
export async function assertCanSeeMember(q: Queryable, u: { role: string; id: string; gymId: string }, memberId: string) {
  if (u.role !== "coach") return;
  const access = await gymAccess(q, u.gymId);
  if (access.coachMembers === "all") return;
  const ok = await one(q, `SELECT 1 FROM members m WHERE m.id = $1 AND m.gym_id = $2 AND ${coachMemberSql("m.id", 3)}`, [memberId, u.gymId, u.id]);
  if (!ok) throw forbidden("This member isn't one of your clients");
}

/** Reception without payment history: the period is cut to today and yesterday. */
export async function clampForReception(q: Queryable, u: { role: string; gymId: string }, from: string, to: string) {
  if (u.role !== "reception") return { from, to };
  if ((await gymAccess(q, u.gymId)).receptionPaymentHistory) return { from, to };
  const today = await gymToday(q, u.gymId);
  const min = addDays(today, -1);
  return { from: from < min ? min : from, to: to > today ? today : to < min ? min : to };
}

/** Reception can't give more than the gym's limit; managers and owners can. */
export async function assertDiscountAllowed(q: Queryable, u: { role: string; gymId: string } | null, discount: number, price: number) {
  if (!u || u.role !== "reception" || discount <= 0) return;
  const max = (await gymAccess(q, u.gymId)).receptionMaxDiscountPct;
  if (price > 0 && discount > (price * max) / 100 + 0.005) {
    throw forbidden(`Reception can give up to ${max}% off. Ask a manager for a bigger discount.`);
  }
}
