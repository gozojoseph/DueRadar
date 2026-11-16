import { and, eq, isNull } from "drizzle-orm";
import {
  billingOccurrences,
  devices,
  notifications,
  profiles,
  subscriptions,
} from "@dueradar/db/schema";
import { formatDate, formatMoney } from "@dueradar/domain";
import type { EmailClient } from "@dueradar/email";
import { buildReminderPush, type PushClient } from "@dueradar/push";
import type { Database } from "@dueradar/db";
import type { ClaimedJob } from "./queue.js";
import { recordDelivery } from "./queue.js";

export interface DeliveryDeps {
  db: Database;
  email: EmailClient;
  push: PushClient;
  appOrigin: string;
  supportEmail: string;
}

export type DeliveryOutcome =
  | { status: "sent" }
  | { status: "skipped"; reason: string }
  | { status: "canceled"; reason: string }
  | { status: "failed"; error: string };

function whenLabel(daysBefore: number): string {
  if (daysBefore === 0) return "today";
  if (daysBefore === 1) return "tomorrow";
  return `in ${daysBefore} days`;
}

/**
 * Delivers one claimed reminder. Cancellation and configuration problems are
 * terminal outcomes; transport errors are returned as failed so the queue can
 * retry with backoff.
 */
export async function deliverReminder(
  deps: DeliveryDeps,
  job: ClaimedJob,
): Promise<DeliveryOutcome> {
  const { db, email, push, appOrigin, supportEmail } = deps;

  const [row] = await db
    .select({
      occurrence: billingOccurrences,
      subscription: subscriptions,
      profile: profiles,
    })
    .from(billingOccurrences)
    .innerJoin(subscriptions, eq(subscriptions.id, billingOccurrences.subscriptionId))
    .innerJoin(profiles, eq(profiles.userId, billingOccurrences.userId))
    .where(
      and(
        eq(billingOccurrences.id, job.occurrenceId),
        eq(billingOccurrences.userId, job.userId),
      ),
    )
    .limit(1);

  if (!row) {
    return { status: "canceled", reason: "Occurrence no longer exists" };
  }

  const { occurrence, subscription, profile } = row;
  if (occurrence.status !== "pending") {
    return { status: "canceled", reason: `Occurrence is ${occurrence.status}` };
  }
  if (subscription.status !== "active") {
    return { status: "canceled", reason: `Subscription is ${subscription.status}` };
  }

  const isTrial = subscription.kind === "trial";
  const when = whenLabel(job.offsetDays);
  const dueLabel = formatDate(occurrence.dueDate, profile.locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const amountLabel = formatMoney(occurrence.amountMinor, occurrence.currency, profile.locale);
  const itemPath = `/subscriptions/${subscription.id}`;

  if (job.channel === "in_app") {
    await db.insert(notifications).values({
      userId: job.userId,
      kind: isTrial ? "trial_ending" : "payment_due",
      title: isTrial
        ? `${subscription.name} trial ends ${when}`
        : `${subscription.name} is due ${when}`,
      body: isTrial
        ? `Your free trial ends ${dueLabel}. Cancel before then if you do not want to be charged.`
        : `${dueLabel} · ${amountLabel}. Open DueRadar to review or mark it paid.`,
      entityType: "occurrence",
      entityId: occurrence.id,
    });
    await recordDelivery(db, {
      jobId: job.id,
      channel: "in_app",
      provider: "internal",
      status: "sent",
    });
    return { status: "sent" };
  }

  if (job.channel === "email") {
    if (!email.configured) {
      await recordDelivery(db, {
        jobId: job.id,
        channel: "email",
        provider: "resend",
        status: "skipped",
        error: "Email provider not configured",
      });
      return { status: "skipped", reason: "Email provider not configured" };
    }
    if (!profile.email) {
      await recordDelivery(db, {
        jobId: job.id,
        channel: "email",
        provider: "resend",
        status: "skipped",
        error: "Profile has no email address",
      });
      return { status: "skipped", reason: "Profile has no email address" };
    }

    const result = await email.sendReminder(
      {
        to: profile.email,
        idempotencyKey: `reminder:${job.dedupeKey}`,
        replyTo: supportEmail,
      },
      {
        toName: profile.displayName,
        itemName: subscription.name,
        itemKind: subscription.kind,
        dueLabel,
        amountLabel,
        daysBefore: job.offsetDays,
        isTrial,
        appOrigin,
        supportEmail,
        itemPath,
      },
    );

    await recordDelivery(db, {
      jobId: job.id,
      channel: "email",
      provider: "resend",
      status: result.ok ? "sent" : "failed",
      providerMessageId: result.id ?? null,
      error: result.ok ? null : result.error ?? "Unknown email error",
    });

    if (!result.ok) {
      return { status: "failed", error: result.error ?? "Email send failed" };
    }
    return { status: "sent" };
  }

  // Push
  if (!push.configured) {
    await recordDelivery(db, {
      jobId: job.id,
      channel: "push",
      provider: "web-push",
      status: "skipped",
      error: "Push is not configured",
    });
    return { status: "skipped", reason: "Push is not configured" };
  }

  const activeDevices = await db
    .select()
    .from(devices)
    .where(and(eq(devices.userId, job.userId), isNull(devices.disabledAt)));

  if (activeDevices.length === 0) {
    await recordDelivery(db, {
      jobId: job.id,
      channel: "push",
      provider: "web-push",
      status: "skipped",
      error: "No active devices",
    });
    return { status: "skipped", reason: "No active devices" };
  }

  const payload = buildReminderPush({ isTrial, daysBefore: job.offsetDays, appOrigin });
  let sent = 0;
  let lastError: string | null = null;

  for (const device of activeDevices) {
    const result = await push.send(
      { endpoint: device.endpoint, p256dh: device.p256dh, auth: device.auth },
      payload,
    );
    if (result.ok) {
      sent += 1;
      await recordDelivery(db, {
        jobId: job.id,
        channel: "push",
        provider: "web-push",
        status: "sent",
      });
    } else {
      lastError = result.error ?? "Push send failed";
      await recordDelivery(db, {
        jobId: job.id,
        channel: "push",
        provider: "web-push",
        status: result.skipped ? "skipped" : "failed",
        error: lastError,
      });
      if (result.gone) {
        await db
          .update(devices)
          .set({ disabledAt: new Date() })
          .where(eq(devices.id, device.id));
      }
    }
  }

  if (sent > 0) return { status: "sent" };
  return { status: "failed", error: lastError ?? "No push delivery succeeded" };
}
