import { and, isNotNull, lt, sql } from "drizzle-orm";
import { auditEvents, imports, webhookEvents } from "@dueradar/db/schema";
import type { Database } from "@dueradar/db";

export interface MaintenanceResult {
  expiredImports: number;
  purgedWebhooks: number;
  purgedAudit: number;
}

/**
 * Enforces the retention promises in the privacy notice:
 * - raw imported text is erased after 72 hours;
 * - webhook dedupe records are kept 30 days;
 * - audit records are kept 12 months (account deletion removes them sooner).
 */
export async function runRetention(db: Database, now = new Date()): Promise<MaintenanceResult> {
  const expired = await db
    .update(imports)
    .set({ rawText: null, status: "expired", processedAt: now })
    .where(and(isNotNull(imports.rawText), lt(imports.rawRetentionUntil, now)))
    .returning({ id: imports.id });

  const webhookCutoff = new Date(now.getTime() - 30 * 86_400_000);
  const oldWebhooks = await db
    .delete(webhookEvents)
    .where(lt(webhookEvents.receivedAt, webhookCutoff))
    .returning({ id: webhookEvents.id });

  const auditCutoff = new Date(now.getTime() - 365 * 86_400_000);
  const oldAudit = await db
    .delete(auditEvents)
    .where(and(lt(auditEvents.createdAt, auditCutoff), sql`${auditEvents.action} <> 'account.deleted'`))
    .returning({ id: auditEvents.id });

  return {
    expiredImports: expired.length,
    purgedWebhooks: oldWebhooks.length,
    purgedAudit: oldAudit.length,
  };
}
