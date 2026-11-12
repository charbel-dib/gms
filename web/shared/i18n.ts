/** English / Arabic (RTL). Missing Arabic strings fall back to English. */
import { useSyncExternalStore } from "react";
import { arMore } from "./ar-more.ts";

export type Lang = "en" | "ar";

const ar: Record<string, string> = {
  // navigation
  Today: "اليوم", "Check-in": "الدخول", Members: "المشتركون", Classes: "الحصص", "Personal training": "التدريب الخاص", Payments: "الدفعات",
  Messages: "الرسائل", Shop: "المتجر", "API reference": "مرجع الـ API", Notifications: "الإشعارات", Insights: "التحليلات", Reports: "التقارير", Leads: "العملاء المحتملون", Expenses: "المصاريف", Settings: "الإعدادات",
  Platform: "المنصة", "Your account": "حسابي", "Sign out": "تسجيل الخروج", "Switch to English": "English", "Switch to Arabic": "العربية",
  // statuses
  active: "فعّال", expiring: "ينتهي قريبًا", expired: "منتهي", frozen: "مجمّد", none: "بلا اشتراك", upcoming: "يبدأ قريبًا",
  // common
  Save: "حفظ", Cancel: "إلغاء", Close: "إغلاق", Search: "بحث", Add: "إضافة", Edit: "تعديل", Delete: "حذف", Loading: "جارٍ التحميل",
  "Add member": "إضافة مشترك", "Sell membership": "بيع اشتراك", Renew: "تجديد", Freeze: "تجميد", Unfreeze: "إلغاء التجميد", "Record payment": "تسجيل دفعة",
  Phone: "الهاتف", Name: "الاسم", "First name": "الاسم", "Last name": "اسم العائلة", Gender: "الجنس", Male: "ذكر", Female: "أنثى", Amount: "المبلغ",
  Currency: "العملة", Method: "طريقة الدفع", cash: "نقدًا", whish: "Whish", omt: "OMT", card: "بطاقة", bank: "تحويل", other: "أخرى", Notes: "ملاحظات",
  "Ends": "ينتهي", "days left": "يوم متبقٍ", Balance: "المتبقي", "Last visit": "آخر زيارة", Code: "الرقم",
  "Scan a QR code, or type a name, phone or member number": "امسح الرمز أو اكتب الاسم أو الهاتف أو رقم المشترك",
  Welcome: "أهلًا", "Entry allowed": "الدخول مسموح", "Entry refused": "الدخول مرفوض", "Ready to scan": "جاهز للمسح",
  no_membership: "لا يوجد اشتراك", not_started: "الاشتراك لم يبدأ بعد", no_visits_left: "لم تتبقَّ زيارات", ladies_hours: "ساعات خاصة بالسيدات", unpaid_balance: "رصيد غير مدفوع",
  archived: "مشترك مؤرشف", grace_period: "فترة سماح", expiring_soon: "ينتهي قريباً",
  // member app
  "Your pass": "بطاقتك", "Show this at reception": "أظهرها عند الاستقبال", "Book": "احجز", Booked: "محجوز", Waitlist: "قائمة الانتظار", Full: "ممتلئ",
  "Cancel booking": "إلغاء الحجز", History: "السجل", Programs: "البرامج", "Ask the gym": "اسأل النادي", Send: "إرسال", "Sign in": "تسجيل الدخول", PIN: "الرقم السري",
  "Ask reception for your PIN": "اطلب رقمك السري من الاستقبال", "visits this month": "زيارات هذا الشهر", "week streak": "أسابيع متتالية", "visits left": "زيارات متبقية",
  "Membership": "الاشتراك", "Valid until": "صالح حتى", "Upcoming classes": "الحصص القادمة", "No classes this week": "لا حصص هذا الأسبوع",
  "Opening hours": "ساعات الدوام", "Ladies hours": "ساعات السيدات", Contact: "تواصل", "Change PIN": "تغيير الرقم السري",
  "Install the app": "ثبّت التطبيق",
  "Turn on notifications": "فعّل الإشعارات", "Turn on": "فعّل", "Turn off": "أوقف",
  "Class reminders, your membership and gym news.": "تذكير بالحصص، واشتراكك، وأخبار النادي.",
  "Notifications are on": "الإشعارات مفعّلة", "Notifications are off": "الإشعارات متوقفة",
  "Notifications are blocked for this site. Allow them in your browser settings.": "الإشعارات محظورة لهذا الموقع. اسمح بها من إعدادات المتصفح.",
  "On iPhone: add the app to your home screen first (Share → Add to Home Screen), then open it from there.": "على الآيفون: أضف التطبيق إلى الشاشة الرئيسية أولًا (مشاركة ← إضافة إلى الشاشة الرئيسية)، ثم افتحه من هناك.",
  "This browser can't receive notifications.": "هذا المتصفح لا يستقبل الإشعارات.",
  "On this phone": "على هذا الهاتف", "What you receive": "ما تستلمه", Recent: "الأحدث", View: "عرض", "Nothing yet.": "لا شيء بعد.",
  "Classes and training": "الحصص والتدريب", "My membership": "اشتراكي", "Payments and receipts": "الدفعات والإيصالات", "Gym news": "أخبار النادي", "Add to home screen for one-tap access": "أضفه للشاشة الرئيسية للوصول السريع",
  Sun: "أحد", Mon: "اثنين", Tue: "ثلاثاء", Wed: "أربعاء", Thu: "خميس", Fri: "جمعة", Sat: "سبت",
  Sunday: "الأحد", Monday: "الاثنين", Tuesday: "الثلاثاء", Wednesday: "الأربعاء", Thursday: "الخميس", Friday: "الجمعة", Saturday: "السبت",
  // member app v3
  Home: "الرئيسية", Coach: "المدرب", Me: "أنا", Back: "رجوع", Tomorrow: "غدًا",
  "Good morning": "صباح الخير", "Good afternoon": "طاب يومك", "Good evening": "مساء الخير",
  "Show my pass": "اعرض بطاقتي", "Tap to show your pass": "اضغط لعرض بطاقتك", "No membership": "بلا اشتراك", until: "حتى", Until: "حتى",
  "Balance to settle at reception": "مبلغ مستحق عند الاستقبال", "Next up": "التالي", "Your order is ready at reception": "طلبك جاهز عند الاستقبال",
  "Weekly goal reached": "حققت هدف الأسبوع", "{n} more this week": "بقي {n} هذا الأسبوع", "{n} visits this month": "{n} زيارات هذا الشهر", "vs last month": "مقارنة بالشهر الماضي",
  wk: "أسبوع", classes: "حصص", days: "أيام", ends: "ينتهي", Offers: "العروض", Offer: "عرض", Event: "فعالية", Plan: "الاشتراك",
  "At the gym's shop": "من متجر النادي", "See all": "عرض الكل", "out of stock": "نفد", "Few left": "الكمية محدودة",
  "Prices, hours, your membership": "الأسعار، الدوام، اشتراكك", "Invite a friend": "ادعُ صديقًا", "Share your link": "شارك رابطك",
  badges: "شارات", Badges: "الشارات", "See your progress": "اعرض تقدمك", "See the product": "اعرض المنتج", "Ask at reception to get it.": "اطلبه من الاستقبال.",
  Bundle: "باقة", Bundles: "الباقات", Product: "منتج", "One less": "إنقاص واحد", "One more": "زيادة واحد", "I want it": "أريده",
  "Sent! Reception will prepare it.": "تم الإرسال. سيجهّزه الاستقبال.", "Out of stock for now. Ask reception when it's back.": "غير متوفر حاليًا. اسأل الاستقبال عن موعد توفره.",
  "Note for reception (flavour, size…)": "ملاحظة للاستقبال (النكهة، الحجم…)", "You pay at reception when you pick it up. You'll get a notification when it's ready.": "تدفع عند الاستقبال عند الاستلام، وسيصلك إشعار عندما يجهز.",
  "My bookings": "حجوزاتي", Ladies: "سيدات", "{n} spots left": "{n} أماكن متبقية", "Booking cancelled": "تم إلغاء الحجز", "Leave waitlist": "مغادرة قائمة الانتظار",
  "You're on the waitlist": "أنت على قائمة الانتظار", "No description.": "لا يوجد وصف.",
  "You don't have a PT package. Ask reception about personal training.": "ليست لديك باقة تدريب خاص. اسأل الاستقبال عن التدريب الخاص.", "Coach to be assigned": "لم يُحدَّد المدرب بعد",
  "{used} of {total} done": "{used} من {total} مكتملة", "{n} to book": "{n} للحجز", "valid until": "صالح حتى", "Book a session": "احجز جلسة",
  "Your coach hasn't published their hours yet. Message them or reception.": "لم ينشر مدربك أوقاته بعد. راسله أو راسل الاستقبال.", "All your sessions are booked.": "كل جلساتك محجوزة.",
  "Coming up": "القادم", "Cancel this session? It goes back to your package.": "هل تريد إلغاء هذه الجلسة؟ ستعود إلى باقتك.", "Session cancelled": "تم إلغاء الجلسة",
  "Too late to cancel in the app": "فات موعد الإلغاء من التطبيق", "Free cancellation up to {h} hours before.": "الإلغاء مجاني حتى {h} ساعات قبل الموعد.", Done: "مكتملة", missed: "فائتة",
  "You have {n} sessions left to book": "بقي لك {n} جلسات للحجز", "Book with {coach}": "احجز مع {coach}", "{n} sessions booked": "تم حجز {n} جلسات", "Session booked": "تم حجز الجلسة",
  "Book {n} sessions": "احجز {n} جلسات", "Book this session": "احجز هذه الجلسة", "Choose a time": "اختر وقتًا",
  "No free time with your coach in the coming days. Message them or reception.": "لا توجد أوقات متاحة مع مدربك في الأيام القادمة. راسله أو راسل الاستقبال.",
  "{min} per session · {n} left to book. Pick two in a row for a longer session.": "{min} للجلسة · بقي {n} للحجز. اختر وقتين متتاليين لجلسة أطول.",
  Supplements: "مكملات", Drinks: "مشروبات", Snacks: "وجبات خفيفة", Accessories: "إكسسوارات", Apparel: "ملابس", Other: "أخرى", All: "الكل",
  "Tap “I want it” and pick it up at reception. You pay there.": "اضغط «أريده» واستلمه من الاستقبال، والدفع هناك.", "My orders": "طلباتي",
  "Ready at reception": "جاهز عند الاستقبال", "Being prepared": "قيد التحضير", Collected: "تم الاستلام", Cancelled: "ملغى", "Nothing here yet.": "لا شيء هنا بعد.",
  "member since": "مشترك منذ", Progress: "التقدم", "Badges, streaks, challenges": "الشارات والسلاسل والتحديات", "PIN, notifications, language": "الرمز السري والإشعارات واللغة",
  "Last class you attended": "آخر حصة حضرتها", "No classes yet.": "لا حصص بعد.", "Nothing booked.": "لا حجوزات.", "Book a class": "احجز حصة",
  Receipt: "إيصال", Visits: "الزيارات", "No visits yet.": "لا زيارات بعد.", Address: "العنوان",
  "Join me at {gym}! Leave your number here and they'll call you: {url}": "تمرّن معي في {gym}. اترك رقمك هنا وسيتصلون بك: {url}",
  "When they join, you get: {reward}": "عندما يشترك، تحصل على: {reward}", "Train together: share your link.": "شارك رابطك لتتمرّنا معًا.", "{j} joined · {p} waiting": "{j} اشتركوا · {p} في الانتظار",
  Share: "مشاركة", "Copy link": "انسخ الرابط", "Link copied": "تم نسخ الرابط",
  "Payments and orders": "الدفعات والطلبات", "Badges, challenges and friends": "الشارات والتحديات والأصدقاء", "Gym news and offers": "أخبار النادي وعروضه",
  "On this phone: on": "على هذا الهاتف: مفعّلة", "On this phone: off": "على هذا الهاتف: متوقفة", "My goal": "هدفي", "Visits per week": "زيارات في الأسبوع",
  "Members who train twice a week or more stick with it far more often.": "المشتركون الذين يتمرّنون مرتين في الأسبوع أو أكثر يستمرون مدة أطول بكثير.",
  "Show me on challenge leaderboards": "أظهرني في ترتيب التحديات", "Only your first name and initial": "اسمك الأول والحرف الأول من اسم العائلة فقط", Language: "اللغة",
  "The two new PINs are different": "الرمزان الجديدان غير متطابقين", "PIN changed": "تم تغيير الرمز السري", "Current PIN": "الرمز الحالي", "New PIN (6 digits)": "رمز جديد (6 أرقام)", "New PIN again": "أعد الرمز الجديد",
  Install: "تثبيت", "visits in total": "زيارة إجمالًا", "best streak": "أطول سلسلة", "Last 12 weeks": "آخر 12 أسبوعًا", goal: "الهدف",
  You: "أنت", "{n} members taking part": "عدد المشاركين: {n}", "you're hidden from others": "أنت مخفي عن الآخرين", "Earned on": "حصلت عليها في",
  "Not a member yet? Leave your number": "لست مشتركًا بعد؟ اترك رقمك", "You're already a member!": "أنت مشترك بالفعل.", "Thanks": "شكراً",
  "Sign in with your phone and the PIN from reception.": "سجّل الدخول برقم هاتفك والرمز السري الذي حصلت عليه من الاستقبال.", "{gym} will call you soon. You can also message them on WhatsApp.": "سيتصل بك {gym} قريبًا. يمكنك أيضًا مراسلتهم على واتساب.",
  "A friend invited you to {gym}": "دعاك صديقك إلى {gym}", "Join {gym}": "انضم إلى {gym}", "Leave your name and number: the gym will call you to plan a visit.": "اترك اسمك ورقمك، وسيتصل بك النادي لتحديد موعد زيارة.",
  "Your name": "اسمك", "What are you interested in? (optional)": "ما الذي يهمك؟ (اختياري)", "Weight loss": "إنقاص الوزن", "Muscle gain": "بناء العضلات", "Just fitness": "لياقة عامة",
  "Already a member? Sign in": "مشترك بالفعل؟ سجّل الدخول", "Gym not found.": "النادي غير موجود.", "Check the link your gym sent you.": "تأكد من الرابط الذي أرسله لك النادي.",
  "First visit": "أول زيارة", "10 visits": "10 زيارات", "25 visits": "25 زيارة", "50 visits": "50 زيارة", "100 club": "نادي الـ100", "250 visits": "250 زيارة",
  "4-week streak": "4 أسابيع متتالية", "12-week streak": "12 أسبوعًا متتاليًا", "Half-year habit": "عادة نصف سنة", "Year-round": "سنة كاملة", "First class": "أول حصة",
  "Class regular": "مواظب على الحصص", "Class hero": "بطل الحصص", "Early bird": "من روّاد الصباح", "Night owl": "ساهر الليل", "One year with us": "سنة معنا",
  "Challenge completed": "تحدٍّ مكتمل", "Brought a friend": "أحضرت صديقًا",
  // admin v3
  "Member app": "تطبيق المشتركين", Saved: "تم الحفظ",
};

let lang: Lang = ((): Lang => {
  try {
    const s = localStorage.getItem("gms.lang");
    if (s === "en" || s === "ar") return s;
  } catch { /* ignore */ }
  return navigator.language?.startsWith("ar") ? "ar" : "en";
})();
const listeners = new Set<() => void>();

function apply() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
}
apply();

export function setLang(l: Lang) {
  if (l === lang) return;
  lang = l;
  try {
    localStorage.setItem("gms.lang", l);
  } catch { /* ignore */ }
  apply();
  listeners.forEach((f) => f());
  // some labels are prepared once when the app starts: reload so every one of them switches
  if (typeof location !== "undefined") location.reload();
}
export const getLang = () => lang;

export function t(s: string, vars?: Record<string, string | number>): string {
  let out = lang === "ar" ? arMore[s] ?? ar[s] ?? s : s;
  if (vars) out = out.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
  return out;
}

export function useLang(): Lang {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => lang);
}

// ---------- formatting ----------
/** In Arabic, keeps "$45" from being displayed as "45$": the amount is isolated as left-to-right text. */
const iso = (s: string) => (lang === "ar" ? `\u2066${s}\u2069` : s);
// Lebanese Arabic with the digits people actually use in Lebanon (0-9), not ٠-٩.
const AR_LOCALE = "ar-LB-u-nu-latn";
export function money(n: number | string | null | undefined, currency: "USD" | "LBP" = "USD"): string {
  const v = Number(n ?? 0);
  if (currency === "LBP") return iso(`${Math.round(v).toLocaleString("en-US")} LBP`);
  const abs = Math.abs(v);
  const s = abs >= 1000 || Number.isInteger(abs) ? Math.round(abs).toLocaleString("en-US") : abs.toFixed(2);
  return iso(`${v < 0 ? "-" : ""}$${s}`);
}

export function fmtDate(d: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }): string {
  if (!d) return "—";
  const date = typeof d === "string" && d.length === 10 ? new Date(d + "T12:00:00") : new Date(d);
  return date.toLocaleDateString(lang === "ar" ? AR_LOCALE : "en-GB", opts);
}

export function fmtTime(d: string | Date): string {
  return new Date(d).toLocaleTimeString(lang === "ar" ? AR_LOCALE : "en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function relDays(d: string | Date | null | undefined): string {
  if (!d) return t("never");
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
  if (days <= 0) return t("today");
  if (days === 1) return t("yesterday");
  return t("{n} days ago", { n: days });
}

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
