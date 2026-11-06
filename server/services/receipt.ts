/**
 * Receipts: one HTML document used for the in-app preview (and printing on A5 or
 * 80 mm thermal printers) and for the public link the member receives (/r/<token>).
 */
import { db, many, one } from "../db/index.ts";
import { config } from "../config.ts";
import { escapeHtml as e } from "./text.ts";
import { waLink } from "./whatsapp.ts";

const fmt = (n: number, c: string) => (c === "LBP" ? `${Math.round(Number(n)).toLocaleString("en-US")} LBP` : `$${Number(n).toFixed(2)}`);

async function load(where: string, value: string, gymId?: string) {
  const p = await one(
    db,
    `SELECT p.*, m.first_name, m.last_name, m.code, m.phone AS member_phone, ms.plan_name, ms.start_date::text AS start_date, ms.end_date::text AS end_date,
            pk.title AS pt_title, pk.sessions_total, us.name AS staff, s.sale_no,
            g.name AS gym_name, g.name_ar AS gym_name_ar, g.address, g.phone AS gym_phone, g.brand_color, g.settings, g.slug, (g.logo IS NOT NULL) AS has_logo,
            to_char(p.paid_at AT TIME ZONE g.timezone, 'DD Mon YYYY, HH24:MI') AS local_time
       FROM payments p JOIN gyms g ON g.id = p.gym_id
       LEFT JOIN members m ON m.id = p.member_id
       LEFT JOIN memberships ms ON ms.id = p.membership_id
       LEFT JOIN pt_packages pk ON pk.id = p.pt_package_id
       LEFT JOIN sales s ON s.id = p.sale_id
       LEFT JOIN users us ON us.id = p.received_by
      WHERE ${where} = $1 ${gymId ? "AND p.gym_id = $2" : ""}`,
    gymId ? [value, gymId] : [value],
  );
  if (!p) return null;
  const items = p.sale_id ? await many(db, "SELECT name, qty, unit_price, currency, line_total_usd FROM sale_items WHERE sale_id = $1 ORDER BY name", [p.sale_id]) : [];
  return { ...p, items };
}

function render(p: any): string {
  const color = /^#[0-9a-fA-F]{6}$/.test(p.brand_color ?? "") ? p.brand_color : "#1a2230";
  const who = p.first_name ? `#${p.code} ${p.first_name} ${p.last_name ?? ""}` : "Walk-in customer";
  const lines: string[] = [];
  if (p.plan_name) lines.push(`<tr><td>Membership<br><small>${e(p.plan_name)} · ${p.start_date} → ${p.end_date}</small></td><td></td></tr>`);
  if (p.pt_title) lines.push(`<tr><td>Personal training<br><small>${e(p.pt_title)}</small></td><td></td></tr>`);
  for (const it of p.items ?? []) {
    lines.push(`<tr><td>${it.qty} × ${e(it.name)}<br><small>${fmt(it.unit_price, it.currency)} each</small></td><td>${fmt(it.line_total_usd, "USD")}</td></tr>`);
  }
  if (!lines.length) lines.push(`<tr><td>${e(p.note ?? "Payment")}</td><td></td></tr>`);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Receipt #${p.receipt_no} · ${e(p.gym_name)}</title>
<style>
  * { box-sizing: border-box; }
  body { font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1a2230; margin: 0; background: #f4f5f2; }
  .r { max-width: 380px; margin: 16px auto; background: #fff; border-radius: 10px; overflow: hidden; border: 1px solid #dde1e6; }
  .h { background: ${color}; color: #fff; padding: 16px 18px; }
  .h b { font-size: 18px; display: block; }
  .h small { color: #fff; opacity: .9; }
  .c { padding: 14px 18px 18px; }
  .meta { display: flex; justify-content: space-between; color: #4b5566; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  td { padding: 7px 0; border-bottom: 1px dashed #dde1e6; vertical-align: top; }
  td:last-child { text-align: right; white-space: nowrap; }
  td small { color: #7a8494; }
  .total { display: flex; justify-content: space-between; align-items: baseline; font-size: 15px; margin-top: 4px; }
  .total b { font-size: 24px; }
  .void { color: #b00; font-weight: 700; border: 2px solid #b00; padding: 6px; text-align: center; margin: 10px 0; border-radius: 6px; }
  .foot { color: #7a8494; font-size: 12px; margin-top: 14px; text-align: center; }
  @media print { body { background: #fff; } .r { margin: 0; border: 0; border-radius: 0; max-width: none; } .h { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  @page { margin: 6mm; }
</style></head><body><div class="r">
<div class="h"><b>${e(p.gym_name)}</b><small>${e([p.address, p.gym_phone].filter(Boolean).join(" · "))}</small></div>
<div class="c">
<div class="meta"><span><b>Receipt #${p.receipt_no}</b>${p.sale_no ? ` · Sale #${p.sale_no}` : ""}</span><span>${e(p.local_time)}</span></div>
<div class="meta" style="margin-top:4px"><span>${e(who)}</span></div>
${p.voided_at ? `<div class="void">VOIDED · ${e(p.void_reason ?? "")}</div>` : ""}
<table>${lines.join("")}
<tr><td>Paid by</td><td>${e(String(p.method).toUpperCase())}${p.reference ? ` · ${e(p.reference)}` : ""}</td></tr>
${p.currency === "LBP" ? `<tr><td>Exchange rate</td><td>${Number(p.lbp_rate).toLocaleString("en-US")} LBP/$</td></tr>` : ""}
${p.staff ? `<tr><td>Received by</td><td>${e(p.staff)}</td></tr>` : ""}
</table>
<div class="total"><span>Total paid</span><b>${fmt(p.amount, p.currency)}</b></div>
${p.currency === "LBP" ? `<div class="total"><small>Equivalent</small><small>${fmt(p.amount_usd, "USD")}</small></div>` : ""}
<p class="foot">${e(p.settings?.receiptFooter ?? "Thank you for training with us!")}</p>
</div></div></body></html>`;
}

export function receiptUrl(token: string) {
  return `${config.publicUrl}/r/${token}`;
}

/** For staff: HTML + shareable link + ready WhatsApp message. */
export async function receiptForStaff(paymentId: string, gymId: string) {
  const p = await load("p.id", paymentId, gymId);
  if (!p) return null;
  const url = receiptUrl(p.public_token);
  const text = `${p.gym_name} — receipt #${p.receipt_no}\n${fmt(p.amount, p.currency)} paid by ${String(p.method).toUpperCase()} on ${p.local_time}.\n${url}`;
  return {
    id: p.id, receipt_no: p.receipt_no, html: render(p), url, text,
    whatsappLink: p.member_phone ? waLink(p.member_phone, text) : null,
    memberName: p.first_name ? `${p.first_name} ${p.last_name ?? ""}`.trim() : null,
  };
}

/** For anyone holding the link (the member). */
export async function receiptByToken(token: string): Promise<string | null> {
  if (!/^[0-9a-f]{32}$/.test(token)) return null;
  const p = await load("p.public_token", token);
  return p ? render(p) : null;
}
