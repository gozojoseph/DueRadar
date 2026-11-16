import type { BillingCycle } from "@dueradar/domain";

export const DETECTION_SOURCES = ["paste", "email", "upload", "ocr", "csv", "api"] as const;
export type DetectionSource = (typeof DETECTION_SOURCES)[number];

export const PARSER_NAMES = ["momo", "card", "trial", "subscription", "generic"] as const;
export type ParserName = (typeof PARSER_NAMES)[number];

/**
 * A message is never trusted to say it is a successful payment just because it
 * contains an amount. Card checks, refunds, declines and wallet transfers are
 * kept distinct so they can be shown for review without becoming a bill.
 */
export const TRANSACTION_TYPES = [
  "payment",
  "card_check",
  "refund",
  "declined",
  "transfer",
  "incoming",
  "unknown",
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const PAYMENT_RAILS = ["momo", "card", "bank", "wallet", "unknown"] as const;
export type PaymentRail = (typeof PAYMENT_RAILS)[number];

export const DETECTION_KINDS = ["subscription", "bill", "trial", "payment"] as const;
export type DetectionKind = (typeof DETECTION_KINDS)[number];

export type EvidenceOrigin = "provider" | "user" | "estimate";

export interface DetectionEvidence {
  field: string;
  /** Short, redacted excerpt that supports the field. */
  text: string;
  origin: EvidenceOrigin;
}

export type DetectionWarningCode =
  | "date_ambiguous"
  | "date_missing"
  | "amount_missing"
  | "merchant_missing"
  | "renewal_date_missing"
  | "renewal_date_estimated"
  | "trial_end_missing"
  | "first_charge_missing"
  | "trial_end_estimated"
  | "one_off_payment"
  | "card_check"
  | "refund"
  | "declined"
  | "wallet_transfer"
  | "incoming_funds"
  | "zero_value"
  | "low_confidence"
  | "llm_assisted"
  | "duplicate_payment";

export interface DetectionWarning {
  code: DetectionWarningCode;
  message: string;
}

/**
 * The editable suggestion payload. Fields that the source did not state are
 * null; the review screen asks the user to fill them instead of inventing data.
 */
export interface DetectionDraft {
  kind: DetectionKind;
  merchant: string | null;
  vendor: string | null;
  amountMinor: number | null;
  currency: string;
  /** Date of the charge described by the message, not the next renewal date. */
  occurredAt: string | null;
  /** Explicit end of a free trial. */
  trialEndsAt: string | null;
  /** Explicit first paid charge after a trial. */
  firstChargeAt: string | null;
  /** Explicit next renewal/expiry date for a subscription, bill or prepaid plan. */
  renewalDate: string | null;
  cycle: BillingCycle | null;
  customIntervalDays: number | null;
  transactionType: TransactionType;
  paymentRail: PaymentRail;
  reference: string | null;
  parser: ParserName;
  confidence: number;
  /** False when the source cannot support a trackable record without edits. */
  eligible: boolean;
  warnings: DetectionWarning[];
  evidence: DetectionEvidence[];
  dedupeKey: string;
}

export interface AnalyzeOptions {
  source?: DetectionSource;
  /** ISO date used for relative phrases such as "tomorrow". */
  today?: string;
  subject?: string | null;
  fromAddress?: string | null;
  messageId?: string | null;
}

export interface AnalyzeResult {
  parser: ParserName;
  drafts: DetectionDraft[];
  /** The portion of the message that was inspected, already capped. */
  text: string;
  warnings: DetectionWarning[];
}
