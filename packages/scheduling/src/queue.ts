import { sql } from "drizzle-orm";
import { deliveryAttempts } from "@dueradar/db/schema";
import type { ReminderChannel } from "@dueradar/db/schema";
import type { Database } from "@dueradar/db";

export interface ClaimedJob {
  id: string;
  userId: string;
  subscriptionId: string | null;
  occurrenceId: string;
  channel: ReminderChannel;
  offsetDays: number;
  fireAt: Date;
  attempts: number;
  dedupeKey: string;
}

interface RawJobRow {
  id: string;
  userId: string;
  subscriptionId: string | null;
  occurrenceId: string;
  channel: ReminderChannel;
  offsetDays: number;
  fireAt: Date | string;
  attempts: number;
  dedupeKey: string;
}

function rowToJob(row: RawJobRow): ClaimedJob {
  return { ...row, fireAt: row.fireAt instanceof Date ? row.fireAt : new Date(row.fireAt) };
}

function rowsOf(result: unknown): RawJobRow[] {
  return ((result as { rows?: RawJobRow[] }).rows ?? []) as RawJobRow[];
}

/** Returns expired leases to the queue, or fails them once retries are spent. */
export async function reclaimStaleJobs(db: Database, staleMinutes = 10): Promise<number> {
  const result = await db.execute(sql`
    update reminder_jobs
    set status = case when attempts >= 5 then 'failed' else 'scheduled' end,
        fire_at = case when attempts >= 5 then fire_at else now() end,
        locked_at = null,
        last_error = coalesce(last_error, 'worker lease expired'),
        updated_at = now()
    where status = 'processing'
      and locked_at is not null
      and locked_at < now() - (${staleMinutes} * interval '1 minute')
  `);
  return (result as unknown as { rowCount?: number }).rowCount ?? 0;
}

/**
 * Atomically claims due jobs with SKIP LOCKED so multiple workers can run
 * safely. `attempts` increments on claim, making crash loops visible.
 */
export async function claimJobs(db: Database, limit = 25): Promise<ClaimedJob[]> {
  const result = await db.execute(sql`
    with claimed as (
      select id
      from reminder_jobs
      where status = 'scheduled'
        and fire_at <= now()
      order by fire_at asc
      limit ${limit}
      for update skip locked
    )
    update reminder_jobs j
    set status = 'processing',
        locked_at = now(),
        attempts = j.attempts + 1,
        updated_at = now()
    from claimed
    where j.id = claimed.id
    returning
      j.id,
      j.user_id as "userId",
      j.subscription_id as "subscriptionId",
      j.occurrence_id as "occurrenceId",
      j.channel,
      j.offset_days as "offsetDays",
      j.fire_at as "fireAt",
      j.attempts,
      j.dedupe_key as "dedupeKey"
  `);
  return rowsOf(result).map(rowToJob);
}

export async function markJobSent(db: Database, jobId: string): Promise<void> {
  await db.execute(sql`
    update reminder_jobs
    set status = 'sent', sent_at = now(), locked_at = null, last_error = null, updated_at = now()
    where id = ${jobId}::uuid
  `);
}

export async function markJobCanceled(db: Database, jobId: string, reason: string): Promise<void> {
  await db.execute(sql`
    update reminder_jobs
    set status = 'canceled', locked_at = null, last_error = ${reason.slice(0, 500)}, updated_at = now()
    where id = ${jobId}::uuid
  `);
}

export async function markJobSkipped(db: Database, jobId: string, reason: string): Promise<void> {
  await db.execute(sql`
    update reminder_jobs
    set status = 'skipped', locked_at = null, last_error = ${reason.slice(0, 500)}, updated_at = now()
    where id = ${jobId}::uuid
  `);
}

/**
 * Retries with linear backoff (2, 4, 6, 8 minutes) until five attempts, then
 * surfaces the failure for an operator instead of retrying forever.
 */
export async function markJobFailed(
  db: Database,
  jobId: string,
  attempts: number,
  error: string,
  maxAttempts = 5,
): Promise<"retry" | "failed"> {
  const final = attempts >= maxAttempts;
  const backoffMinutes = Math.min(60, attempts * 2);
  await db.execute(sql`
    update reminder_jobs
    set status = ${final ? "failed" : "scheduled"},
        fire_at = case when ${final} then fire_at else now() + (${backoffMinutes} * interval '1 minute') end,
        locked_at = null,
        last_error = ${error.slice(0, 500)},
        updated_at = now()
    where id = ${jobId}::uuid
  `);
  return final ? "failed" : "retry";
}

export async function recordDelivery(
  db: Database,
  attempt: {
    jobId: string;
    channel: ReminderChannel;
    provider: string | null;
    status: "sent" | "failed" | "skipped";
    providerMessageId?: string | null;
    error?: string | null;
  },
): Promise<void> {
  await db.insert(deliveryAttempts).values({
    jobId: attempt.jobId,
    channel: attempt.channel,
    provider: attempt.provider,
    status: attempt.status,
    providerMessageId: attempt.providerMessageId ?? null,
    error: attempt.error?.slice(0, 1000) ?? null,
  });
}
