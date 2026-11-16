import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Application tables live in `public`. Authentication tables are owned by
 * Neon Auth in `neon_auth` and are deliberately not referenced by foreign
 * keys; ownership is keyed by the auth user id and enforced in every query.
 */

export type RecordKind = "subscription" | "bill" | "trial" | "prepaid" | "installment";
export type RecordStatus = "active" | "paused" | "cancelled";
export type BillingCycle =
  | "weekly"
  | "monthly"
  | "quarterly"
  | "semiannual"
  | "annual"
  | "custom_days";
export type OccurrenceStatus = "pending" | "paid" | "skipped" | "canceled";
export type ReminderChannel = "email" | "push" | "in_app";
export type ReminderJobStatus =
  | "scheduled"
  | "processing"
  | "sent"
  | "failed"
  | "skipped"
  | "canceled";
export type PaymentMethodKind = "card" | "momo" | "bank" | "wallet" | "cash" | "other";
export type PaymentSource = "manual" | "import" | "detection";
export type SuggestionStatus = "pending" | "accepted" | "rejected";
export type ImportStatus = "pending" | "processed" | "failed" | "expired";
export type ProviderConnectionStatus = "active" | "revoked" | "error";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const profiles = pgTable(
  "profiles",
  {
    userId: text("user_id").primaryKey(),
    email: text("email").notNull(),
    displayName: text("display_name"),
    timezone: text("timezone").notNull().default("Africa/Accra"),
    currency: varchar("currency", { length: 3 }).notNull().default("GHS"),
    locale: text("locale").notNull().default("en-GH"),
    weekStartsOn: integer("week_starts_on").notNull().default(1),
    reminderTime: text("reminder_time").notNull().default("09:00"),
    quietHoursStart: text("quiet_hours_start").notNull().default("21:00"),
    quietHoursEnd: text("quiet_hours_end").notNull().default("07:00"),
    emailReminders: boolean("email_reminders").notNull().default(true),
    pushReminders: boolean("push_reminders").notNull().default(false),
    onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    check("profiles_currency_check", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check("profiles_week_start_check", sql`${table.weekStartsOn} between 0 and 1`),
  ],
);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    color: text("color").notNull().default("#0f766e"),
    icon: text("icon").notNull().default("tag"),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex("categories_user_name_uq").on(table.userId, table.name),
    index("categories_user_idx").on(table.userId),
  ],
);

export const paymentMethods = pgTable(
  "payment_methods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    label: text("label").notNull(),
    kind: text("kind").$type<PaymentMethodKind>().notNull().default("card"),
    brand: text("brand"),
    /** Last four digits only. Full card numbers are never stored. */
    last4: varchar("last4", { length: 4 }),
    expiryMonth: integer("expiry_month"),
    expiryYear: integer("expiry_year"),
    isDefault: boolean("is_default").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    index("payment_methods_user_idx").on(table.userId),
    check(
      "payment_methods_kind_check",
      sql`${table.kind} in ('card','momo','bank','wallet','cash','other')`,
    ),
    check(
      "payment_methods_last4_check",
      sql`${table.last4} is null or ${table.last4} ~ '^[0-9]{4}$'`,
    ),
  ],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    vendor: text("vendor"),
    kind: text("kind").$type<RecordKind>().notNull().default("subscription"),
    status: text("status").$type<RecordStatus>().notNull().default("active"),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("GHS"),
    cycle: text("cycle").$type<BillingCycle>().notNull().default("monthly"),
    customIntervalDays: integer("custom_interval_days"),
    anchorDate: date("anchor_date", { mode: "string" }).notNull(),
    endOfMonthMode: boolean("end_of_month_mode").notNull().default(false),
    trialEndsAt: date("trial_ends_at", { mode: "string" }),
    nextDueDate: date("next_due_date", { mode: "string" }),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    paymentMethodId: uuid("payment_method_id").references(() => paymentMethods.id, {
      onDelete: "set null",
    }),
    url: text("url"),
    notes: text("notes"),
    reminderOffsets: jsonb("reminder_offsets").$type<number[] | null>(),
    reminderChannels: jsonb("reminder_channels").$type<ReminderChannel[] | null>(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("subscriptions_user_status_idx").on(table.userId, table.status),
    index("subscriptions_user_next_due_idx").on(table.userId, table.nextDueDate),
    check("subscriptions_amount_check", sql`${table.amountMinor} >= 0`),
    check("subscriptions_currency_check", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check(
      "subscriptions_kind_check",
      sql`${table.kind} in ('subscription','bill','trial','prepaid','installment')`,
    ),
    check("subscriptions_status_check", sql`${table.status} in ('active','paused','cancelled')`),
    check(
      "subscriptions_cycle_check",
      sql`${table.cycle} in ('weekly','monthly','quarterly','semiannual','annual','custom_days')`,
    ),
    check(
      "subscriptions_custom_interval_check",
      sql`${table.cycle} <> 'custom_days' or (${table.customIntervalDays} is not null and ${table.customIntervalDays} >= 1)`,
    ),
  ],
);

export const billingOccurrences = pgTable(
  "billing_occurrences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    periodStart: date("period_start", { mode: "string" }).notNull(),
    periodEnd: date("period_end", { mode: "string" }).notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    status: text("status").$type<OccurrenceStatus>().notNull().default("pending"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    paymentId: uuid("payment_id"),
    /** Suppresses generated reminders until this local date; a snooze job is added instead. */
    snoozedUntil: date("snoozed_until", { mode: "string" }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("billing_occurrences_subscription_due_uq").on(table.subscriptionId, table.dueDate),
    index("billing_occurrences_user_due_idx").on(table.userId, table.dueDate),
    index("billing_occurrences_user_status_idx").on(table.userId, table.status, table.dueDate),
    check(
      "billing_occurrences_status_check",
      sql`${table.status} in ('pending','paid','skipped','canceled')`,
    ),
    check("billing_occurrences_amount_check", sql`${table.amountMinor} >= 0`),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id, {
      onDelete: "set null",
    }),
    occurrenceId: uuid("occurrence_id").references(() => billingOccurrences.id, {
      onDelete: "set null",
    }),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }).notNull().defaultNow(),
    method: text("method"),
    reference: text("reference"),
    source: text("source").$type<PaymentSource>().notNull().default("manual"),
    notes: text("notes"),
    /** Snapshot of the item name so history survives deleting the subscription. */
    description: text("description"),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    index("payments_user_paid_idx").on(table.userId, table.paidAt),
    index("payments_subscription_idx").on(table.subscriptionId),
    check("payments_amount_check", sql`${table.amountMinor} >= 0`),
    check("payments_source_check", sql`${table.source} in ('manual','import','detection')`),
  ],
);

export const imports = pgTable(
  "imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    source: text("source").notNull(),
    status: text("status").$type<ImportStatus>().notNull().default("pending"),
    rawText: text("raw_text"),
    rawRetentionUntil: timestamp("raw_retention_until", { withTimezone: true }),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    index("imports_user_created_idx").on(table.userId, table.createdAt),
    check(
      "imports_source_check",
      sql`${table.source} in ('paste','email','upload','ocr','csv','api')`,
    ),
    check("imports_status_check", sql`${table.status} in ('pending','processed','failed','expired')`),
  ],
);

export const detectionSuggestions = pgTable(
  "detection_suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    importId: uuid("import_id").references(() => imports.id, { onDelete: "cascade" }),
    kind: text("kind"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    confidence: integer("confidence").notNull().default(0),
    status: text("status").$type<SuggestionStatus>().notNull().default("pending"),
    dedupeKey: text("dedupe_key").notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex("detection_suggestions_dedupe_uq").on(table.dedupeKey),
    index("detection_suggestions_user_status_idx").on(table.userId, table.status),
    check("detection_suggestions_confidence_check", sql`${table.confidence} between 0 and 100`),
    check(
      "detection_suggestions_status_check",
      sql`${table.status} in ('pending','accepted','rejected')`,
    ),
  ],
);

export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    platform: text("platform"),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex("devices_endpoint_uq").on(table.endpoint),
    index("devices_user_idx").on(table.userId),
  ],
);

export const reminderJobs = pgTable(
  "reminder_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id, {
      onDelete: "cascade",
    }),
    occurrenceId: uuid("occurrence_id")
      .notNull()
      .references(() => billingOccurrences.id, { onDelete: "cascade" }),
    channel: text("channel").$type<ReminderChannel>().notNull(),
    offsetDays: integer("offset_days").notNull(),
    fireAt: timestamp("fire_at", { withTimezone: true }).notNull(),
    status: text("status").$type<ReminderJobStatus>().notNull().default("scheduled"),
    attempts: integer("attempts").notNull().default(0),
    dedupeKey: text("dedupe_key").notNull(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("reminder_jobs_dedupe_uq").on(table.dedupeKey),
    index("reminder_jobs_due_idx").on(table.status, table.fireAt),
    index("reminder_jobs_user_idx").on(table.userId),
    check("reminder_jobs_channel_check", sql`${table.channel} in ('email','push','in_app')`),
    check(
      "reminder_jobs_status_check",
      sql`${table.status} in ('scheduled','processing','sent','failed','skipped','canceled')`,
    ),
    check("reminder_jobs_attempts_check", sql`${table.attempts} >= 0`),
  ],
);

export const deliveryAttempts = pgTable(
  "delivery_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => reminderJobs.id, { onDelete: "cascade" }),
    channel: text("channel").$type<ReminderChannel>().notNull(),
    provider: text("provider"),
    status: text("status").notNull(),
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("delivery_attempts_job_idx").on(table.jobId)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    kind: text("kind").notNull().default("reminder"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamps.createdAt,
  },
  (table) => [index("notifications_user_created_idx").on(table.userId, table.createdAt)],
);

export const emailAliases = pgTable(
  "email_aliases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    address: text("address").notNull(),
    createdAt: timestamps.createdAt,
  },
  (table) => [uniqueIndex("email_aliases_address_uq").on(table.address)],
);

export const providerConnections = pgTable(
  "provider_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    provider: text("provider").notNull(),
    status: text("status").$type<ProviderConnectionStatus>().notNull().default("active"),
    encryptedTokens: text("encrypted_tokens"),
    cursor: text("cursor"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamps.createdAt,
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("provider_connections_user_provider_uq").on(table.userId, table.provider),
    check(
      "provider_connections_status_check",
      sql`${table.status} in ('active','revoked','error')`,
    ),
  ],
);

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    payloadHash: text("payload_hash"),
    status: text("status").notNull().default("received"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("webhook_events_provider_external_uq").on(table.provider, table.externalId),
    index("webhook_events_received_idx").on(table.receivedAt),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id"),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    index("audit_events_user_created_idx").on(table.userId, table.createdAt),
    index("audit_events_action_idx").on(table.action),
  ],
);

export type Profile = typeof profiles.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
export type BillingOccurrence = typeof billingOccurrences.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type ReminderJob = typeof reminderJobs.$inferSelect;
export type Device = typeof devices.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type PaymentMethod = typeof paymentMethods.$inferSelect;
