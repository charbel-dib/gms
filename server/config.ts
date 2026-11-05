/** Central configuration, read once from environment variables. */
function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v !== undefined && v !== "") return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required environment variable ${name}`);
}

const isProd = process.env.NODE_ENV === "production";

function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  // On AWS the URL is assembled from discrete secrets injected by ECS.
  if (process.env.DB_HOST) {
    const u = encodeURIComponent(env("DB_USER"));
    const p = encodeURIComponent(env("DB_PASSWORD"));
    return `postgres://${u}:${p}@${env("DB_HOST")}:${env("DB_PORT", "5432")}/${env("DB_NAME", "gms")}?sslmode=${env("DB_SSLMODE", "require")}`;
  }
  if (isProd) throw new Error("DATABASE_URL or DB_HOST must be set in production");
  return "postgres://postgres:devpass@127.0.0.1:5432/gms?sslmode=disable";
}

export const config = {
  isProd,
  port: Number(env("PORT", "8080")),
  databaseUrl: databaseUrl(),
  /** Public base URL, used in WhatsApp links and member-app QR codes. */
  publicUrl: env("PUBLIC_URL", "http://localhost:8080").replace(/\/$/, ""),
  /** Root domain for gym subdomains, e.g. gms.lb → fitzone.gms.lb */
  rootDomain: env("ROOT_DOMAIN", "localhost"),
  sessionDays: Number(env("SESSION_DAYS", "30")),
  /** Bootstrap super-admin, created on first start if no super-admin exists. */
  superadminEmail: env("SUPERADMIN_EMAIL", "admin@gms.local"),
  superadminPassword: env("SUPERADMIN_PASSWORD", isProd ? undefined : "admin12345"),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  anthropicModel: env("ANTHROPIC_MODEL", "claude-haiku-5-5"),
  whatsapp: {
    token: process.env.WHATSAPP_TOKEN || "",
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || "gms-verify",
    appSecret: process.env.WHATSAPP_APP_SECRET || "",
    apiVersion: env("WHATSAPP_API_VERSION", "v21.0"),
  },
  jobsEnabled: env("JOBS_ENABLED", "true") === "true",
  trustProxy: env("TRUST_PROXY", isProd ? "true" : "false") === "true",
};
