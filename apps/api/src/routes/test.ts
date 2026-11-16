import type { FastifyInstance } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import { devices } from "@dueradar/db/schema";
import { requireUser, userWithEmail } from "../auth/guard.js";
import type { Database } from "../db.js";
import type { Env } from "../env.js";
import { badRequest, parseBody } from "../lib/errors.js";
import type { Clients } from "../lib/clients.js";
import { ensureProfile } from "../services/profile.js";
import { testChannelSchema } from "../schemas.js";
import { recordAudit } from "../lib/audit.js";

export async function registerTestRoutes(
  app: FastifyInstance,
  deps: { env: Env; db: Database; clients: Clients },
): Promise<void> {
  const { env, db, clients } = deps;

  app.post(
    "/api/v1/test/email",
    { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } },
    async (request) => {
      const user = await userWithEmail(request, env, await requireUser(request, env));
      const profile = await ensureProfile(db, user);
      if (!profile.email) throw badRequest("Your account has no email address.");
      if (!clients.email.configured) {
        throw badRequest("Email is not configured on this environment yet.");
      }

      const result = await clients.email.sendTest({
        to: profile.email,
        idempotencyKey: `test-email:${user.id}:${Date.now()}`,
      });
      await recordAudit(db, request, {
        userId: user.id,
        action: "test.email",
        metadata: { ok: result.ok },
      });
      if (!result.ok) {
        throw badRequest(result.error ?? "The test email could not be sent.");
      }
      return { ok: true, message: `Test email sent to ${profile.email}.` };
    },
  );

  app.post(
    "/api/v1/test/push",
    { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } },
    async (request) => {
      const user = await requireUser(request, env);
      parseBody(testChannelSchema, request.body ?? { channel: "push" });
      if (!clients.push.configured) {
        throw badRequest("Push is not configured on this environment yet.");
      }

      const rows = await db
        .select()
        .from(devices)
        .where(and(eq(devices.userId, user.id), isNull(devices.disabledAt)));

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
        else failed += 1;
      }

      await recordAudit(db, request, {
        userId: user.id,
        action: "test.push",
        metadata: { sent, failed },
      });
      return { sent, failed };
    },
  );
}
