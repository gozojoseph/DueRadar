import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { billingTransactions, profiles } from "@dueradar/db/schema";
import { requireUser, userWithEmail } from "../auth/guard.js";
import type { Database } from "../db.js";
import type { Env } from "../env.js";
import { recordAudit } from "../lib/audit.js";
import { ApiError, badRequest, conflict, notFound, parseBody } from "../lib/errors.js";
import { ensureProfile } from "../services/profile.js";
import { applyVerifiedPayment } from "../services/billing.js";
import { getCheckoutProvider } from "../services/payments.js";
import {
  initializePaystackCheckout,
  verifyPaystackCheckout,
  verifyPaystackSignature,
  type VerifiedPaystackTransaction,
} from "../services/paystack.js";
import {
  initializeYebeckCollection,
  normalizeGhanaMsisdn,
  verifyYebeckCollection,
  type MomoNetwork,
  type YebeckCollection,
} from "../services/yebeck.js";
import { getPlanAccess, PLUS_PRICES } from "../services/plan.js";
import { z } from "zod";

const checkoutSchema = z.object({
  interval: z.enum(["monthly", "annual"]),
  network: z.enum(["mtn", "telecel", "at"]).optional(),
  msisdn: z.string().trim().max(24).optional(),
  name: z.string().trim().max(80).optional(),
});

const verifySchema = z.object({
  reference: z.string().trim().min(8).max(100),
});

const paystackWebhookSchema = z.object({
  event: z.string().max(100),
  data: z.object({ reference: z.string().min(8).max(100) }).passthrough(),
});

// Yebeck's dashboard sends a test ping of arbitrary shape when a webhook URL
// is saved, and their payload shapes are not documented in detail. The payload
// is never trusted anyway (every actionable event is re-verified
// server-to-server), so accept anything that parses as a JSON object and only
// act on `collection.successful` events carrying a reference.
const yebeckWebhookSchema = z
  .object({
    event: z.string().max(100).optional(),
    data: z
      .object({ reference: z.string().min(1).max(100) })
      .passthrough()
      .optional(),
  })
  .passthrough();

function serviceUnavailable(message: string): ApiError {
  return new ApiError(503, "billing_not_configured", message);
}

export async function registerBillingRoutes(
  app: FastifyInstance,
  deps: { env: Env; db: Database },
): Promise<void> {
  const { env, db } = deps;

  app.get("/api/v1/billing", async (request) => {
    const user = await requireUser(request, env);
    await ensureProfile(db, user);
    const [plan, provider] = await Promise.all([
      getPlanAccess(db, user.id),
      getCheckoutProvider(db),
    ]);
    return {
      ...plan,
      provider,
      configured: provider === "paystack"
        ? Boolean(env.PAYSTACK_SECRET_KEY)
        : Boolean(env.YEBECK_SECRET_KEY),
      prices: {
        monthly: { currency: "GHS", amount: PLUS_PRICES.monthly.amountGhs },
        annual: { currency: "GHS", amount: PLUS_PRICES.annual.amountGhs },
      },
    };
  });

  app.post("/api/v1/billing/skip", async (request) => {
    const user = await requireUser(request, env);
    const profile = await ensureProfile(db, user);
    if (!profile.paidAccessRequired) return { deferred: true };

    const [updated] = await db
      .update(profiles)
      .set({ paidAccessRequired: false, updatedAt: new Date() })
      .where(eq(profiles.userId, user.id))
      .returning({ userId: profiles.userId });
    if (!updated) throw notFound("Profile not found.");
    await recordAudit(db, request, {
      userId: user.id,
      action: "plan.selection_deferred",
      entityType: "profile",
      entityId: user.id,
    });
    return { deferred: true };
  });

  app.post(
    "/api/v1/billing/checkout",
    { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } },
    async (request) => {
      const user = await userWithEmail(request, env, await requireUser(request, env));
      const input = parseBody(checkoutSchema, request.body);
      if (!user.email) throw badRequest("A verified email address is required for checkout.");

      // New checkouts go to the provider the admin selected. The transaction
      // row records which provider owns it, so verify/webhook keep working for
      // in-flight payments even after the admin switches providers.
      const provider = await getCheckoutProvider(db);

      await ensureProfile(db, user);
      const plan = await getPlanAccess(db, user.id);
      if (plan.grandfathered) {
        throw conflict("Your account already has lifetime Plus access.");
      }

      const reference = `dr_${randomUUID().replace(/-/g, "")}`;
      const price = PLUS_PRICES[input.interval];

      if (provider === "yebeck") {
        if (!env.YEBECK_SECRET_KEY) {
          throw serviceUnavailable("Online payments are not configured yet.");
        }
        if (!input.network || !input.msisdn) {
          throw badRequest(
            "Choose your mobile money network and enter the number to charge.",
          );
        }
        const msisdn = normalizeGhanaMsisdn(input.msisdn);
        if (!msisdn) {
          throw badRequest(
            "Enter a valid Ghana mobile money number, for example 024 123 4567.",
          );
        }

        await db.insert(billingTransactions).values({
          userId: user.id,
          reference,
          provider,
          interval: input.interval,
          amountMinor: price.amountMinor,
          currency: "GHS",
          status: "pending",
        });

        try {
          const collection = await initializeYebeckCollection(env.YEBECK_SECRET_KEY, {
            amountMinor: price.amountMinor,
            network: input.network,
            customerMsisdn: msisdn,
            customerName: input.name || null,
            narration: `DueRadar Plus ${input.interval}`,
          });
          // Yebeck keys collections by its own MVN- reference, not ours —
          // remember it so verify/webhook can query the payment later.
          await db
            .update(billingTransactions)
            .set({ providerTransactionId: collection.reference, updatedAt: new Date() })
            .where(eq(billingTransactions.reference, reference));
          return {
            provider,
            reference,
            status: collection.status,
          };
        } catch (error) {
          await db
            .update(billingTransactions)
            .set({ status: "failed", updatedAt: new Date() })
            .where(eq(billingTransactions.reference, reference));
          throw error;
        }
      }

      if (!env.PAYSTACK_SECRET_KEY) {
        throw serviceUnavailable("Online payments are not configured yet.");
      }

      await db.insert(billingTransactions).values({
        userId: user.id,
        reference,
        provider,
        interval: input.interval,
        amountMinor: price.amountMinor,
        currency: "GHS",
        status: "pending",
      });

      try {
        const checkoutUrl = await initializePaystackCheckout(env.PAYSTACK_SECRET_KEY, {
          email: user.email,
          reference,
          interval: input.interval,
          callbackUrl: new URL("/billing/return", env.APP_ORIGIN).toString(),
        });
        return { provider, checkoutUrl, reference };
      } catch (error) {
        await db
          .update(billingTransactions)
          .set({ status: "failed", updatedAt: new Date() })
          .where(eq(billingTransactions.reference, reference));
        throw error;
      }
    },
  );

  app.post(
    "/api/v1/billing/verify",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request) => {
      const user = await requireUser(request, env);
      const { reference } = parseBody(verifySchema, request.body);

      const [transaction] = await db
        .select()
        .from(billingTransactions)
        .where(and(
          eq(billingTransactions.reference, reference),
          eq(billingTransactions.userId, user.id),
        ))
        .limit(1);
      if (!transaction) throw notFound("Payment reference not found.");

      // Verify against the provider that owns the transaction, not the one
      // currently selected for new checkouts — an admin switch mid-payment
      // must never strand a checkout.
      let payment: VerifiedPaystackTransaction;
      if (transaction.provider === "yebeck") {
        if (!env.YEBECK_SECRET_KEY) {
          throw serviceUnavailable(
            "This payment was started with a provider that is not enabled yet.",
          );
        }
        // Yebeck knows the payment only by its MVN- reference, which was
        // stored on the transaction at checkout time — not by our dr- one.
        if (!transaction.providerTransactionId) {
          throw conflict(
            "This payment is missing its provider reference. Please start a new checkout.",
          );
        }
        const collection = await verifyYebeckCollection(
          env.YEBECK_SECRET_KEY,
          transaction.providerTransactionId,
        );
        payment = {
          id: collection.id,
          // applyVerifiedPayment matches the payment against the transaction's
          // own reference, so translate back from Yebeck's MVN- one.
          reference: transaction.reference,
          status: collection.status === "successful" ? "success" : collection.status,
          amount: collection.amountMinor,
          currency: collection.currency,
          paidAt: collection.paidAt,
        };
      } else {
        if (!env.PAYSTACK_SECRET_KEY) {
          throw serviceUnavailable(
            "This payment was started with a provider that is not enabled yet.",
          );
        }
        payment = await verifyPaystackCheckout(env.PAYSTACK_SECRET_KEY, reference);
      }
      if (payment.status !== "success") {
        return {
          status: "pending" as const,
          provider: transaction.provider,
        };
      }

      const result = await applyVerifiedPayment(db, reference, payment);
      return {
        status: "paid" as const,
        provider: transaction.provider,
        activated: result.activated,
        accessUntil: result.accessUntil,
      };
    },
  );

  await app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", { parseAs: "buffer" }, (_request, body, done) => {
      done(null, body);
    });

    scope.post(
      "/api/webhooks/paystack",
      { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
      async (request, reply) => {
        if (!env.PAYSTACK_SECRET_KEY) {
          return reply.code(503).send({
            error: {
              code: "billing_not_configured",
              message: "Online payments are not configured yet.",
            },
          });
        }

        const rawBody = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
        const signature = request.headers["x-paystack-signature"];
        if (
          rawBody.length === 0 ||
          !verifyPaystackSignature(
            rawBody,
            typeof signature === "string" ? signature : undefined,
            env.PAYSTACK_SECRET_KEY,
          )
        ) {
          return reply.code(401).send({
            error: { code: "invalid_signature", message: "Webhook signature verification failed." },
          });
        }

        let payload: unknown;
        try {
          payload = JSON.parse(rawBody.toString("utf8"));
        } catch {
          return reply.code(400).send({
            error: { code: "invalid_payload", message: "Unreadable webhook payload." },
          });
        }
        const parsed = paystackWebhookSchema.safeParse(payload);
        if (!parsed.success) {
          return reply.code(400).send({
            error: { code: "invalid_payload", message: "Unreadable webhook payload." },
          });
        }
        if (parsed.data.event !== "charge.success") {
          return reply.code(200).send({ ok: true, ignored: true });
        }

        const [transaction] = await db
          .select({ reference: billingTransactions.reference })
          .from(billingTransactions)
          .where(eq(billingTransactions.reference, parsed.data.data.reference))
          .limit(1);
        if (!transaction) {
          request.log.warn(
            { reference: parsed.data.data.reference },
            "Ignored Paystack webhook for an unknown payment reference",
          );
          return reply.code(200).send({ ok: true, ignored: true });
        }

        const payment = await verifyPaystackCheckout(
          env.PAYSTACK_SECRET_KEY,
          parsed.data.data.reference,
        );
        if (payment.status !== "success") {
          return reply.code(503).send({ ok: false, pending: true });
        }

        let result: Awaited<ReturnType<typeof applyVerifiedPayment>>;
        try {
          result = await applyVerifiedPayment(db, parsed.data.data.reference, payment);
        } catch (error) {
          if (error instanceof ApiError && error.statusCode === 409) {
            request.log.error(
              { reference: parsed.data.data.reference, reason: error.message },
              "Paystack payment did not match the stored checkout",
            );
            return reply.code(200).send({ ok: true, rejected: true });
          }
          throw error;
        }
        request.log.info(
          { reference: parsed.data.data.reference, activated: result.activated },
          "Paystack payment verified",
        );
        return reply.code(200).send({ ok: true });
      },
    );

    // Yebeck webhooks are not signed (their API exposes no signature scheme
    // yet), so the payload is never trusted: the reference must belong to a
    // known Yebeck transaction and the real status is re-checked
    // server-to-server before Plus is activated.
    scope.post(
      "/api/webhooks/yebeck",
      { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
      async (request, reply) => {
        if (!env.YEBECK_SECRET_KEY) {
          return reply.code(503).send({
            error: {
              code: "billing_not_configured",
              message: "Online payments are not configured yet.",
            },
          });
        }

        const rawBody = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
        let payload: unknown;
        try {
          payload = JSON.parse(rawBody.toString("utf8"));
        } catch {
          return reply.code(400).send({
            error: { code: "invalid_payload", message: "Unreadable webhook payload." },
          });
        }
        const parsed = yebeckWebhookSchema.safeParse(payload);
        if (!parsed.success) {
          return reply.code(400).send({
            error: { code: "invalid_payload", message: "Unreadable webhook payload." },
          });
        }
        const webhookReference = parsed.data.data?.reference;
        if (parsed.data.event !== "collection.successful" || !webhookReference) {
          // Test pings, unrelated events, and payloads without a reference are
          // acknowledged so the dashboard does not mark the endpoint as failing.
          return reply.code(200).send({ ok: true, ignored: true });
        }

        // Yebeck events carry Yebeck's MVN- reference; the transaction stores
        // it in providerTransactionId since checkout.
        const [transaction] = await db
          .select({ reference: billingTransactions.reference, provider: billingTransactions.provider })
          .from(billingTransactions)
          .where(and(
            eq(billingTransactions.providerTransactionId, webhookReference),
            eq(billingTransactions.provider, "yebeck"),
          ))
          .limit(1);
        if (!transaction) {
          request.log.warn(
            { reference: webhookReference },
            "Ignored Yebeck webhook for an unknown payment reference",
          );
          return reply.code(200).send({ ok: true, ignored: true });
        }

        let collection: YebeckCollection;
        try {
          collection = await verifyYebeckCollection(
            env.YEBECK_SECRET_KEY,
            webhookReference,
          );
        } catch (error) {
          request.log.error(
            { reference: webhookReference, err: error },
            "Yebeck webhook re-verification failed",
          );
          // Ask Yebeck to retry later; never activate on an unverified claim.
          return reply.code(503).send({ ok: false, pending: true });
        }
        if (collection.status !== "successful") {
          return reply.code(200).send({ ok: true, pending: true });
        }

        let result: Awaited<ReturnType<typeof applyVerifiedPayment>>;
        try {
          result = await applyVerifiedPayment(db, transaction.reference, {
            id: collection.id,
            reference: transaction.reference,
            status: "success",
            amount: collection.amountMinor,
            currency: collection.currency,
            paidAt: collection.paidAt,
          });
        } catch (error) {
          if (error instanceof ApiError && error.statusCode === 409) {
            request.log.error(
              { reference: webhookReference, reason: error.message },
              "Yebeck payment did not match the stored checkout",
            );
            return reply.code(200).send({ ok: true, rejected: true });
          }
          throw error;
        }
        request.log.info(
          { reference: webhookReference, activated: result.activated },
          "Yebeck payment verified",
        );
        return reply.code(200).send({ ok: true });
      },
    );
  });
}
