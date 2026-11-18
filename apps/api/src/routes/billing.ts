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
} from "../services/paystack.js";
import { getPlanAccess, PLUS_PRICES } from "../services/plan.js";
import { z } from "zod";

const checkoutSchema = z.object({
  interval: z.enum(["monthly", "annual"]),
});

const verifySchema = z.object({
  reference: z.string().trim().min(8).max(100),
});

const paystackWebhookSchema = z.object({
  event: z.string().max(100),
  data: z.object({ reference: z.string().min(8).max(100) }).passthrough(),
});

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
    const plan = await getPlanAccess(db, user.id);
    return {
      ...plan,
      configured: Boolean(env.PAYSTACK_SECRET_KEY),
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
      if (!env.PAYSTACK_SECRET_KEY) {
        throw serviceUnavailable("Online payments are not configured yet.");
      }

      // New checkouts go to the provider the admin selected. The transaction
      // row records which provider owns it, so verify/webhook keep working for
      // in-flight payments even after the admin switches providers.
      const provider = await getCheckoutProvider(db);
      if (provider !== "paystack") {
        throw serviceUnavailable(
          "The selected payment provider is not ready yet. Checkouts are unavailable.",
        );
      }

      await ensureProfile(db, user);
      const plan = await getPlanAccess(db, user.id);
      if (plan.grandfathered) {
        throw conflict("Your account already has lifetime Plus access.");
      }

      const reference = `dr_${randomUUID().replace(/-/g, "")}`;
      const price = PLUS_PRICES[input.interval];
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
        return { checkoutUrl, reference };
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
      if (!env.PAYSTACK_SECRET_KEY) {
        throw serviceUnavailable("Online payments are not configured yet.");
      }

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
      if (transaction.provider !== "paystack") {
        throw serviceUnavailable(
          "This payment was started with a provider that is not enabled yet.",
        );
      }
      const payment = await verifyPaystackCheckout(env.PAYSTACK_SECRET_KEY, reference);
      if (payment.status !== "success") {
        return { status: "pending" as const };
      }

      const result = await applyVerifiedPayment(db, reference, payment);
      return {
        status: "paid" as const,
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
  });
}
