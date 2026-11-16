import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth/guard.js";
import type { Database } from "../db.js";
import { isInboundEmailConfigured, type Env } from "../env.js";
import { recordAudit } from "../lib/audit.js";
import { conflict, parseBody, paymentRequired } from "../lib/errors.js";
import { emailAliasCreateSchema } from "../schemas.js";
import { ensureProfile } from "../services/profile.js";
import { getPlanAccess } from "../services/plan.js";
import {
  createAlias,
  getActiveAlias,
  revokeAlias,
} from "../services/email-alias.js";

function aliasDto(row: Awaited<ReturnType<typeof getActiveAlias>>) {
  if (!row) return null;
  return {
    id: row.id,
    address: row.address,
    createdAt: row.createdAt,
    lastReceivedAt: row.lastReceivedAt,
    revokedAt: row.revokedAt,
  };
}

export async function registerEmailAliasRoutes(
  app: FastifyInstance,
  deps: { env: Env; db: Database },
): Promise<void> {
  const { env, db } = deps;
  const configured = isInboundEmailConfigured(env);

  app.get("/api/v1/email-alias", async (request) => {
    const user = await requireUser(request, env);
    const alias = await getActiveAlias(db, user.id);
    return {
      alias: aliasDto(alias),
      configured,
      domain: env.INBOUND_EMAIL_DOMAIN ?? null,
    };
  });

  app.post(
    "/api/v1/email-alias",
    { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } },
    async (request, reply) => {
      const user = await requireUser(request, env);
      if (!configured) {
        throw conflict("Email forwarding is not configured for this environment.");
      }
      await ensureProfile(db, user);
      const plan = await getPlanAccess(db, user.id);
      if (!plan.canUseEmailImport) {
        throw paymentRequired("Email forwarding is a DueRadar Plus feature.");
      }
      const input = parseBody(emailAliasCreateSchema, request.body ?? {});
      const alias = await createAlias(db, user.id, env.INBOUND_EMAIL_DOMAIN ?? "", {
        rotate: input.rotate,
      });
      await recordAudit(db, request, {
        userId: user.id,
        action: input.rotate ? "email_alias.rotated" : "email_alias.created",
        entityType: "email_alias",
        entityId: alias.id,
      });
      return reply.code(201).send({
        alias: aliasDto(alias),
        configured,
        domain: env.INBOUND_EMAIL_DOMAIN ?? null,
      });
    },
  );

  app.delete(
    "/api/v1/email-alias",
    { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } },
    async (request) => {
      const user = await requireUser(request, env);
      await revokeAlias(db, user.id);
      await recordAudit(db, request, {
        userId: user.id,
        action: "email_alias.revoked",
        entityType: "email_alias",
      });
      return { revoked: true, alias: null, configured, domain: env.INBOUND_EMAIL_DOMAIN ?? null };
    },
  );
}
