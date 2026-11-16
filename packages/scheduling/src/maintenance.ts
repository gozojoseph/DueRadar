import { and, isNotNull, lt, or } from "drizzle-orm";
import { auditEvents, deliveryAttempts, imports, webhookEvents } from "@dueradar/db/schema";
import type { Database } from "@dueradar/db";

export interface MaintenanceResult {
  expiredImports: number;
  purgedWebhooks: number;
  purgedDeliveryAttempts: number;
  purgedAudit: number;
}

const DAY_MS = 86_400_000;

export interface RetentionCutoffs {
  webhookAt: Date;
  deliveryAttemptAt: Date;
  auditAt: Date;
}

/**
 * Pure boundary calculation so the retention promises are testable without a
 * database. Raw imports use a per-row `rawRetentionUntil` (72 hours) instead.
 */
export function retentionCutoffs(now: Date): RetentionCutoffs {
  return {
    webhookAt: new Date(now.getTime() - 30 * DAY_MS),
    deliveryAttemptAt: new Date(now.getTime() - 365 * DAY_MS),
    auditAt: new Date(now.getTime() - 365 * DAY_MS),
  };
}

/**
 * Enforces the retention promises in the privacy notice:
 * - raw imported text is erased after 72 hours;
 * - webhook dedupe records are kept 30 days;
 * - delivery attempts and audit records are kept 12 months, including the
 *   non-identifying account-deletion row.
 */
export async function runRetention(db: Database, now = new Date()): Promise<MaintenanceResult> {
  const cutoffs = retentionCutoffs(now);

  const expired = await db
    .update(imports)
    .set({
      rawText: null,
      subject: null,
      fromAddress: null,
      status: "expired",
      processedAt: now,
    })
    .where(
      and(
        lt(imports.rawRetentionUntil, now),
        or(
          isNotNull(imports.rawText),
          isNotNull(imports.subject),
          isNotNull(imports.fromAddress),
        ),
      ),
    )
    .returning({ id: imports.id });

  const oldWebhooks = await db
    .delete(webhookEvents)
    .where(lt(webhookEvents.receivedAt, cutoffs.webhookAt))
    .returning({ id: webhookEvents.id });

  const oldDeliveryAttempts = await db
    .delete(deliveryAttempts)
    .where(lt(deliveryAttempts.attemptedAt, cutoffs.deliveryAttemptAt))
    .returning({ id: deliveryAttempts.id });

  const oldAudit = await db
    .delete(auditEvents)
    .where(lt(auditEvents.createdAt, cutoffs.auditAt))
    .returning({ id: auditEvents.id });

  return {
    expiredImports: expired.length,
    purgedWebhooks: oldWebhooks.length,
    purgedDeliveryAttempts: oldDeliveryAttempts.length,
    purgedAudit: oldAudit.length,
  };
}
