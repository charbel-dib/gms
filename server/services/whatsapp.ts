/**
 * WhatsApp delivery.
 *
 * Two modes, chosen per gym:
 *  1. Cloud API (Meta) — fully automatic. Needs the gym's WhatsApp Business number
 *     (phone_number_id) and an access token. Business-initiated messages use
 *     approved templates; replies inside the 24h window use free text.
 *  2. Click-to-send (default, zero setup) — messages land in the Outbox with a
 *     wa.me link; reception sends them in one tap from the gym's own WhatsApp.
 *     This is how most Lebanese gyms work today, so GMS is useful from day one.
 */
import crypto from "node:crypto";
import { config } from "../config.ts";
import { decryptSecret } from "../auth.ts";
import { one, type Queryable } from "../db/index.ts";

export function waLink(phone: string, text: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}

interface WaCreds {
  phoneNumberId: string;
  token: string;
}

export function gymWaCreds(settings: any): WaCreds | null {
  const wa = settings?.whatsapp ?? {};
  const phoneNumberId = wa.phoneNumberId || null;
  if (!phoneNumberId) return null;
  let token = "";
  if (wa.tokenEnc) {
    try {
      token = decryptSecret(wa.tokenEnc);
    } catch {
      token = "";
    }
  }
  token ||= config.whatsapp.token;
  return token ? { phoneNumberId, token } : null;
}

async function graphSend(creds: WaCreds, payload: Record<string, unknown>): Promise<string> {
  const res = await fetch(`https://graph.facebook.com/${config.whatsapp.apiVersion}/${creds.phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${creds.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
    signal: AbortSignal.timeout(15_000),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message ?? `WhatsApp API HTTP ${res.status}`);
  return data?.messages?.[0]?.id ?? "";
}

export interface OutMessage {
  gymId: string;
  memberId: string | null;
  phone: string;
  kind: string; // reminder_expiry, winback, welcome, manual, bot, app_access
  body: string;
  dedupeKey?: string;
  /** Template used when the Cloud API needs a business-initiated message. */
  template?: { name: string; lang: "en" | "ar"; params: string[] };
  /** true when replying inside the 24h customer service window. */
  isReply?: boolean;
}

/** Sends (or queues for click-to-send) a WhatsApp message and logs it. Returns the stored row, or null if deduplicated. */
export async function sendWhatsApp(q: Queryable, msg: OutMessage) {
  const gym = await one(q, "SELECT settings, saas_plan FROM gyms WHERE id = $1", [msg.gymId]);
  const creds = gym?.saas_plan === "elite" ? gymWaCreds(gym?.settings) : null;
  const row = await one(
    q,
    `INSERT INTO messages (gym_id, member_id, phone, direction, kind, body, status, dedupe_key)
     VALUES ($1,$2,$3,'out',$4,$5,$6,$7)
     ON CONFLICT (gym_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
     RETURNING *`,
    [msg.gymId, msg.memberId, msg.phone, msg.kind, msg.body, creds ? "queued" : "manual", msg.dedupeKey ?? null],
  );
  if (!row) return null;
  if (!creds) return { ...row, link: waLink(msg.phone, msg.body) };
  try {
    const to = msg.phone.replace(/\D/g, "");
    const providerId = msg.isReply || !msg.template
      ? await graphSend(creds, { to, type: "text", text: { body: msg.body, preview_url: true } })
      : await graphSend(creds, {
          to,
          type: "template",
          template: {
            name: msg.template.name,
            language: { code: msg.template.lang },
            components: [{ type: "body", parameters: msg.template.params.map((text) => ({ type: "text", text })) }],
          },
        });
    await q.query("UPDATE messages SET status = 'sent', provider_id = $2, sent_at = now() WHERE id = $1", [row.id, providerId]);
    return { ...row, status: "sent", provider_id: providerId };
  } catch (e: any) {
    await q.query("UPDATE messages SET status = 'failed', error = $2 WHERE id = $1", [row.id, String(e.message).slice(0, 500)]);
    return { ...row, status: "failed", error: e.message, link: waLink(msg.phone, msg.body) };
  }
}

/** Verifies Meta's X-Hub-Signature-256 header on webhook calls. */
export function verifyMetaSignature(raw: Buffer, header: string | undefined): boolean {
  if (!config.whatsapp.appSecret) return !config.isProd; // enforce in production
  if (!header?.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", config.whatsapp.appSecret).update(raw).digest("hex");
  const got = header.slice(7);
  return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

const REMINDER_DEFAULTS = {
  en: {
    before: "Hi {name} 👋 your {plan} membership at {gym} ends on {date} ({days} days left). Renew at reception or reply here to keep your streak going 💪",
    today: "Hi {name}, your {plan} membership at {gym} ends today. Renew now so you don't miss a day 💪",
    after: "Hi {name}, we miss you at {gym}! Your membership ended on {date}. Come back this week and we'll take care of you 🙌",
  },
  ar: {
    before: "مرحبا {name} 👋 اشتراكك ({plan}) في {gym} بينتهي بتاريخ {date} (باقي {days} أيام). جدّد عالاستقبال أو جاوبنا هون 💪",
    today: "مرحبا {name}، اشتراكك ({plan}) في {gym} بينتهي اليوم. جدّد هلّق تا ما تخسر ولا يوم 💪",
    after: "مرحبا {name}، اشتقنالك بـ {gym}! اشتراكك خلص بتاريخ {date}. رجاع هالجمعة ومنهتم فيك 🙌",
  },
};

export function reminderText(
  lang: "en" | "ar",
  kind: "before" | "today" | "after",
  vars: { name: string; plan: string; gym: string; date: string; days: number },
  custom?: string,
): string {
  const tpl = custom && kind === "before" ? custom : REMINDER_DEFAULTS[lang][kind];
  return tpl.replace(/\{(\w+)\}/g, (_, k) => String((vars as any)[k] ?? ""));
}
