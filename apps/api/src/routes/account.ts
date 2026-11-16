import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { eq, sql, type SQL } from "drizzle-orm";
import {
  auditEvents,
  billingOccurrences,
  categories,
  detectionSuggestions,
  devices,
  emailAliases,
  imports,
  notifications,
  paymentMethods,
  payments,
  profiles,
  providerConnections,
  reminderJobs,
  subscriptions,
} from "@dueradar/db/schema";
import type { Database } from "../db.js";
import type { Env } from "../env.js";
import { requireUser } from "../auth/guard.js";
import { parseBody } from "../lib/errors.js";
import { accountDeleteSchema } from "../schemas.js";
import { ensureProfile, lookupAuthIdentity } from "../services/profile.js";
import { clearSessionCache } from "../auth/session.js";
import type { Clients } from "../lib/clients.js";
import { secureCookies } from "../env.js";

export function clearAuthCookies(reply: FastifyReply, env: Env): void {
  const secure = secureCookies(env) ? "; Secure" : "";
  // Managed Better Auth issues `neon-auth.*` cookies; self-hosted Better Auth
  // uses `better-auth.*`. Clear both so a deletion never leaves a usable
  // session cookie behind.
  const names = [
    "better-auth.session_token",
    "__Secure-better-auth.session_token",
    "better-auth.session_data",
    "__Secure-better-auth.session_data",
    "neon-auth.session_token",
    "__Secure-neon-auth.session_token",
    "neon-auth.session_data",
    "__Secure-neon-auth.session_data",
  ];
  reply.header(
    "set-cookie",
    names.map((name) => {
      // `__Secure-` cookies are rejected without the Secure attribute, even
      // when they are being deleted. Production already forces it.
      const secureAttribute = name.startsWith("__Secure-") ? "; Secure" : secure;
      return `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secureAttribute}`;
    }),
  );
}

export async function registerAccountRoutes(
  app: FastifyInstance,
  deps: { env: Env; db: Database; clients: Clients },
): Promise<void> {
  const { env, db, clients } = deps;

  const deleteAccount = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await requireUser(request, env);
    const input = parseBody(accountDeleteSchema, request.body ?? {});
    const profile = await ensureProfile(db, user);
    const identity = profile.email ? null : await lookupAuthIdentity(db, user.id);
    const email = profile.email || identity?.email || user.email || "";

    await db.transaction(async (tx) => {
      // Deleting jobs cascades to delivery attempts.
      await tx.delete(reminderJobs).where(eq(reminderJobs.userId, user.id));
      await tx.delete(notifications).where(eq(notifications.userId, user.id));
      await tx.delete(devices).where(eq(devices.userId, user.id));
      await tx.delete(detectionSuggestions).where(eq(detectionSuggestions.userId, user.id));
      await tx.delete(imports).where(eq(imports.userId, user.id));
      await tx.delete(payments).where(eq(payments.userId, user.id));
      await tx.delete(billingOccurrences).where(eq(billingOccurrences.userId, user.id));
      await tx.delete(subscriptions).where(eq(subscriptions.userId, user.id));
      await tx.delete(paymentMethods).where(eq(paymentMethods.userId, user.id));
      await tx.delete(categories).where(eq(categories.userId, user.id));
      await tx.delete(emailAliases).where(eq(emailAliases.userId, user.id));
      await tx.delete(providerConnections).where(eq(providerConnections.userId, user.id));
      await tx.delete(profiles).where(eq(profiles.userId, user.id));
      await tx.delete(auditEvents).where(eq(auditEvents.userId, user.id));

      // Managed auth tables live in the same database and have no cascading
      // foreign keys, so sessions and credentials are removed explicitly.
      await tx.execute(sqlDeleteSession(user.id));
      await tx.execute(sqlDeleteAccount(user.id));
      await tx.execute(sqlDeleteMember(user.id));
      await tx.execute(sqlDeleteInvitation(user.id, email));
      if (email) await tx.execute(sqlDeleteVerification(email));
      await tx.execute(sqlDeleteAuthUser(user.id));

      await tx.insert(auditEvents).values({
        userId: null,
        action: "account.deleted",
        entityType: "user",
        entityId: null,
        metadata: { reason: input.reason ?? null, hadEmail: Boolean(email) },
      });
    });

    // Cookie lookups are memoised for 30 seconds. If that cache kept the
    // deleted user's session, their still-valid cookie would keep working
    // until the entry expired.
    clearSessionCache();
    clearAuthCookies(reply, env);

    if (email && clients.email.configured) {
      await clients.email
        .send({
          to: email,
          subject: "Your DueRadar account was deleted",
          idempotencyKey: `account-deleted:${user.id}`,
          html: `<p>Hello,</p><p>Your DueRadar account and its tracking data have been deleted. Payment records, reminders, devices, and sign-in credentials were removed.</p><p>If you did not request this, contact ${env.SUPPORT_EMAIL} immediately.</p><p>— DueRadar</p>`,
          text: `Your DueRadar account and its tracking data have been deleted. If you did not request this, contact ${env.SUPPORT_EMAIL} immediately.`,
        })
        .catch((error: unknown) => {
          request.log.warn({ err: error }, "Account-deleted confirmation email failed");
        });
    }

    return reply.code(204).send();
  };

  app.delete(
    "/api/v1/account",
    { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } },
    async (request, reply) => deleteAccount(request, reply),
  );

  app.post(
    "/api/v1/account/delete",
    { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } },
    async (request, reply) => deleteAccount(request, reply),
  );
}

// Raw SQL helpers keep the managed `neon_auth` schema isolated from Drizzle.
function sqlDeleteSession(userId: string): SQL {
  return sql`delete from neon_auth.session where "userId" = ${userId}::uuid`;
}
function sqlDeleteAccount(userId: string): SQL {
  return sql`delete from neon_auth.account where "userId" = ${userId}::uuid`;
}
function sqlDeleteMember(userId: string): SQL {
  return sql`delete from neon_auth.member where "userId" = ${userId}::uuid`;
}
function sqlDeleteInvitation(userId: string, email: string): SQL {
  return sql`delete from neon_auth.invitation where "inviterId" = ${userId}::uuid or email = ${email}`;
}
function sqlDeleteVerification(email: string): SQL {
  return sql`delete from neon_auth.verification where identifier ilike ${`%${email}%`}`;
}
function sqlDeleteAuthUser(userId: string): SQL {
  return sql`delete from neon_auth."user" where id = ${userId}::uuid`;
}
