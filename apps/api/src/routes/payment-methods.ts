import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { paymentMethods } from "@dueradar/db/schema";
import { requireUser } from "../auth/guard.js";
import type { Database } from "../db.js";
import type { Env } from "../env.js";
import { notFound, parseBody } from "../lib/errors.js";
import { recordAudit } from "../lib/audit.js";
import { paymentMethodInputSchema } from "../schemas.js";

export async function registerPaymentMethodRoutes(
  app: FastifyInstance,
  deps: { env: Env; db: Database },
): Promise<void> {
  const { env, db } = deps;

  app.get("/api/v1/payment-methods", async (request) => {
    const user = await requireUser(request, env);
    const rows = await db
      .select()
      .from(paymentMethods)
      .where(and(eq(paymentMethods.userId, user.id)))
      .orderBy(paymentMethods.isDefault, paymentMethods.label);
    return { paymentMethods: rows.filter((row) => !row.archivedAt) };
  });

  app.post("/api/v1/payment-methods", async (request, reply) => {
    const user = await requireUser(request, env);
    const input = parseBody(paymentMethodInputSchema, request.body);

    if (input.isDefault) {
      await db
        .update(paymentMethods)
        .set({ isDefault: false })
        .where(eq(paymentMethods.userId, user.id));
    }

    const [created] = await db
      .insert(paymentMethods)
      .values({
        userId: user.id,
        label: input.label,
        kind: input.kind,
        brand: input.brand ?? null,
        last4: input.last4 ?? null,
        expiryMonth: input.expiryMonth ?? null,
        expiryYear: input.expiryYear ?? null,
        isDefault: input.isDefault ?? false,
      })
      .returning();

    await recordAudit(db, request, {
      userId: user.id,
      action: "payment_method.created",
      entityType: "payment_method",
      entityId: created?.id,
    });
    return reply.code(201).send({ paymentMethod: created });
  });

  app.patch("/api/v1/payment-methods/:id", async (request) => {
    const user = await requireUser(request, env);
    const { id } = request.params as { id: string };
    const input = parseBody(paymentMethodInputSchema.partial(), request.body);

    if (input.isDefault) {
      await db
        .update(paymentMethods)
        .set({ isDefault: false })
        .where(eq(paymentMethods.userId, user.id));
    }

    const [updated] = await db
      .update(paymentMethods)
      .set({
        label: input.label,
        kind: input.kind,
        brand: input.brand,
        last4: input.last4,
        expiryMonth: input.expiryMonth,
        expiryYear: input.expiryYear,
        isDefault: input.isDefault,
      })
      .where(and(eq(paymentMethods.id, id), eq(paymentMethods.userId, user.id)))
      .returning();

    if (!updated) throw notFound("Payment method not found.");
    return { paymentMethod: updated };
  });

  app.delete("/api/v1/payment-methods/:id", async (request, reply) => {
    const user = await requireUser(request, env);
    const { id } = request.params as { id: string };
    const [archived] = await db
      .update(paymentMethods)
      .set({ archivedAt: new Date(), isDefault: false })
      .where(and(eq(paymentMethods.id, id), eq(paymentMethods.userId, user.id)))
      .returning({ id: paymentMethods.id });
    if (!archived) throw notFound("Payment method not found.");
    await recordAudit(db, request, {
      userId: user.id,
      action: "payment_method.archived",
      entityType: "payment_method",
      entityId: id,
    });
    return reply.code(204).send();
  });
}
