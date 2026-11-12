/**
 * Telegram delivery through one GMS bot.
 *
 * The operator creates the bot once with @BotFather and pastes its token on the platform page; GMS stores it
 * encrypted and points the bot's webhook at /api/webhooks/telegram/<secret>. Members, staff and the operator
 * connect by opening a one-time link. Telegram only lets a bot write to someone who opened it first, which is
 * exactly what that link does.
 */
import crypto from "node:crypto";
import { config } from "../config.ts";
import { decryptSecret, encryptSecret } from "../auth.ts";
import { db, many, one, type Queryable } from "../db/index.ts";

export interface Bot { token: string; username: string; secret: string }

const API = () => (process.env.TELEGRAM_API_BASE || "https://api.telegram.org").replace(/\/$/, "");
let cache: { bot: Bot | null; at: number } | null = null;

export async function getBot(): Promise<Bot | null> {
  if (cache && Date.now() - cache.at < 60_000) return cache.bot;
  const row = await one(db, "SELECT value FROM platform_settings WHERE key = 'telegram'");
  let bot: Bot | null = null;
  if (row?.value?.token) {
    try { bot = { token: decryptSecret(row.value.token), username: row.value.username, secret: row.value.secret }; } catch { bot = null; }
  }
  cache = { bot, at: Date.now() };
  return bot;
}

export async function tgCall(token: string, method: string, body: Record<string, unknown> = {}): Promise<any> {
  const res = await fetch(`${API()}/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!j.ok) throw new Error(j.description || `Telegram HTTP ${res.status}`);
  return j.result;
}

/** Checks the token, points the webhook at this server and stores the bot. Returns its @username. */
export async function connectBot(token: string): Promise<string> {
  const me = await tgCall(token, "getMe");
  const secret = crypto.randomBytes(24).toString("base64url");
  await tgCall(token, "setWebhook", { url: `${config.publicUrl}/api/webhooks/telegram/${secret}`, allowed_updates: ["message"], drop_pending_updates: true });
  await tgCall(token, "setMyCommands", { commands: [{ command: "summary", description: "This week in numbers (owners)" }, { command: "stop", description: "Stop messages here" }] }).catch(() => {});
  await db.query(
    `INSERT INTO platform_settings (key, value) VALUES ('telegram', $1) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
    [{ token: encryptSecret(token), username: me.username, secret }],
  );
  cache = null;
  return me.username;
}

export async function disconnectBot() {
  const bot = await getBot();
  if (bot) await tgCall(bot.token, "deleteWebhook").catch(() => {});
  await db.query("DELETE FROM platform_settings WHERE key = 'telegram'");
  cache = null;
}

/** Sends a text message. Returns Telegram's message id. */
export async function tgSend(chatId: string | number, text: string): Promise<string> {
  const bot = await getBot();
  if (!bot) throw new Error("Telegram is not set up");
  const r = await tgCall(bot.token, "sendMessage", { chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true });
  return String(r.message_id);
}

/** A one-time link (valid 7 days) that connects whoever opens it to this member, staff member or operator. */
export async function linkFor(target: { gymId: string | null; memberId?: string; userId?: string }) {
  const bot = await getBot();
  if (!bot) return null;
  const code = crypto.randomBytes(12).toString("base64url");
  await db.query("DELETE FROM telegram_codes WHERE expires_at < now()");
  await db.query("INSERT INTO telegram_codes (code, gym_id, member_id, user_id, expires_at) VALUES ($1,$2,$3,$4, now() + interval '7 days')",
    [code, target.gymId, target.memberId ?? null, target.userId ?? null]);
  return { url: `https://t.me/${bot.username}?start=${code}`, bot: bot.username };
}

export async function memberChat(q: Queryable, memberId: string): Promise<string | null> {
  return (await one(q, "SELECT chat_id::text AS c FROM telegram_links WHERE member_id = $1", [memberId]))?.c ?? null;
}

/** Owners and managers of a gym who connected their Telegram. */
export async function staffChats(gymId: string): Promise<string[]> {
  const rows = await many(db, `SELECT l.chat_id::text AS c FROM telegram_links l JOIN users u ON u.id = l.user_id
                                WHERE l.gym_id = $1 AND u.role IN ('owner','manager') AND u.active`, [gymId]);
  return rows.map((r) => r.c);
}

/** Tells the operator (every super-admin who connected Telegram). Never throws. */
export async function notifyOperator(text: string) {
  try {
    if (!(await getBot())) return;
    const rows = await many(db, `SELECT l.chat_id::text AS c FROM telegram_links l JOIN users u ON u.id = l.user_id WHERE u.role = 'superadmin'`);
    for (const r of rows) await tgSend(r.c, text).catch(() => {});
  } catch { /* best effort */ }
}
