/** Messaging (WhatsApp), AI features and the WhatsApp webhook. */
import { z } from "zod";
import { db, one, many, audit } from "../db/index.ts";
import { requireStaff } from "../auth.ts";
import { bad, HttpError, notFound, normalizePhone, zId, type Router } from "../http.ts";
import { sendWhatsApp, verifyMetaSignature, waLink } from "../services/whatsapp.ts";
import { runReminders } from "../jobs.ts";
import { askGym } from "../ai/assistant.ts";
import { botReply } from "../ai/bot.ts";
import { scoreGym, trainForGym } from "../ai/churn.ts";
import { retrieve } from "../ai/rag.ts";
import { llmEnabled, runWithTools } from "../ai/llm.ts";
import { config } from "../config.ts";
import { hasElite } from "../services/plans.ts";

const SEGMENTS = {
  active: "status IN ('active','expiring')",
  expiring: "status = 'expiring'",
  expired_30: "status = 'expired' AND days_left >= -30",
  expired_90: "status = 'expired' AND days_left >= -90",
  at_risk: "churn_score >= 0.6 AND status IN ('active','expiring')",
  unpaid: "balance_usd > 0.009",
  women: "gender = 'female' AND status IN ('active','expiring')",
  all: "true",
} as const satisfies Record<string, string>;
type Segment = keyof typeof SEGMENTS;

export function registerEngage(r: Router) {
  // ---------- messages ----------
  r.get("/api/messages", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager", "reception"]);
    const where = ["ms.gym_id = $1"];
    const st = ctx.query.get("status");
    if (st === "outbox") where.push("ms.status = 'manual'");
    else if (st === "inbox") where.push("ms.direction = 'in'");
    else if (st === "failed") where.push("ms.status = 'failed'");
    const rows = await many(db, `SELECT ms.*, m.first_name, m.last_name, m.code FROM messages ms LEFT JOIN members m ON m.id = ms.member_id
                                  WHERE ${where.join(" AND ")} ORDER BY ms.created_at DESC LIMIT 300`, [u.gymId]);
    const counts = await one(db, `SELECT count(*) FILTER (WHERE status = 'manual')::int AS outbox, count(*) FILTER (WHERE direction = 'in' AND created_at > now() - interval '7 days')::int AS inbox,
                                         count(*) FILTER (WHERE status = 'failed')::int AS failed FROM messages WHERE gym_id = $1`, [u.gymId]);
    return { rows: rows.map((m) => (m.status === "manual" || m.status === "failed") && m.phone ? { ...m, link: waLink(m.phone, m.body) } : m), counts };
  });

  r.post("/api/messages/send", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager", "reception"]);
    const b = await ctx.body(z.object({ member_id: zId, body: z.string().trim().min(1).max(2000), kind: z.string().max(30).default("manual") }));
    const m = await one(db, "SELECT id, phone FROM members WHERE id = $1 AND gym_id = $2", [b.member_id, u.gymId]);
    if (!m) throw notFound("member");
    if (!m.phone) throw bad("phone_required", "This member has no phone number");
    const row = await sendWhatsApp(db, { gymId: u.gymId, memberId: m.id, phone: m.phone, kind: b.kind, body: b.body, isReply: true });
    await audit(db, u.gymId, u.id, "message.send", "member", m.id);
    return row;
  });

  r.post("/api/messages/broadcast", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const b = await ctx.body(z.object({ segment: z.enum(Object.keys(SEGMENTS) as [Segment, ...Segment[]]), body: z.string().trim().min(1).max(1000), preview: z.boolean().default(false) }));
    const people = await many(db, `SELECT id, first_name, phone FROM member_overview WHERE gym_id = $1 AND archived_at IS NULL AND phone IS NOT NULL AND whatsapp_opt_in AND ${SEGMENTS[b.segment]} LIMIT 1000`, [u.gymId]);
    if (b.preview) return { count: people.length, sample: people.slice(0, 5).map((p) => ({ name: p.first_name, text: b.body.replace(/\{name\}/g, p.first_name) })) };
    const stamp = Date.now();
    let sent = 0, queued = 0;
    for (const p of people) {
      const row = await sendWhatsApp(db, { gymId: u.gymId, memberId: p.id, phone: p.phone, kind: "broadcast", body: b.body.replace(/\{name\}/g, p.first_name), dedupeKey: `bc:${stamp}:${p.id}` });
      if (row?.status === "sent") sent++; else queued++;
    }
    await audit(db, u.gymId, u.id, "message.broadcast", undefined, undefined, { segment: b.segment, count: people.length });
    return { count: people.length, sent, queued };
  });

  r.post("/api/messages/:id/done", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager", "reception"]);
    const row = await one(db, "UPDATE messages SET status = 'sent', sent_at = now() WHERE id = $1 AND gym_id = $2 AND status IN ('manual','failed') RETURNING id", [zId.parse(ctx.params.id), u.gymId]);
    if (!row) throw notFound("message");
    return { ok: true };
  });

  r.post("/api/messages/reminders/run", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    return runReminders(u.gymId);
  });

  // ---------- AI ----------
  r.get("/api/ai/status", async (ctx) => {
    const u = await requireStaff(ctx);
    const m = await one(db, "SELECT kind, metrics, trained_at FROM ai_models WHERE gym_id = $1", [u.gymId]);
    return { llm: llmEnabled() && (await hasElite(db, u.gymId)), model: config.anthropicModel, churnModel: m };
  });

  r.post("/api/ai/ask", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const b = await ctx.body(z.object({ question: z.string().trim().min(2).max(1000), history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) })).max(10).default([]) }));
    try {
      return await askGym(u.gymId, b.question, b.history);
    } catch (e: any) {
      throw new HttpError(502, "ai_unavailable", `The AI service did not answer: ${e.message}`);
    }
  });

  r.get("/api/ai/churn", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager", "reception"]);
    const rows = await many(db, `SELECT mo.id, mo.code, mo.first_name, mo.last_name, mo.phone, mo.status, mo.plan_name, mo.end_date, mo.days_left, mo.last_checkin,
                                        cs.score, cs.factors->'reasons' AS reasons, cs.model, cs.computed_at
                                   FROM churn_scores cs JOIN member_overview mo ON mo.id = cs.member_id
                                  WHERE cs.gym_id = $1 AND mo.archived_at IS NULL ORDER BY cs.score DESC LIMIT 200`, [u.gymId]);
    const model = await one(db, "SELECT kind, metrics, trained_at FROM ai_models WHERE gym_id = $1", [u.gymId]);
    return { rows, model };
  });

  r.post("/api/ai/churn/refresh", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const train = await trainForGym(u.gymId);
    const score = await scoreGym(u.gymId);
    return { train, score };
  });

  /** Drafts a personal win-back WhatsApp for a member, from their churn reasons. */
  r.post("/api/ai/winback/:memberId", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager", "reception"]);
    const b = await ctx.body(z.object({ lang: z.enum(["en", "ar", "arabizi", "fr"]).default("en") }));
    const m = await one(db, `SELECT mo.*, cs.factors->'reasons' AS reasons, g.name AS gym_name FROM member_overview mo JOIN gyms g ON g.id = mo.gym_id
                              LEFT JOIN churn_scores cs ON cs.member_id = mo.id WHERE mo.id = $1 AND mo.gym_id = $2`, [zId.parse(ctx.params.memberId), u.gymId]);
    if (!m) throw notFound("member");
    let text: string;
    if (llmEnabled() && (await hasElite(db, u.gymId))) {
      const out = await runWithTools({
        system: `You write short, warm WhatsApp messages for the staff of "${m.gym_name}", a gym in Lebanon. Output ONLY the message text (2–3 sentences, max one emoji), language: ${b.lang === "arabizi" ? "Lebanese Arabizi (latin letters, e.g. 'kifak')" : b.lang === "ar" ? "Lebanese Arabic" : b.lang === "fr" ? "French" : "English"}. Never mention data, scores or AI. No discount unless the context says so.`,
        messages: [{ role: "user", content: `Member: ${m.first_name}. Plan: ${m.plan_name ?? "none"}, ends ${m.end_date ?? "-"} (${m.days_left ?? "-"} days left). Why we worry: ${JSON.stringify(m.reasons ?? [])}. Goal: bring them back this week in a caring, non-pushy way, invite them to a class or a free check-in with a coach.` }],
        tools: [],
        maxTokens: 220,
      });
      text = out.text;
    } else {
      const templates = {
        en: `Hi ${m.first_name}! We haven't seen you at ${m.gym_name} lately and we miss you 💪 Want us to book you a free session with a coach this week to get back on track?`,
        ar: `مرحبا ${m.first_name}! اشتقنالك بـ ${m.gym_name} 💪 بتحب نحجزلك جلسة مجانية مع مدرب هالجمعة لترجع عالروتين؟`,
        arabizi: `Hi ${m.first_name}! Eshta2nelak bi ${m.gym_name} 💪 Baddak nehjizlak session ma3 coach hal jem3a ta terja3 3al routine?`,
        fr: `Salut ${m.first_name} ! On ne t'a pas vu à ${m.gym_name} ces derniers temps 💪 Tu veux qu'on te réserve une séance offerte avec un coach cette semaine ?`,
      };
      text = templates[b.lang as keyof typeof templates];
    }
    return { text, link: m.phone ? waLink(m.phone, text) : null };
  });

  // knowledge base (for the bot)
  r.get("/api/ai/knowledge", async (ctx) => {
    const u = await requireStaff(ctx);
    return many(db, "SELECT * FROM knowledge_docs WHERE gym_id = $1 ORDER BY title", [u.gymId]);
  });
  r.post("/api/ai/knowledge", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const b = await ctx.body(z.object({ title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(5000) }));
    return one(db, "INSERT INTO knowledge_docs (gym_id, title, body) VALUES ($1,$2,$3) RETURNING *", [u.gymId, b.title, b.body]);
  });
  r.put("/api/ai/knowledge/:id", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const b = await ctx.body(z.object({ title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(5000) }));
    const row = await one(db, "UPDATE knowledge_docs SET title = $3, body = $4, updated_at = now() WHERE id = $1 AND gym_id = $2 RETURNING *", [zId.parse(ctx.params.id), u.gymId, b.title, b.body]);
    if (!row) throw notFound("document");
    return row;
  });
  r.del("/api/ai/knowledge/:id", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager"]);
    const res = await db.query("DELETE FROM knowledge_docs WHERE id = $1 AND gym_id = $2", [zId.parse(ctx.params.id), u.gymId]);
    if (!res.rowCount) throw notFound("document");
    return { ok: true };
  });
  /** Lets staff test the member bot exactly as a member would see it. */
  r.post("/api/ai/bot-test", async (ctx) => {
    const u = await requireStaff(ctx);
    const b = await ctx.body(z.object({ text: z.string().trim().min(1).max(1000), member_id: zId.nullable().optional() }));
    const [reply, sources] = await Promise.all([botReply(u.gymId, b.member_id ?? null, b.text), retrieve(u.gymId, b.text, 3)]);
    return { ...reply, sources: sources.map((s) => ({ title: s.doc.title, score: Math.round(s.score * 100) / 100 })) };
  });

  // ---------- WhatsApp Cloud API webhook ----------
  r.get("/api/webhooks/whatsapp", async (ctx) => {
    const mode = ctx.query.get("hub.mode");
    const token = ctx.query.get("hub.verify_token");
    if (mode === "subscribe" && token === config.whatsapp.verifyToken) {
      ctx.res.writeHead(200, { "Content-Type": "text/plain" });
      ctx.res.end(ctx.query.get("hub.challenge") ?? "");
      return undefined;
    }
    throw new HttpError(403, "forbidden", "verification failed");
  });

  r.post("/api/webhooks/whatsapp", async (ctx) => {
    const raw = await ctx.rawBody();
    if (!verifyMetaSignature(raw, ctx.req.headers["x-hub-signature-256"] as string | undefined)) throw new HttpError(401, "bad_signature", "invalid signature");
    let payload: any;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      throw bad("invalid_json");
    }
    // Acknowledge fast; Meta retries on slow responses.
    queueMicrotask(() => handleWebhook(payload).catch((e) => console.error("[whatsapp webhook]", e.message)));
    return { ok: true };
  });
}

async function handleWebhook(payload: any) {
  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const v = change?.value ?? {};
      const phoneNumberId = v?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;
      const gym = await one(db, "SELECT id FROM gyms WHERE settings->'whatsapp'->>'phoneNumberId' = $1 AND saas_status <> 'suspended'", [phoneNumberId]);
      if (!gym) continue;
      for (const s of v.statuses ?? []) {
        if (["delivered", "read", "failed", "sent"].includes(s.status)) {
          await db.query("UPDATE messages SET status = $2, error = coalesce($3, error) WHERE provider_id = $1 AND gym_id = $4", [s.id, s.status, s.errors?.[0]?.title ?? null, gym.id]);
        }
      }
      for (const msg of v.messages ?? []) {
        const phone = normalizePhone("+" + String(msg.from ?? ""));
        const text = msg.type === "text" ? String(msg.text?.body ?? "") : msg.type === "button" ? String(msg.button?.text ?? "") : `[${msg.type}]`;
        const member = await one(db, "SELECT id FROM members WHERE gym_id = $1 AND phone = $2 AND archived_at IS NULL ORDER BY created_at DESC LIMIT 1", [gym.id, phone]);
        const dup = await one(db, "INSERT INTO messages (gym_id, member_id, phone, direction, kind, body, status, provider_id, dedupe_key) VALUES ($1,$2,$3,'in','inbound',$4,'received',$5,$6) ON CONFLICT DO NOTHING RETURNING id",
          [gym.id, member?.id ?? null, phone, text, msg.id ?? null, msg.id ? `in:${msg.id}` : null]);
        if (!dup || msg.type !== "text") continue;
        const history = await many(db, `SELECT direction, body FROM messages WHERE gym_id = $1 AND phone = $2 AND created_at > now() - interval '24 hours' AND id <> $3 ORDER BY created_at DESC LIMIT 6`, [gym.id, phone, dup.id]);
        const reply = await botReply(gym.id, member?.id ?? null, text, history.reverse().map((h) => ({ role: h.direction === "in" ? "user" : "assistant", content: h.body })));
        await sendWhatsApp(db, { gymId: gym.id, memberId: member?.id ?? null, phone, kind: reply.handoff ? "bot_handoff" : "bot", body: reply.reply, isReply: true });
      }
    }
  }
}
