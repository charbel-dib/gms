/**
 * Retrieval for the gym's knowledge (RAG).
 *
 * The corpus = the gym's own FAQ documents + documents generated live from its
 * data (hours, ladies hours, prices, weekly class schedule, coaches, contacts).
 * So when the owner changes a price, the bot already knows — no re-indexing.
 *
 * Ranking = BM25 with an Arabic / Arabizi / English normaliser and a small
 * gym-domain synonym map ("ishtirak", "اشتراك" → membership). It runs in-process,
 * needs no vector database, and works fully offline.
 */
import { db, many, one } from "../db/index.ts";

export interface Doc {
  id: string;
  title: string;
  body: string;
}

/** Isolates right-to-left text inside left-to-right sentences (and vice versa) so numbers do not get reordered. */
const iso = (s: string) => `\u2068${s}\u2069`;
const days = (n: number) => (n === 1 ? "1 day" : n % 30 === 0 && n <= 180 ? `${n / 30} month${n > 30 ? "s" : ""}` : n === 365 ? "1 year" : `${n} days`);

const DAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const SYNONYMS: Record<string, string> = {
  // membership
  ishtirak: "membership", eshtirak: "membership", ishtirake: "membership", اشتراك: "membership", اشتراكي: "membership",
  subscription: "membership", abonnement: "membership", plan: "membership", renew: "membership", jadded: "membership", جدد: "membership", تجديد: "membership",
  // price
  price: "price", prices: "price", cost: "price", adesh: "price", addesh: "price", adeh: "price", kam: "price", se3er: "price", sa3er: "price",
  سعر: "price", الاسعار: "price", اسعار: "price", قديش: "price", كم: "price", prix: "price", tarif: "price", how_much: "price",
  // hours
  hours: "hours", open: "hours", opening: "hours", close: "hours", closing: "hours", dawam: "hours", fetih: "hours", fat7a: "hours",
  maftou7: "hours", maftouh: "hours", دوام: "hours", مفتوح: "hours", بتفتحو: "hours", بتسكرو: "hours", horaires: "hours", time: "hours",
  // ladies
  ladies: "ladies", women: "ladies", female: "ladies", girls: "ladies", banet: "ladies", sabaya: "ladies", نسائي: "ladies", صبايا: "ladies", بنات: "ladies", نساء: "ladies",
  // classes
  class: "class", classes: "class", zumba: "class", spinning: "class", pilates: "class", yoga: "class", wod: "class", زومبا: "class", schedule: "class", cours: "class", hessa: "class", حصة: "class", حصص: "class", برنامج: "class", صف: "class",
  // coaches
  coach: "coach", trainer: "coach", pt: "coach", personal: "coach", mudarreb: "coach", mdarreb: "coach", مدرب: "coach", مدربة: "coach", كوتش: "coach",
  // freeze
  freeze: "freeze", freezing: "freeze", frozen: "freeze", pause: "freeze", travel: "freeze", msefer: "freeze", msefra: "freeze", msafer: "freeze", safar: "freeze", sefer: "freeze", jamed: "freeze", wa22ef: "freeze", وقف: "freeze", تجميد: "freeze", جمد: "freeze", مسافر: "freeze",
  // payment
  pay: "payment", payment: "payment", whish: "payment", omt: "payment", card: "payment", cash: "payment", dafe3: "payment", دفع: "payment", ادفع: "payment",
  // location
  where: "location", location: "location", address: "location", wen: "location", ween: "location", وين: "location", عنوان: "location", adresse: "location",
  // generator / electricity
  electricity: "generator", generator: "generator", kahraba: "generator", moteur: "generator", كهرباء: "generator", موتور: "generator",
};

const STOP = new Set(["the", "a", "an", "is", "are", "of", "to", "in", "on", "for", "and", "or", "do", "you", "your", "i", "my", "me", "what", "can", "it", "at", "be", "with",
  "في", "من", "على", "عن", "هل", "انا", "انت", "شو", "ما", "يا", "و", "le", "la", "les", "de", "des", "du", "est", "et", "je", "vous", "pour"]);

function normChars(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه");
}

const SYN = new Map(Object.entries(SYNONYMS).map(([k, v]) => [normChars(k), v]));
const STOP_N = new Set([...STOP].map(normChars));

/** Normalises Arabic letters, strips diacritics and tatweel, lowercases, and expands domain synonyms. */
export function tokenize(text: string): string[] {
  const norm = normChars(text).replace(/how much/g, "how_much");
  const raw = norm.match(/[\p{L}\p{N}_]+/gu) ?? [];
  const out: string[] = [];
  for (let t of raw) {
    if (STOP_N.has(t)) continue;
    if (t.startsWith("ال") && t.length > 4) t = t.slice(2);
    out.push(t);
    let syn = SYN.get(t);
    // Arabic: also try the word without a possessive/pronoun suffix (دوامكن → دوام, اشتراكي → اشتراك)
    if (!syn && /[؀-ۿ]/.test(t)) {
      for (const suf of ["كن", "كم", "هم", "ها", "نا", "ك", "ي", "ه"]) {
        if (t.endsWith(suf) && t.length - suf.length >= 3) {
          const stem = t.slice(0, -suf.length);
          out.push(stem);
          syn = SYN.get(stem);
          break;
        }
      }
    }
    if (syn && syn !== t) out.push(syn);
  }
  return out;
}

export class Bm25 {
  private docs: { doc: Doc; tf: Map<string, number>; len: number }[] = [];
  private df = new Map<string, number>();
  private avg = 0;

  constructor(docs: Doc[], private k1 = 1.4, private b = 0.7) {
    for (const doc of docs) {
      const toks = tokenize(doc.title + " " + doc.title + " " + doc.body);
      const tf = new Map<string, number>();
      for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      this.docs.push({ doc, tf, len: toks.length });
    }
    this.avg = this.docs.reduce((s, d) => s + d.len, 0) / Math.max(1, this.docs.length);
  }

  search(query: string, k = 4): { doc: Doc; score: number }[] {
    const qt = [...new Set(tokenize(query))];
    const N = this.docs.length;
    return this.docs
      .map((d) => {
        let score = 0;
        for (const t of qt) {
          const f = d.tf.get(t);
          if (!f) continue;
          const idf = Math.log(1 + (N - (this.df.get(t) ?? 0) + 0.5) / ((this.df.get(t) ?? 0) + 0.5));
          score += idf * ((f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * d.len) / this.avg)));
        }
        return { doc: d.doc, score };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
}

/** Builds the gym's live corpus from its data + custom documents. */
export async function gymCorpus(gymId: string): Promise<Doc[]> {
  const [gym, plans, sched, coaches, docs] = await Promise.all([
    one(db, "SELECT * FROM gyms WHERE id = $1", [gymId]),
    many(db, "SELECT * FROM plans WHERE gym_id = $1 AND active ORDER BY sort, price", [gymId]),
    many(db, `SELECT s.weekday, to_char(s.start_time, 'HH24:MI') AS t, s.duration_min, ct.name, ct.women_only, us.name AS coach
                FROM class_schedules s JOIN class_types ct ON ct.id = s.class_type_id LEFT JOIN users us ON us.id = s.coach_id
               WHERE s.gym_id = $1 AND s.active AND ct.active ORDER BY s.weekday, s.start_time`, [gymId]),
    many(db, "SELECT name, bio FROM users WHERE gym_id = $1 AND active AND role IN ('coach','owner','manager') AND bio IS NOT NULL", [gymId]),
    many(db, "SELECT id, title, body FROM knowledge_docs WHERE gym_id = $1", [gymId]),
  ]);
  const out: Doc[] = docs.map((d) => ({ id: d.id, title: d.title, body: d.body }));
  const s = gym.settings ?? {};
  if (s.hours?.length) {
    out.push({
      id: "hours", title: `Opening hours (${iso("دوام")})`,
      body: s.hours.map((h: any) => `• ${DAYS_EN[h.day]}: ${h.closed ? "closed" : `${h.open} – ${h.close}`}`).join("\n"),
    });
  }
  if (s.ladiesHours?.length) {
    out.push({ id: "ladies", title: `Ladies-only hours (women only, ${iso("صبايا")})`, body: s.ladiesHours.map((h: any) => `${DAYS_EN[h.day]} ${h.from}–${h.to}`).join(", ") + ". Only women can enter the gym floor during these hours." });
  }
  if (plans.length) {
    const fmt = (p: any) => (p.currency === "LBP" ? `${Number(p.price).toLocaleString("en-US")} LBP` : `$${Number(p.price)}`);
    out.push({
      id: "prices", title: `Membership prices and plans (${iso("اسعار الاشتراك")})`,
      body: plans.map((p: any) => `• ${p.name}${p.name_ar ? ` (${iso(p.name_ar)})` : ""}: ${fmt(p)} — ${p.kind === "visits" ? `${p.visits} visit${p.visits > 1 ? "s" : ""} within ${days(p.duration_days)}` : days(p.duration_days)}${p.includes_classes ? ", group classes included" : ", gym floor only"}${p.freeze_days_allowed ? `, up to ${p.freeze_days_allowed} freeze days` : ""}${p.gender_restriction === "female" ? ", women only" : ""}`).join("\n"),
    });
  }
  if (sched.length) {
    out.push({
      id: "classes", title: `Weekly group class schedule (${iso("برنامج الحصص")})`,
      body: sched.map((c: any) => `• ${DAYS_EN[c.weekday]} ${c.t} ${c.name} (${c.duration_min} min${c.coach ? `, coach ${c.coach}` : ""}${c.women_only ? ", women only" : ""})`).join("\n") + "\nBook classes in the member app.",
    });
  }
  if (coaches.length) out.push({ id: "coaches", title: `Coaches and personal trainers (${iso("المدربين")})`, body: coaches.map((c: any) => `${c.name}: ${c.bio}`).join(" ") });
  out.push({
    id: "contact", title: "Location, contact and payment",
    body: `${gym.name}${gym.name_ar ? ` (${gym.name_ar})` : ""}. Address: ${gym.address ?? gym.city ?? "ask reception"}. Phone/WhatsApp: ${gym.whatsapp ?? gym.phone ?? "-"}. Instagram: ${gym.instagram ?? "-"}. Payment accepted in USD or LBP (rate ${Number(gym.lbp_rate).toLocaleString("en-US")} LBP/USD).`,
  });
  return out;
}

export async function retrieve(gymId: string, query: string, k = 4) {
  const corpus = await gymCorpus(gymId);
  return new Bm25(corpus).search(query, k);
}
