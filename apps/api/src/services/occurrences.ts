import { and, asc, eq, gte, lte, min, sql } from "drizzle-orm";
import {
  billingOccurrences,
  categories,
  payments,
  subscriptions,
} from "@dueradar/db/schema";
import type { BillingOccurrence } from "@dueradar/db/schema";
import {
  occurrenceView,
  todayInTimeZone,
  type OccurrenceView,
} from "@dueradar/domain";
import type { Database } from "../db.js";
import { conflict, notFound } from "../lib/errors.js";
import { planOccurrenceReminders } from "@dueradar/scheduling";

export interface OccurrenceFilters {
  from?: string;
  to?: string;
  status?: string;
  view?: string;
  kind?: string;
  subscriptionId?: string;
  limit?: number;
}

const occurrenceColumns = {
  id: billingOccurrences.id,
  subscriptionId: billingOccurrences.subscriptionId,
  userId: billingOccurrences.userId,
  dueDate: billingOccurrences.dueDate,
  periodStart: billingOccurrences.periodStart,
  periodEnd: billingOccurrences.periodEnd,
  amountMinor: billingOccurrences.amountMinor,
  currency: billingOccurrences.currency,
  status: billingOccurrences.status,
  paidAt: billingOccurrences.paidAt,
  paymentId: billingOccurrences.paymentId,
  snoozedUntil: billingOccurrences.snoozedUntil,
  name: subscriptions.name,
  vendor: subscriptions.vendor,
  kind: subscriptions.kind,
  cycle: subscriptions.cycle,
  subscriptionStatus: subscriptions.status,
  categoryName: categories.name,
  categoryColor: categories.color,
};

export type OccurrenceRow = {
  id: string;
  subscriptionId: string;
  userId: string;
  dueDate: string;
  periodStart: string;
  periodEnd: string;
  amountMinor: number;
  currency: string;
  status: BillingOccurrence["status"];
  paidAt: Date | null;
  paymentId: string | null;
  snoozedUntil: string | null;
  name: string;
  vendor: string | null;
  kind: string;
  cycle: string;
  subscriptionStatus: string;
  categoryName: string | null;
  categoryColor: string | null;
  view: OccurrenceView;
  daysUntil: number;
};

export async function listOccurrences(
  db: Database,
  userId: string,
  timeZone: string,
  filters: OccurrenceFilters,
): Promise<OccurrenceRow[]> {
  const rows = await db
    .select(occurrenceColumns)
    .from(billingOccurrences)
    .innerJoin(subscriptions, eq(subscriptions.id, billingOccurrences.subscriptionId))
    .leftJoin(categories, eq(categories.id, subscriptions.categoryId))
    .where(
      and(
        eq(billingOccurrences.userId, userId),
        filters.from ? gte(billingOccurrences.dueDate, filters.from) : undefined,
        filters.to ? lte(billingOccurrences.dueDate, filters.to) : undefined,
        filters.status
          ? eq(billingOccurrences.status, filters.status as BillingOccurrence["status"])
          : undefined,
        filters.kind ? eq(subscriptions.kind, filters.kind as never) : undefined,
        filters.subscriptionId
          ? eq(billingOccurrences.subscriptionId, filters.subscriptionId)
          : undefined,
        filters.status && filters.status !== "pending"
          ? undefined
          : eq(subscriptions.status, "active"),
      ),
    )
    .orderBy(asc(billingOccurrences.dueDate), asc(subscriptions.name))
    .limit(filters.limit ?? 500);

  const today = todayInTimeZone(timeZone);
  const mapped = rows.map((row) => {
    const view = occurrenceView(row.status, row.dueDate, today);
    const daysUntil = Math.round(
      (Date.parse(`${row.dueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
    );
    return { ...row, view, daysUntil };
  });

  if (!filters.view) return mapped;
  return mapped.filter((row) => row.view === filters.view);
}

export async function getOwnedOccurrence(
  db: Database,
  userId: string,
  occurrenceId: string,
): Promise<BillingOccurrence | null> {
  const [row] = await db
    .select()
    .from(billingOccurrences)
    .where(
      and(
        eq(billingOccurrences.id, occurrenceId),
        eq(billingOccurrences.userId, userId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function refreshNextDue(
  db: Database,
  userId: string,
  subscriptionId: string,
): Promise<void> {
  const [row] = await db
    .select({ next: min(billingOccurrences.dueDate) })
    .from(billingOccurrences)
    .where(
      and(
        eq(billingOccurrences.subscriptionId, subscriptionId),
        eq(billingOccurrences.userId, userId),
        eq(billingOccurrences.status, "pending"),
      ),
    );
  await db
    .update(subscriptions)
    .set({ nextDueDate: row?.next ?? null, updatedAt: new Date() })
    .where(and(eq(subscriptions.id, subscriptionId), eq(subscriptions.userId, userId)));
}

export interface PayInput {
  amountMinor?: number;
  paidAt?: string;
  method?: string | null;
  reference?: string | null;
  notes?: string | null;
}

export async function payOccurrence(
  db: Database,
  userId: string,
  occurrenceId: string,
  input: PayInput,
) {
  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ occurrence: billingOccurrences, subscription: subscriptions })
      .from(billingOccurrences)
      .innerJoin(subscriptions, eq(subscriptions.id, billingOccurrences.subscriptionId))
      .where(
        and(
          eq(billingOccurrences.id, occurrenceId),
          eq(billingOccurrences.userId, userId),
        ),
      )
      .limit(1)
      .for("update");

    if (!row) throw notFound("That payment is no longer available.");
    const occurrence = row.occurrence;

    if (occurrence.status === "paid") {
      const existing = occurrence.paymentId
        ? await tx
            .select()
            .from(payments)
            .where(and(eq(payments.id, occurrence.paymentId), eq(payments.userId, userId)))
            .limit(1)
        : [];
      return { alreadyPaid: true, payment: existing[0] ?? null, occurrence };
    }

    if (occurrence.status !== "pending") {
      throw conflict("This occurrence was skipped or cancelled and cannot be marked paid.");
    }

    const amountMinor = input.amountMinor ?? occurrence.amountMinor;
    const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();

    const [payment] = await tx
      .insert(payments)
      .values({
        userId,
        subscriptionId: occurrence.subscriptionId,
        occurrenceId: occurrence.id,
        amountMinor,
        currency: occurrence.currency,
        paidAt,
        method: input.method ?? null,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
        source: "manual",
        description: row.subscription.name,
      })
      .returning();

    const [updated] = await tx
      .update(billingOccurrences)
      .set({
        status: "paid",
        paidAt,
        paymentId: payment?.id ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(billingOccurrences.id, occurrenceId),
          eq(billingOccurrences.userId, userId),
        ),
      )
      .returning();

    const [next] = await tx
      .select({ next: min(billingOccurrences.dueDate) })
      .from(billingOccurrences)
      .where(
        and(
          eq(billingOccurrences.subscriptionId, occurrence.subscriptionId),
          eq(billingOccurrences.status, "pending"),
        ),
      );
    await tx
      .update(subscriptions)
      .set({ nextDueDate: next?.next ?? null, updatedAt: new Date() })
      .where(eq(subscriptions.id, occurrence.subscriptionId));

    return { alreadyPaid: false, payment: payment ?? null, occurrence: updated ?? occurrence };
  });

  if (!result.alreadyPaid) {
    await planOccurrenceReminders(db, occurrenceId);
  }
  return result;
}

export async function unpayOccurrence(
  db: Database,
  userId: string,
  occurrenceId: string,
) {
  const row = await db.transaction(async (tx) => {
    const [occurrence] = await tx
      .select()
      .from(billingOccurrences)
      .where(
        and(
          eq(billingOccurrences.id, occurrenceId),
          eq(billingOccurrences.userId, userId),
        ),
      )
      .limit(1)
      .for("update");

    if (!occurrence) throw notFound("That payment is no longer available.");
    if (occurrence.status !== "paid") throw conflict("This occurrence is not marked paid.");

    if (occurrence.paymentId) {
      await tx
        .delete(payments)
        .where(and(eq(payments.id, occurrence.paymentId), eq(payments.userId, userId)));
    }

    const [updated] = await tx
      .update(billingOccurrences)
      .set({ status: "pending", paidAt: null, paymentId: null, updatedAt: new Date() })
      .where(
        and(
          eq(billingOccurrences.id, occurrenceId),
          eq(billingOccurrences.userId, userId),
        ),
      )
      .returning();

    if (!updated) throw notFound();
    await refreshNextDue(tx as unknown as Database, userId, updated.subscriptionId);
    return updated;
  });

  await planOccurrenceReminders(db, occurrenceId);
  return row;
}

export async function skipOccurrence(
  db: Database,
  userId: string,
  occurrenceId: string,
) {
  const occurrence = await getOwnedOccurrence(db, userId, occurrenceId);
  if (!occurrence) throw notFound("That occurrence is no longer available.");
  if (occurrence.status !== "pending") {
    throw conflict("Only a pending occurrence can be skipped.");
  }

  const [updated] = await db
    .update(billingOccurrences)
    .set({ status: "skipped", updatedAt: new Date() })
    .where(
      and(
        eq(billingOccurrences.id, occurrenceId),
        eq(billingOccurrences.userId, userId),
      ),
    )
    .returning();

  await refreshNextDue(db, userId, occurrence.subscriptionId);
  await planOccurrenceReminders(db, occurrenceId);
  return updated;
}

export async function unskipOccurrence(
  db: Database,
  userId: string,
  occurrenceId: string,
) {
  const occurrence = await getOwnedOccurrence(db, userId, occurrenceId);
  if (!occurrence) throw notFound("That occurrence is no longer available.");
  if (occurrence.status !== "skipped") throw conflict("This occurrence was not skipped.");

  const [updated] = await db
    .update(billingOccurrences)
    .set({ status: "pending", updatedAt: new Date() })
    .where(
      and(
        eq(billingOccurrences.id, occurrenceId),
        eq(billingOccurrences.userId, userId),
      ),
    )
    .returning();
  await refreshNextDue(db, userId, occurrence.subscriptionId);
  await planOccurrenceReminders(db, occurrenceId);
  return updated;
}

export async function snoozeOccurrence(
  db: Database,
  userId: string,
  occurrenceId: string,
  until: string,
) {
  const occurrence = await getOwnedOccurrence(db, userId, occurrenceId);
  if (!occurrence) throw notFound("That occurrence is no longer available.");
  if (occurrence.status !== "pending") throw conflict("Only a pending occurrence can be snoozed.");

  const [updated] = await db
    .update(billingOccurrences)
    .set({ snoozedUntil: until, updatedAt: new Date() })
    .where(
      and(
        eq(billingOccurrences.id, occurrenceId),
        eq(billingOccurrences.userId, userId),
      ),
    )
    .returning();
  await planOccurrenceReminders(db, occurrenceId);
  return updated;
}

export async function clearSnooze(
  db: Database,
  userId: string,
  occurrenceId: string,
) {
  const occurrence = await getOwnedOccurrence(db, userId, occurrenceId);
  if (!occurrence) throw notFound("That occurrence is no longer available.");

  const [updated] = await db
    .update(billingOccurrences)
    .set({ snoozedUntil: null, updatedAt: new Date() })
    .where(
      and(
        eq(billingOccurrences.id, occurrenceId),
        eq(billingOccurrences.userId, userId),
      ),
    )
    .returning();
  await planOccurrenceReminders(db, occurrenceId);
  return updated;
}

export async function countOpenOccurrences(
  db: Database,
  userId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(billingOccurrences)
    .innerJoin(subscriptions, eq(subscriptions.id, billingOccurrences.subscriptionId))
    .where(
      and(
        eq(billingOccurrences.userId, userId),
        eq(billingOccurrences.status, "pending"),
        eq(subscriptions.status, "active"),
      ),
    );
  return row?.count ?? 0;
}
