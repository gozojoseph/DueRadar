import { and, eq, gte, inArray, lte, notInArray, sql } from "drizzle-orm";
import {
  billingOccurrences,
  profiles,
  reminderJobs,
  subscriptions,
} from "@dueradar/db/schema";
import type { BillingOccurrence, Profile, Subscription } from "@dueradar/db/schema";
import {
  addDaysToDate,
  defaultReminderChannels,
  defaultReminderOffsets,
  planReminders,
  todayInTimeZone,
  zonedWallTimeToUtc,
  type ReminderChannel,
} from "@dueradar/domain";
import type { Database, DatabaseExecutor } from "@dueradar/db";

export interface ReminderJobDraft {
  userId: string;
  subscriptionId: string;
  occurrenceId: string;
  channel: ReminderChannel;
  offsetDays: number;
  fireAt: Date;
  dedupeKey: string;
}

async function replaceOccurrenceJobs(
  db: DatabaseExecutor,
  occurrenceId: string,
  drafts: ReminderJobDraft[],
): Promise<void> {
  if (drafts.length > 0) {
    await db
      .insert(reminderJobs)
      .values(drafts)
      .onConflictDoUpdate({
        target: reminderJobs.dedupeKey,
        set: {
          fireAt: sql`excluded.fire_at`,
          status: "scheduled",
          updatedAt: new Date(),
          lockedAt: null,
          lastError: null,
        },
        setWhere: sql`${reminderJobs.status} <> 'sent'`,
      });
  }

  const keys = drafts.map((draft) => draft.dedupeKey);
  await db
    .update(reminderJobs)
    .set({ status: "canceled", updatedAt: new Date() })
    .where(
      and(
        eq(reminderJobs.occurrenceId, occurrenceId),
        inArray(reminderJobs.status, ["scheduled", "failed"]),
        keys.length > 0 ? notInArray(reminderJobs.dedupeKey, keys) : undefined,
      ),
    );
}

export async function cancelOccurrenceReminders(
  db: DatabaseExecutor,
  occurrenceId: string,
): Promise<void> {
  await db
    .update(reminderJobs)
    .set({ status: "canceled", updatedAt: new Date() })
    .where(
      and(
        eq(reminderJobs.occurrenceId, occurrenceId),
        inArray(reminderJobs.status, ["scheduled", "failed"]),
      ),
    );
}

export async function cancelSubscriptionReminders(
  db: DatabaseExecutor,
  subscriptionId: string,
): Promise<void> {
  await db
    .update(reminderJobs)
    .set({ status: "canceled", updatedAt: new Date() })
    .where(
      and(
        eq(reminderJobs.subscriptionId, subscriptionId),
        inArray(reminderJobs.status, ["scheduled", "failed"]),
      ),
    );
}

function buildOccurrenceDrafts(
  occurrence: BillingOccurrence,
  subscription: Subscription,
  profile: Profile,
  now: Date,
): ReminderJobDraft[] {
  const channels: ReminderChannel[] =
    subscription.reminderChannels ?? defaultReminderChannels(profile);
  const base = {
    userId: occurrence.userId,
    subscriptionId: subscription.id,
    occurrenceId: occurrence.id,
  };

  if (occurrence.snoozedUntil) {
    const fireAt = zonedWallTimeToUtc(
      occurrence.snoozedUntil,
      profile.reminderTime,
      profile.timezone,
    );
    if (fireAt.getTime() <= now.getTime()) return [];
    return channels.map((channel) => ({
      ...base,
      channel,
      offsetDays: 0,
      fireAt,
      dedupeKey: `${occurrence.id}:snooze:${occurrence.snoozedUntil}:${channel}`,
    }));
  }

  const offsets = subscription.reminderOffsets ?? defaultReminderOffsets(subscription.kind);
  const plans = planReminders({
    occurrenceId: occurrence.id,
    dueDate: occurrence.dueDate,
    offsets,
    channels,
    profile: {
      timeZone: profile.timezone,
      reminderTime: profile.reminderTime,
      quietHoursStart: profile.quietHoursStart,
      quietHoursEnd: profile.quietHoursEnd,
    },
    now,
  });

  return plans.map((plan) => ({
    ...base,
    channel: plan.channel,
    offsetDays: plan.offsetDays,
    fireAt: plan.fireAt,
    dedupeKey: plan.dedupeKey,
  }));
}

/** Recomputes every reminder for a single occurrence. */
export async function planOccurrenceReminders(
  db: DatabaseExecutor,
  occurrenceId: string,
  now = new Date(),
): Promise<void> {
  const [row] = await db
    .select({ occurrence: billingOccurrences, subscription: subscriptions, profile: profiles })
    .from(billingOccurrences)
    .innerJoin(subscriptions, eq(subscriptions.id, billingOccurrences.subscriptionId))
    .innerJoin(profiles, eq(profiles.userId, billingOccurrences.userId))
    .where(eq(billingOccurrences.id, occurrenceId))
    .limit(1);

  if (!row) return;

  if (row.occurrence.status !== "pending" || row.subscription.status !== "active") {
    await cancelOccurrenceReminders(db, occurrenceId);
    return;
  }

  const drafts = buildOccurrenceDrafts(row.occurrence, row.subscription, row.profile, now);
  await replaceOccurrenceJobs(db, occurrenceId, drafts);
}

/** Recomputes reminders for every pending occurrence of one subscription. */
export async function syncSubscriptionReminders(
  db: DatabaseExecutor,
  userId: string,
  subscriptionId: string,
  now = new Date(),
): Promise<void> {
  const [row] = await db
    .select({ subscription: subscriptions, profile: profiles })
    .from(subscriptions)
    .innerJoin(profiles, eq(profiles.userId, subscriptions.userId))
    .where(and(eq(subscriptions.id, subscriptionId), eq(subscriptions.userId, userId)))
    .limit(1);

  if (!row) return;

  if (row.subscription.status !== "active") {
    await cancelSubscriptionReminders(db, subscriptionId);
    return;
  }

  const today = todayInTimeZone(row.profile.timezone, now);
  const horizon = addDaysToDate(today, 75);
  const occurrences = await db
    .select()
    .from(billingOccurrences)
    .where(
      and(
        eq(billingOccurrences.subscriptionId, subscriptionId),
        eq(billingOccurrences.userId, userId),
        eq(billingOccurrences.status, "pending"),
        gte(billingOccurrences.dueDate, addDaysToDate(today, -1)),
        lte(billingOccurrences.dueDate, horizon),
      ),
    );

  for (const occurrence of occurrences) {
    const drafts = buildOccurrenceDrafts(occurrence, row.subscription, row.profile, now);
    await replaceOccurrenceJobs(db, occurrence.id, drafts);
  }
}

/** Full replan after reminder settings or time zone changes. */
export async function resyncUserReminders(db: Database, userId: string): Promise<void> {
  const rows = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, "active")));
  for (const row of rows) {
    await syncSubscriptionReminders(db, userId, row.id);
  }
}

/**
 * Rolling horizon maintenance. The API plans the next ~75 days whenever a
 * bill changes; this keeps the window moving as days pass so a weekly cron
 * never needs to know which subscriptions exist.
 */
export async function refreshAllReminders(
  db: Database,
  now = new Date(),
): Promise<{ subscriptions: number }> {
  const rows = await db
    .select({ id: subscriptions.id, userId: subscriptions.userId })
    .from(subscriptions)
    .where(eq(subscriptions.status, "active"));

  for (const row of rows) {
    await syncSubscriptionReminders(db, row.userId, row.id, now);
  }
  return { subscriptions: rows.length };
}
