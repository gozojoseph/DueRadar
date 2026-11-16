/**
 * Redaction happens before a body is persisted or logged. We keep just enough
 * to explain a detection (for example the last four card digits) and never
 * keep full card numbers, CVVs, PINs, OTPs or account numbers.
 */

const CARD_WITH_SEPARATORS = /\b(?:\d[ -]?){12,18}\d\b/g;
const LONG_NUMBER = /\b\d{8,}\b/g;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_GH = /(?:\+?233|0)\s?\d{2}\s?\d{3}\s?\d{4}\b/g;
const OTP_CONTEXT =
  /\b(?:otp|one[-\s]?time\s*(?:password|code|pin)|verification\s*code|auth(?:entication)?\s*code|pin)\b[^.\n]{0,40}?(\d{4,8})\b/gi;

function luhn(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

export interface RedactOptions {
  /** Keep the last four digits of a valid card number. */
  keepCardLast4?: boolean;
}

export function redactSensitive(input: string, options: RedactOptions = {}): string {
  let value = input;

  value = value.replace(CARD_WITH_SEPARATORS, (match) => {
    const digits = match.replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) {
      return options.keepCardLast4 === false
        ? "[card]"
        : `[card ending ${digits.slice(-4)}]`;
    }
    return match;
  });

  value = value.replace(OTP_CONTEXT, (match, code: string) =>
    match.replace(code, `[code ending ${code.slice(-2)}]`),
  );
  value = value.replace(EMAIL, "[email]");
  value = value.replace(PHONE_GH, (match) => `[phone ending ${match.replace(/\D/g, "").slice(-2)}]`);
  value = value.replace(LONG_NUMBER, "[number]");

  return value;
}

/** Removes query strings and fragments from links without fetching anything. */
export function stripTrackingLinks(input: string): string {
  return input.replace(/https?:\/\/[^\s<>"']+/gi, (url) => {
    try {
      const parsed = new URL(url);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return "[link]";
    }
  });
}

export function sanitiseEvidence(input: string, maxLength = 180): string {
  const redacted = redactSensitive(stripTrackingLinks(input));
  const clean = redacted.replace(/\s+/g, " ").trim();
  return clean.length <= maxLength ? clean : `${clean.slice(0, maxLength - 1).trimEnd()}…`;
}
