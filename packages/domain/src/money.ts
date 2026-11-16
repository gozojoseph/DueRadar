/**
 * Money is stored as integer minor units (pesewas, cents) together with an
 * ISO 4217 currency code. Amounts are never added across currencies without a
 * dated exchange rate, which DueRadar does not fabricate.
 */

export interface Money {
  amountMinor: number;
  currency: string;
}

/** Currencies with no minor unit or a non-2 exponent. */
const EXPONENTS: Record<string, number> = {
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  ISK: 0,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  PYG: 0,
  RWF: 0,
  UGX: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
  BHD: 3,
  IQD: 3,
  JOD: 3,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  TND: 3,
};

export function normalizeCurrency(currency: string): string {
  return currency.trim().toUpperCase();
}

export function isSupportedCurrency(currency: string): boolean {
  try {
    new Intl.NumberFormat("en", { style: "currency", currency }).format(1);
    return true;
  } catch {
    return false;
  }
}

export function currencyExponent(currency: string): number {
  return EXPONENTS[normalizeCurrency(currency)] ?? 2;
}

export function majorToMinor(amount: number, currency: string): number {
  return Math.round(amount * 10 ** currencyExponent(currency));
}

export function minorToMajor(amountMinor: number, currency: string): number {
  return amountMinor / 10 ** currencyExponent(currency);
}

export function formatMoney(
  amountMinor: number,
  currency: string,
  locale = "en-GH",
  options: Intl.NumberFormatOptions = {},
): string {
  const exponent = currencyExponent(currency);
  const major = amountMinor / 10 ** exponent;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: normalizeCurrency(currency),
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
    ...options,
  }).format(major);
}

/** Compact display for tight cards: GHS 1,240 rather than GH₵1,240.00. */
export function formatMoneyCompact(
  amountMinor: number,
  currency: string,
  locale = "en-GH",
  options: Intl.NumberFormatOptions = {},
): string {
  return formatMoney(amountMinor, currency, locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
    ...options,
  });
}

/**
 * Parses user input into minor units. Accepts "1,234.56", "1 234,56",
 * "GHS 1,234", and plain numbers. Returns null for unusable input.
 */
export function parseMoneyInput(input: string, currency: string): number | null {
  let value = input.trim().replace(/[^\d.,-]/g, "");
  if (!value || value === "-" || value === ".") return null;

  const lastComma = value.lastIndexOf(",");
  const lastDot = value.lastIndexOf(".");

  if (lastComma > -1 && lastDot > -1) {
    if (lastDot > lastComma) {
      value = value.replace(/,/g, "");
    } else {
      value = value.replace(/\./g, "").replace(",", ".");
    }
  } else if (lastComma > -1) {
    const decimals = value.length - lastComma - 1;
    value = decimals > 0 && decimals <= 2 ? value.replace(",", ".") : value.replace(/,/g, "");
  }

  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return majorToMinor(amount, currency);
}

export function sumByCurrency(
  items: Array<{ amountMinor: number; currency: string }>,
): Array<{ currency: string; amountMinor: number }> {
  const totals = new Map<string, number>();
  for (const item of items) {
    const currency = normalizeCurrency(item.currency);
    totals.set(currency, (totals.get(currency) ?? 0) + item.amountMinor);
  }
  return [...totals.entries()]
    .map(([currency, amountMinor]) => ({ currency, amountMinor }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

/** Ghanaian cedi symbol used in compact UI labels. */
export function currencySymbol(currency: string): string {
  switch (normalizeCurrency(currency)) {
    case "GHS":
      return "GH₵";
    case "USD":
      return "$";
    case "EUR":
      return "€";
    case "GBP":
      return "£";
    case "NGN":
      return "₦";
    default:
      return normalizeCurrency(currency);
  }
}
