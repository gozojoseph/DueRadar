import {
  addDaysToDate,
  addMonthsClamped,
  compareDates,
  daysBetween,
} from "@dueradar/domain";
import type { BillingCycle } from "@dueradar/domain";
import { paymentFingerprint } from "./dedupe.js";
import { merchantKey, sameMerchant } from "./merchants.js";
import type { TransactionType } from "./types.js";

export interface RecurringTransaction {
  id?: string;
  merchant: string;
  amountMinor: number;
  currency: string;
  occurredAt: string;
  type: TransactionType;
  source?: string;
  reference?: string | null;
}

export interface RecurringCandidate {
  merchant: string;
  amountMinor: number;
  currency: string;
  cycle: BillingCycle;
  customIntervalDays: number | null;
  nextDate: string;
  confidence: number;
  strong: boolean;
  /** True because the next date is projected from history, not stated. */
  estimated: true;
  transactions: RecurringTransaction[];
  duplicatePayments: number;
}

interface CycleGuess {
  cycle: BillingCycle;
  days: number;
  tolerance: number;
  customIntervalDays: number | null;
}

const CYCLES: CycleGuess[] = [
  { cycle: "weekly", days: 7, tolerance: 2, customIntervalDays: null },
  { cycle: "monthly", days: 30, tolerance: 4, customIntervalDays: null },
  { cycle: "quarterly", days: 91, tolerance: 10, customIntervalDays: null },
  { cycle: "semiannual", days: 182, tolerance: 14, customIntervalDays: null },
  { cycle: "annual", days: 365, tolerance: 20, customIntervalDays: null },
];

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

function nearestCycle(gaps: number[]): CycleGuess | null {
  if (gaps.length === 0) return null;
  const middle = median(gaps);
  let best: CycleGuess | null = null;
  let bestScore = 0;
  for (const guess of CYCLES) {
    const matches = gaps.filter((gap) => Math.abs(gap - guess.days) <= guess.tolerance).length;
    const score = matches / gaps.length;
    if (score > bestScore) {
      bestScore = score;
      best = guess;
    }
  }
  if (!best || bestScore < 0.66) {
    // A stable non-standard interval is still useful (for example a 14-day
    // prepaid plan), but only when the gaps agree with each other.
    const custom = gaps.every((gap) => Math.abs(gap - middle) <= 2);
    if (custom && middle >= 5 && middle <= 60) {
      return {
        cycle: "custom_days",
        days: Math.round(middle),
        tolerance: 2,
        customIntervalDays: Math.round(middle),
      };
    }
    return null;
  }
  return best;
}

function clusterAmounts(transactions: RecurringTransaction[]): RecurringTransaction[][] {
  const clusters: RecurringTransaction[][] = [];
  for (const transaction of [...transactions].sort((a, b) => a.amountMinor - b.amountMinor)) {
    let placed = false;
    for (const cluster of clusters) {
      const center = median(cluster.map((entry) => entry.amountMinor));
      const tolerance = Math.max(100, Math.round(center * 0.15));
      if (Math.abs(transaction.amountMinor - center) <= tolerance) {
        cluster.push(transaction);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push([transaction]);
  }
  return clusters;
}

function nextFrom(last: string, guess: CycleGuess): string {
  switch (guess.cycle) {
    case "weekly":
      return addDaysToDate(last, 7);
    case "monthly":
      return addMonthsClamped(last, 1);
    case "quarterly":
      return addMonthsClamped(last, 3);
    case "semiannual":
      return addMonthsClamped(last, 6);
    case "annual":
      return addMonthsClamped(last, 12);
    case "custom_days":
      return addDaysToDate(last, guess.customIntervalDays ?? guess.days);
  }
}

/**
 * Finds recurring charges. Three successful charges from the same merchant and
 * currency are strong evidence; two are only surfaced when the caller supplies
 * independent evidence (for example an explicit renewal notice).
 */
export function detectRecurringCandidates(
  transactions: RecurringTransaction[],
  options: { independentEvidence?: boolean; today?: string } = {},
): RecurringCandidate[] {
  const usable = transactions.filter(
    (transaction) =>
      transaction.type === "payment" &&
      transaction.amountMinor > 0 &&
      /^\d{4}-\d{2}-\d{2}$/.test(transaction.occurredAt) &&
      transaction.merchant.trim().length > 0,
  );

  const byMerchant = new Map<string, RecurringTransaction[]>();
  for (const transaction of usable) {
    const key = merchantKey(transaction.merchant);
    if (!key) continue;
    const current = byMerchant.get(key) ?? [];
    current.push(transaction);
    byMerchant.set(key, current);
  }

  const candidates: RecurringCandidate[] = [];

  for (const entries of byMerchant.values()) {
    const merchant = entries[0]?.merchant ?? "";
    const currencyGroups = new Map<string, RecurringTransaction[]>();
    for (const entry of entries) {
      const key = entry.currency.toUpperCase();
      const group = currencyGroups.get(key) ?? [];
      group.push(entry);
      currencyGroups.set(key, group);
    }

    for (const [currency, currencyEntries] of currencyGroups) {
      for (const cluster of clusterAmounts(currencyEntries)) {
        // Same payment through SMS + CSV is one charge, not two.
        const seen = new Set<string>();
        const unique: RecurringTransaction[] = [];
        let duplicatePayments = 0;
        for (const entry of [...cluster].sort((a, b) =>
          compareDates(a.occurredAt, b.occurredAt),
        )) {
          const fingerprint = paymentFingerprint(entry);
          if (seen.has(fingerprint)) {
            duplicatePayments += 1;
            continue;
          }
          // Same merchant, amount and day with no reference is the same charge.
          const sameDay = unique.find(
            (existing) =>
              existing.occurredAt === entry.occurredAt &&
              existing.amountMinor === entry.amountMinor &&
              sameMerchant(existing.merchant, entry.merchant),
          );
          if (sameDay) {
            duplicatePayments += 1;
            continue;
          }
          seen.add(fingerprint);
          unique.push(entry);
        }

        if (unique.length < 2) continue;
        const gaps: number[] = [];
        for (let index = 1; index < unique.length; index += 1) {
          const previous = unique[index - 1];
          const current = unique[index];
          if (!previous || !current) continue;
          gaps.push(daysBetween(previous.occurredAt, current.occurredAt));
        }
        const guess = nearestCycle(gaps);
        if (!guess) continue;

        const strong = unique.length >= 3;
        if (!strong && !options.independentEvidence) continue;

        const latest = unique[unique.length - 1];
        if (!latest) continue;
        const nextDate = nextFrom(latest.occurredAt, guess);
        const amounts = unique.map((entry) => entry.amountMinor);
        const center = median(amounts);
        const drift =
          center > 0
            ? Math.max(...amounts.map((amount) => Math.abs(amount - center) / center))
            : 0;

        let confidence = strong ? 72 : 52;
        if (unique.length >= 4) confidence += 8;
        if (drift <= 0.05) confidence += 8;
        if (duplicatePayments > 0) confidence -= 0;
        if (options.independentEvidence) confidence += 8;
        confidence = Math.max(0, Math.min(94, confidence));

        candidates.push({
          merchant,
          amountMinor: latest.amountMinor,
          currency,
          cycle: guess.cycle,
          customIntervalDays: guess.customIntervalDays,
          nextDate,
          confidence,
          strong,
          estimated: true,
          transactions: unique,
          duplicatePayments,
        });
      }
    }
  }

  return candidates.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Cross-source dedupe check used when accepting a suggestion: an existing
 * payment on the same day for the same amount and merchant is the same charge.
 */
export function findDuplicatePayment(
  candidate: RecurringTransaction,
  existing: RecurringTransaction[],
): RecurringTransaction | null {
  const fingerprint = paymentFingerprint(candidate);
  return (
    existing.find((entry) => paymentFingerprint(entry) === fingerprint) ??
    existing.find(
      (entry) =>
        entry.occurredAt === candidate.occurredAt &&
        entry.amountMinor === candidate.amountMinor &&
        entry.currency.toUpperCase() === candidate.currency.toUpperCase() &&
        sameMerchant(entry.merchant, candidate.merchant),
    ) ??
    null
  );
}
