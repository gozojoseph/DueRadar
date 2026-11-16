import {
  addDaysToDate,
  addMonthsFromAnchor,
  compareDates,
  parseDateString,
  todayInTimeZone,
} from "./dates.js";

export const BILLING_CYCLES = [
  "weekly",
  "monthly",
  "quarterly",
  "semiannual",
  "annual",
  "custom_days",
] as const;

export type BillingCycle = (typeof BILLING_CYCLES)[number];

export interface Recurrence {
  anchorDate: string;
  cycle: BillingCycle;
  customIntervalDays?: number | null;
  endOfMonthMode?: boolean;
}

export interface OccurrenceSeed {
  dueDate: string;
  periodStart: string;
  periodEnd: string;
  index: number;
}

const MONTHS_BY_CYCLE: Record<string, number> = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
};

/** The due date of the occurrence at `index`, computed from the anchor. */
export function occurrenceDate(recurrence: Recurrence, index: number): string {
  if (index < 0) throw new Error("Occurrence index must be non-negative");
  const { anchorDate, cycle, customIntervalDays, endOfMonthMode } = recurrence;

  if (cycle === "weekly") return addDaysToDate(anchorDate, index * 7);
  if (cycle === "custom_days") {
    const interval = customIntervalDays ?? 0;
    if (interval < 1) throw new Error("Custom billing interval must be at least one day");
    return addDaysToDate(anchorDate, index * interval);
  }

  const months = MONTHS_BY_CYCLE[cycle];
  if (!months) throw new Error(`Unsupported billing cycle: ${cycle}`);
  const { year, month, day } = parseDateString(anchorDate);
  return addMonthsFromAnchor(year, month, day, index * months, Boolean(endOfMonthMode));
}

/**
 * Materialises occurrences up to and including `throughDate`. The last row's
 * period end is computed from the following occurrence.
 */
export function generateOccurrences(
  recurrence: Recurrence,
  throughDate: string,
  options: { fromDate?: string; maxCount?: number } = {},
): OccurrenceSeed[] {
  const maxCount = options.maxCount ?? 400;
  const dates: string[] = [];

  for (let index = 0; index < maxCount; index += 1) {
    const dueDate = occurrenceDate(recurrence, index);
    if (compareDates(dueDate, throughDate) > 0) break;
    if (!options.fromDate || compareDates(dueDate, options.fromDate) >= 0) dates.push(dueDate);
  }

  return dates.map((dueDate, i) => {
    const asIndex = recurrenceIndexFor(recurrence, dueDate);
    const next = occurrenceDate(recurrence, asIndex + 1);
    return {
      dueDate,
      periodStart: dueDate,
      periodEnd: addDaysToDate(next, -1),
      index: asIndex,
    };
  });
}

/** Finds the smallest index whose due date is on or after `date`. */
export function recurrenceIndexFor(recurrence: Recurrence, date: string): number {
  for (let index = 0; index < 1000; index += 1) {
    const due = occurrenceDate(recurrence, index);
    if (compareDates(due, date) >= 0) return index;
  }
  throw new Error("Recurrence index search exceeded 1000 periods");
}

export function nextDueDate(
  recurrence: Recurrence,
  onOrAfter: string,
  options: { includePaidThrough?: string } = {},
): string {
  if (options.includePaidThrough) {
    const next = addDaysToDate(options.includePaidThrough, 1);
    return occurrenceDate(recurrence, recurrenceIndexFor(recurrence, next));
  }
  return occurrenceDate(recurrence, recurrenceIndexFor(recurrence, onOrAfter));
}

export function previousDueDate(recurrence: Recurrence, onOrBefore: string): string {
  const index = recurrenceIndexFor(recurrence, onOrBefore);
  const candidate = occurrenceDate(recurrence, index);
  return candidate === onOrBefore ? candidate : occurrenceDate(recurrence, Math.max(0, index - 1));
}

/** Used when a card charge is confirmed; the next cycle starts after it. */
export function nextDueAfterPaid(recurrence: Recurrence, paidDueDate: string): string {
  const index = recurrenceIndexFor(recurrence, paidDueDate);
  return occurrenceDate(recurrence, index + 1);
}

/** Number of days in one cycle, used only for display estimates. */
export function cycleLengthDays(recurrence: Recurrence): number {
  const first = occurrenceDate(recurrence, 0);
  const second = occurrenceDate(recurrence, 1);
  return Math.max(
    1,
    Math.round((Date.parse(`${second}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000),
  );
}

export function cycleLabel(cycle: BillingCycle, customIntervalDays?: number | null): string {
  switch (cycle) {
    case "weekly":
      return "Weekly";
    case "monthly":
      return "Monthly";
    case "quarterly":
      return "Every 3 months";
    case "semiannual":
      return "Every 6 months";
    case "annual":
      return "Yearly";
    case "custom_days":
      return customIntervalDays && customIntervalDays % 7 === 0
        ? `Every ${customIntervalDays / 7} weeks`
        : `Every ${customIntervalDays ?? 1} days`;
  }
}

/** Helper for callers that only have a time zone and need today's date. */
export function todayFor(timeZone: string, now = new Date()): string {
  return todayInTimeZone(timeZone, now);
}
