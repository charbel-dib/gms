/**
 * Telegram: connecting people to the GMS bot, and what the bot does when they write to it.
 *
 *  - Members get their reminders and messages there (when their gym has Telegram on), and the gym's assistant
 *    answers their questions. "I want to talk to someone" alerts the gym's owners and managers.
 *  - Owners and managers get the weekly summary, and can ask about their numbers ("how much this month?").
 *  - The operator (super-admin) gets new trial requests and the platform's week.
 */
import { z } from "zod";
import { db, one, many, audit } from "../db/index.ts";
import { requireMember, requireStaff, requireSuperadmin } from "../auth.ts";
import { HttpError, notFound, zId, type Router } from "../http.ts";
import { askGym } from "../ai/assistant.ts";
import { botReply } from "../ai/bot.ts";
import { connectBot, disconnectBot, getBot, linkFor, staffChats, tgSend } from "../services/telegram.ts";
import { gymWeekText, platformWeekText } from "../services/weekly.ts";
import { waLink } from "../services/whatsapp.ts";

const say = (locale: string | null | undefined, en: string, ar: string) => (locale === "ar" ? ar : en);
const BOTH = (en: string, ar: string) => `${en}\n\n${ar}`;

/** Staff of a gym, or the operator outside any gym. */
async function staffOrOperator(ctx: Parameters<typeof requireStaff>[0]): Promise<{ id: string; role: string; gymId: string | null }> {
  try {
    return await requireStaff(ctx);
  } catch (e) {
    if (e instanceof HttpError && e.code === "gym_required" && ctx.user?.role === "superadmin") return { ...ctx.user, gymId: null };
    throw e;
  }
}

export function registerTelegram(r: Router) {
  // ---------- the operator sets up the bot ----------
  r.get("/api/admin/telegram", async (ctx) => {
    const su = await requireSuperadmin(ctx);
    const bot = await getBot();
    const me = await one(db, "SELECT username FROM telegram_links WHERE user_id = $1", [su.id]);
    const counts = await one(db, "SELECT count(*) FILTER (WHERE member_id IS NOT NULL)::int AS members, count(*) FILTER (WHERE user_id IS NOT NULL)::int AS staff FROM telegram_links");
    return { connected: !!bot, username: bot?.username ?? null, me_linked: !!me, me_username: me?.username ?? null, ...counts };
  });

  r.put("/api/admin/telegram", async (ctx) => {
    const su = await requireSuperadmin(ctx);
    const b = await ctx.body(z.object({ token: z.string().trim().regex(/^\d{5,}:[A-Za-z0-9_-]{30,}$/, "This doesn't look like a bot token from @BotFather") }));
    let username: string;
    try {
      username = await connectBot(b.token);
    } catch (e: any) {
      throw new HttpError(400, "telegram_error", `Telegram refused: ${e.message}`);
    }
    await audit(db, null, su.id, "telegram.connect", "platform", undefined, { username });
    return { ok: true, username };
  });

  r.del("/api/admin/telegram", async (ctx) => {
    const su = await requireSuperadmin(ctx);
    await disconnectBot();
    await audit(db, null, su.id, "telegram.disconnect", "platform");
    return { ok: true };
  });

  // ---------- connecting your own Telegram (staff, or the operator) ----------
  r.get("/api/telegram", async (ctx) => {
    const u = await staffOrOperator(ctx);
    const bot = await getBot();
    const gym = u.gymId ? await one(db, "SELECT settings FROM gyms WHERE id = $1", [u.gymId]) : null;
    const me = await one(db, "SELECT username FROM telegram_links WHERE user_id = $1", [u.id]);
    const members = u.gymId ? await one(db, "SELECT count(*)::int AS n FROM telegram_links WHERE gym_id = $1 AND member_id IS NOT NULL", [u.gymId]) : { n: 0 };
    return { bot: bot?.username ?? null, enabled: !!gym?.settings?.telegram?.enabled, me_linked: !!me, me_username: me?.username ?? null, members: members.n };
  });

  r.post("/api/telegram/me", async (ctx) => {
    const u = await staffOrOperator(ctx);
    const link = await linkFor({ gymId: u.role === "superadmin" ? null : u.gymId, userId: u.id });
    if (!link) throw new HttpError(409, "telegram_off", "Telegram is not set up yet.");
    return link;
  });

  r.del("/api/telegram/me", async (ctx) => {
    const u = await staffOrOperator(ctx);
    await db.query("DELETE FROM telegram_links WHERE user_id = $1", [u.id]);
    return { ok: true };
  });

  // ---------- connecting a member ----------
  r.get("/api/members/:id/telegram", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager", "reception"]);
    const id = zId.parse(ctx.params.id);
    const m = await one(db, "SELECT id FROM members WHERE id = $1 AND gym_id = $2", [id, u.gymId]);
    if (!m) throw notFound("member");
    const l = await one(db, "SELECT username, created_at FROM telegram_links WHERE member_id = $1", [id]);
    return { linked: !!l, username: l?.username ?? null, since: l?.created_at ?? null };
  });

  // a link for the member, and a WhatsApp message ready to send it with
  r.post("/api/members/:id/telegram", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager", "reception"]);
    const id = zId.parse(ctx.params.id);
    const m = await one(db, "SELECT m.first_name, m.phone, g.name, g.locale FROM members m JOIN gyms g ON g.id = m.gym_id WHERE m.id = $1 AND m.gym_id = $2", [id, u.gymId]);
    if (!m) throw notFound("member");
    const link = await linkFor({ gymId: u.gymId, memberId: id });
    if (!link) throw new HttpError(409, "telegram_off", "Telegram is not set up yet.");
    const text = say(m.locale,
      `Hi ${m.first_name}, get your ${m.name} reminders on Telegram. Open this link and press Start: ${link.url}`,
      `مرحبًا ${m.first_name}، يمكنك استلام تذكيرات ${m.name} على تلغرام. افتح هذا الرابط واضغط Start: ${link.url}`);
    return { ...link, text, whatsapp: m.phone ? waLink(m.phone, text) : null };
  });

  r.del("/api/members/:id/telegram", async (ctx) => {
    const u = await requireStaff(ctx, ["owner", "manager", "reception"]);
    const id = zId.parse(ctx.params.id);
    await db.query("DELETE FROM telegram_links WHERE member_id = $1 AND gym_id = $2", [id, u.gymId]);
    return { ok: true };
  });

  // the member connects from the member app
  r.post("/api/m/telegram", async (ctx) => {
    const me = await requireMember(ctx);
    const g = await one(db, "SELECT settings FROM gyms WHERE id = $1", [me.gymId]);
    if (!g?.settings?.telegram?.enabled) throw new HttpError(409, "telegram_off", "This gym doesn't use Telegram.");
    const link = await linkFor({ gymId: me.gymId, memberId: me.id });
    if (!link) throw new HttpError(409, "telegram_off", "Telegram is not set up yet.");
    return link;
  });

  // ---------- the bot itself ----------
  r.post("/api/webhooks/telegram/:secret", async (ctx) => {
    const bot = await getBot();
    if (!bot || ctx.params.secret !== bot.secret) throw notFound("page");
    const update = JSON.parse((await ctx.rawBody()).toString("utf8") || "{}");
    // answer Telegram at once; it retries slow webhooks
    queueMicrotask(() => handleUpdate(update).catch((e) => console.error("[telegram]", e.message)));
    return { ok: true };
  });
}

export async function handleUpdate(update: any) {
  const m = update?.message;
  if (!m?.chat || m.chat.type !== "private" || typeof m.text !== "string") return;
  const chat = String(m.chat.id);
  const text = m.text.trim().slice(0, 1000);
  const username = m.from?.username ?? null;
  const reply = (t: string) => tgSend(chat, t);

  // /start <code>: connect this chat
  const start = /^\/start(?:\s+(\S+))?$/.exec(text);
  if (start) {
    if (!start[1]) {
      const known = await one(db, "SELECT 1 FROM telegram_links WHERE chat_id = $1", [chat]);
      if (!known) return void (await reply(BOTH("Hi! To connect, open the link your gym sent you.", "مرحبًا. للربط، افتح الرابط الذي أرسله لك ناديك.")));
      return void (await reply(BOTH("You're connected. Write your question here.", "أنت مرتبط. اكتب سؤالك هنا.")));
    }
    const c = await one(db, "DELETE FROM telegram_codes WHERE code = $1 AND expires_at > now() RETURNING *", [start[1]]);
    if (!c) return void (await reply(BOTH("This link has expired or was already used. Ask for a new one.", "انتهت صلاحية هذا الرابط أو سبق استخدامه. اطلب رابطًا جديدًا.")));
    if (c.member_id) {
      await db.query("DELETE FROM telegram_links WHERE member_id = $1", [c.member_id]);
      await db.query("INSERT INTO telegram_links (chat_id, username, gym_id, member_id) VALUES ($1,$2,$3,$4)", [chat, username, c.gym_id, c.member_id]);
      const g = await one(db, "SELECT mb.first_name, g.name, g.name_ar, g.locale FROM members mb JOIN gyms g ON g.id = mb.gym_id WHERE mb.id = $1", [c.member_id]);
      return void (await reply(say(g.locale,
        `Hi ${g.first_name}, you're connected to ${g.name}. Your reminders will come here, and you can ask anything about the gym: hours, prices, your membership.`,
        `مرحبًا ${g.first_name}، أنت الآن مرتبط بـ ${g.name_ar || g.name}. ستصلك التذكيرات هنا، ويمكنك السؤال عن أي شيء يخص النادي: الدوام والأسعار واشتراكك.`)));
    }
    await db.query("DELETE FROM telegram_links WHERE user_id = $1", [c.user_id]);
    await db.query("INSERT INTO telegram_links (chat_id, username, gym_id, user_id) VALUES ($1,$2,$3,$4)", [chat, username, c.gym_id, c.user_id]);
    const u = await one(db, "SELECT u.name, u.role, g.name AS gym, g.locale FROM users u LEFT JOIN gyms g ON g.id = u.gym_id WHERE u.id = $1", [c.user_id]);
    if (u.role === "superadmin") return void (await reply(`Connected, ${u.name}. New trial requests will come here, and your week every Monday. Send /summary any time.`));
    if (u.role === "owner" || u.role === "manager") {
      return void (await reply(say(u.locale,
        `Connected, ${u.name}. Every Monday morning you'll get ${u.gym}'s week here. Ask me about your numbers any time, for example "how much did we collect this month?", or send /summary.`,
        `تم الربط يا ${u.name}. سيصلك ملخص أسبوع ${u.gym} هنا كل يوم اثنين صباحًا. اسألني عن أرقامك متى شئت، مثلًا «كم حصّلنا هذا الشهر؟»، أو أرسل /summary.`)));
    }
    return void (await reply(say(u.locale, `Connected, ${u.name}.`, `تم الربط يا ${u.name}.`)));
  }

  const links = await many(db, `SELECT l.*, u.role, u.active AS user_active, g.locale, g.name AS gym_name, g.archived_at, g.saas_status
      FROM telegram_links l LEFT JOIN users u ON u.id = l.user_id LEFT JOIN gyms g ON g.id = l.gym_id
     WHERE l.chat_id = $1 ORDER BY l.last_used_at DESC`, [chat]);
  if (text === "/stop") {
    await db.query("DELETE FROM telegram_links WHERE chat_id = $1", [chat]);
    return void (await reply(BOTH("Done. You won't get messages here anymore.", "تم. لن تصلك رسائل هنا بعد الآن.")));
  }
  if (!links.length) return void (await reply(BOTH("Hi! To connect, open the link your gym sent you.", "مرحبًا. للربط، افتح الرابط الذي أرسله لك ناديك.")));
  const l = links[0];
  await db.query("UPDATE telegram_links SET last_used_at = now(), username = coalesce($2, username) WHERE id = $1", [l.id, username]);
  if (l.gym_id && (l.archived_at || l.saas_status === "suspended")) return;

  // the operator
  if (l.role === "superadmin") {
    return void (await reply(text === "/summary" ? await platformWeekText() : "I send you new trial requests, and your week every Monday. Send /summary any time."));
  }

  // owners and managers: their week, and questions about their own numbers
  if (l.user_id) {
    if (!l.user_active || !["owner", "manager"].includes(l.role)) return void (await reply(say(l.locale, "Weekly summaries go to owners and managers.", "يصل الملخص الأسبوعي إلى مالك النادي والمدير.")));
    if (text === "/summary") return void (await reply(await gymWeekText(l.gym_id)));
    const history = await many(db, `SELECT direction, body FROM messages WHERE gym_id = $1 AND channel = 'telegram-staff' AND phone = $2 AND created_at > now() - interval '2 hours' ORDER BY created_at DESC LIMIT 6`, [l.gym_id, chat]);
    const a = await askGym(l.gym_id, text, history.reverse().map((h) => ({ role: h.direction === "in" ? "user" as const : "assistant" as const, content: h.body })));
    const answer = String(a.answer || say(l.locale, "I couldn't work that out. Try asking another way.", "لم أجد الجواب. جرّب طرح السؤال بطريقة أخرى.")).slice(0, 3500);
    await db.query("INSERT INTO messages (gym_id, phone, direction, kind, body, status, channel) VALUES ($1,$2,'in','owner_question',$3,'received','telegram-staff'), ($1,$2,'out','owner_answer',$4,'sent','telegram-staff')", [l.gym_id, chat, text, answer]);
    return void (await reply(answer));
  }

  // members: the gym's assistant
  const mb = await one(db, "SELECT id, first_name, last_name, phone FROM members WHERE id = $1 AND archived_at IS NULL", [l.member_id]);
  if (!mb) return;
  const inRow = await one(db, `INSERT INTO messages (gym_id, member_id, phone, direction, kind, body, status, channel, dedupe_key)
      VALUES ($1,$2,$3,'in','inbound',$4,'received','telegram',$5) ON CONFLICT DO NOTHING RETURNING id`,
    [l.gym_id, mb.id, mb.phone, text, `tg-in:${update.update_id}`]);
  if (!inRow) return; // Telegram sent the same update twice
  const history = await many(db, `SELECT direction, body FROM messages WHERE member_id = $1 AND channel = 'telegram' AND created_at > now() - interval '24 hours' AND id <> $2 ORDER BY created_at DESC LIMIT 6`, [mb.id, inRow.id]);
  const out = await botReply(l.gym_id, mb.id, text, history.reverse().map((h) => ({ role: h.direction === "in" ? "user" as const : "assistant" as const, content: h.body })));
  const id = await tgSend(chat, out.reply);
  await db.query(`INSERT INTO messages (gym_id, member_id, phone, direction, kind, body, status, channel, provider_id, sent_at) VALUES ($1,$2,$3,'out',$4,$5,'sent','telegram',$6, now())`,
    [l.gym_id, mb.id, mb.phone, out.handoff ? "bot_handoff" : "bot", out.reply, `tg:${id}`]);
  if (out.handoff) {
    const alert = say(l.locale, `${mb.first_name} ${mb.last_name} wants to talk to someone. They wrote: "${text}"`, `${mb.first_name} ${mb.last_name} يريد التحدث مع أحد الموظفين. كتب: «${text}»`);
    for (const c of await staffChats(l.gym_id)) await tgSend(c, alert).catch(() => {});
  }
}
