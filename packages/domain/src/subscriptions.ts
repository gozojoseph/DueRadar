import { compareDates, daysBetween, isDateString } from "./dates.js";

export const RECORD_KINDS = ["subscription", "bill", "trial", "prepaid", "installment"] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

export const RECORD_STATUSES = ["active", "paused", "cancelled"] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

export const OCCURRENCE_STATUSES = ["pending", "paid", "skipped", "canceled"] as const;
export type OccurrenceStatus = (typeof OCCURRENCE_STATUSES)[number];

export const REMINDER_CHANNELS = ["email", "push", "in_app"] as const;
export type ReminderChannel = (typeof REMINDER_CHANNELS)[number];

export const PAYMENT_SOURCES = ["manual", "import", "detection"] as const;
export type PaymentSource = (typeof PAYMENT_SOURCES)[number];

export const PAYMENT_METHOD_KINDS = ["card", "momo", "bank", "wallet", "cash", "other"] as const;
export type PaymentMethodKind = (typeof PAYMENT_METHOD_KINDS)[number];

export const DEFAULT_REMINDER_OFFSETS: Record<RecordKind, number[]> = {
  bill: [7, 1],
  trial: [3, 1],
  subscription: [3, 1],
  prepaid: [3, 1],
  installment: [3, 1],
};

export function defaultReminderOffsets(kind: RecordKind): number[] {
  return [...(DEFAULT_REMINDER_OFFSETS[kind] ?? [3, 1])];
}

export function defaultReminderChannels(profile: {
  emailReminders: boolean;
  pushReminders: boolean;
}): ReminderChannel[] {
  const channels: ReminderChannel[] = ["in_app"];
  if (profile.emailReminders) channels.push("email");
  if (profile.pushReminders) channels.push("push");
  return channels;
}

export type OccurrenceView = "overdue" | "due" | "upcoming" | "paid" | "skipped" | "canceled";

/** How an occurrence should be presented given today's date in the user's zone. */
export function occurrenceView(
  status: OccurrenceStatus,
  dueDate: string,
  today: string,
  dueSoonDays = 7,
): OccurrenceView {
  if (status === "paid") return "paid";
  if (status === "skipped") return "skipped";
  if (status === "canceled") return "canceled";
  if (compareDates(dueDate, today) < 0) return "overdue";
  if (daysBetween(today, dueDate) <= dueSoonDays) return "due";
  return "upcoming";
}

export function isOpen(status: OccurrenceStatus): boolean {
  return status === "pending";
}

export function kindLabel(kind: RecordKind): string {
  switch (kind) {
    case "subscription":
      return "Subscription";
    case "bill":
      return "Bill";
    case "trial":
      return "Free trial";
    case "prepaid":
      return "Prepaid renewal";
    case "installment":
      return "Instalment";
  }
}

export function isValidRecordKind(value: string): value is RecordKind {
  return (RECORD_KINDS as readonly string[]).includes(value);
}

export function isValidDate(value: string): boolean {
  return isDateString(value);
}

/**
 * Trials have a single deadline (the end date). Everything else recurs.
 * A trial's occurrence is generated at `trialEndsAt`.
 */
export function isSingleOccurrenceKind(kind: RecordKind): boolean {
  return kind === "trial";
}
