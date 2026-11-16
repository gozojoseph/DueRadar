import type { FastifyInstance } from "fastify";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { webhookEvents } from "@dueradar/db/schema";
import { redactSensitive } from "@dueradar/detection";
import type { Database } from "../db.js";
import type { Env } from "../env.js";
import {
  InboundEmailError,
  parseResendEvent,
  processInboundEmail,
  type ResendReceivedEvent,
} from "../services/inbound-email.js";
import { createLlmEnhancer } from "../services/llm-detect.js";

interface SvixHeaders {
  id: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
}

export function verifySvixSignature(
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
  const signed = Buffer.concat([Buffer.from(`${id}.${timestamp}.`), rawBody]);
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

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Processing failed";
  return redactSensitive(message).slice(0, 300);
}

/**
 * Resend receiving webhook. The signed payload only carries metadata; the body
 * is fetched through the authenticated API, redacted, and parsed. Failed
 * deliveries are retried by Resend, and a duplicate delivery of a previously
 * failed event is reprocessed instead of being discarded.
 */
export async function registerWebhookRoutes(
  app: FastifyInstance,
  deps: { env: Env; db: Database },
): Promise<void> {
  const { env, db } = deps;
  const enhance = createLlmEnhancer(env) ?? undefined;

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
              error: {
                code: "webhook_not_configured",
                message: "Receiving webhook is not configured.",
              },
            });
          }
          request.log.warn(
            "RESEND_WEBHOOK_SECRET not set; accepting webhook without signature check in development",
          );
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

        let event: ResendReceivedEvent;
        try {
          event = parseResendEvent(JSON.parse(rawBody.toString("utf8")));
        } catch {
          return reply.code(400).send({
            error: { code: "invalid_payload", message: "Unreadable webhook payload." },
          });
        }

        if (event.type === "email.received") {
          if (!env.RESEND_API_KEY || !env.INBOUND_EMAIL_DOMAIN) {
            request.log.error("Inbound email webhook arrived before receiving was configured");
            return reply.code(503).send({
              error: {
                code: "receiving_not_configured",
                message: "Inbound email is not configured.",
              },
            });
          }
        }

        const externalId =
          (request.headers["svix-id"] as string | undefined) ??
          event.data?.email_id ??
          createHash("sha256").update(rawBody).digest("hex");

        const baseMetadata = {
          type: event.type,
          emailId: event.data?.email_id ?? null,
        };

        const [inserted] = await db
          .insert(webhookEvents)
          .values({
            provider: "resend",
            externalId,
            payloadHash: createHash("sha256").update(rawBody).digest("hex"),
            status: "received",
            metadata: baseMetadata,
          })
          .onConflictDoNothing()
          .returning();

        let record = inserted;
        if (!record) {
          const [existing] = await db
            .select()
            .from(webhookEvents)
            .where(
              and(
                eq(webhookEvents.provider, "resend"),
                eq(webhookEvents.externalId, externalId),
              ),
            )
            .limit(1);
          if (!existing) {
            return reply.code(500).send({
              error: { code: "webhook_store_failed", message: "Could not record the webhook." },
            });
          }
          if (existing.status === "processed") {
            return reply.code(200).send({ ok: true, duplicate: true });
          }
          // A previous attempt failed. Reuse the row so attempts and the last
          // error stay auditable, then process the event again.
          record = existing;
        }

        const metadata = { ...(record.metadata ?? {}), ...baseMetadata };
        await db
          .update(webhookEvents)
          .set({
            status: "processing",
            attempts: sql`${webhookEvents.attempts} + 1`,
            error: null,
            metadata,
          })
          .where(eq(webhookEvents.id, record.id));

        try {
          const result = await processInboundEmail({ env, db, enhance }, event);
          await db
            .update(webhookEvents)
            .set({
              status: "processed",
              processedAt: new Date(),
              error: null,
              metadata: {
                ...metadata,
                outcome: result.outcome,
                reason: result.reason ?? null,
                importId: result.importId ?? null,
              },
            })
            .where(eq(webhookEvents.id, record.id));

          request.log.info(
            {
              eventId: record.id,
              type: event.type,
              emailId: event.data?.email_id ?? null,
              outcome: result.outcome,
              importId: result.importId ?? null,
            },
            "Resend webhook processed",
          );

          return reply.code(200).send({ ok: true, outcome: result.outcome });
        } catch (error) {
          const retryable = !(error instanceof InboundEmailError) || error.retryable;
          const message = safeError(error);
          await db
            .update(webhookEvents)
            .set({
              status: retryable ? "failed" : "processed",
              processedAt: retryable ? null : new Date(),
              error: message,
              metadata: {
                ...metadata,
                outcome: "failed",
                retryable,
              },
            })
            .where(eq(webhookEvents.id, record.id));

          if (!retryable) {
            request.log.warn(
              { eventId: record.id, type: event.type, error: message },
              "Resend webhook could not be processed and will not be retried",
            );
            return reply.code(200).send({ ok: true, outcome: "failed" });
          }

          request.log.error(
            { eventId: record.id, type: event.type, error: message },
            "Resend webhook processing failed; retry expected",
          );
          return reply.code(500).send({
            error: {
              code: "webhook_processing_failed",
              message: "The email could not be processed yet.",
            },
          });
        }
      },
    );
  });
}
