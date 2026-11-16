import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/guard.js";
import type { Database } from "../db.js";
import type { Env } from "../env.js";
import { recordAudit } from "../lib/audit.js";
import { parseBody } from "../lib/errors.js";
import { createLlmEnhancer } from "../services/llm-detect.js";
import {
  beginGmailOAuth,
  completeGmailOAuth,
  disconnectGmail,
  getGmailConnectionStatus,
  syncGmailMessages,
} from "../services/gmail.js";

const gmailCallbackSchema = z.object({
  code: z.string().min(1).max(4096),
  state: z.string().min(20).max(256),
});

export async function registerProviderRoutes(
  app: FastifyInstance,
  deps: { env: Env; db: Database },
): Promise<void> {
  const { env, db } = deps;
  const enhance = createLlmEnhancer(env) ?? undefined;

  app.get("/api/v1/providers/gmail/status", async (request) => {
    const user = await requireUser(request, env);
    return getGmailConnectionStatus(db, user.id, env);
  });

  app.post(
    "/api/v1/providers/gmail/connect",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request) => {
      const user = await requireUser(request, env);
      const result = await beginGmailOAuth(db, user.id, env);
      await recordAudit(db, request, {
        userId: user.id,
        action: "provider.gmail.connect_started",
        entityType: "provider_connection",
        metadata: { provider: "gmail" },
      });
      return result;
    },
  );

  app.post(
    "/api/v1/providers/gmail/callback",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request) => {
      const user = await requireUser(request, env);
      const input = parseBody(gmailCallbackSchema, request.body);
      const result = await completeGmailOAuth(db, user.id, env, input);
      await recordAudit(db, request, {
        userId: user.id,
        action: "provider.gmail.connected",
        entityType: "provider_connection",
        metadata: { provider: "gmail" },
      });
      return { connected: true, emailAddress: result.emailAddress };
    },
  );

  app.post(
    "/api/v1/providers/gmail/sync",
    { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } },
    async (request) => {
      const user = await requireUser(request, env);
      const result = await syncGmailMessages(db, user.id, env, { enhance });
      await recordAudit(db, request, {
        userId: user.id,
        action: "provider.gmail.synced",
        entityType: "provider_connection",
        metadata: {
          provider: "gmail",
          imported: result.imported,
          detected: result.detected,
        },
      });
      return result;
    },
  );

  app.delete(
    "/api/v1/providers/gmail",
    { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } },
    async (request) => {
      const user = await requireUser(request, env);
      const result = await disconnectGmail(db, user.id, env);
      await recordAudit(db, request, {
        userId: user.id,
        action: "provider.gmail.disconnected",
        entityType: "provider_connection",
        metadata: { provider: "gmail" },
      });
      return result;
    },
  );
}
