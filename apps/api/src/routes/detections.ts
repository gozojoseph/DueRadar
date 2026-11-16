import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser, userWithEmail } from "../auth/guard.js";
import type { Database } from "../db.js";
import type { Env } from "../env.js";
import { recordAudit } from "../lib/audit.js";
import { badRequest, notFound, parseBody } from "../lib/errors.js";
import {
  detectionAcceptSchema,
  detectionRejectAllSchema,
  detectionRejectSchema,
} from "../schemas.js";
import { ensureProfile } from "../services/profile.js";
import {
  acceptSuggestion,
  getDetectionSummary,
  getDetectionSuggestion,
  listDetectionSuggestions,
  rejectSuggestion,
  rejectSuggestions,
} from "../services/detection.js";

const listQuerySchema = z.object({
  status: z.enum(["pending", "accepted", "rejected", "all"]).optional(),
  includeBlocked: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value !== "false"),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

function isUuid(value: string): boolean {
  return z.string().uuid().safeParse(value).success;
}

function subscriptionError(error: unknown): never {
  if (error instanceof Error && error.message === "category_not_owned") {
    throw badRequest("That category no longer exists.");
  }
  if (error instanceof Error && error.message === "payment_method_not_owned") {
    throw badRequest("That payment method no longer exists.");
  }
  throw error;
}

export async function registerDetectionRoutes(
  app: FastifyInstance,
  deps: { env: Env; db: Database },
): Promise<void> {
  const { env, db } = deps;

  app.get("/api/v1/detections/summary", async (request) => {
    const user = await requireUser(request, env);
    return getDetectionSummary(db, user.id);
  });

  app.post(
    "/api/v1/detections/reject-all",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request) => {
      const user = await requireUser(request, env);
      const input = parseBody(detectionRejectAllSchema, request.body ?? {});
      const rejected = await rejectSuggestions(db, user.id, input.ids);
      if (rejected > 0) {
        await recordAudit(db, request, {
          userId: user.id,
          action: "detection.rejected_all",
          entityType: "detection_suggestion",
          metadata: { rejected },
        });
      }
      return { rejected };
    },
  );

  app.get("/api/v1/detections", async (request) => {
    const user = await requireUser(request, env);
    const query = parseBody(listQuerySchema, request.query);
    return {
      suggestions: await listDetectionSuggestions(db, user.id, {
        status: query.status ?? "pending",
        includeBlocked: query.includeBlocked,
        limit: query.limit ?? 50,
      }),
    };
  });

  app.get("/api/v1/detections/:id", async (request) => {
    const user = await requireUser(request, env);
    const { id } = request.params as { id: string };
    if (!isUuid(id)) throw notFound("Suggestion not found.");
    const suggestion = await getDetectionSuggestion(db, user.id, id);
    if (!suggestion) throw notFound("Suggestion not found.");
    return { suggestion };
  });

  app.post(
    "/api/v1/detections/:id/accept",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const user = await userWithEmail(request, env, await requireUser(request, env));
      const { id } = request.params as { id: string };
      if (!isUuid(id)) throw notFound("Suggestion not found.");
      const input = parseBody(detectionAcceptSchema, request.body ?? {});
      const profile = await ensureProfile(db, user);

      let result: Awaited<ReturnType<typeof acceptSuggestion>>;
      try {
        result = await acceptSuggestion(
          db,
          user.id,
          id,
          input.overrides,
          profile.timezone,
        );
      } catch (error) {
        subscriptionError(error);
      }

      await recordAudit(db, request, {
        userId: user.id,
        action: "detection.accepted",
        entityType: "detection_suggestion",
        entityId: id,
        metadata: {
          subscriptionId: result.subscriptionId,
          recordedPayments: result.recordedPayments,
        },
      });
      return reply.code(201).send(result);
    },
  );

  app.post(
    "/api/v1/detections/:id/reject",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (request) => {
      const user = await requireUser(request, env);
      const { id } = request.params as { id: string };
      if (!isUuid(id)) throw notFound("Suggestion not found.");
      const input = parseBody(detectionRejectSchema, request.body ?? {});
      const suggestion = await rejectSuggestion(db, user.id, id, input.reason);
      await recordAudit(db, request, {
        userId: user.id,
        action: "detection.rejected",
        entityType: "detection_suggestion",
        entityId: id,
      });
      return { suggestion };
    },
  );
}
