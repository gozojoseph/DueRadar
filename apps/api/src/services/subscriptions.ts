import { and, eq, gte, min, sql } from "drizzle-orm";
import type { DatabaseExecutor } from "@dueradar/db";
import {
  billingOccurrences,
  categories,
  paymentMethods,
  subscriptions,
} from "@dueradar/db/schema";
import type { BillingCycle, RecordKind, Subscription } from "@dueradar/db/schema";
import {
  addMonthsClamped,
  generateOccurrences,
  maxDate,
  occurrenceView,
  todayInTimeZone,
} from "@dueradar/domain";
import type { Database } from "../db.js";
import { cancelSubscriptionReminders, syncSubscriptionReminders } from "@dueradar/scheduling";

export interface SubscriptionInput {
  name: string;
  vendor?: string | null;
  kind: RecordKind;
  amountMinor: number;
  currency: string;
  cycle: BillingCycle;
  customIntervalDays?: number | null;
  anchorDate: string;
  endOfMonthMode: boolean;
  trialEndsAt?: string | null;
  categoryId?: string | null;
  paymentMethodId?: string | null;
  url?: string | null;
  notes?: string | null;
  reminderOffsets?: number[] | null;
  reminderChannels?: Array<"email" | "push" | "in_app"> | null;
  status?: "active" | "paused" | "cancelled";
}

export interface SubscriptionPatch extends Partial<SubscriptionInput> {}

function normaliseUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function normaliseInput(input: SubscriptionInput): SubscriptionInput {
  return {
    ...input,
    name: input.name.trim(),
    vendor: input.vendor?.trim() || null,
    url: normaliseUrl(input.url),
    notes: input.notes?.trim() || null,
  };
}

async function assertOwnedReferences(
  db: DatabaseExecutor,
  userId: string,
  input: Pick<SubscriptionInput, "categoryId" | "paymentMethodId">,
): Promise<void> {
  if (input.categoryId) {
    const [category] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.id, input.categoryId), eq(categories.userId, userId)))
      .limit(1);
    if (!category) throw new Error("category_not_owned");
  }
  if (input.paymentMethodId) {
    const [method] = await db
      .select({ id: paymentMethods.id })
      .from(paymentMethods)
      .where(and(eq(paymentMethods.id, input.paymentMethodId), eq(paymentMethods.userId, userId)))
      .limit(1);
    if (!method) throw new Error("payment_method_not_owned");
  }
}

async function materialiseOccurrences(
  db: DatabaseExecutor,
  subscription: Subscription,
  today: string,
): Promise<void> {
  if (subscription.kind === "trial") {
    const dueDate = subscription.trialEndsAt ?? subscription.anchorDate;
    await db
      .insert(billingOccurrences)
      .values({
        userId: subscription.userId,
        subscriptionId: subscription.id,
        dueDate,
        periodStart: dueDate,
        periodEnd: dueDate,
        amountMinor: subscription.amountMinor,
        currency: subscription.currency,
        status: "pending",
      })
      .onConflictDoNothing();
    return;
  }

  const recurrence = {
    anchorDate: subscription.anchorDate,
    cycle: subscription.cycle,
    customIntervalDays: subscription.customIntervalDays,
    endOfMonthMode: subscription.endOfMonthMode,
  };
  const through = addMonthsClamped(maxDate(today, subscription.anchorDate), 24);
  const seeds = generateOccurrences(recurrence, through, { maxCount: 200 });

  if (seeds.length === 0) {
    const dueDate = subscription.anchorDate;
    seeds.push({ dueDate, periodStart: dueDate, periodEnd: dueDate, index: 0 });
  }

  await db
    .insert(billingOccurrences)
    .values(
      seeds.map((seed) => ({
        userId: subscription.userId,
        subscriptionId: subscription.id,
        dueDate: seed.dueDate,
        periodStart: seed.periodStart,
        periodEnd: seed.periodEnd,
        amountMinor: subscription.amountMinor,
        currency: subscription.currency,
        status: "pending" as const,
      })),
    )
    .onConflictDoNothing();
}

export async function refreshNextDueDate(
  db: DatabaseExecutor,
  subscriptionId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ next: min(billingOccurrences.dueDate) })
    .from(billingOccurrences)
    .where(
      and(
        eq(billingOccurrences.subscriptionId, subscriptionId),
        eq(billingOccurrences.status, "pending"),
      ),
    );
  const nextDueDate = row?.next ?? null;
  await db
    .update(subscriptions)
    .set({ nextDueDate, updatedAt: new Date() })
    .where(eq(subscriptions.id, subscriptionId));
  return nextDueDate;
}

export async function listSubscriptions(
  db: Database,
  userId: string,
  filters: { status?: string; kind?: string; search?: string },
) {
  const rows = await db
    .select({
      subscription: subscriptions,
      categoryName: categories.name,
      categoryColor: categories.color,
      methodLabel: paymentMethods.label,
    })
    .from(subscriptions)
    .leftJoin(categories, eq(categories.id, subscriptions.categoryId))
    .leftJoin(paymentMethods, eq(paymentMethods.id, subscriptions.paymentMethodId))
    .where(
      and(
        eq(subscriptions.userId, userId),
        filters.status ? eq(subscriptions.status, filters.status as Subscription["status"]) : undefined,
        filters.kind ? eq(subscriptions.kind, filters.kind as RecordKind) : undefined,
        filters.search
          ? sql`(${subscriptions.name} ilike ${`%${filters.search}%`} or coalesce(${subscriptions.vendor}, '') ilike ${`%${filters.search}%`})`
          : undefined,
      ),
    )
    .orderBy(subscriptions.status, subscriptions.nextDueDate, subscriptions.name);

  return rows.map((row) => ({
    ...row.subscription,
    categoryName: row.categoryName,
    categoryColor: row.categoryColor,
    paymentMethodLabel: row.methodLabel,
  }));
}

export async function getOwnedSubscription(
  db: Database,
  userId: string,
  subscriptionId: string,
): Promise<Subscription | null> {
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.id, subscriptionId), eq(subscriptions.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function createSubscription(
  db: DatabaseExecutor,
  userId: string,
  rawInput: SubscriptionInput,
  timeZone: string,
) {
  const input = normaliseInput(rawInput);
  try {
    await assertOwnedReferences(db, userId, input);
  } catch (error) {
    if (error instanceof Error && error.message === "category_not_owned") {
      throw new Error("category_not_owned");
    }
    throw error;
  }

  const anchorDate =
    input.kind === "trial" && input.trialEndsAt ? input.trialEndsAt : input.anchorDate;

  const [created] = await db
    .insert(subscriptions)
    .values({
      userId,
      name: input.name,
      vendor: input.vendor ?? null,
      kind: input.kind,
      status: "active",
      amountMinor: input.amountMinor,
      currency: input.currency,
      cycle: input.kind === "trial" ? "monthly" : input.cycle,
      customIntervalDays: input.cycle === "custom_days" ? input.customIntervalDays ?? null : null,
      anchorDate,
      endOfMonthMode: input.endOfMonthMode,
      trialEndsAt: input.trialEndsAt ?? null,
      categoryId: input.categoryId ?? null,
      paymentMethodId: input.paymentMethodId ?? null,
      url: input.url ?? null,
      notes: input.notes ?? null,
      reminderOffsets: input.reminderOffsets ?? null,
      reminderChannels: input.reminderChannels ?? null,
    })
    .returning();

  if (!created) throw new Error("Failed to create subscription");

  const today = todayInTimeZone(timeZone);
  await materialiseOccurrences(db, created, today);
  const nextDueDate = await refreshNextDueDate(db, created.id);
  await syncSubscriptionReminders(db, userId, created.id);

  return { ...created, nextDueDate };
}

export async function updateSubscription(
  db: Database,
  userId: string,
  subscriptionId: string,
  patch: SubscriptionPatch,
  timeZone: string,
): Promise<Subscription | null> {
  const existing = await getOwnedSubscription(db, userId, subscriptionId);
  if (!existing) return null;

  const merged: SubscriptionInput = {
    name: patch.name ?? existing.name,
    vendor: patch.vendor !== undefined ? patch.vendor : existing.vendor,
    kind: patch.kind ?? existing.kind,
    amountMinor: patch.amountMinor ?? existing.amountMinor,
    currency: patch.currency ?? existing.currency,
    cycle: patch.cycle ?? existing.cycle,
    customIntervalDays:
      patch.customIntervalDays !== undefined
        ? patch.customIntervalDays
        : existing.customIntervalDays,
    anchorDate: patch.anchorDate ?? existing.anchorDate,
    endOfMonthMode: patch.endOfMonthMode ?? existing.endOfMonthMode,
    trialEndsAt: patch.trialEndsAt !== undefined ? patch.trialEndsAt : existing.trialEndsAt,
    categoryId: patch.categoryId !== undefined ? patch.categoryId : existing.categoryId,
    paymentMethodId:
      patch.paymentMethodId !== undefined ? patch.paymentMethodId : existing.paymentMethodId,
    url: patch.url !== undefined ? patch.url : existing.url,
    notes: patch.notes !== undefined ? patch.notes : existing.notes,
    reminderOffsets:
      patch.reminderOffsets !== undefined ? patch.reminderOffsets : existing.reminderOffsets,
    reminderChannels:
      patch.reminderChannels !== undefined ? patch.reminderChannels : existing.reminderChannels,
    status: patch.status ?? existing.status,
  };

  const input = normaliseInput(merged);
  try {
    await assertOwnedReferences(db, userId, input);
  } catch (error) {
    if (error instanceof Error && error.message === "category_not_owned") {
      throw new Error("category_not_owned");
    }
    throw error;
  }

  const anchorDate =
    input.kind === "trial" && input.trialEndsAt ? input.trialEndsAt : input.anchorDate;

  const structureChanged =
    anchorDate !== existing.anchorDate ||
    input.cycle !== existing.cycle ||
    input.customIntervalDays !== existing.customIntervalDays ||
    input.endOfMonthMode !== existing.endOfMonthMode ||
    input.kind !== existing.kind ||
    (input.trialEndsAt ?? null) !== (existing.trialEndsAt ?? null);

  const priceChanged =
    input.amountMinor !== existing.amountMinor || input.currency !== existing.currency;

  const today = todayInTimeZone(timeZone);

  if (structureChanged) {
    await db
      .delete(billingOccurrences)
      .where(
        and(
          eq(billingOccurrences.subscriptionId, subscriptionId),
          eq(billingOccurrences.status, "pending"),
          gte(billingOccurrences.dueDate, today),
        ),
      );
  }

  if (priceChanged) {
    await db
      .update(billingOccurrences)
      .set({
        amountMinor: input.amountMinor,
        currency: input.currency,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(billingOccurrences.subscriptionId, subscriptionId),
          eq(billingOccurrences.status, "pending"),
          gte(billingOccurrences.dueDate, today),
        ),
      );
  }

  const nextStatus = input.status ?? existing.status;
  const [updated] = await db
    .update(subscriptions)
    .set({
      name: input.name,
      vendor: input.vendor ?? null,
      kind: input.kind,
      amountMinor: input.amountMinor,
      currency: input.currency,
      cycle: input.kind === "trial" ? "monthly" : input.cycle,
      customIntervalDays: input.cycle === "custom_days" ? input.customIntervalDays ?? null : null,
      anchorDate,
      endOfMonthMode: input.endOfMonthMode,
      trialEndsAt: input.trialEndsAt ?? null,
      categoryId: input.categoryId ?? null,
      paymentMethodId: input.paymentMethodId ?? null,
      url: input.url ?? null,
      notes: input.notes ?? null,
      reminderOffsets: input.reminderOffsets ?? null,
      reminderChannels: input.reminderChannels ?? null,
      status: nextStatus,
      cancelledAt:
        nextStatus === "cancelled" ? existing.cancelledAt ?? new Date() : null,
      updatedAt: new Date(),
    })
    .where(and(eq(subscriptions.id, subscriptionId), eq(subscriptions.userId, userId)))
    .returning();

  if (!updated) return null;

  await materialiseOccurrences(db, updated, today);
  await refreshNextDueDate(db, subscriptionId);

  if (updated.status === "active") {
    await syncSubscriptionReminders(db, userId, subscriptionId);
  } else {
    await cancelSubscriptionReminders(db, subscriptionId);
  }

  const [fresh] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, subscriptionId))
    .limit(1);
  return fresh ?? updated;
}

export async function getSubscriptionDetail(
  db: Database,
  userId: string,
  subscriptionId: string,
  timeZone: string,
) {
  const [row] = await db
    .select({
      subscription: subscriptions,
      categoryName: categories.name,
      categoryColor: categories.color,
      methodLabel: paymentMethods.label,
    })
    .from(subscriptions)
    .leftJoin(categories, eq(categories.id, subscriptions.categoryId))
    .leftJoin(paymentMethods, eq(paymentMethods.id, subscriptions.paymentMethodId))
    .where(and(eq(subscriptions.id, subscriptionId), eq(subscriptions.userId, userId)))
    .limit(1);

  if (!row) return null;

  const occurrences = await db
    .select()
    .from(billingOccurrences)
    .where(
      and(
        eq(billingOccurrences.subscriptionId, subscriptionId),
        eq(billingOccurrences.userId, userId),
      ),
    )
    .orderBy(billingOccurrences.dueDate)
    .limit(120);

  const today = todayInTimeZone(timeZone);
  return {
    ...row.subscription,
    categoryName: row.categoryName,
    categoryColor: row.categoryColor,
    paymentMethodLabel: row.methodLabel,
    occurrences: occurrences.map((occurrence) => ({
      ...occurrence,
      view: occurrenceView(occurrence.status, occurrence.dueDate, today),
    })),
  };
}

export async function deleteSubscription(
  db: Database,
  userId: string,
  subscriptionId: string,
): Promise<boolean> {
  const existing = await getOwnedSubscription(db, userId, subscriptionId);
  if (!existing) return false;
  await cancelSubscriptionReminders(db, subscriptionId);
  await db
    .delete(subscriptions)
    .where(and(eq(subscriptions.id, subscriptionId), eq(subscriptions.userId, userId)));
  return true;
}
