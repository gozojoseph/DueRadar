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
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  APP_ORIGIN: z.string().min(1).default("http://localhost:5173"),
  SUPPORT_EMAIL: z.string().default("support@dueradar.cloud"),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("DueRadar <reminders@dueradar.cloud>"),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default("mailto:support@dueradar.cloud"),
  GMAIL_OAUTH_CLIENT_ID: z.string().optional(),
  GMAIL_OAUTH_CLIENT_SECRET: z.string().optional(),
  PROVIDER_TOKEN_ENCRYPTION_KEY: z.string().optional(),
  GMAIL_POLL_INTERVAL_MINUTES: z.coerce.number().int().min(5).max(720).default(30),
  RUN_MIGRATIONS: z.string().optional(),
  POLL_INTERVAL_MS: z.coerce.number().int().min(5_000).max(300_000).default(30_000),
  MAINTENANCE_INTERVAL_HOURS: z.coerce.number().min(1).max(48).default(6),
});

export type WorkerEnv = z.infer<typeof EnvSchema>;

export function loadWorkerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const messages = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid worker environment:\n${messages.join("\n")}`);
  }
  return result.data;
}
