/** Reusable forms: selling a membership and recording a payment. */
import React, { useEffect, useMemo, useState } from "react";
import { get } from "../../shared/api.ts";
import { Field, Segmented } from "../../shared/ui.tsx";
import { money, t } from "../../shared/i18n.ts";
import { useApp } from "../app.tsx";

export interface PaymentValue { amount: string; currency: "USD" | "LBP"; method: string; reference: string }

export function PaymentFields({ value, onChange, suggestUsd }: { value: PaymentValue; onChange: (v: PaymentValue) => void; suggestUsd?: number }) {
  const { me } = useApp();
  const rate = Number(me.gym?.lbp_rate ?? 89500);
  const set = (p: Partial<PaymentValue>) => onChange({ ...value, ...p });
  const usd = value.currency === "USD" ? Number(value.amount || 0) : Number(value.amount || 0) / rate;
  return (
    <div className="stack-s">
      <div className="grid-3">
        <Field label={t("Amount")}>
          <input className="input" inputMode="decimal" value={value.amount} onChange={(e) => set({ amount: e.target.value.replace(/[^\d.]/g, "") })} placeholder="0" />
        </Field>
        <Field label={t("Currency")}>
          <Segmented label={t("Currency")} value={value.currency} onChange={(c) => {
            const n = Number(value.amount || 0);
            set({ currency: c, amount: n ? String(c === "LBP" ? Math.round(n * rate) : Math.round((n / rate) * 100) / 100) : value.amount });
          }} options={[{ value: "USD", label: "USD $" }, { value: "LBP", label: "LBP" }]} />
        </Field>
        <Field label={t("Method")}>
          <select className="input" value={value.method} onChange={(e) => set({ method: e.target.value })}>
            {["cash", "whish", "omt", "card", "bank", "other"].map((m) => <option key={m} value={m}>{t(m)}</option>)}
          </select>
        </Field>
      </div>
      {value.method !== "cash" && (
        <Field label="Reference" hint="Whish / OMT transaction number, last digits of the card…">
          <input className="input" value={value.reference} onChange={(e) => set({ reference: e.target.value })} />
        </Field>
      )}
      <p className="muted" style={{ fontSize: "0.85rem" }}>
        {value.currency === "LBP" ? `≈ ${money(usd)} at ${rate.toLocaleString("en-US")} LBP/USD. ` : ""}
        {suggestUsd !== undefined && Math.abs(usd - suggestUsd) > 0.01 && (usd < suggestUsd ? `${money(suggestUsd - usd)} will remain as a balance.` : "")}
      </p>
    </div>
  );
}

export function emptyPayment(): PaymentValue {
  return { amount: "", currency: "USD", method: "cash", reference: "" };
}

export function toPaymentBody(p: PaymentValue) {
  const amount = Number(p.amount || 0);
  return amount > 0 ? { amount, currency: p.currency, method: p.method, reference: p.reference || null } : null;
}

export interface SaleValue { plan_id: string; start_date: string; discount: string; payment: PaymentValue }

export function SaleFields({ value, onChange, gender }: { value: SaleValue; onChange: (v: SaleValue) => void; gender?: string | null }) {
  const { me } = useApp();
  const [plans, setPlans] = useState<any[]>([]);
  useEffect(() => { get("/api/plans").then((p) => setPlans(p.filter((x: any) => x.active))); }, []);
  const plan = plans.find((p) => p.id === value.plan_id);
  const rate = Number(me.gym?.lbp_rate ?? 89500);
  const due = useMemo(() => {
    if (!plan) return 0;
    const net = Number(plan.price) - Number(value.discount || 0);
    return plan.currency === "LBP" ? net / rate : net;
  }, [plan, value.discount, rate]);
  useEffect(() => {
    if (plan && !value.payment.amount) {
      onChange({ ...value, payment: { ...value.payment, currency: plan.currency, amount: String(Number(plan.price) - Number(value.discount || 0)) } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan?.id]);
  const available = plans.filter((p) => !p.gender_restriction || !gender || p.gender_restriction === gender);
  return (
    <div className="stack">
      <Field label={t("Plan")}>
        <select className="input" value={value.plan_id} onChange={(e) => onChange({ ...value, plan_id: e.target.value, payment: { ...value.payment, amount: "" } })} required>
          <option value="">Choose a plan…</option>
          {available.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {money(p.price, p.currency)} · {p.kind === "visits" ? `${p.visits} visits / ${p.duration_days} days` : `${p.duration_days} days`}
            </option>
          ))}
        </select>
      </Field>
      {plan && (
        <div className="grid-2">
          <Field label="Start date" hint="Leave empty: today, or the day after the current membership ends.">
            <input className="input" type="date" value={value.start_date} onChange={(e) => onChange({ ...value, start_date: e.target.value })} />
          </Field>
          <Field label={`Discount (${plan.currency})`}>
            <input className="input" inputMode="decimal" value={value.discount} onChange={(e) => onChange({ ...value, discount: e.target.value.replace(/[^\d.]/g, ""), payment: { ...value.payment, amount: "" } })} placeholder="0" />
          </Field>
        </div>
      )}
      {plan && (
        <div className="stack-s">
          <div className="spread"><b>Payment now</b><span className="muted">Total due {money(due)}</span></div>
          <PaymentFields value={value.payment} onChange={(payment) => onChange({ ...value, payment })} suggestUsd={due} />
        </div>
      )}
    </div>
  );
}

export function emptySale(): SaleValue {
  return { plan_id: "", start_date: "", discount: "", payment: emptyPayment() };
}

export function toSaleBody(s: SaleValue) {
  return { plan_id: s.plan_id, start_date: s.start_date || null, discount: Number(s.discount || 0), payment: toPaymentBody(s.payment) };
}
