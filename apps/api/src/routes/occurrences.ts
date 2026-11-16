import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser, userWithEmail } from "../auth/guard.js";
import type { Database } from "../db.js";
import type { Env } from "../env.js";
import { notFound, parseBody } from "../lib/errors.js";
import { recordAudit } from "../lib/audit.js";
import { dateString, paymentInputSchema, skipInputSchema, snoozeInputSchema } from "../schemas.js";
import { ensureProfile } from "../services/profile.js";
import {
  clearSnooze,
  getOwnedOccurrence,
  listOccurrences,
  payOccurrence,
  skipOccurrence,
  snoozeOccurrence,
  unpayOccurrence,
  unskipOccurrence,
} from "../services/occurrences.js";

const listQuerySchema = z.object({
  from: dateString.optional(),
  to: dateString.optional(),
  status: z.enum(["pending", "paid", "skipped", "canceled"]).optional(),
  view: z.enum(["overdue", "due", "upcoming", "paid", "skipped", "canceled"]).optional(),
  kind: z.enum(["subscription", "bill", "trial", "prepaid", "installment"]).optional(),
  subscriptionId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export async function registerOccurrenceRoutes(
  app: FastifyInstance,
  deps: { env: Env; db: Database },
): Promise<void> {
  const { env, db } = deps;

  app.get("/api/v1/occurrences", async (request) => {
    const user = await userWithEmail(request, env, await requireUser(request, env));
    const query = parseBody(listQuerySchema, request.query);
    const profile = await ensureProfile(db, user);
    const occurrences = await listOccurrences(db, user.id, profile.timezone, query);
    return { occurrences };
  });

  app.get("/api/v1/occurrences/:id", async (request) => {
    const user = await userWithEmail(request, env, await requireUser(request, env));
    const { id } = request.params as { id: string };
    const profile = await ensureProfile(db, user);
    const rows = await listOccurrences(db, user.id, profile.timezone, { limit: 500 });
    const occurrence = rows.find((row) => row.id === id);
    if (!occurrence) throw notFound("Occurrence not found.");
    return { occurrence };
  });

  app.post("/api/v1/occurrences/:id/pay", async (request) => {
    const user = await requireUser(request, env);
    const { id } = request.params as { id: string };
    const input = parseBody(paymentInputSchema, request.body ?? {});
    const result = await payOccurrence(db, user.id, id, input);
    await recordAudit(db, request, {
      userId: user.id,
      action: result.alreadyPaid ? "occurrence.paid.already" : "occurrence.paid",
      entityType: "occurrence",
      entityId: id,
      metadata: { paymentId: result.payment?.id },
    });
    return result;
  });

  app.post("/api/v1/occurrences/:id/unpay", async (request) => {
    const user = await requireUser(request, env);
    const { id } = request.params as { id: string };
    const occurrence = await unpayOccurrence(db, user.id, id);
    await recordAudit(db, request, {
      userId: user.id,
      action: "occurrence.unpaid",
      entityType: "occurrence",
      entityId: id,
    });
    return { occurrence };
  });

  app.post("/api/v1/occurrences/:id/skip", async (request) => {
    const user = await requireUser(request, env);
    const { id } = request.params as { id: string };
    const input = parseBody(skipInputSchema, request.body ?? {});
    const occurrence = await skipOccurrence(db, user.id, id);
    await recordAudit(db, request, {
      userId: user.id,
      action: "occurrence.skipped",
      entityType: "occurrence",
      entityId: id,
      metadata: input.reason ? { reason: input.reason } : undefined,
    });
    return { occurrence };
  });

  app.post("/api/v1/occurrences/:id/unskip", async (request) => {
    const user = await requireUser(request, env);
    const { id } = request.params as { id: string };
    const occurrence = await unskipOccurrence(db, user.id, id);
    await recordAudit(db, request, {
      userId: user.id,
      action: "occurrence.unskipped",
      entityType: "occurrence",
      entityId: id,
    });
    return { occurrence };
  });

  app.post("/api/v1/occurrences/:id/snooze", async (request) => {
    const user = await requireUser(request, env);
    const { id } = request.params as { id: string };
    const input = parseBody(snoozeInputSchema, request.body);
    const occurrence = await snoozeOccurrence(db, user.id, id, input.until);
    await recordAudit(db, request, {
      userId: user.id,
      action: "occurrence.snoozed",
      entityType: "occurrence",
      entityId: id,
      metadata: { until: input.until },
    });
    return { occurrence };
  });

  app.post("/api/v1/occurrences/:id/unsnooze", async (request) => {
    const user = await requireUser(request, env);
    const { id } = request.params as { id: string };
    await getOwnedOccurrence(db, user.id, id);
    const occurrence = await clearSnooze(db, user.id, id);
    await recordAudit(db, request, {
      userId: user.id,
      action: "occurrence.unsnoozed",
      entityType: "occurrence",
      entityId: id,
    });
    return { occurrence };
  });
}
