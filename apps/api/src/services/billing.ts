import { and, eq, or, sql } from "drizzle-orm";
import type { Database } from "../db.js";
import { conflict, notFound } from "../lib/errors.js";
import { billingTransactions, profiles } from "@dueradar/db/schema";
import type { BillingTransaction } from "@dueradar/db/schema";
import type { VerifiedPaystackTransaction } from "./paystack.js";
import { PLUS_PRICES } from "./plan.js";

export function matchesBillingTransaction(
  transaction: Pick<
    BillingTransaction,
    "reference" | "interval" | "amountMinor" | "currency"
  >,
  payment: VerifiedPaystackTransaction,
): boolean {
  const expectedAmount = PLUS_PRICES[transaction.interval].amountMinor;
  return (
    payment.status === "success" &&
    payment.reference === transaction.reference &&
    transaction.amountMinor === expectedAmount &&
    payment.amount === expectedAmount &&
    transaction.currency === "GHS" &&
    payment.currency === transaction.currency
  );
}

function addMonthsClamped(date: Date, months: number): Date {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

export async function applyVerifiedPayment(
  db: Database,
  reference: string,
  payment: VerifiedPaystackTransaction,
): Promise<{ activated: boolean; accessUntil: Date | null }> {
  return db.transaction(async (tx) => {
    const [transaction] = await tx
      .select()
      .from(billingTransactions)
      .where(eq(billingTransactions.reference, reference))
      .for("update")
      .limit(1);
    if (!transaction) throw notFound("Payment reference not found.");
    if (payment.reference !== transaction.reference) {
      throw conflict("The verified payment does not match this checkout.");
    }

    if (!matchesBillingTransaction(transaction, payment)) {
      throw conflict("The payment could not be verified for this plan.");
    }

    if (transaction.status === "paid") {
      return { activated: false, accessUntil: transaction.accessUntil };
    }
    if (transaction.status !== "pending" && transaction.status !== "failed") {
      throw conflict("This payment is no longer eligible for activation.");
    }

    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${transaction.userId}, 0))`,
    );
    const [profile] = await tx
      .select({
        planExpiresAt: profiles.planExpiresAt,
        planGrandfathered: profiles.planGrandfathered,
      })
      .from(profiles)
      .where(eq(profiles.userId, transaction.userId))
      .for("update")
      .limit(1);
    if (!profile) throw new Error("Profile is required before activating Plus.");

    const now = new Date();
    const price = PLUS_PRICES[transaction.interval];
    const base =
      profile.planExpiresAt && profile.planExpiresAt.getTime() > now.getTime()
        ? profile.planExpiresAt
        : now;
    const accessUntil = profile.planGrandfathered
      ? null
      : addMonthsClamped(base, price.durationMonths);

    const [updated] = await tx
      .update(billingTransactions)
      .set({
        status: "paid",
        providerTransactionId: String(payment.id),
        paidAt: payment.paidAt ?? now,
        accessUntil,
        updatedAt: now,
      })
      .where(
        and(
          eq(billingTransactions.id, transaction.id),
          or(
            eq(billingTransactions.status, "pending"),
            eq(billingTransactions.status, "failed"),
          ),
        ),
      )
      .returning();
    if (!updated) throw conflict("This payment was already processed.");

    if (!profile.planGrandfathered) {
      await tx
        .update(profiles)
        .set({
          planTier: "plus",
          planExpiresAt: accessUntil,
          updatedAt: now,
        })
        .where(eq(profiles.userId, transaction.userId));
    }

    return { activated: true, accessUntil };
  });
}
