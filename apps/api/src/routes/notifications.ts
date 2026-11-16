import type { FastifyInstance } from "fastify";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { notifications } from "@dueradar/db/schema";
import { requireUser } from "../auth/guard.js";
import type { Database } from "../db.js";
import type { Env } from "../env.js";
import { parseBody } from "../lib/errors.js";
import { notificationReadSchema } from "../schemas.js";

export async function registerNotificationRoutes(
  app: FastifyInstance,
  deps: { env: Env; db: Database },
): Promise<void> {
  const { env, db } = deps;

  app.get("/api/v1/notifications", async (request) => {
    const user = await requireUser(request, env);
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, user.id))
      .orderBy(desc(notifications.createdAt))
      .limit(50);

    const [unread] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));

    return { notifications: rows, unread: unread?.count ?? 0 };
  });

  app.post("/api/v1/notifications/read", async (request) => {
    const user = await requireUser(request, env);
    const input = parseBody(notificationReadSchema, request.body ?? {});
    if (input.all) {
      await db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));
    } else if (input.ids && input.ids.length > 0) {
      await db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(and(eq(notifications.userId, user.id), inArray(notifications.id, input.ids)));
    }
    return { ok: true };
  });
}
