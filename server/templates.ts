/**
 * Gym templates — the "configurable template" model.
 * A new gym starts from one of these and is then customised (branding, plans,
 * classes, modules, rules) from the Settings screen, without any code change.
 */
export interface GymTemplate {
  key: string;
  label: string;
  description: string;
  modules: Record<string, boolean>;
  settings: Record<string, unknown>;
  plans: { name: string; name_ar: string; kind: "time" | "visits"; duration_days: number; visits?: number; price: number; includes_classes: boolean; freeze_days_allowed: number; gender_restriction?: "female" | "male" }[];
  classTypes: { name: string; name_ar: string; color: string; default_capacity: number; duration_min: number; women_only?: boolean; slots: [weekday: number, time: string][] }[];
  knowledge: { title: string; body: string }[];
}

const weekHours = (open: string, close: string, fridayClose?: string) =>
  [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: day === 0 ? "08:00" : open, close: day === 5 && fridayClose ? fridayClose : day === 0 ? "14:00" : close }));

const baseSettings = {
  checkin: { graceDays: 0, blockOnBalance: false, cooldownMinutes: 60 },
  reminders: { enabled: true, daysBefore: [7, 1], afterExpiryDays: [3], winback: true },
  ladiesHours: [] as { day: number; from: string; to: string }[],
};

export const TEMPLATES: GymTemplate[] = [
  {
    key: "classic",
    label: "Classic gym",
    description: "Open gym floor + a few group classes. The most common format in Lebanon.",
    modules: { classes: true, pt: true, whatsapp: true, ai: true, memberApp: true, expenses: true, leads: true, shop: true },
    settings: { ...baseSettings, hours: weekHours("06:00", "23:00") },
    plans: [
      { name: "1 Month", name_ar: "شهر", kind: "time", duration_days: 30, price: 45, includes_classes: true, freeze_days_allowed: 0 },
      { name: "3 Months", name_ar: "٣ أشهر", kind: "time", duration_days: 90, price: 120, includes_classes: true, freeze_days_allowed: 10 },
      { name: "6 Months", name_ar: "٦ أشهر", kind: "time", duration_days: 180, price: 220, includes_classes: true, freeze_days_allowed: 20 },
      { name: "1 Year", name_ar: "سنة", kind: "time", duration_days: 365, price: 400, includes_classes: true, freeze_days_allowed: 30 },
      { name: "Student 1 Month", name_ar: "طالب - شهر", kind: "time", duration_days: 30, price: 35, includes_classes: false, freeze_days_allowed: 0 },
      { name: "10 Visits", name_ar: "١٠ زيارات", kind: "visits", duration_days: 60, visits: 10, price: 40, includes_classes: false, freeze_days_allowed: 0 },
      { name: "Day Pass", name_ar: "دخول يوم", kind: "visits", duration_days: 1, visits: 1, price: 7, includes_classes: false, freeze_days_allowed: 0 },
    ],
    classTypes: [
      { name: "Zumba", name_ar: "زومبا", color: "#E4572E", default_capacity: 20, duration_min: 50, slots: [[1, "18:30"], [3, "18:30"], [5, "11:00"]] },
      { name: "Spinning", name_ar: "سبينينغ", color: "#3D5A80", default_capacity: 15, duration_min: 45, slots: [[2, "07:00"], [4, "19:30"], [6, "10:00"]] },
      { name: "Body Pump", name_ar: "بادي بامب", color: "#2A9D8F", default_capacity: 18, duration_min: 55, slots: [[1, "20:00"], [3, "20:00"]] },
      { name: "Abs & Core", name_ar: "بطن", color: "#8D6A9F", default_capacity: 20, duration_min: 30, slots: [[2, "18:00"], [4, "18:00"]] },
    ],
    knowledge: [
      { title: "House rules", body: "Bring a towel. Re-rack your weights. Proper sports shoes are required on the floor. Lockers are free during your visit; leave nothing overnight." },
      { title: "Freezing a membership", body: "3, 6 and 12-month memberships can be frozen (10, 20 and 30 days). Ask reception or message us on WhatsApp at least one day before." },
      { title: "Generator & electricity", body: "The gym runs on generator power during cuts, so the floor stays open during all opening hours. Air conditioning may be reduced during cuts." },
      { title: "Payments", body: "We accept cash in USD or LBP, Whish Money and OMT. Card payment is available at reception." },
    ],
  },
  {
    key: "ladies",
    label: "Ladies-only studio",
    description: "Women-only gym with many group classes and nutrition follow-up.",
    modules: { classes: true, pt: true, whatsapp: true, ai: true, memberApp: true, expenses: true, leads: true, shop: true },
    settings: { ...baseSettings, hours: weekHours("07:00", "21:00", "13:00") },
    plans: [
      { name: "1 Month Unlimited", name_ar: "شهر غير محدود", kind: "time", duration_days: 30, price: 55, includes_classes: true, freeze_days_allowed: 0, gender_restriction: "female" },
      { name: "3 Months Unlimited", name_ar: "٣ أشهر غير محدود", kind: "time", duration_days: 90, price: 150, includes_classes: true, freeze_days_allowed: 14, gender_restriction: "female" },
      { name: "8 Classes", name_ar: "٨ حصص", kind: "visits", duration_days: 30, visits: 8, price: 40, includes_classes: true, freeze_days_allowed: 0, gender_restriction: "female" },
    ],
    classTypes: [
      { name: "Pilates Mat", name_ar: "بيلاتس", color: "#C06C84", default_capacity: 12, duration_min: 50, women_only: true, slots: [[1, "09:30"], [3, "09:30"], [5, "09:30"]] },
      { name: "Zumba", name_ar: "زومبا", color: "#E4572E", default_capacity: 20, duration_min: 50, women_only: true, slots: [[2, "18:00"], [4, "18:00"]] },
      { name: "Stretch & Tone", name_ar: "تمدد وشد", color: "#6C5B7B", default_capacity: 15, duration_min: 45, women_only: true, slots: [[0, "10:00"], [3, "19:00"]] },
    ],
    knowledge: [
      { title: "Women only", body: "The studio is for women only. Male coaches never enter during opening hours." },
      { title: "Kids", body: "Children are not allowed on the floor. A small waiting corner is available near reception." },
    ],
  },
  {
    key: "crossfit",
    label: "CrossFit / functional box",
    description: "Class-based box: every visit is a booked WOD with a coach.",
    modules: { classes: true, pt: true, whatsapp: true, ai: true, memberApp: true, expenses: true, leads: true, shop: true },
    settings: { ...baseSettings, hours: weekHours("06:00", "21:30") },
    plans: [
      { name: "Unlimited Monthly", name_ar: "شهري غير محدود", kind: "time", duration_days: 30, price: 120, includes_classes: true, freeze_days_allowed: 7 },
      { name: "12 Classes", name_ar: "١٢ حصة", kind: "visits", duration_days: 30, visits: 12, price: 95, includes_classes: true, freeze_days_allowed: 0 },
      { name: "Drop-in", name_ar: "حصة واحدة", kind: "visits", duration_days: 1, visits: 1, price: 15, includes_classes: true, freeze_days_allowed: 0 },
    ],
    classTypes: [
      { name: "WOD", name_ar: "تمرين اليوم", color: "#D62828", default_capacity: 14, duration_min: 60, slots: [[1, "06:30"], [1, "18:00"], [2, "18:00"], [3, "06:30"], [3, "18:00"], [4, "18:00"], [5, "17:00"], [6, "10:00"]] },
      { name: "Olympic Lifting", name_ar: "رفع أثقال أولمبي", color: "#003049", default_capacity: 8, duration_min: 60, slots: [[2, "19:30"], [4, "19:30"]] },
      { name: "Fundamentals", name_ar: "أساسيات", color: "#F77F00", default_capacity: 6, duration_min: 60, slots: [[0, "11:00"]] },
    ],
    knowledge: [
      { title: "Booking", body: "Every class must be booked in the app. Cancel at least 2 hours before so someone on the waitlist can take your spot." },
      { title: "Beginners", body: "New athletes start with 3 Fundamentals sessions before joining regular WODs." },
    ],
  },
  {
    key: "fightclub",
    label: "Boxing / MMA club",
    description: "Combat sports club with level-based classes and private coaching.",
    modules: { classes: true, pt: true, whatsapp: true, ai: true, memberApp: true, expenses: true, leads: true, shop: true },
    settings: { ...baseSettings, hours: weekHours("09:00", "22:00") },
    plans: [
      { name: "Monthly", name_ar: "شهري", kind: "time", duration_days: 30, price: 70, includes_classes: true, freeze_days_allowed: 0 },
      { name: "3 Months", name_ar: "٣ أشهر", kind: "time", duration_days: 90, price: 190, includes_classes: true, freeze_days_allowed: 10 },
      { name: "Kids Monthly", name_ar: "أطفال شهري", kind: "time", duration_days: 30, price: 50, includes_classes: true, freeze_days_allowed: 0 },
    ],
    classTypes: [
      { name: "Boxing Basics", name_ar: "ملاكمة مبتدئين", color: "#9B2226", default_capacity: 16, duration_min: 60, slots: [[1, "19:00"], [3, "19:00"], [5, "12:00"]] },
      { name: "Muay Thai", name_ar: "مواي تاي", color: "#BB3E03", default_capacity: 14, duration_min: 75, slots: [[2, "19:00"], [4, "19:00"]] },
      { name: "Kids Boxing", name_ar: "ملاكمة أطفال", color: "#0A9396", default_capacity: 12, duration_min: 50, slots: [[6, "11:00"], [2, "17:00"]] },
    ],
    knowledge: [
      { title: "Equipment", body: "Bring your own hand wraps. Gloves can be borrowed for your first two sessions; after that members bring their own." },
    ],
  },
];

/**
 * How much of GMS a gym sees. Nothing is removed from the product: a level is only
 * a preset of modules, and the owner can still switch any module on in Settings.
 *   essential — members, check-in, payments, WhatsApp messages (a small weights gym)
 *   studio    — + classes, personal training, member app
 *   full      — everything
 */
export type GymLevel = "essential" | "studio" | "full";
export const LEVELS: GymLevel[] = ["essential", "studio", "full"];
export function levelModules(level: GymLevel): Record<string, boolean> {
  const studio = level !== "essential";
  const full = level === "full";
  return { whatsapp: true, classes: studio, pt: studio, memberApp: studio, expenses: full, leads: full, shop: full, ai: full };
}

export function getTemplate(key: string): GymTemplate {
  return TEMPLATES.find((t) => t.key === key) ?? TEMPLATES[0];
}
