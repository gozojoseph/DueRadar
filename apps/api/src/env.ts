import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

/**
 * Local development keeps one gitignored `.env.local` at the repository root.
 * Render injects real environment variables, so production never reads a file.
 * `process.loadEnvFile` leaves variables that are already set untouched, which
 * lets a shell or CI override the file.
 */
export function loadLocalEnvFile(
  cwd = process.cwd(),
  nodeEnv = process.env.NODE_ENV,
): string | null {
  if (nodeEnv === "production") return null;

  const explicit = process.env.ENV_FILE;
  const candidates = [
    ...(explicit ? [resolve(cwd, explicit)] : []),
    resolve(cwd, ".env.local"),
    resolve(cwd, "..", ".env.local"),
    resolve(cwd, "..", "..", ".env.local"),
  ];

  for (const file of candidates) {
    if (!existsSync(file)) continue;
    process.loadEnvFile(file);
    return file;
  }
  return null;
}

if (process.env.DUERADAR_SKIP_LOCAL_ENV !== "true") {
  loadLocalEnvFile();
}

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  APP_ORIGIN: z.string().min(1).default("http://localhost:5173"),
  NEON_AUTH_BASE_URL: z.string().min(1, "NEON_AUTH_BASE_URL is required"),
  NEON_AUTH_JWKS_URL: z.string().optional(),
  NEON_AUTH_ISSUER: z.string().optional(),
  NEON_AUTH_AUDIENCE: z.string().optional(),
  ADMIN_EMAILS: z.string().default("").transform((value, context) => {
    const emails = [
      ...new Set(
        value
          .split(",")
          .map((email) => email.trim().toLowerCase())
          .filter(Boolean),
      ),
    ];
    const invalid = emails.filter((email) => !z.email().safeParse(email).success);
    if (invalid.length > 0) {
      context.addIssue({
        code: "custom",
        message: `ADMIN_EMAILS contains invalid email address(es): ${invalid.join(", ")}`,
      });
    }
    return emails;
  }),
  COOKIE_SECURE: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  GMAIL_OAUTH_CLIENT_ID: z.string().optional(),
  GMAIL_OAUTH_CLIENT_SECRET: z.string().optional(),
  PROVIDER_TOKEN_ENCRYPTION_KEY: z.string().optional(),
  PAYSTACK_SECRET_KEY: z.string().optional(),
  YEBECK_SECRET_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("DueRadar <reminders@dueradar.cloud>"),
  SUPPORT_EMAIL: z.string().default("support@dueradar.cloud"),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default("mailto:support@dueradar.cloud"),
  RESEND_WEBHOOK_SECRET: z.string().optional(),
  /**
   * Domain that receives forwarded email, for example `inbound.dueradar.cloud`
   * or the account-managed `<id>.resend.app` domain. No scheme and no `@`.
   */
  INBOUND_EMAIL_DOMAIN: z
    .string()
    .trim()
    .toLowerCase()
    .max(253)
    .refine(
      (value) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(value),
      "Use a bare domain such as inbound.dueradar.cloud",
    )
    .optional(),
  /** Raw message text is erased after this many hours. Never more than 72. */
  DETECTION_RAW_RETENTION_HOURS: z.coerce.number().int().min(1).max(72).default(72),
  DETECTION_LLM_ENABLED: z.string().optional(),
  DETECTION_LLM_URL: z.string().url().optional(),
  DETECTION_LLM_API_KEY: z.string().optional(),
  DETECTION_LLM_MODEL: z.string().trim().max(120).optional(),
  DETECTION_LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30_000).default(8000),
  RUN_MIGRATIONS: z.string().optional(),
  SERVE_WEB: z.string().optional(),
  WEB_DIST: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function isInboundEmailConfigured(
  env: Pick<Env, "NODE_ENV" | "INBOUND_EMAIL_DOMAIN" | "RESEND_API_KEY" | "RESEND_WEBHOOK_SECRET">,
): boolean {
  return Boolean(
    env.INBOUND_EMAIL_DOMAIN &&
      env.RESEND_API_KEY &&
      (env.NODE_ENV !== "production" || env.RESEND_WEBHOOK_SECRET),
  );
}

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached && source === process.env) return cached;
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const messages = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid environment configuration:\n${messages.join("\n")}`);
  }
  const env = result.data;
  if (source === process.env) cached = env;
  return env;
}

export function isProduction(env: Env): boolean {
  return env.NODE_ENV === "production";
}

export function secureCookies(env: Env): boolean {
  if (env.COOKIE_SECURE === "true") return true;
  if (env.COOKIE_SECURE === "false") return false;
  return env.APP_ORIGIN.startsWith("https://");
}

export function llmDetectionEnabled(env: Env): boolean {
  return (
    env.DETECTION_LLM_ENABLED === "true" &&
    Boolean(env.DETECTION_LLM_URL && env.DETECTION_LLM_API_KEY && env.DETECTION_LLM_MODEL)
  );
}
