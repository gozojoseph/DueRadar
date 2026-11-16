import type { FastifyInstance } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import { devices } from "@dueradar/db/schema";
import { requireUser } from "../auth/guard.js";
import type { Database } from "../db.js";
import type { Env } from "../env.js";
import { notFound, parseBody } from "../lib/errors.js";
import { recordAudit } from "../lib/audit.js";
import type { Clients } from "../lib/clients.js";
import { deviceInputSchema } from "../schemas.js";

export async function registerDeviceRoutes(
  app: FastifyInstance,
  deps: { env: Env; db: Database; clients: Clients },
): Promise<void> {
  const { env, db, clients } = deps;

  app.get("/api/v1/devices", async (request) => {
    const user = await requireUser(request, env);
    const rows = await db
      .select({
        id: devices.id,
        endpoint: devices.endpoint,
        platform: devices.platform,
        userAgent: devices.userAgent,
        lastSeenAt: devices.lastSeenAt,
        createdAt: devices.createdAt,
      })
      .from(devices)
      .where(and(eq(devices.userId, user.id), isNull(devices.disabledAt)))
      .orderBy(devices.lastSeenAt);
    return { devices: rows, pushConfigured: clients.push.configured };
  });

  app.post("/api/v1/devices", async (request, reply) => {
    const user = await requireUser(request, env);
    const input = parseBody(deviceInputSchema, request.body);

    const [device] = await db
      .insert(devices)
      .values({
        userId: user.id,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: input.userAgent ?? request.headers["user-agent"] ?? null,
        platform: input.platform ?? null,
        lastSeenAt: new Date(),
      })
      .onConflictDoUpdate({
        target: devices.endpoint,
        set: {
          userId: user.id,
          p256dh: input.keys.p256dh,
          auth: input.keys.auth,
          userAgent: input.userAgent ?? request.headers["user-agent"] ?? null,
          platform: input.platform ?? null,
          lastSeenAt: new Date(),
          disabledAt: null,
        },
      })
      .returning();

    await recordAudit(db, request, {
      userId: user.id,
      action: "device.registered",
      entityType: "device",
      entityId: device?.id,
      metadata: { platform: input.platform ?? null },
    });
    return reply.code(201).send({ device: { id: device?.id } });
  });

  app.delete("/api/v1/devices/:id", async (request, reply) => {
    const user = await requireUser(request, env);
    const { id } = request.params as { id: string };
    const [disabled] = await db
      .update(devices)
      .set({ disabledAt: new Date() })
      .where(and(eq(devices.id, id), eq(devices.userId, user.id)))
      .returning({ id: devices.id });
    if (!disabled) throw notFound("Device not found.");
    await recordAudit(db, request, {
      userId: user.id,
      action: "device.removed",
      entityType: "device",
      entityId: id,
    });
    return reply.code(204).send();
  });

  app.post(
    "/api/v1/devices/test",
    { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } },
    async (request) => {
      const user = await requireUser(request, env);
      const rows = await db
        .select()
        .from(devices)
        .where(and(eq(devices.userId, user.id), isNull(devices.disabledAt)));

      if (rows.length === 0) {
        return { sent: 0, failed: 0, message: "No push-enabled devices yet." };
      }

      let sent = 0;
      let failed = 0;
      for (const device of rows) {
        const result = await clients.push.send(
          { endpoint: device.endpoint, p256dh: device.p256dh, auth: device.auth },
          {
            title: "DueRadar test notification",
            body: "Push notifications are working on this device.",
            url: `${env.APP_ORIGIN}/settings`,
            tag: "dueradar-test",
          },
        );
        if (result.ok) sent += 1;
        else {
          failed += 1;
          if (result.gone) {
            await db
              .update(devices)
              .set({ disabledAt: new Date() })
              .where(eq(devices.id, device.id));
          }
        }
      }

      await recordAudit(db, request, {
        userId: user.id,
        action: "device.test_push",
        metadata: { sent, failed },
      });
      return { sent, failed };
    },
  );
}
