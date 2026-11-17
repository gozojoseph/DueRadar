import { and, eq, isNull } from "drizzle-orm";
import { devices, notifications } from "@dueradar/db/schema";
import type { PushPayload } from "@dueradar/push";
import type { Database } from "../db.js";
import type { Env } from "../env.js";
import { createClients } from "../lib/clients.js";
import type { SuggestionDto } from "./detection.js";

export interface DetectionNotificationInput {
  /** Human phrase for where the detections came from, e.g. "your Gmail". */
  sourceLabel: string;
  suggestions: SuggestionDto[];
  /**
   * Also push to the user's devices. Intended for passive sources — a Gmail
   * sync lands while the user is not looking at the app — never for imports
   * the user just triggered themselves.
   */
  withPush?: boolean;
}

function summaryText(suggestions: SuggestionDto[]): string {
  const counts = { subscription: 0, bill: 0, trial: 0, other: 0 };
  for (const suggestion of suggestions) {
    const kind = suggestion.draft.kind;
    if (kind === "subscription" || kind === "bill" || kind === "trial") {
      counts[kind] += 1;
    } else {
      counts.other += 1;
    }
  }
  const parts: string[] = [];
  if (counts.subscription > 0) {
    parts.push(
      counts.subscription === 1
        ? "a subscription charge"
        : `${counts.subscription} subscription charges`,
    );
  }
  if (counts.bill > 0) {
    parts.push(counts.bill === 1 ? "a bill" : `${counts.bill} bills`);
  }
  if (counts.trial > 0) {
    parts.push(counts.trial === 1 ? "a free trial" : `${counts.trial} free trials`);
  }
  if (counts.other > 0) {
    parts.push(
      counts.other === 1 ? "a recurring charge" : `${counts.other} recurring charges`,
    );
  }
  return parts.join(", ");
}

export interface DetectionNotificationCopy {
  title: string;
  body: string;
  pushTitle: string;
  pushBody: string;
}

/** Pure copy construction so the batching text stays testable. */
export function buildDetectionNotification(
  suggestions: SuggestionDto[],
  sourceLabel: string,
): DetectionNotificationCopy {
  const total = suggestions.length;
  const summary = summaryText(suggestions);
  return {
    title: total === 1 ? "1 new item to review" : `${total} new items to review`,
    body: `DueRadar detected ${summary} in ${sourceLabel}. Open Review to check ${total === 1 ? "it" : "them"}.`,
    pushTitle: "New items found in your Gmail",
    pushBody: `DueRadar detected ${summary}. Tap to review before tracking.`,
  };
}

/**
 * One batched notification per import or sync run that produced new
 * suggestions — never one per detection. Failures are swallowed and logged:
 * an undelivered nudge must never fail the import that created the data.
 */
export function createDetectionNotifier(db: Database, userId: string, env: Env) {
  const { push } = createClients(env);

  return {
    async notify(input: DetectionNotificationInput): Promise<void> {
      const { suggestions, sourceLabel, withPush = false } = input;
      const total = suggestions.length;
      if (total <= 0) return;

      const copy = buildDetectionNotification(suggestions, sourceLabel);

      try {
        await db.insert(notifications).values({
          userId,
          kind: "detection_pending",
          title: copy.title,
          body: copy.body,
          entityType: "detection_batch",
          entityId: null,
        });
      } catch (error) {
        console.error(
          "[detections] in-app notification failed:",
          error instanceof Error ? error.message : "unknown error",
        );
      }

      if (!withPush || !push.configured) return;

      try {
        const deviceRows = await db
          .select()
          .from(devices)
          .where(and(eq(devices.userId, userId), isNull(devices.disabledAt)));
        if (deviceRows.length === 0) return;

        const payload: PushPayload = {
          title: copy.pushTitle,
          body: copy.pushBody,
          url: `${env.APP_ORIGIN}/detections`,
          tag: "dueradar-detections",
        };
        for (const device of deviceRows) {
          const result = await push.send(
            { endpoint: device.endpoint, p256dh: device.p256dh, auth: device.auth },
            payload,
          );
          if (!result.ok && result.gone) {
            await db
              .update(devices)
              .set({ disabledAt: new Date() })
              .where(eq(devices.id, device.id));
          }
        }
      } catch (error) {
        console.error(
          "[detections] push notification failed:",
          error instanceof Error ? error.message : "unknown error",
        );
      }
    },
  };
}

export type DetectionNotifier = ReturnType<typeof createDetectionNotifier>;
