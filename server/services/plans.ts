/**
 * GMS subscription plans (what a gym pays GMS) and what each one unlocks.
 *   Starter $29  — members, plans, payments USD/LBP, QR check-in, click-to-send WhatsApp, leads, expenses, reports
 *   Pro     $59  — + group classes & bookings, personal training, branded member app, churn prediction & insights
 *   Elite   $99  — + automatic WhatsApp (Business Platform), AI assistant in Arabic/Arabizi (LLM), priority support
 */
import { one, type Queryable } from "../db/index.ts";

export type SaasPlan = "starter" | "pro" | "elite";

export const PLAN_PRICES: Record<SaasPlan, number> = { starter: 29, pro: 59, elite: 99 };

const PRO_MODULES = ["classes", "pt", "memberApp", "ai"];

export function moduleAllowed(plan: SaasPlan, module: string): boolean {
  if (plan === "starter") return !PRO_MODULES.includes(module);
  return true;
}

/** Turns off modules the plan does not include. */
export function clampModules(plan: SaasPlan, modules: Record<string, boolean>): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(modules)) out[k] = v && moduleAllowed(plan, k);
  return out;
}

export async function gymPlan(q: Queryable, gymId: string): Promise<SaasPlan> {
  const g = await one<{ saas_plan: SaasPlan }>(q, "SELECT saas_plan FROM gyms WHERE id = $1", [gymId]);
  return g?.saas_plan ?? "starter";
}

/** Generative AI (LLM) and automatic WhatsApp are Elite features; other plans use the offline AI and click-to-send. */
export async function hasElite(q: Queryable, gymId: string): Promise<boolean> {
  return (await gymPlan(q, gymId)) === "elite";
}
