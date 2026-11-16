import { majorToMinor, normalizeCurrency } from "@dueradar/domain";

export interface ParsedAmount {
  amountMinor: number;
  currency: string;
  raw: string;
  index: number;
}

const CURRENCY_ALIASES: Array<[RegExp, string]> = [
  [/^gh[s₵¢c]?$/i, "GHS"],
  [/^cedis?$/i, "GHS"],
  [/^usd$/i, "USD"],
  [/^us\$$/i, "USD"],
  [/^eur$/i, "EUR"],
  [/^gbp$/i, "GBP"],
  [/^ngn$/i, "NGN"],
  [/^kes$/i, "KES"],
  [/^ksh$/i, "KES"],
  [/^zar$/i, "ZAR"],
  [/^xof$/i, "XOF"],
  [/^cfa$/i, "XOF"],
  [/^cad$/i, "CAD"],
  [/^aud$/i, "AUD"],
  [/^inr$/i, "INR"],
  [/^jpy$/i, "JPY"],
];

const SYMBOL_CURRENCY: Record<string, string> = {
  "₵": "GHS",
  "¢": "GHS",
  $: "USD",
  "€": "EUR",
  "£": "GBP",
  "₦": "NGN",
  "₹": "INR",
  "¥": "JPY",
};

function currencyFor(token: string): string | null {
  const clean = token.trim();
  if (SYMBOL_CURRENCY[clean]) return SYMBOL_CURRENCY[clean] ?? null;
  for (const [pattern, currency] of CURRENCY_ALIASES) {
    if (pattern.test(clean)) return currency;
  }
  return null;
}

function numericValue(raw: string): number | null {
  const cleaned = raw.replace(/,/g, "").trim();
  if (!/^\d+(?:\.\d{1,3})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/**
 * Finds the amounts that carry a currency marker or an explicit money keyword.
 * Bare integers are deliberately ignored: dates, phone numbers and references
 * are far more common than a currency-less price in an alert.
 */
export function extractAmounts(text: string, defaultCurrency = "GHS"): ParsedAmount[] {
  const found: ParsedAmount[] = [];
  const seen = new Set<string>();

  const add = (raw: string, index: number, currencyToken?: string, fallback = false) => {
    const amount = numericValue(raw);
    if (amount === null) return;
    if (!fallback && amount > 1_000_000_000) return;
    const currency = currencyToken
      ? currencyFor(currencyToken) ?? normalizeCurrency(defaultCurrency)
      : normalizeCurrency(defaultCurrency);
    const amountMinor = majorToMinor(amount, currency);
    if (amountMinor < 0) return;
    const key = `${index}:${amountMinor}:${currency}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({
      amountMinor,
      currency,
      raw: raw.trim(),
      index,
    });
  };

  const codeFirst =
    /\b(GHS|GH[S₵¢]|GHC|CEDI(?:S)?|USD|US\$|EUR|GBP|NGN|KES|KSh|ZAR|XOF|CFA|CAD|AUD|INR|JPY)\b\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi;
  for (const match of text.matchAll(codeFirst)) {
    add(match[2] ?? "", match.index ?? 0, match[1]);
  }

  const symbolFirst = /([₵$€£₦₹¥])\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/g;
  for (const match of text.matchAll(symbolFirst)) {
    add(match[2] ?? "", match.index ?? 0, match[1]);
  }

  const codeLast =
    /([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(GHS|USD|EUR|GBP|NGN|KES|ZAR|XOF|CFA)\b/gi;
  for (const match of text.matchAll(codeLast)) {
    add(match[1] ?? "", match.index ?? 0, match[2]);
  }

  const keyword = /(?:amount|paid|payment|charged|charge|debit(?:ed)?|purchase|total|price|for)\s*(?:of|is|:)?\s*([0-9][0-9,]*\.[0-9]{2})/gi;
  for (const match of text.matchAll(keyword)) {
    add(match[1] ?? "", match.index ?? 0, undefined, true);
  }

  return found.sort((a, b) => a.index - b.index);
}

/** Prefer the amount closest to a payment verb over a balance or fee line. */
export function primaryAmount(
  amounts: ParsedAmount[],
  text?: string,
  defaultCurrency = "GHS",
): ParsedAmount | null {
  if (amounts.length === 0) return null;
  if (!text) return amounts[0] ?? null;

  const score = (amount: ParsedAmount): number => {
    const context = text.slice(Math.max(0, amount.index - 45), amount.index + 45).toLowerCase();
    let value = 0;
    if (/\b(?:paid|payment|purchase|charged|debited|deducted|sent|spent)\b/.test(context)) value += 4;
    if (/\b(?:balance|available|remaining)\b/.test(context)) value -= 4;
    if (/\b(?:fee|tax|vat|charges?)\b/.test(context)) value -= 3;
    if (amount.currency !== defaultCurrency) value += 1;
    return value;
  };

  return [...amounts].sort((a, b) => score(b) - score(a) || a.index - b.index)[0] ?? null;
}
