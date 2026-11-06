/** English / Arabic (RTL). Missing Arabic strings fall back to English. */
import { useSyncExternalStore } from "react";

export type Lang = "en" | "ar";

const ar: Record<string, string> = {
  // navigation
  Today: "اليوم", "Check-in": "الدخول", Members: "المشتركين", Classes: "الحصص", "Personal training": "التدريب الخاص", Payments: "الدفعات",
  Messages: "الرسائل", Shop: "المتجر", "API reference": "مرجع الـ API", Notifications: "الإشعارات", Insights: "الذكاء الاصطناعي", Reports: "التقارير", Leads: "العملاء المحتملين", Expenses: "المصاريف", Settings: "الإعدادات",
  Platform: "المنصة", "Sign out": "تسجيل الخروج", "Switch to English": "English", "Switch to Arabic": "العربية",
  // statuses
  active: "فعّال", expiring: "ينتهي قريباً", expired: "منتهي", frozen: "مجمّد", none: "بلا اشتراك", upcoming: "يبدأ قريباً",
  // common
  Save: "حفظ", Cancel: "إلغاء", Close: "إغلاق", Search: "بحث", Add: "إضافة", Edit: "تعديل", Delete: "حذف", Loading: "جارٍ التحميل",
  "Add member": "إضافة مشترك", "Sell membership": "بيع اشتراك", Renew: "تجديد", Freeze: "تجميد", Unfreeze: "إلغاء التجميد", "Record payment": "تسجيل دفعة",
  Phone: "الهاتف", Name: "الاسم", "First name": "الاسم", "Last name": "الشهرة", Gender: "الجنس", Male: "ذكر", Female: "أنثى", Amount: "المبلغ",
  Currency: "العملة", Method: "طريقة الدفع", cash: "نقداً", whish: "Whish", omt: "OMT", card: "بطاقة", bank: "تحويل", other: "أخرى", Notes: "ملاحظات",
  "Ends": "ينتهي", "days left": "يوم متبقي", Balance: "المتبقي", "Last visit": "آخر زيارة", Code: "الرقم",
  "Scan a QR code, or type a name, phone or member number": "امسح الرمز أو اكتب الاسم أو الهاتف أو رقم المشترك",
  Welcome: "أهلاً", "Entry allowed": "الدخول مسموح", "Entry refused": "الدخول مرفوض", "Ready to scan": "جاهز للمسح",
  no_membership: "لا يوجد اشتراك", not_started: "الاشتراك لم يبدأ بعد", no_visits_left: "لم يبقَ زيارات", ladies_hours: "ساعات خاصة بالسيدات", unpaid_balance: "رصيد غير مدفوع",
  archived: "مشترك مؤرشف", grace_period: "فترة سماح", expiring_soon: "ينتهي قريباً",
  // member app
  "Your pass": "بطاقتك", "Show this at reception": "أظهرها عند الاستقبال", "Book": "احجز", Booked: "محجوز", Waitlist: "قائمة الانتظار", Full: "ممتلئ",
  "Cancel booking": "إلغاء الحجز", History: "السجل", Programs: "البرامج", "Ask the gym": "اسأل النادي", Send: "إرسال", "Sign in": "دخول", PIN: "الرقم السري",
  "Ask reception for your PIN": "اطلب رقمك السري من الاستقبال", "visits this month": "زيارات هذا الشهر", "week streak": "أسابيع متتالية", "visits left": "زيارات متبقية",
  "Membership": "الاشتراك", "Valid until": "صالح حتى", "Upcoming classes": "الحصص القادمة", "No classes this week": "لا حصص هذا الأسبوع",
  "Opening hours": "ساعات الدوام", "Ladies hours": "ساعات السيدات", Contact: "تواصل", "Change PIN": "تغيير الرقم السري",
  "Install the app": "ثبّت التطبيق",
  "Turn on notifications": "فعّل الإشعارات", "Turn on": "فعّل", "Turn off": "أوقف",
  "Class reminders, your membership and gym news.": "تذكير بالحصص، اشتراكك وأخبار النادي.",
  "Notifications are on": "الإشعارات مفعّلة", "Notifications are off": "الإشعارات متوقفة",
  "Notifications are blocked for this site. Allow them in your browser settings.": "الإشعارات محظورة لهذا الموقع. اسمح بها من إعدادات المتصفح.",
  "On iPhone: add the app to your home screen first (Share → Add to Home Screen), then open it from there.": "على الآيفون: أضف التطبيق إلى الشاشة الرئيسية أولاً (مشاركة ← إضافة إلى الشاشة الرئيسية) ثم افتحه من هناك.",
  "This browser can't receive notifications.": "هذا المتصفح لا يستقبل الإشعارات.",
  "On this phone": "على هذا الهاتف", "What you receive": "ما تستلمه", Recent: "الأحدث", View: "عرض", "Nothing yet.": "لا شيء بعد.",
  "Classes and training": "الحصص والتدريب", "My membership": "اشتراكي", "Payments and receipts": "الدفعات والإيصالات", "Gym news": "أخبار النادي", "Add to home screen for one-tap access": "أضفه للشاشة الرئيسية للوصول السريع",
  Sun: "أحد", Mon: "اثنين", Tue: "ثلاثاء", Wed: "أربعاء", Thu: "خميس", Fri: "جمعة", Sat: "سبت",
  Sunday: "الأحد", Monday: "الاثنين", Tuesday: "الثلاثاء", Wednesday: "الأربعاء", Thursday: "الخميس", Friday: "الجمعة", Saturday: "السبت",
  // member app v3
  Home: "الرئيسية", Coach: "المدرب", Me: "أنا", Back: "رجوع", Tomorrow: "بكرا",
  "Good morning": "صباح الخير", "Good afternoon": "نهارك سعيد", "Good evening": "مسا الخير",
  "Show my pass": "اعرض بطاقتي", "Tap to show your pass": "اضغط لعرض بطاقتك", "No membership": "بلا اشتراك", until: "لغاية", Until: "لغاية",
  "Balance to settle at reception": "مبلغ مستحق عند الاستقبال", "Next up": "التالي", "Your order is ready at reception": "طلبك جاهز عند الاستقبال",
  "Weekly goal reached!": "حققت هدف الأسبوع!", "{n} more this week": "باقي {n} هالأسبوع", "{n} visits this month": "{n} زيارات هالشهر", "vs last month": "مقارنة بالشهر الماضي",
  wk: "أسبوع", classes: "حصص", days: "أيام", ends: "ينتهي", Offers: "العروض", Offer: "عرض", Event: "حدث", Plan: "الاشتراك",
  "At the gym's shop": "من متجر النادي", "See all": "شوف الكل", "out of stock": "نفذ", "Few left": "باقي قليل",
  "Prices, hours, your membership": "الأسعار، الدوام، اشتراكك", "Invite a friend": "ادعُ صديق", "Share your link": "شارك رابطك",
  badges: "شارات", Badges: "الشارات", "See your progress": "شوف تقدمك", "See the product": "شوف المنتج", "Ask at reception to get it.": "اطلبه من الاستقبال.",
  Bundle: "باقة", Bundles: "الباقات", Product: "منتج", "One less": "واحد أقل", "One more": "واحد زيادة", "I want it": "بدّي ياه",
  "Sent! Reception will prepare it.": "تم! الاستقبال رح يحضّره.", "Out of stock for now. Ask reception when it's back.": "نفذ حالياً. اسأل الاستقبال إيمتى برجع.",
  "Note for reception (flavour, size…)": "ملاحظة للاستقبال (النكهة، الحجم…)", "You pay at reception when you pick it up. You'll get a notification when it's ready.": "بتدفع عند الاستقبال لما تستلمه. رح يوصلك إشعار لما يجهز.",
  "My bookings": "حجوزاتي", Ladies: "سيدات", "{n} spots left": "باقي {n} أماكن", "Booking cancelled": "تم إلغاء الحجز", "Leave waitlist": "اترك لائحة الانتظار",
  "You're on the waitlist": "انت على لائحة الانتظار", "No description.": "لا يوجد وصف.",
  "You don't have a PT package. Ask reception about personal training.": "ما عندك باقة تدريب خاص. اسأل الاستقبال.", "Coach to be assigned": "المدرب لم يُحدد بعد",
  "{used} of {total} done": "{used} من {total} منتهية", "{n} to book": "{n} للحجز", "valid until": "صالح لغاية", "Book a session": "احجز جلسة",
  "Your coach hasn't published their hours yet. Message them or reception.": "مدربك ما نشر أوقاته بعد. راسله أو راسل الاستقبال.", "All your sessions are booked.": "كل جلساتك محجوزة.",
  "Coming up": "القادم", "Cancel this session? It goes back to your package.": "بدك تلغي الجلسة؟ بترجع على باقتك.", "Session cancelled": "تم إلغاء الجلسة",
  "Too late to cancel in the app": "فات وقت الإلغاء من التطبيق", "Free cancellation up to {h} hours before.": "إلغاء مجاني لغاية {h} ساعات قبل.", Done: "منتهية", missed: "فاتت",
  "You have {n} sessions left to book": "باقي إلك {n} جلسات للحجز", "Book with {coach}": "احجز مع {coach}", "{n} sessions booked": "تم حجز {n} جلسات", "Session booked": "تم حجز الجلسة",
  "Book {n} sessions": "احجز {n} جلسات", "Book this session": "احجز هالجلسة", "Choose a time": "اختار وقت",
  "No free time with your coach in the coming days. Message them or reception.": "ما في أوقات فاضية مع مدربك بالأيام الجاية. راسله أو راسل الاستقبال.",
  "{min} per session · {n} left to book. Pick two in a row for a longer session.": "{min} للجلسة · باقي {n} للحجز. اختار وقتين ورا بعض لجلسة أطول.",
  Supplements: "مكملات", Drinks: "مشروبات", Snacks: "سناكات", Accessories: "إكسسوارات", Apparel: "ملابس", Other: "غيره", All: "الكل",
  "Tap “I want it” and pick it up at reception. You pay there.": "اضغط «بدّي ياه» واستلمه من الاستقبال. بتدفع هونيك.", "My orders": "طلباتي",
  "Ready at reception": "جاهز عند الاستقبال", "Being prepared": "عم يتحضّر", Collected: "تم الاستلام", Cancelled: "ملغى", "Nothing here yet.": "ما في شي بعد.",
  "member since": "مشترك من", Progress: "التقدم", "Badges, streaks, challenges": "شارات، سلاسل، تحديات", "PIN, notifications, language": "الرمز، الإشعارات، اللغة",
  "Last class you attended": "آخر حصة حضرتها", "No classes yet.": "ما في حصص بعد.", "Nothing booked.": "ما في حجز.", "Book a class": "احجز حصة",
  Receipt: "إيصال", Visits: "الزيارات", "No visits yet.": "ما في زيارات بعد.", Address: "العنوان",
  "Join me at {gym}! Leave your number here and they'll call you: {url}": "تعا تمرّن معي بـ {gym}! اترك رقمك هون وبيتصلوا فيك: {url}",
  "When they join, you get: {reward}": "لما يشترك، بتاخد: {reward}", "Train together: share your link.": "تمرّنوا سوا: شارك رابطك.", "{j} joined · {p} waiting": "{j} اشتركوا · {p} بالانتظار",
  Share: "مشاركة", "Copy link": "انسخ الرابط", "Link copied": "تم نسخ الرابط",
  "Payments and orders": "الدفعات والطلبات", "Badges, challenges and friends": "الشارات، التحديات والأصحاب", "Gym news and offers": "أخبار وعروض النادي",
  "On this phone: on": "على هالتلفون: مفعّلة", "On this phone: off": "على هالتلفون: متوقفة", "My goal": "هدفي", "Visits per week": "زيارات بالأسبوع",
  "Members who train twice a week or more stick with it far more often.": "اللي بيتمرّنوا مرتين بالأسبوع أو أكتر بيكمّلوا أكتر بكتير.",
  "Show me on challenge leaderboards": "اعرضني بترتيب التحديات", "Only your first name and initial": "بس اسمك الأول وأول حرف من الشهرة", Language: "اللغة",
  "The two new PINs are different": "الرمزين الجداد مش متطابقين", "PIN changed": "تم تغيير الرمز", "Current PIN": "الرمز الحالي", "New PIN (4–6 digits)": "رمز جديد (4–6 أرقام)", "New PIN again": "أعد الرمز الجديد",
  Install: "تثبيت", "visits in total": "زيارة بالمجموع", "best streak": "أطول سلسلة", "Last 12 weeks": "آخر 12 أسبوع", goal: "الهدف", "Done!": "تم!",
  You: "انت", "{n} members taking part": "{n} مشترك مشاركين", "you're hidden from others": "انت مخفي عن الباقيين", "Earned on": "حصلت عليها بـ",
  "Not a member yet? Leave your number": "مش مشترك بعد؟ اترك رقمك", "You're already a member!": "انت مشترك من قبل!", "Thanks! 🙌": "شكراً! 🙌",
  "Sign in with your phone and the PIN from reception.": "ادخل برقمك والرمز اللي من الاستقبال.", "{gym} will call you soon. You can also message them on WhatsApp.": "{gym} رح يتصلوا فيك قريباً. فيك كمان تراسلهم عالواتساب.",
  "A friend invited you to {gym}": "صاحبك دعاك على {gym}", "Join {gym}": "اشترك بـ {gym}", "Leave your name and number: the gym will call you to plan a visit.": "اترك اسمك ورقمك: النادي رح يتصل فيك لتنظيم زيارة.",
  "Your name": "اسمك", "What are you interested in? (optional)": "شو بيهمك؟ (اختياري)", "Weight loss": "خسارة وزن", "Muscle gain": "بناء عضل", "Just fitness": "لياقة بس",
  "Already a member? Sign in": "مشترك؟ سجّل دخول", "Gym not found.": "النادي غير موجود.", "Check the link your gym sent you.": "تأكد من الرابط اللي بعتلك ياه النادي.",
  "First visit": "أول زيارة", "10 visits": "10 زيارات", "25 visits": "25 زيارة", "50 visits": "50 زيارة", "100 club": "نادي الـ100", "250 visits": "250 زيارة",
  "4-week streak": "4 أسابيع ورا بعض", "12-week streak": "12 أسبوع ورا بعض", "Half-year habit": "عادة نص سنة", "Year-round": "سنة كاملة", "First class": "أول حصة",
  "Class regular": "زبون الحصص", "Class hero": "بطل الحصص", "Early bird": "طير الصبح", "Night owl": "بومة الليل", "One year with us": "سنة معنا",
  "Challenge completed": "تحدي منجز", "Brought a friend": "جبت صاحب",
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
  lang = l;
  try {
    localStorage.setItem("gms.lang", l);
  } catch { /* ignore */ }
  apply();
  listeners.forEach((f) => f());
}
export const getLang = () => lang;

export function t(s: string, vars?: Record<string, string | number>): string {
  let out = lang === "ar" ? ar[s] ?? s : s;
  if (vars) out = out.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
  return out;
}

export function useLang(): Lang {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => lang);
}

// ---------- formatting ----------
export function money(n: number | string | null | undefined, currency: "USD" | "LBP" = "USD"): string {
  const v = Number(n ?? 0);
  if (currency === "LBP") return `${Math.round(v).toLocaleString("en-US")} LBP`;
  const abs = Math.abs(v);
  const s = abs >= 1000 || Number.isInteger(abs) ? Math.round(abs).toLocaleString("en-US") : abs.toFixed(2);
  return `${v < 0 ? "-" : ""}$${s}`;
}

export function fmtDate(d: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }): string {
  if (!d) return "—";
  const date = typeof d === "string" && d.length === 10 ? new Date(d + "T12:00:00") : new Date(d);
  return date.toLocaleDateString(lang === "ar" ? "ar-LB" : "en-GB", opts);
}

export function fmtTime(d: string | Date): string {
  return new Date(d).toLocaleTimeString(lang === "ar" ? "ar-LB" : "en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function relDays(d: string | Date | null | undefined): string {
  if (!d) return "never";
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
