/**
 * Member assistant — answers members on WhatsApp and in the member app, 24/7,
 * in Lebanese Arabic, Arabizi, English or French. Grounded on the gym's data (RAG)
 * and on the member's own membership; can list and book classes. Hands over to
 * reception when it cannot help or when the member asks for a person.
 */
import { db, many, one } from "../db/index.ts";
import { llmEnabled, runWithTools, type Tool } from "./llm.ts";
import { retrieve } from "./rag.ts";
import { bookSession } from "../modules/classes.ts";
import { hasElite } from "../services/plans.ts";

const HANDOFF = /human|person|reception|staff|someone|call me|موظف|حدا|حدن|حدن|بدي احكي|bade e7ke|bade ehke|réception|quelqu.un/i;
const STATUS = /my (membership|subscription|plan)|days left|when (does|do) .*(end|expire)|ishtirak(e|i)|eshtirak(e|i)|اشتراكي|كم باقي|قديش باقي|ba2e|ba2i|expire|mon abonnement/i;

export interface BotReply {
  reply: string;
  handoff: boolean;
  mode: "llm" | "offline";
}

async function memberContext(gymId: string, memberId: string | null) {
  if (!memberId) return null;
  const m = await one(db, `SELECT first_name, last_name, status, plan_name, start_date, end_date, days_left, visits_total, visits_used, balance_usd, includes_classes, gender
                             FROM member_overview WHERE id = $1 AND gym_id = $2`, [memberId, gymId]);
  return m;
}

function statusText(m: any): string {
  if (!m || m.status === "none") return "I can't find an active membership on your number. Reception can help you subscribe 🙂";
  const visits = m.visits_total != null ? ` You have ${m.visits_total - m.visits_used} visit(s) left.` : "";
  const bal = Number(m.balance_usd) > 0 ? ` There is a balance of $${Number(m.balance_usd).toFixed(2)} to settle at reception.` : "";
  if (m.status === "expired") return `Hi ${m.first_name}! Your ${m.plan_name} membership ended on ${m.end_date}. Pass by reception or reply here to renew 💪${bal}`;
  if (m.status === "frozen") return `Hi ${m.first_name}! Your membership is frozen right now. It runs until ${m.end_date} after the freeze.${bal}`;
  return `Hi ${m.first_name}! Your ${m.plan_name} membership is active until ${m.end_date} (${m.days_left} day(s) left).${visits}${bal}`;
}

export async function botReply(gymId: string, memberId: string | null, text: string, history: { role: "user" | "assistant"; content: string }[] = []): Promise<BotReply> {
  const msg = text.trim().slice(0, 1000);
  const useLlm = llmEnabled() && (await hasElite(db, gymId));
  if (HANDOFF.test(msg)) {
    return { reply: "Sure — I've let the team know, someone from reception will answer you here shortly 🙏", handoff: true, mode: useLlm ? "llm" : "offline" };
  }
  const [gym, member, docs] = await Promise.all([
    one(db, "SELECT name, (now() AT TIME ZONE timezone)::text AS now FROM gyms WHERE id = $1", [gymId]),
    memberContext(gymId, memberId),
    retrieve(gymId, msg, 4),
  ]);

  if (!useLlm) {
    if (STATUS.test(msg)) return { reply: statusText(member), handoff: false, mode: "offline" };
    const top = docs[0];
    if (top && top.score > 1) return { reply: `${top.doc.title}:\n${top.doc.body}`, handoff: false, mode: "offline" };
    return { reply: "Thanks for your message! A team member will get back to you here shortly 🙏", handoff: true, mode: "offline" };
  }

  const upcoming = await many(db, `
    SELECT s.id, to_char(s.starts_at AT TIME ZONE g.timezone, 'Dy DD Mon HH24:MI') AS at, ct.name, s.capacity,
           (SELECT count(*) FROM bookings b WHERE b.session_id = s.id AND b.status IN ('booked','attended'))::int AS booked
      FROM class_sessions s JOIN class_types ct ON ct.id = s.class_type_id JOIN gyms g ON g.id = s.gym_id
     WHERE s.gym_id = $1 AND NOT s.cancelled AND s.starts_at > now() AND s.starts_at < now() + interval '4 days'
     ORDER BY s.starts_at LIMIT 25`, [gymId]);

  let handoff = false;
  const tools: Tool[] = [
    {
      name: "handoff_to_staff",
      description: "Use when you cannot answer from the provided information, for complaints, refunds, price negotiations, or medical questions.",
      input_schema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] },
      run: async () => { handoff = true; return { ok: true }; },
    },
  ];
  if (memberId) {
    tools.push({
      name: "book_class",
      description: "Books the member into one of the upcoming classes listed in the context (by its id). Only call after the member clearly asked to book that class.",
      input_schema: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"] },
      run: async ({ session_id }) => {
        if (!upcoming.some((u) => u.id === session_id)) return { error: "unknown class id" };
        try {
          return await db.tx((q) => bookSession(q, gymId, session_id, memberId, { byStaff: false }).then((r) => ({ status: r.status })));
        } catch (e: any) {
          return { error: e.message };
        }
      },
    });
  }

  const system = `You are the friendly WhatsApp assistant of "${gym.name}", a gym in Lebanon. Local time: ${gym.now}.
Reply in the SAME language and script as the member (Lebanese Arabic, Arabizi like "kifak", English or French). Keep replies short (1–4 sentences), warm, with at most one emoji.
Use ONLY the information below; never invent prices, hours or rules. If the answer is not there, call handoff_to_staff and say reception will follow up.
${member ? `MEMBER: ${JSON.stringify(member)}` : "The sender is not a registered member (a prospect): be welcoming and invite them for a visit."}
GYM INFORMATION:
${docs.map((d) => `## ${d.doc.title}\n${d.doc.body}`).join("\n")}
UPCOMING CLASSES (id | time | name | booked/capacity):
${upcoming.map((u) => `${u.id} | ${u.at} | ${u.name} | ${u.booked}/${u.capacity}`).join("\n") || "none"}`;

  const out = await runWithTools({ system, messages: [...history.slice(-6), { role: "user", content: msg }], tools, maxRounds: 3, maxTokens: 400 });
  return { reply: out.text || "A team member will answer you shortly 🙏", handoff, mode: "llm" };
}
