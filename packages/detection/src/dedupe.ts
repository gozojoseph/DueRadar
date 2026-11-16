import { merchantKey } from "./merchants.js";

/** FNV-1a over UTF-16 code units, stable across Node and browsers. */
export function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  let second = 0x9e3779b9;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    second ^= value.charCodeAt(index);
    second = Math.imul(second, 0x85ebca6b) >>> 0;
  }
  return `${hash.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

export interface FingerprintInput {
  merchant: string | null;
  amountMinor: number | null;
  currency: string;
  occurredAt: string | null;
  reference?: string | null;
  messageId?: string | null;
  trialEndsAt?: string | null;
  renewalDate?: string | null;
}

/**
 * Identifies the suggestion, not the email. Re-sending the same alert or
 * importing it again through another channel produces the same key.
 */
export function suggestionFingerprint(input: FingerprintInput): string {
  const parts = [
    input.merchant ? merchantKey(input.merchant) : "unknown",
    input.amountMinor === null ? "-" : String(input.amountMinor),
    input.currency.toUpperCase(),
    input.occurredAt ?? input.renewalDate ?? input.trialEndsAt ?? "-",
  ];
  const reference = input.reference?.replace(/\s+/g, "").toLowerCase();
  if (reference && reference.length >= 4) parts.push(reference.slice(0, 40));
  return `sug_${stableHash(parts.join("|"))}`;
}

/**
 * Cross-source payment identity. A reference wins when both records carry one;
 * otherwise the merchant, amount and calendar day must match.
 */
export function paymentFingerprint(input: FingerprintInput): string {
  const reference = input.reference?.replace(/\s+/g, "").toLowerCase();
  if (reference && reference.length >= 4) {
    return `pay_${stableHash(`ref|${reference}`)}`;
  }
  return `pay_${stableHash(
    [
      input.merchant ? merchantKey(input.merchant) : "unknown",
      input.amountMinor ?? "-",
      input.currency.toUpperCase(),
      input.occurredAt ?? "-",
    ].join("|"),
  )}`;
}

export function messageFingerprint(input: {
  messageId?: string | null;
  from?: string | null;
  subject?: string | null;
  text: string;
}): string {
  if (input.messageId) return `msg_${stableHash(input.messageId.toLowerCase())}`;
  return `msg_${stableHash(
    `${(input.from ?? "").toLowerCase()}|${(input.subject ?? "").toLowerCase()}|${input.text
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 4000)}`,
  )}`;
}
