import { one, type Queryable } from "../db/index.ts";

export type Currency = "USD" | "LBP";

export function toUsd(amount: number, currency: Currency, lbpRate: number): number {
  const usd = currency === "USD" ? amount : amount / lbpRate;
  return Math.round(usd * 100) / 100;
}

export async function gymRate(q: Queryable, gymId: string): Promise<number> {
  const g = await one<{ lbp_rate: number }>(q, "SELECT lbp_rate FROM gyms WHERE id = $1", [gymId]);
  return g?.lbp_rate ?? 89500;
}

/** Today's date (YYYY-MM-DD) in the gym's timezone. */
export async function gymToday(q: Queryable, gymId: string): Promise<string> {
  const r = await one<{ d: string }>(q, "SELECT (now() AT TIME ZONE timezone)::date::text AS d FROM gyms WHERE id = $1", [gymId]);
  return r!.d;
}

export function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}
