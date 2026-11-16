import { createDatabase, runMigrations } from "@dueradar/db";
import { createEmailClient, type EmailClient } from "@dueradar/email";
import { createPushClient, type PushClient } from "@dueradar/push";
import {
  claimJobs,
  deliverReminder,
  markJobCanceled,
  markJobFailed,
  markJobSent,
  markJobSkipped,
  reclaimStaleJobs,
  refreshAllReminders,
  runRetention,
  type DeliveryDeps,
} from "@dueradar/scheduling";
import { loadWorkerEnv } from "./env.js";

const env = loadWorkerEnv();

const { pool, db } = createDatabase(env.DATABASE_URL, {
  max: 4,
  applicationName: "dueradar-worker",
});

const email: EmailClient = createEmailClient({
  apiKey: env.RESEND_API_KEY,
  from: env.EMAIL_FROM,
  replyTo: env.SUPPORT_EMAIL,
  appOrigin: env.APP_ORIGIN,
  supportEmail: env.SUPPORT_EMAIL,
});

const push: PushClient = createPushClient({
  publicKey: env.VAPID_PUBLIC_KEY,
  privateKey: env.VAPID_PRIVATE_KEY,
  subject: env.VAPID_SUBJECT,
});

const deps: DeliveryDeps = {
  db,
  email,
  push,
  appOrigin: env.APP_ORIGIN,
  supportEmail: env.SUPPORT_EMAIL,
};

let running = true;
let maintenanceDueAt = Date.now();

function log(level: "info" | "warn" | "error", message: string, meta?: unknown): void {
  const line = { time: new Date().toISOString(), level, service: "dueradar-worker", message, meta };
  const output = JSON.stringify(line);
  if (level === "error") console.error(output);
  else if (level === "warn") console.warn(output);
  else console.log(output);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processBatch(batchSize: number): Promise<number> {
  const reclaimed = await reclaimStaleJobs(db);
  if (reclaimed > 0) log("warn", "Reclaimed stale reminder jobs", { reclaimed });

  const jobs = await claimJobs(db, batchSize);
  for (const job of jobs) {
    if (!running) break;
    try {
      const outcome = await deliverReminder(deps, job);
      if (outcome.status === "sent") {
        await markJobSent(db, job.id);
        log("info", "Reminder delivered", {
          jobId: job.id,
          channel: job.channel,
          occurrenceId: job.occurrenceId,
          offsetDays: job.offsetDays,
        });
      } else if (outcome.status === "canceled") {
        await markJobCanceled(db, job.id, outcome.reason);
      } else if (outcome.status === "skipped") {
        await markJobSkipped(db, job.id, outcome.reason);
        log("warn", "Reminder skipped", {
          jobId: job.id,
          channel: job.channel,
          reason: outcome.reason,
        });
      } else {
        const result = await markJobFailed(db, job.id, job.attempts, outcome.error);
        log("error", "Reminder delivery failed", {
          jobId: job.id,
          channel: job.channel,
          attempts: job.attempts,
          retry: result === "retry",
          error: outcome.error,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const result = await markJobFailed(db, job.id, job.attempts, message);
      log("error", "Reminder processing threw", {
        jobId: job.id,
        channel: job.channel,
        retry: result === "retry",
        error: message,
      });
    }
  }

  return jobs.length;
}

async function maintenance(): Promise<void> {
  const started = Date.now();
  try {
    const [refresh, retention] = await Promise.all([refreshAllReminders(db), runRetention(db)]);
    log("info", "Maintenance complete", {
      subscriptions: refresh.subscriptions,
      expiredImports: retention.expiredImports,
      purgedWebhooks: retention.purgedWebhooks,
      purgedDeliveryAttempts: retention.purgedDeliveryAttempts,
      purgedAudit: retention.purgedAudit,
      durationMs: Date.now() - started,
    });
  } catch (error) {
    log("error", "Maintenance failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  maintenanceDueAt = Date.now() + env.MAINTENANCE_INTERVAL_HOURS * 3_600_000;
}

async function shutdown(signal: string): Promise<void> {
  log("info", "Shutting down", { signal });
  running = false;
  const timer = setTimeout(() => process.exit(1), 15_000);
  timer.unref();
  try {
    await pool.end();
    process.exit(0);
  } catch {
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  log("error", "Unhandled rejection", {
    error: reason instanceof Error ? reason.message : String(reason),
  });
});

if (env.RUN_MIGRATIONS !== "false") {
  try {
    await runMigrations(db, { pool, log: (message) => log("info", message) });
  } catch (error) {
    log("error", "Migration failed; worker will not start", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

log("info", "Worker started", {
  environment: env.NODE_ENV,
  pollIntervalMs: env.POLL_INTERVAL_MS,
  emailConfigured: email.configured,
  pushConfigured: push.configured,
});

await maintenance();

while (running) {
  let processed = 0;
  try {
    processed = await processBatch(25);
  } catch (error) {
    log("error", "Job batch failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (Date.now() >= maintenanceDueAt) {
    await maintenance();
  }

  if (!running) break;
  await sleep(processed > 0 ? 500 : env.POLL_INTERVAL_MS);
}

log("info", "Worker stopped");
process.exit(0);
