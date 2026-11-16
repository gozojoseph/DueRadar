import { and, count, eq, sql } from "drizzle-orm";
import { profiles, subscriptions } from "@dueradar/db/schema";
import type { DatabaseExecutor } from "@dueradar/db";
import { paymentRequired } from "../lib/errors.js";

export const FREE_ACTIVE_ITEM_LIMIT = 5;

export const PLUS_PRICES = {
  monthly: { amountMinor: 999, amountGhs: "9.99", durationMonths: 1 },
  annual: { amountMinor: 9_900, amountGhs: "99.00", durationMonths: 12 },
} as const;

export type PaidInterval = keyof typeof PLUS_PRICES;

export async function lockPlanForUser(db: DatabaseExecutor, userId: string): Promise<void> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);
}

export function hasPlusAccess(
  profile: Pick<
    typeof profiles.$inferSelect,
    "planTier" | "planExpiresAt" | "planGrandfathered"
  >,
  now = new Date(),
): boolean {
  return (
    profile.planTier === "plus" &&
    (profile.planGrandfathered ||
      (profile.planExpiresAt !== null && profile.planExpiresAt.getTime() > now.getTime()))
  );
}

export async function getPlanAccess(
  db: DatabaseExecutor,
  userId: string,
  now = new Date(),
) {
  const [profile] = await db
    .select({
      planTier: profiles.planTier,
      planExpiresAt: profiles.planExpiresAt,
      planGrandfathered: profiles.planGrandfathered,
    })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);

  if (!profile) throw new Error("Profile is required before resolving plan access.");

  const [activeResult] = await db
    .select({ count: count() })
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, "active")));
  const activeItems = activeResult?.count ?? 0;
  const isPlus = hasPlusAccess(profile, now);

  return {
    tier: isPlus ? ("plus" as const) : ("free" as const),
    grandfathered: isPlus && profile.planGrandfathered,
    expiresAt: profile.planGrandfathered ? null : profile.planExpiresAt,
    activeItems,
    activeItemLimit: isPlus ? null : FREE_ACTIVE_ITEM_LIMIT,
    canUseEmailImport: isPlus,
  };
}

export async function enforceActiveItemLimit(
  db: DatabaseExecutor,
  userId: string,
  now = new Date(),
): Promise<void> {
  const [profile] = await db
    .select({
      planTier: profiles.planTier,
      planExpiresAt: profiles.planExpiresAt,
      planGrandfathered: profiles.planGrandfathered,
    })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);

  if (!profile) throw new Error("Profile is required before enforcing plan access.");
  if (hasPlusAccess(profile, now)) return;

  const [activeResult] = await db
    .select({ count: count() })
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, "active")));

  if ((activeResult?.count ?? 0) >= FREE_ACTIVE_ITEM_LIMIT) {
    throw paymentRequired(
      `The Free plan includes ${FREE_ACTIVE_ITEM_LIMIT} active items. Upgrade to Plus to add or reactivate more.`,
    );
  }
}
