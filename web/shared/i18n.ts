/** English / Arabic (RTL). Missing Arabic strings fall back to English. */
import { useSyncExternalStore } from "react";

export type Lang = "en" | "ar";

const ar: Record<string, string> = {
  // navigation
  Today: "اليوم", "Check-in": "الدخول", Members: "المشتركين", Classes: "الحصص", "Personal training": "التدريب الخاص", Payments: "الدفعات",
  Messages: "الرسائل", Shop: "المتجر", Notifications: "الإشعارات", Insights: "الذكاء الاصطناعي", Reports: "التقارير", Leads: "العملاء المحتملين", Expenses: "المصاريف", Settings: "الإعدادات",
  Platform: "المنصة", "Sign out": "تسجيل الخروج", "Switch to English": "English", "Switch to Arabic": "العربية",
  // statuses
  active: "فعّال", expiring: "ينتهي قريباً", expired: "منتهي", frozen: "مجمّد", none: "بلا اشتراك", upcoming: "يبدأ قريباً",
  // common
  Save: "حفظ", Cancel: "إلغاء", Close: "إغلاق", Search: "بحث", Add: "إضافة", Edit: "تعديل", Delete: "حذف", Loading: "جارٍ التحميل",
  "Add member": "إضافة مشترك", "Sell membership": "بيع اشتراك", Renew: "تجديد", Freeze: "تجميد", Unfreeze: "إلغاء التجميد", "Record payment": "تسجيل دفعة",
  Phone: "الهاتف", Name: "الاسم", "First name": "الاسم", "Last name": "الشهرة", Gender: "الجنس", Male: "ذكر", Female: "أنثى", Plan: "الاشتراك", Amount: "المبلغ",
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
