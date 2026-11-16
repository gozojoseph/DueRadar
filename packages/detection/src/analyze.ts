import { normalizeCurrency } from "@dueradar/domain";
import type { BillingCycle } from "@dueradar/domain";
import { classifyDates, findDateMentions, trialEndFromDuration, type DateRole } from "./dates.js";
import { messageFingerprint, suggestionFingerprint } from "./dedupe.js";
import { displayMerchant, extractMerchant } from "./merchants.js";
import { extractAmounts, primaryAmount } from "./money.js";
import { sanitiseEvidence } from "./redact.js";
import { prepareMessage, snippet } from "./text.js";
import type {
  AnalyzeOptions,
  AnalyzeResult,
  DetectionDraft,
  DetectionEvidence,
  DetectionKind,
  DetectionWarning,
  ParserName,
  PaymentRail,
  TransactionType,
} from "./types.js";

const MOMO_SIGNAL =
  /\b(?:mtn|telecel|vodafone|airteltigo|mobile\s*money|momo|wallet)\b/i;
const CARD_SIGNAL =
  /\b(?:visa|mastercard|verve|card\s*(?:ending|no|number)|pos|debit\s*card|credit\s*card|issuer|authori[sz]ation)\b/i;
const TRIAL_SIGNAL = /\b(?:free\s*trial|trial\s+(?:period|ends?|expires?|started|starts?)|your\s+trial)\b/i;
const SUBSCRIPTION_SIGNAL =
  /\b(?:subscription|membership|recurr(?:ing|ence)|renews?|renewal|billing\s+cycle|auto[-\s]?renew|plan)\b/i;

interface ParsedContext {
  text: string;
  amounts: ReturnType<typeof extractAmounts>;
  amount: ReturnType<typeof primaryAmount>;
  merchant: string | null;
  dates: ReturnType<typeof classifyDates>;
  cycle: BillingCycle | null;
  customIntervalDays: number | null;
  transactionType: TransactionType;
  paymentRail: PaymentRail;
  reference: string | null;
  trialEnd: string | null;
  firstCharge: string | null;
  renewalDate: string | null;
  occurredAt: string | null;
  ambiguousDate: { raw: string; alternative: string | null } | null;
  durationEnd: { date: string; days: number } | null;
}

function detectTransactionType(text: string, amountMinor: number | null): TransactionType {
  if (/\b(?:refund|refunded|reversal|reversed|chargeback|credited\s+back)\b/i.test(text)) {
    return "refund";
  }
  if (
    /\b(?:card\s*(?:verification|check|validation)|verification\s*(?:charge|payment)|authori[sz]ation\s*(?:hold|check)|pre[-\s]?auth|temporary\s+hold|zero[-\s]?value)\b/i.test(
      text,
    )
  ) {
    return "card_check";
  }
  if (
    /\b(?:declined|failed|unsuccessful|not\s+successful|rejected|insufficient\s+funds|no\s+funds|not\s+completed)\b/i.test(
      text,
    )
  ) {
    return "declined";
  }
  if (/\b(?:you\s+have\s+received|received\s+(?:from|ghs|usd)|credited\s+with|money\s+in|deposit(?:ed)?)\b/i.test(text)) {
    return "incoming";
  }
  if (
    /\b(?:transferred\s+to|transfer\s+to|sent\s+to|cash\s+out|withdrawal|wallet\s+transfer)\b/i.test(text) &&
    !/\b(?:subscription|renewal|billing|invoice|merchant)\b/i.test(text)
  ) {
    return "transfer";
  }
  if (
    /\b(?:paid|payment|purchase|charged|debited|deducted|successful(?:ly)?|sent)\b/i.test(text)
  ) {
    return "payment";
  }
  if (amountMinor === 0) return "card_check";
  return "unknown";
}

function detectRail(text: string): PaymentRail {
  if (MOMO_SIGNAL.test(text)) return "momo";
  if (CARD_SIGNAL.test(text)) return "card";
  if (/\b(?:bank\s*transfer|account\s*(?:number|no)|bank\s+account|direct\s+debit)\b/i.test(text)) {
    return "bank";
  }
  if (/\bwallet\b/i.test(text)) return "wallet";
  return "unknown";
}

function detectCycle(text: string): { cycle: BillingCycle | null; customIntervalDays: number | null } {
  const everyDays = /\bevery\s+(\d{1,3})\s*(day|days|week|weeks)\b/i.exec(text);
  if (everyDays) {
    const count = Number(everyDays[1]);
    if (Number.isFinite(count) && count > 0) {
      const days = (everyDays[2] ?? "").toLowerCase().startsWith("week") ? count * 7 : count;
      return { cycle: "custom_days", customIntervalDays: days };
    }
  }
  if (/\b(?:annual(?:ly)?|yearly|per\s+year|each\s+year|once\s+a\s+year)\b/i.test(text)) {
    return { cycle: "annual", customIntervalDays: null };
  }
  if (/\b(?:quarterly|per\s+quarter|every\s+(?:three|3)\s+months?)\b/i.test(text)) {
    return { cycle: "quarterly", customIntervalDays: null };
  }
  if (/\b(?:semi[-\s]?annual(?:ly)?|half[-\s]?yearly|every\s+(?:six|6)\s+months?)\b/i.test(text)) {
    return { cycle: "semiannual", customIntervalDays: null };
  }
  if (/\b(?:weekly|per\s+week|each\s+week|every\s+week)\b/i.test(text)) {
    return { cycle: "weekly", customIntervalDays: null };
  }
  if (/\b(?:monthly|per\s+month|each\s+month|every\s+month|month\s+plan)\b/i.test(text)) {
    return { cycle: "monthly", customIntervalDays: null };
  }
  return { cycle: null, customIntervalDays: null };
}

function extractReference(text: string): string | null {
  const match =
    /\b(?:ref(?:erence)?|transaction\s*(?:id|ref|no)?|txn(?:\s*id)?|receipt(?:\s*(?:no|number))?|invoice(?:\s*(?:no|number))?)[:\s#-]*([A-Z0-9][A-Z0-9-]{3,31})\b/i.exec(
      text,
    );
  return match?.[1]?.trim() ?? null;
}

function parseContext(text: string, options: AnalyzeOptions): ParsedContext {
  const amounts = extractAmounts(text, "GHS");
  const amount = primaryAmount(amounts, text);
  const mentions = findDateMentions(text, options.today);
  const dates = classifyDates(text, mentions);
  const cycle = detectCycle(text);
  const transactionType = detectTransactionType(text, amount?.amountMinor ?? null);
  const rawMerchant = extractMerchant(text);
  const merchant = rawMerchant ? displayMerchant(rawMerchant) : null;

  const pick = (role: DateRole) =>
    dates.find((date) => !date.ambiguous && date.roles.includes(role) && date.date);
  const trialEndDate = pick("trial_end");
  const firstChargeDate = pick("first_charge");
  const renewalDate = pick("renewal");
  const paymentDate = pick("payment");
  const ambiguous = dates.find((date) => date.ambiguous);
  const duration = trialEndFromDuration(text, dates);

  let trialEnd = trialEndDate?.date ?? null;
  let durationEnd: ParsedContext["durationEnd"] = null;
  if (!trialEnd && duration) {
    trialEnd = duration.date;
    durationEnd = { date: duration.date, days: duration.days };
  }

  // "Your trial ends on 12 June and you will be charged on 19 June" must not
  // lose the explicit first charge just because the trial end was found first.
  let firstCharge = firstChargeDate?.date ?? null;
  if (firstCharge && trialEnd && firstCharge === trialEnd) firstCharge = null;
  if (renewalDate?.date && trialEnd && renewalDate.date === trialEnd) {
    // The same deadline can be both the end of the trial and the renewal date.
    trialEnd = renewalDate.date;
  }

  const occurredAt =
    paymentDate?.date ??
    (!trialEnd && !renewalDate
      ? dates.find((date) => !date.ambiguous && date.date)?.date ?? null
      : null);

  return {
    text,
    amounts,
    amount,
    merchant,
    dates,
    cycle: cycle.cycle,
    customIntervalDays: cycle.customIntervalDays,
    transactionType,
    paymentRail: detectRail(text),
    reference: extractReference(text),
    trialEnd,
    firstCharge,
    renewalDate: renewalDate?.date ?? firstCharge ?? trialEnd,
    occurredAt,
    ambiguousDate: ambiguous
      ? { raw: ambiguous.raw, alternative: ambiguous.alternative }
      : null,
    durationEnd,
  };
}

function findLine(text: string, needle: string): string {
  const index = text.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return snippet(text);
  const start = Math.max(0, text.lastIndexOf("\n", index) + 1);
  const end = text.indexOf("\n", index);
  return snippet(text.slice(start, end < 0 ? text.length : end));
}

function buildEvidence(context: ParsedContext, rawText: string): DetectionEvidence[] {
  const evidence: DetectionEvidence[] = [];
  if (context.amount) {
    evidence.push({
      field: "amount",
      text: sanitiseEvidence(
        context.text.slice(
          Math.max(0, context.amount.index - 40),
          context.amount.index + context.amount.raw.length + 50,
        ),
      ),
      origin: "provider",
    });
  }
  if (context.merchant) {
    evidence.push({
      field: "merchant",
      text: sanitiseEvidence(findLine(context.text, context.merchant)),
      origin: "provider",
    });
  }
  for (const date of context.dates) {
    if (!date.date) {
      evidence.push({
        field: "date",
        text: sanitiseEvidence(
          context.text.slice(Math.max(0, date.index - 50), date.index + date.raw.length + 20),
        ),
        origin: "provider",
      });
      continue;
    }
    const label = date.roles.includes("trial_end")
      ? "trial end"
      : date.roles.includes("first_charge")
        ? "first charge"
        : date.roles.includes("renewal")
          ? "renewal"
          : "transaction date";
    evidence.push({
      field: label,
      text: sanitiseEvidence(
        context.text.slice(Math.max(0, date.index - 50), date.index + date.raw.length + 20),
      ),
      origin: date.origin,
    });
  }
  if (context.cycle) {
    const match =
      /\b(?:weekly|monthly|quarterly|semi[-\s]?annual|annual(?:ly)?|yearly|per\s+(?:week|month|quarter|year)|every\s+\d+\s+(?:days?|weeks?|months?))\b/i.exec(
        context.text,
      );
    if (match) {
      evidence.push({
        field: "frequency",
        text: sanitiseEvidence(
          context.text.slice(Math.max(0, (match.index ?? 0) - 40), (match.index ?? 0) + match[0].length + 40),
        ),
        origin: "provider",
      });
    }
  }
  if (context.durationEnd) {
    evidence.push({
      field: "trial duration",
      text: sanitiseEvidence(
        context.text.slice(
          Math.max(0, context.text.search(/\d{1,3}[\s-]*(?:day|days)/i) - 40),
          context.text.search(/\d{1,3}[\s-]*(?:day|days)/i) + 80,
        ),
      ),
      origin: "estimate",
    });
  }
  if (rawText && evidence.length === 0) {
    evidence.push({ field: "message", text: sanitiseEvidence(rawText), origin: "provider" });
  }
  return evidence.slice(0, 8);
}

function warning(code: DetectionWarning["code"], message: string): DetectionWarning {
  return { code, message };
}

function warningForType(type: TransactionType): DetectionWarning | null {
  switch (type) {
    case "card_check":
      return warning("card_check", "This looks like a card check or authorisation, not a charge.");
    case "refund":
      return warning("refund", "Refunds and reversals are never turned into a subscription.");
    case "declined":
      return warning("declined", "This payment was declined or failed.");
    case "transfer":
      return warning("wallet_transfer", "Wallet transfers are not subscription charges.");
    case "incoming":
      return warning("incoming_funds", "This is money received, not a payment.");
    default:
      return null;
  }
}

function chooseParser(text: string): ParserName {
  if (TRIAL_SIGNAL.test(text)) return "trial";
  if (MOMO_SIGNAL.test(text) && /\b(?:paid|payment|sent|received|debited|credited|transfer)\b/i.test(text)) {
    return "momo";
  }
  if (CARD_SIGNAL.test(text)) return "card";
  if (SUBSCRIPTION_SIGNAL.test(text)) return "subscription";
  return "generic";
}

function chooseKind(parser: ParserName, context: ParsedContext, blocked: boolean): DetectionKind {
  if (blocked) return "payment";
  if (parser === "trial") return "trial";
  if (parser === "subscription") {
    return context.renewalDate || context.cycle ? "subscription" : "bill";
  }
  if (context.renewalDate && context.amount) {
    return SUBSCRIPTION_SIGNAL.test(context.text) ? "subscription" : "bill";
  }
  if (context.cycle && context.amount) return "subscription";
  return "payment";
}

function confidenceFor(
  parser: ParserName,
  context: ParsedContext,
  kind: DetectionKind,
  blocked: boolean,
): number {
  let score = 30;
  if (context.amount) score += 20;
  if (context.merchant) score += 15;
  if (context.occurredAt) score += 10;
  if (context.renewalDate || context.trialEnd) score += 10;
  if (context.cycle) score += 5;
  if (context.reference) score += 5;
  if (parser === "momo" || parser === "card") score += 5;
  if (parser === "generic") score -= 5;
  if (kind === "payment") score -= 10;
  if (blocked) score -= 30;
  return Math.max(0, Math.min(95, score));
}

function buildDraft(parser: ParserName, context: ParsedContext, text: string): DetectionDraft {
  const blockedType =
    context.transactionType !== "payment" && context.transactionType !== "unknown";
  const zeroValue = context.amount?.amountMinor === 0;
  const zeroBlocked = zeroValue && parser !== "trial";
  const blocked = blockedType || zeroBlocked;
  const kind = chooseKind(parser, context, blocked);
  const confidence = confidenceFor(parser, context, kind, blocked);
  const warnings: DetectionWarning[] = [];

  const typeWarning = warningForType(context.transactionType);
  if (typeWarning) warnings.push(typeWarning);
  if (zeroValue && zeroBlocked) {
    warnings.push(warning("zero_value", "A zero-value transaction is not a charge."));
  }
  if (!context.amount) warnings.push(warning("amount_missing", "No amount was stated."));
  if (!context.merchant) warnings.push(warning("merchant_missing", "No merchant was stated."));
  if (context.ambiguousDate) {
    warnings.push(
      warning(
        "date_ambiguous",
        `The date "${context.ambiguousDate.raw}" is ambiguous${
          context.ambiguousDate.alternative
            ? ` (could be ${context.ambiguousDate.alternative})`
            : ""
        }. Confirm it before tracking.`,
      ),
    );
  }

  if (kind === "trial") {
    if (!context.trialEnd) {
      warnings.push(
        warning("trial_end_missing", "The trial end date is missing. Add it before tracking."),
      );
    }
    if (context.durationEnd) {
      warnings.push(
        warning(
          "trial_end_estimated",
          `The end date was calculated from a ${context.durationEnd.days}-day trial. Confirm it with the provider.`,
        ),
      );
    }
    if (/\bfirst\s+(?:paid\s+)?(?:charge|payment)\b/i.test(text) && !context.firstCharge) {
      warnings.push(
        warning("first_charge_missing", "The first paid charge date is not clear. Add it if you know it."),
      );
    }
  } else if (kind === "subscription" || kind === "bill") {
    if (!context.renewalDate) {
      warnings.push(
        warning(
          "renewal_date_missing",
          "The next renewal date is missing. Add it before tracking.",
        ),
      );
    }
  }

  if (kind === "payment") {
    if (!blocked && context.transactionType === "payment") {
      warnings.push(
        warning(
          "one_off_payment",
          "This is a single payment. Add the next renewal date to track it as a bill or subscription.",
        ),
      );
    }
  }
  if (!context.occurredAt && !context.renewalDate && !context.trialEnd && kind !== "trial") {
    if (!context.ambiguousDate) {
      warnings.push(warning("date_missing", "No transaction or renewal date was stated."));
    }
  }
  if (confidence < 55 && !blocked) {
    warnings.push(
      warning("low_confidence", "Only part of the message could be read. Check every field."),
    );
  }

  const currency = normalizeCurrency(context.amount?.currency ?? "GHS");
  const eligible =
    !blocked &&
    context.merchant !== null &&
    (kind === "trial"
      ? context.trialEnd !== null
      : (kind === "subscription" || kind === "bill") &&
        context.renewalDate !== null &&
        context.amount !== null);

  const dedupeKey = context.merchant || context.amount || context.occurredAt
    ? suggestionFingerprint({
        merchant: context.merchant,
        amountMinor: context.amount?.amountMinor ?? null,
        currency,
        occurredAt: context.occurredAt,
        reference: context.reference,
        trialEndsAt: context.trialEnd,
        renewalDate: context.renewalDate,
      })
    : messageFingerprint({ text });

  return {
    kind,
    merchant: context.merchant,
    vendor: context.merchant,
    amountMinor: context.amount?.amountMinor ?? null,
    currency,
    occurredAt: context.occurredAt,
    trialEndsAt: context.trialEnd,
    firstChargeAt: context.firstCharge,
    renewalDate: kind === "trial" ? context.firstCharge : context.renewalDate,
    cycle: context.cycle,
    customIntervalDays: context.customIntervalDays,
    transactionType: context.transactionType,
    paymentRail: context.paymentRail,
    reference: context.reference,
    parser,
    confidence,
    eligible,
    warnings,
    evidence: buildEvidence(context, text),
    dedupeKey,
  };
}

/**
 * Analyses one untrusted message. The parser is chosen from signal words, all
 * fields are extracted independently, and a draft is always returned so the
 * review screen can show what was found even when nothing is trackable.
 */
export function analyzeMessage(input: string, options: AnalyzeOptions = {}): AnalyzeResult {
  const combined = options.subject ? `${options.subject}\n${input}` : input;
  const text = prepareMessage(combined);
  if (!text) {
    return { parser: "generic", drafts: [], text: "", warnings: [] };
  }
  const context = parseContext(text, options);
  const parser = chooseParser(text);
  const draft = buildDraft(parser, context, text);
  return {
    parser,
    drafts: [draft],
    text,
    warnings: draft.warnings,
  };
}

/**
 * Builds a draft from a CSV row or a user-corrected charge. The caller supplies
 * the fields; this helper keeps dedupe and confidence consistent.
 */
export function draftFromCharge(input: {
  merchant: string;
  amountMinor: number;
  currency: string;
  occurredAt: string;
  transactionType?: TransactionType;
  reference?: string | null;
  kind?: DetectionKind;
  cycle?: BillingCycle | null;
  renewalDate?: string | null;
  source?: string;
}): DetectionDraft {
  const type = input.transactionType ?? "payment";
  const kind: DetectionKind =
    input.kind ??
    (type === "payment" ? (input.renewalDate ? "bill" : "payment") : "payment");
  const warnings: DetectionWarning[] = [];
  const typeWarning = warningForType(type);
  if (typeWarning) warnings.push(typeWarning);
  if (input.amountMinor === 0) {
    warnings.push(warning("zero_value", "A zero-value transaction is not a charge."));
  }
  if (kind === "payment" && type === "payment") {
    warnings.push(
      warning("one_off_payment", "Add the next renewal date to track this as a recurring record."),
    );
  }
  return {
    kind,
    merchant: displayMerchant(input.merchant),
    vendor: displayMerchant(input.merchant),
    amountMinor: input.amountMinor,
    currency: normalizeCurrency(input.currency),
    occurredAt: input.occurredAt,
    trialEndsAt: null,
    firstChargeAt: null,
    renewalDate: input.renewalDate ?? null,
    cycle: input.cycle ?? null,
    customIntervalDays: null,
    transactionType: type,
    paymentRail: "unknown",
    reference: input.reference ?? null,
    parser: "generic",
    confidence: 65,
    eligible: type === "payment" && input.amountMinor > 0 && kind !== "payment",
    warnings,
    evidence: [
      {
        field: "imported record",
        text: sanitiseEvidence(
          `${input.source ?? "CSV"}: ${input.merchant} ${input.amountMinor} ${input.currency} on ${input.occurredAt}`,
        ),
        origin: "provider",
      },
    ],
    dedupeKey: suggestionFingerprint({
      merchant: input.merchant,
      amountMinor: input.amountMinor,
      currency: input.currency,
      occurredAt: input.occurredAt,
      reference: input.reference,
      renewalDate: input.renewalDate,
    }),
  };
}

/** Adds an estimated next date when recurrence evidence supplies one. */
export function withEstimatedRenewal(
  draft: DetectionDraft,
  nextDate: string,
  evidence: DetectionEvidence[],
): DetectionDraft {
  const warnings = draft.warnings.filter(
    (entry) =>
      entry.code !== "renewal_date_missing" &&
      entry.code !== "one_off_payment" &&
      entry.code !== "renewal_date_estimated",
  );
  return {
    ...draft,
    kind: draft.kind === "payment" ? "subscription" : draft.kind,
    renewalDate: nextDate,
    eligible: draft.amountMinor !== null && draft.transactionType === "payment",
    warnings: [
      ...warnings,
      warning(
        "renewal_date_estimated",
        "The next date is estimated from matching charges. Confirm it before saving.",
      ),
    ],
    evidence: [...draft.evidence, ...evidence].slice(0, 10),
  };
}

export function sortDrafts(drafts: DetectionDraft[]): DetectionDraft[] {
  return [...drafts].sort((a, b) => {
    const rank = (draft: DetectionDraft) =>
      draft.kind === "trial" ? 0 : draft.kind === "subscription" ? 1 : draft.kind === "bill" ? 2 : 3;
    const difference = rank(a) - rank(b);
    if (difference !== 0) return difference;
    return b.confidence - a.confidence;
  });
}
