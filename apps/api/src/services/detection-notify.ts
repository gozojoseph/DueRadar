import type { Database } from "../db.js";
import type { Env } from "../env.js";
import { createClients } from "../lib/clients.js";
import {
  buildDetectionNotification,
  createDetectionNotifierCore,
  type DetectionNotificationCopy,
  type DetectionNotificationInput,
} from "@dueradar/providers";

export {
  buildDetectionNotification,
  type DetectionNotificationCopy,
  type DetectionNotificationInput,
};

/**
 * API wrapper: builds the push client from env, then delegates to the shared
 * package implementation (the worker builds its own push client directly).
 */
export function createDetectionNotifier(db: Database, userId: string, env: Env) {
  const { push } = createClients(env);
  return createDetectionNotifierCore({
    db,
    userId,
    push,
    appOrigin: env.APP_ORIGIN,
  });
}

export type DetectionNotifier = ReturnType<typeof createDetectionNotifier>;
