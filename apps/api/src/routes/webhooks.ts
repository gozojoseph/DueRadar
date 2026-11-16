import type { FastifyInstance } from "fastify";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { webhookEvents } from "@dueradar/db/schema";
import type { Database } from "../db.js";
import type { Env } from "../env.js";

interface SvixHeaders {
  id: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
}

function verifySvixSignature(
  headers: SvixHeaders,
  rawBody: Buffer,
  secret: string,
): { ok: boolean; reason?: string } {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return { ok: false, reason: "missing signature headers" };

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) return { ok: false, reason: "invalid timestamp" };
  const skew = Math.abs(Date.now() / 1000 - timestampSeconds);
  if (skew > 300) return { ok: false, reason: "timestamp outside tolerance" };

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signed = Buffer.concat([
    Buffer.from(`${id}.${timestamp}.`),
    rawBody,
  ]);
  const expected = createHmac("sha256", key).update(signed).digest();

  const candidates = signature
    .split(" ")
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith("v1,"))
    .map((entry) => entry.slice(3));

  for (const candidate of candidates) {
    const decoded = Buffer.from(candidate, "base64");
    if (decoded.length === expected.length && timingSafeEqual(decoded, expected)) {
      return { ok: true };
    }
  }
  return { ok: false, reason: "signature mismatch" };
}

/**
 * Resend receiving webhook. Only metadata is accepted here and stored with a
 * payload hash. Phase 2 fetches the message body through the authenticated
 * Resend API, strips HTML, and never loads remote images or links.
 */
export async function registerWebhookRoutes(
  app: FastifyInstance,
  deps: { env: Env; db: Database },
): Promise<void> {
  const { env, db } = deps;

  await app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", { parseAs: "buffer" }, (_request, body, done) => {
      done(null, body);
    });

    scope.post(
      "/api/webhooks/resend",
      { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
      async (request, reply) => {
        if (!env.RESEND_WEBHOOK_SECRET) {
          if (env.NODE_ENV === "production") {
            return reply.code(503).send({
              error: { code: "webhook_not_configured", message: "Receiving webhook is not configured." },
            });
          }
          request.log.warn("RESEND_WEBHOOK_SECRET not set; accepting webhook without signature check in development");
        }

        const rawBody = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
        if (rawBody.length === 0) {
          return reply.code(400).send({
            error: { code: "empty_body", message: "Missing webhook body." },
          });
        }

        if (env.RESEND_WEBHOOK_SECRET) {
          const check = verifySvixSignature(
            {
              id: request.headers["svix-id"] as string | undefined,
              timestamp: request.headers["svix-timestamp"] as string | undefined,
              signature: request.headers["svix-signature"] as string | undefined,
            },
            rawBody,
            env.RESEND_WEBHOOK_SECRET,
          );
          if (!check.ok) {
            request.log.warn({ reason: check.reason }, "Rejected Resend webhook signature");
            return reply.code(401).send({
              error: { code: "invalid_signature", message: "Webhook signature verification failed." },
            });
          }
        }

        const event = JSON.parse(rawBody.toString("utf8")) as {
          type?: string;
          data?: { email_id?: string; from?: string; to?: string[]; subject?: string };
        };

        const externalId =
          (request.headers["svix-id"] as string | undefined) ??
          event.data?.email_id ??
          createHash("sha256").update(rawBody).digest("hex");

        const [stored] = await db
          .insert(webhookEvents)
          .values({
            provider: "resend",
            externalId,
            payloadHash: createHash("sha256").update(rawBody).digest("hex"),
            status: "received",
          })
          .onConflictDoNothing()
          .returning({ id: webhookEvents.id });

        if (!stored) {
          return reply.code(200).send({ ok: true, duplicate: true });
        }

        request.log.info(
          {
            eventId: stored.id,
            type: event.type ?? "unknown",
            emailId: event.data?.email_id ?? null,
            to: event.data?.to ?? null,
          },
          "Resend webhook stored",
        );

        return reply.code(200).send({ ok: true });
      },
    );
  });
}
