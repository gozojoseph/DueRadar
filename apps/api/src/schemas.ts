import { z } from "zod";
import {
  BILLING_CYCLES,
  REMINDER_CHANNELS,
  RECORD_KINDS,
  isDateString,
  isSupportedCurrency,
  isValidTimeOfDay,
} from "@dueradar/domain";
import { CSV_MAX_BYTES } from "@dueradar/detection";

export const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the YYYY-MM-DD format")
  .refine(isDateString, "Enter a real calendar date");

export const timeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time such as 09:00")
  .refine(isValidTimeOfDay, "Enter a valid time");

export const currency = z
  .string()
  .trim()
  .length(3)
  .transform((value) => value.toUpperCase())
  .refine(isSupportedCurrency, "Unsupported currency");

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export const profileUpdateSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80).nullable().optional(),
    timezone: z
      .string()
      .max(64)
      .refine(isValidTimeZone, "Unknown time zone")
      .optional(),
    currency: currency.optional(),
    locale: z.string().max(20).optional(),
    weekStartsOn: z.number().int().min(0).max(1).optional(),
    reminderTime: timeOfDay.optional(),
    quietHoursStart: timeOfDay.optional(),
    quietHoursEnd: timeOfDay.optional(),
    emailReminders: z.boolean().optional(),
    pushReminders: z.boolean().optional(),
  })
  .strict();

export const onboardingSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80).optional(),
    timezone: z.string().max(64).refine(isValidTimeZone, "Unknown time zone").optional(),
    currency: currency.optional(),
    reminderTime: timeOfDay.optional(),
    quietHoursStart: timeOfDay.optional(),
    quietHoursEnd: timeOfDay.optional(),
    emailReminders: z.boolean().optional(),
    pushReminders: z.boolean().optional(),
    weekStartsOn: z.number().int().min(0).max(1).optional(),
  })
  .strict();

const subscriptionObjectSchema = z
  .object({
    name: z.string().trim().min(1, "Give this a name").max(120),
    vendor: z.string().trim().max(120).nullable().optional(),
    kind: z.enum(RECORD_KINDS),
    amountMinor: z.number().int().min(0).max(1_000_000_000_000),
    currency,
    cycle: z.enum(BILLING_CYCLES).default("monthly"),
    customIntervalDays: z.number().int().min(1).max(366).nullable().optional(),
    anchorDate: dateString,
    endOfMonthMode: z.boolean().default(false),
    trialEndsAt: dateString.nullable().optional(),
    categoryId: z.string().uuid().nullable().optional(),
    paymentMethodId: z.string().uuid().nullable().optional(),
    url: z.string().trim().max(500).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    reminderOffsets: z.array(z.number().int().min(0).max(60)).max(6).nullable().optional(),
    reminderChannels: z.array(z.enum(REMINDER_CHANNELS)).min(1).max(3).nullable().optional(),
    status: z.enum(["active", "paused", "cancelled"]).optional(),
  })
  .strict();

type SubscriptionDraft = z.infer<typeof subscriptionObjectSchema>;

/**
 * Shared by create and patch. On a patch, only the supplied fields are checked,
 * so setting `cycle` to `custom_days` still demands an interval while editing
 * an unrelated field on an existing custom schedule stays valid.
 */
function refineSubscription(value: Partial<SubscriptionDraft>, ctx: z.RefinementCtx): void {
  if (value.cycle === "custom_days" && !value.customIntervalDays) {
    ctx.addIssue({
      code: "custom",
      path: ["customIntervalDays"],
      message: "Choose how many days between payments",
    });
  }
  if (value.kind === "trial" && !value.trialEndsAt) {
    ctx.addIssue({
      code: "custom",
      path: ["trialEndsAt"],
      message: "Trials need an end date",
    });
  }
}

export const subscriptionInputSchema = subscriptionObjectSchema.superRefine(refineSubscription);

// Zod 4 refuses `.partial()` on a schema that already carries refinements, so
// the object is made partial first and refined afterwards.
export const subscriptionUpdateSchema = subscriptionObjectSchema
  .partial()
  .superRefine(refineSubscription);

export const paymentInputSchema = z
  .object({
    amountMinor: z.number().int().min(0).max(1_000_000_000_000).optional(),
    paidAt: z.string().datetime({ offset: true }).optional(),
    method: z.string().trim().max(80).nullable().optional(),
    reference: z.string().trim().max(120).nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();

export const skipInputSchema = z
  .object({ reason: z.string().trim().max(300).nullable().optional() })
  .strict()
  .default({});

export const snoozeInputSchema = z
  .object({
    until: dateString,
    channels: z.array(z.enum(REMINDER_CHANNELS)).min(1).max(3).optional(),
  })
  .strict();

export const categoryInputSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex colour")
      .optional(),
    icon: z.string().trim().max(40).optional(),
  })
  .strict();

export const paymentMethodInputSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    kind: z.enum(["card", "momo", "bank", "wallet", "cash", "other"]),
    brand: z.string().trim().max(40).nullable().optional(),
    last4: z
      .string()
      .regex(/^\d{4}$/, "Enter the last four digits only")
      .nullable()
      .optional(),
    expiryMonth: z.number().int().min(1).max(12).nullable().optional(),
    expiryYear: z.number().int().min(2024).max(2100).nullable().optional(),
    isDefault: z.boolean().optional(),
  })
  .strict();

export const deviceInputSchema = z
  .object({
    endpoint: z
      .string()
      .url()
      .max(1000)
      .refine((value) => {
        let url: URL;
        try {
          url = new URL(value);
        } catch {
          return false;
        }
        return (
          url.protocol === "https:" &&
          !url.username &&
          !url.password &&
          (!url.port || url.port === "443") &&
          !url.hash
        );
      }, "Use a public HTTPS push endpoint"),
    keys: z.object({
      p256dh: z.string().min(10).max(500),
      auth: z.string().min(5).max(200),
    }),
    userAgent: z.string().max(500).optional(),
    platform: z.string().max(80).optional(),
  })
  .strict();

export const accountDeleteSchema = z
  .object({
    confirm: z.literal("DELETE"),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

export const notificationReadSchema = z
  .object({ ids: z.array(z.string().uuid()).max(200).optional(), all: z.boolean().optional() })
  .strict();

export const testChannelSchema = z.object({ channel: z.enum(["email", "push"]) }).strict();

/* ------------------------------ Phase 2 imports ---------------------------- */

/**
 * A screenshot is read on the device and only its text is uploaded, so `ocr`
 * carries the same shape as a pasted message. `email` and `csv` are produced by
 * the server, never chosen by a signed-in client.
 */
export const importMessageSchema = z
  .object({
    source: z.enum(["paste", "ocr", "upload"]).default("paste"),
    text: z.string().trim().min(1, "Paste the message or receipt text").max(60_000),
    subject: z.string().trim().max(300).nullable().optional(),
    fromAddress: z.string().trim().max(320).nullable().optional(),
  })
  .strict();

export const csvMappingSchema = z
  .object({
    date: z.string().trim().max(120),
    merchant: z.string().trim().max(120),
    amount: z.string().trim().max(120).nullable().optional(),
    debit: z.string().trim().max(120).nullable().optional(),
    credit: z.string().trim().max(120).nullable().optional(),
    currency: z.string().trim().max(120).nullable().optional(),
    type: z.string().trim().max(120).nullable().optional(),
    reference: z.string().trim().max(120).nullable().optional(),
    dateFormat: z.enum(["auto", "dmy", "mdy", "ymd"]).default("auto"),
    defaultCurrency: currency.default("GHS"),
  })
  .strict();

export const csvPreviewSchema = z
  .object({
    csv: z.string().min(1, "Choose a CSV file").max(CSV_MAX_BYTES),
    mapping: csvMappingSchema.nullable().optional(),
  })
  .strict();

export const csvImportSchema = z
  .object({
    csv: z.string().min(1, "Choose a CSV file").max(CSV_MAX_BYTES),
    mapping: csvMappingSchema,
    fileName: z.string().trim().max(200).nullable().optional(),
  })
  .strict();

const detectionOverrideSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    vendor: z.string().trim().max(120).nullable().optional(),
    kind: z.enum(["subscription", "bill", "trial"]).optional(),
    amountMinor: z.number().int().min(0).max(1_000_000_000_000).optional(),
    currency: currency.optional(),
    cycle: z.enum(BILLING_CYCLES).optional(),
    customIntervalDays: z.number().int().min(1).max(366).nullable().optional(),
    anchorDate: dateString.optional(),
    trialEndsAt: dateString.nullable().optional(),
    categoryId: z.string().uuid().nullable().optional(),
    paymentMethodId: z.string().uuid().nullable().optional(),
    url: z.string().trim().max(500).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    reminderOffsets: z.array(z.number().int().min(0).max(60)).max(6).nullable().optional(),
    reminderChannels: z.array(z.enum(REMINDER_CHANNELS)).min(1).max(3).nullable().optional(),
  })
  .strict();

export const detectionAcceptSchema = z
  .object({ overrides: detectionOverrideSchema.default({}) })
  .strict();

export const detectionRejectSchema = z
  .object({ reason: z.string().trim().max(300).nullable().optional() })
  .strict()
  .default({});

export const detectionRejectAllSchema = z
  .object({
    ids: z.array(z.string().uuid()).min(1).max(200).optional(),
  })
  .strict()
  .default({});

export const emailAliasCreateSchema = z
  .object({ rotate: z.boolean().optional() })
  .strict()
  .default({});
