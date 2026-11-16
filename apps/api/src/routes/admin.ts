import type { FastifyInstance } from "fastify";
import {
  and,
  count,
  desc,
  eq,
  gt,
  ilike,
  isNotNull,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { billingTransactions, profiles, subscriptions } from "@dueradar/db/schema";
import { isAdminUser, requireAdmin } from "../services/admin.js";
import type { Database } from "../db.js";
import type { Env } from "../env.js";
import { conflict, notFound, parseBody } from "../lib/errors.js";
import { recordAudit } from "../lib/audit.js";
import { z } from "zod";

const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

const userQuerySchema = pageQuerySchema.extend({
  search: z.string().trim().max(120).default(""),
});

const billingQuerySchema = pageQuerySchema.extend({
  search: z.string().trim().max(120).default(""),
  status: z.enum(["all", "pending", "paid", "failed"]).default("all"),
});

const suspensionSchema = z
  .object({
    suspended: z.boolean(),
    reason: z.string().trim().min(5).max(500),
  })
  .strict();

const userIdSchema = z.object({ userId: z.string().uuid() });

export async function registerAdminRoutes(
  app: FastifyInstance,
  deps: { env: Env; db: Database },
): Promise<void> {
  const { env, db } = deps;

  app.get("/api/v1/admin/overview", async (request) => {
    await requireAdmin(request, env, db);
    const now = new Date();
    const [userStats, activeItems, plusMembers, paymentStats] = await Promise.all([
      db.select({ totalUsers: count() }).from(profiles),
      db
        .select({ activeItems: count() })
        .from(subscriptions)
        .where(eq(subscriptions.status, "active")),
      db
        .select({ plusMembers: count() })
        .from(profiles)
        .where(and(
          eq(profiles.planTier, "plus"),
          or(eq(profiles.planGrandfathered, true), gt(profiles.planExpiresAt, now)),
        )),
      db
        .select({
          paidTransactions: sql<number>`count(*) filter (where ${billingTransactions.status} = 'paid')::int`,
          pendingPayments: sql<number>`count(*) filter (where ${billingTransactions.status} = 'pending')::int`,
          grossPaidMinor: sql<string>`coalesce(sum(${billingTransactions.amountMinor}) filter (where ${billingTransactions.status} = 'paid'), 0)::text`,
        })
        .from(billingTransactions),
    ]);

    return {
      totalUsers: userStats[0]?.totalUsers ?? 0,
      activeItems: activeItems[0]?.activeItems ?? 0,
      plusMembers: plusMembers[0]?.plusMembers ?? 0,
      paidTransactions: paymentStats[0]?.paidTransactions ?? 0,
      pendingPayments: paymentStats[0]?.pendingPayments ?? 0,
      grossPaidMinor: paymentStats[0]?.grossPaidMinor ?? "0",
    };
  });

  app.get("/api/v1/admin/users", async (request) => {
    await requireAdmin(request, env, db);
    const { limit, offset, search } = parseBody(userQuerySchema, request.query);
    const filter = search
      ? or(ilike(profiles.email, `%${search}%`), ilike(profiles.displayName, `%${search}%`))
      : undefined;
    const [totalRows, users] = await Promise.all([
      db.select({ total: count() }).from(profiles).where(filter),
      db
        .select({
          userId: profiles.userId,
          email: profiles.email,
          displayName: profiles.displayName,
          plan: sql<"free" | "plus">`
            case
              when ${profiles.planTier} = 'plus'
                and (${profiles.planGrandfathered} or ${profiles.planExpiresAt} > now())
              then 'plus'
              else 'free'
            end
          `,
          planExpiresAt: profiles.planExpiresAt,
          planGrandfathered: profiles.planGrandfathered,
          suspendedAt: profiles.suspendedAt,
          suspensionReason: profiles.suspensionReason,
          createdAt: profiles.createdAt,
          activeItems: sql<number>`(
            select count(*)::int
            from public.subscriptions
            where public.subscriptions.user_id = ${profiles.userId}
              and public.subscriptions.status = 'active'
          )`,
        })
        .from(profiles)
        .where(filter)
        .orderBy(desc(profiles.createdAt))
        .limit(limit)
        .offset(offset),
    ]);

    return { users, total: totalRows[0]?.total ?? 0, limit, offset };
  });

  app.get("/api/v1/admin/billing", async (request) => {
    await requireAdmin(request, env, db);
    const { limit, offset, search, status } = parseBody(billingQuerySchema, request.query);
    const filters: SQL[] = [];
    if (status !== "all") filters.push(eq(billingTransactions.status, status));
    if (search) {
      const bySearch = or(
        ilike(profiles.email, `%${search}%`),
        ilike(billingTransactions.reference, `%${search}%`),
      );
      if (bySearch) filters.push(bySearch);
    }
    const filter = filters.length > 0 ? and(...filters) : undefined;
    const [totalRows, transactions] = await Promise.all([
      db
        .select({ total: count() })
        .from(billingTransactions)
        .leftJoin(profiles, eq(profiles.userId, billingTransactions.userId))
        .where(filter),
      db
        .select({
          id: billingTransactions.id,
          userId: billingTransactions.userId,
          email: profiles.email,
          reference: billingTransactions.reference,
          interval: billingTransactions.interval,
          amountMinor: billingTransactions.amountMinor,
          currency: billingTransactions.currency,
          status: billingTransactions.status,
          paidAt: billingTransactions.paidAt,
          accessUntil: billingTransactions.accessUntil,
          createdAt: billingTransactions.createdAt,
        })
        .from(billingTransactions)
        .leftJoin(profiles, eq(profiles.userId, billingTransactions.userId))
        .where(filter)
        .orderBy(desc(billingTransactions.createdAt))
        .limit(limit)
        .offset(offset),
    ]);

    return { transactions, total: totalRows[0]?.total ?? 0, limit, offset };
  });

  app.patch(
    "/api/v1/admin/users/:userId/suspension",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request) => {
      const admin = await requireAdmin(request, env, db);
      const { userId } = parseBody(userIdSchema, request.params);
      const input = parseBody(suspensionSchema, request.body);
      if (userId === admin.id && input.suspended) {
        throw conflict("You cannot suspend your own account.");
      }

      const [target] = await db
        .select({ userId: profiles.userId, suspendedAt: profiles.suspendedAt })
        .from(profiles)
        .where(eq(profiles.userId, userId))
        .limit(1);
      if (!target) throw notFound("Account not found.");
      if (input.suspended && (await isAdminUser(db, env, userId))) {
        throw conflict(
          "Remove this address from ADMIN_EMAILS before suspending an administrator.",
        );
      }
      if (Boolean(target.suspendedAt) === input.suspended) {
        throw conflict(
          input.suspended ? "This account is already suspended." : "This account is already active.",
        );
      }

      return db.transaction(async (tx) => {
        const [updated] = await tx
          .update(profiles)
          .set({
            suspendedAt: input.suspended ? new Date() : null,
            suspensionReason: input.suspended ? input.reason : null,
            updatedAt: new Date(),
          })
          .where(and(
            eq(profiles.userId, userId),
            input.suspended ? isNull(profiles.suspendedAt) : isNotNull(profiles.suspendedAt),
          ))
          .returning({
            userId: profiles.userId,
            suspendedAt: profiles.suspendedAt,
            suspensionReason: profiles.suspensionReason,
          });
        if (!updated) throw conflict("This account's status changed. Refresh and try again.");

        await recordAudit(tx, request, {
          userId: admin.id,
          action: input.suspended ? "admin.account.suspended" : "admin.account.reactivated",
          entityType: "profile",
          entityId: userId,
          metadata: { reason: input.reason },
        });
        return { user: updated };
      });
    },
  );
}
