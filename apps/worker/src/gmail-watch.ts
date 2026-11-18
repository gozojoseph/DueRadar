import { and, eq } from "drizzle-orm";
import { profiles, providerConnections } from "@dueradar/db/schema";
import { syncGmailConnection, ProviderError, GMAIL_PROVIDER } from "@dueradar/providers";
import type { PushClient } from "@dueradar/push";
import type { Database } from "@dueradar/db";

export interface GmailWatchDeps {
  db: Database;
  push: PushClient;
  appOrigin: string;
  clientId?: string;
  clientSecret?: string;
  encryptionKey?: string;
  intervalMs: number;
  log: (level: "info" | "warn" | "error", message: string, fields?: Record<string, unknown>) => void;
}

export interface GmailWatchResult {
  checked: number;
  imported: number;
  detected: number;
  errors: number;
}

function stringFromMetadata(
  metadata: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = metadata?.[key];
  return typeof value === "string" ? value : null;
}

/**
 * Polls the Gmail mailbox of every connected Plus user on a slow cadence,
 * running the exact same sync the manual "Scan now" button runs. New
 * billing-related messages become review suggestions plus an in-app alert
 * and a push notification.
 */
export async function pollWatchedGmail(deps: GmailWatchDeps): Promise<GmailWatchResult> {
  const { db, log } = deps;
  const result: GmailWatchResult = { checked: 0, imported: 0, detected: 0, errors: 0 };

  const configReady = Boolean(
    deps.clientId && deps.clientSecret && deps.encryptionKey,
  );
  if (!configReady) return result;

  const rows = await db
    .select({
      connection: providerConnections,
      planTier: profiles.planTier,
      suspendedAt: profiles.suspendedAt,
    })
    .from(providerConnections)
    .innerJoin(profiles, eq(profiles.userId, providerConnections.userId))
    .where(and(eq(providerConnections.provider, GMAIL_PROVIDER), eq(providerConnections.status, "active")));

  for (const row of rows) {
    if (row.planTier !== "plus" || row.suspendedAt) continue;

    // Manual syncs also stamp lastSyncedAt, so a recent scan of either kind
    // counts as fresh and the poller skips it.
    const lastSyncedAt = stringFromMetadata(row.connection.metadata ?? null, "lastSyncedAt");
    if (
      lastSyncedAt &&
      Date.now() - new Date(lastSyncedAt).getTime() < deps.intervalMs
    ) {
      continue;
    }

    result.checked += 1;
    try {
      const sync = await syncGmailConnection(
        {
          db,
          userId: row.connection.userId,
          config: {
            clientId: deps.clientId as string,
            clientSecret: deps.clientSecret as string,
          },
          encryptionKey: Buffer.from(deps.encryptionKey as string, "base64"),
          appOrigin: deps.appOrigin,
          push: deps.push,
        },
        { useCursor: false },
      );
      result.imported += sync.imported;
      result.detected += sync.detected;
      if (sync.imported > 0) {
        log("info", "Gmail watch imported messages", {
          userId: row.connection.userId,
          imported: sync.imported,
          detected: sync.detected,
        });
      }
    } catch (error) {
      result.errors += 1;
      if (error instanceof ProviderError) {
        log("warn", "Gmail watch sync failed", {
          userId: row.connection.userId,
          statusCode: error.statusCode,
          code: error.code,
          error: error.message,
        });
      } else {
        log("error", "Gmail watch sync threw", {
          userId: row.connection.userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return result;
}
