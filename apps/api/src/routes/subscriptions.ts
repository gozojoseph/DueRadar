import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser, userWithEmail } from "../auth/guard.js";
import type { Database } from "../db.js";
import type { Env } from "../env.js";
import { badRequest, notFound, parseBody } from "../lib/errors.js";
import { recordAudit } from "../lib/audit.js";
import { subscriptionInputSchema, subscriptionUpdateSchema } from "../schemas.js";
import { ensureProfile } from "../services/profile.js";
import {
  createSubscription,
  deleteSubscription,
  getOwnedSubscription,
  getSubscriptionDetail,
  listSubscriptions,
  updateSubscription,
  type SubscriptionInput,
} from "../services/subscriptions.js";

const listQuerySchema = z.object({
  status: z.enum(["active", "paused", "cancelled"]).optional(),
  kind: z.enum(["subscription", "bill", "trial", "prepaid", "installment"]).optional(),
  search: z.string().trim().max(100).optional(),
});

export function serviceError(error: unknown): never {
  if (error instanceof Error && error.message === "category_not_owned") {
    throw badRequest("That category no longer exists.");
  }
  if (error instanceof Error && error.message === "payment_method_not_owned") {
    throw badRequest("That payment method no longer exists.");
  }
  throw error;
}

function toInput(input: z.infer<typeof subscriptionInputSchema>): SubscriptionInput {
  return {
    ...input,
    cycle: input.cycle,
    endOfMonthMode: input.endOfMonthMode,
  };
}

export async function registerSubscriptionRoutes(
  app: FastifyInstance,
  deps: { env: Env; db: Database },
): Promise<void> {
  const { env, db } = deps;

  app.get("/api/v1/subscriptions", async (request) => {
    const user = await requireUser(request, env);
    const query = parseBody(listQuerySchema, request.query);
    return { subscriptions: await listSubscriptions(db, user.id, query) };
  });

  app.post("/api/v1/subscriptions", async (request, reply) => {
    const user = await userWithEmail(request, env, await requireUser(request, env));
    const input = parseBody(subscriptionInputSchema, request.body);
    const profile = await ensureProfile(db, user);

    try {
      const subscription = await createSubscription(
        db,
        user.id,
        toInput(input),
        profile.timezone,
      );
      await recordAudit(db, request, {
        userId: user.id,
        action: "subscription.created",
        entityType: "subscription",
        entityId: subscription.id,
        metadata: { kind: subscription.kind, currency: subscription.currency },
      });
      return reply.code(201).send({ subscription });
    } catch (error) {
      serviceError(error);
    }
  });

  app.get("/api/v1/subscriptions/:id", async (request) => {
    const user = await userWithEmail(request, env, await requireUser(request, env));
    const { id } = request.params as { id: string };
    const profile = await ensureProfile(db, user);
    const subscription = await getSubscriptionDetail(db, user.id, id, profile.timezone);
    if (!subscription) throw notFound("Subscription not found.");
    return { subscription };
  });

  app.patch("/api/v1/subscriptions/:id", async (request) => {
    const user = await userWithEmail(request, env, await requireUser(request, env));
    const { id } = request.params as { id: string };
    const patch = parseBody(subscriptionUpdateSchema, request.body);
    const profile = await ensureProfile(db, user);

    try {
      const subscription = await updateSubscription(
        db,
        user.id,
        id,
        patch as Partial<SubscriptionInput>,
        profile.timezone,
      );
      if (!subscription) throw notFound("Subscription not found.");
      await recordAudit(db, request, {
        userId: user.id,
        action: "subscription.updated",
        entityType: "subscription",
        entityId: id,
        metadata: { fields: Object.keys(patch) },
      });
      return { subscription };
    } catch (error) {
      serviceError(error);
    }
  });

  app.delete("/api/v1/subscriptions/:id", async (request, reply) => {
    const user = await requireUser(request, env);
    const { id } = request.params as { id: string };
    const deleted = await deleteSubscription(db, user.id, id);
    if (!deleted) throw notFound("Subscription not found.");
    await recordAudit(db, request, {
      userId: user.id,
      action: "subscription.deleted",
      entityType: "subscription",
      entityId: id,
    });
    return reply.code(204).send();
  });

  for (const [path, status] of [
    ["pause", "paused"],
    ["resume", "active"],
    ["cancel", "cancelled"],
  ] as const) {
    app.post(`/api/v1/subscriptions/:id/${path}`, async (request) => {
      const user = await userWithEmail(request, env, await requireUser(request, env));
      const { id } = request.params as { id: string };
      const profile = await ensureProfile(db, user);
      const existing = await getOwnedSubscription(db, user.id, id);
      if (!existing) throw notFound("Subscription not found.");

      const subscription = await updateSubscription(
        db,
        user.id,
        id,
        { status },
        profile.timezone,
      );
      if (!subscription) throw notFound("Subscription not found.");
      await recordAudit(db, request, {
        userId: user.id,
        action: `subscription.${path}`,
        entityType: "subscription",
        entityId: id,
      });
      return { subscription };
    });
  }
}
