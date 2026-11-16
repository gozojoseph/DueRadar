import { makeDateString, isDateString, majorToMinor, normalizeCurrency } from "@dueradar/domain";
import { paymentFingerprint } from "./dedupe.js";
import { displayMerchant } from "./merchants.js";
import { monthNumber } from "./text.js";
import type { TransactionType } from "./types.js";

export interface ParsedCsv {
  delimiter: "," | ";" | "\t" | "|";
  headers: string[];
  rows: string[][];
  truncated: boolean;
}

export const CSV_MAX_ROWS = 5000;
export const CSV_MAX_BYTES = 2 * 1024 * 1024;

function detectDelimiter(line: string): "," | ";" | "\t" | "|" {
  const candidates = [",", ";", "\t", "|"] as const;
  let best: "," | ";" | "\t" | "|" = ",";
  let bestCount = -1;
  for (const candidate of candidates) {
    let count = 0;
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"') quoted = !quoted;
      else if (!quoted && char === candidate) count += 1;
    }
    if (count > bestCount) {
      bestCount = count;
      best = candidate;
    }
  }
  return best;
}

/**
 * RFC 4180-style parser with a hard row ceiling. It is deliberately dependency
 * free so the exact same parsing can run in tests and on the API.
 */
export function parseCsv(input: string, maxRows = CSV_MAX_ROWS): ParsedCsv {
  const content = input.replace(/^\uFEFF/, "");
  const firstLine = content.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = detectDelimiter(firstLine);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let truncated = false;

  const pushRow = () => {
    if (row.length === 1 && (row[0] ?? "").trim() === "") {
      row = [];
      field = "";
      return;
    }
    if (rows.length < maxRows) {
      row.push(field);
      rows.push(row);
    } else {
      truncated = true;
    }
    row = [];
    field = "";
  };

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (quoted) {
      if (char === '"') {
        if (content[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === delimiter) {
      row.push(field);
      field = "";
      continue;
    }
    if (char === "\n") {
      pushRow();
      continue;
    }
    if (char === "\r") continue;
    field += char;
  }
  if (field.length > 0 || row.length > 0) pushRow();

  const headers = (rows.shift() ?? []).map((header) => header.trim());
  // Drop completely blank rows after the header.
  const cleaned = rows.filter((entry) => entry.some((value) => value.trim().length > 0));
  return { delimiter, headers, rows: cleaned, truncated };
}

export interface CsvMapping {
  date: string;
  merchant: string;
  amount?: string | null;
  debit?: string | null;
  credit?: string | null;
  currency?: string | null;
  type?: string | null;
  reference?: string | null;
  dateFormat?: "auto" | "dmy" | "mdy" | "ymd";
  defaultCurrency?: string;
}

export interface CsvRowError {
  row: number;
  message: string;
}

export interface CsvTransaction {
  row: number;
  merchant: string;
  amountMinor: number;
  currency: string;
  occurredAt: string;
  type: TransactionType;
  reference: string | null;
  debitOrCredit: "debit" | "credit" | "unknown";
  duplicate: boolean;
}

export interface CsvMapResult {
  transactions: CsvTransaction[];
  errors: CsvRowError[];
  duplicates: number;
}

const HEADER_ALIASES: Record<keyof Omit<CsvMapping, "dateFormat" | "defaultCurrency">, RegExp[]> = {
  date: [/^date$/i, /transaction\s*date/i, /posted\s*date/i, /value\s*date/i],
  merchant: [/merchant/i, /description/i, /narration/i, /details/i, /payee/i, /^name$/i, /reference\s*text/i],
  amount: [/^amount$/i, /amount\s*\(/i, /^value$/i, /transaction\s*amount/i, /^total$/i],
  debit: [/debit/i, /money\s*out/i, /withdrawal/i, /paid\s*out/i],
  credit: [/credit/i, /money\s*in/i, /deposit/i, /paid\s*in/i],
  currency: [/currency/i, /ccy/i],
  type: [/^type$/i, /transaction\s*type/i, /^status$/i, /debit\s*\/\s*credit/i],
  reference: [/reference/i, /^ref$/i, /transaction\s*id/i, /^id$/i, /receipt/i],
};

export function suggestCsvMapping(headers: string[]): CsvMapping {
  const find = (aliases: RegExp[]): string | null => {
    for (const alias of aliases) {
      const match = headers.find((header) => alias.test(header.trim()));
      if (match) return match;
    }
    return null;
  };
  return {
    date: find(HEADER_ALIASES.date) ?? "",
    merchant: find(HEADER_ALIASES.merchant) ?? "",
    amount: find(HEADER_ALIASES.amount),
    debit: find(HEADER_ALIASES.debit),
    credit: find(HEADER_ALIASES.credit),
    currency: find(HEADER_ALIASES.currency),
    type: find(HEADER_ALIASES.type),
    reference: find(HEADER_ALIASES.reference),
    dateFormat: "auto",
    defaultCurrency: "GHS",
  };
}

function parseDateValue(
  value: string,
  format: CsvMapping["dateFormat"],
): { date: string | null; ambiguous: boolean } {
  const clean = value.trim();
  if (!clean) return { date: null, ambiguous: false };
  if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(clean)) {
    const [year, month, day] = clean.split(/[-/.]/).map(Number);
    const date = makeDateString(year ?? 0, month ?? 0, day ?? 0);
    return isDateString(date) ? { date, ambiguous: false } : { date: null, ambiguous: false };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    return isDateString(clean) ? { date: clean, ambiguous: false } : { date: null, ambiguous: false };
  }

  const numeric = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(clean);
  if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    let year = Number(numeric[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    const mode = format ?? "auto";
    if (mode === "ymd") {
      const date = makeDateString(first, second, year);
      return isDateString(date) ? { date, ambiguous: false } : { date: null, ambiguous: false };
    }
    const ambiguous = mode === "auto" && first <= 12 && second <= 12 && first !== second;
    const dayFirst = mode !== "mdy";
    const day = dayFirst ? first : second;
    const month = dayFirst ? second : first;
    const date = makeDateString(year, month, day);
    return {
      date: isDateString(date) ? date : null,
      ambiguous,
    };
  }

  const named = /^(\d{1,2})[\s-]+([A-Za-z]{3,9})[\s,-]+(\d{2,4})$/.exec(clean);
  if (named) {
    const month = monthNumber(named[2] ?? "");
    let year = Number(named[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    const date = month ? makeDateString(year, month, Number(named[1])) : "";
    return isDateString(date) ? { date, ambiguous: false } : { date: null, ambiguous: false };
  }

  const namedFirst = /^([A-Za-z]{3,9})\s+(\d{1,2})[\s,]+(\d{2,4})$/.exec(clean);
  if (namedFirst) {
    const month = monthNumber(namedFirst[1] ?? "");
    let year = Number(namedFirst[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    const date = month ? makeDateString(year, month, Number(namedFirst[2])) : "";
    return isDateString(date) ? { date, ambiguous: false } : { date: null, ambiguous: false };
  }

  // Excel serial dates are common in bank exports.
  if (/^\d{5}$/.test(clean)) {
    const serial = Number(clean);
    if (serial >= 20_000 && serial <= 60_000) {
      const milliseconds = Date.UTC(1899, 11, 30) + serial * 86_400_000;
      const date = new Date(milliseconds).toISOString().slice(0, 10);
      return isDateString(date) ? { date, ambiguous: false } : { date: null, ambiguous: false };
    }
  }

  return { date: null, ambiguous: false };
}

export function parseCsvAmount(value: string): number | null {
  let clean = value.trim();
  if (!clean) return null;
  let negative = false;
  if (/^\(.*\)$/.test(clean)) {
    negative = true;
    clean = clean.slice(1, -1);
  }
  if (/-$/.test(clean)) {
    negative = true;
    clean = clean.slice(0, -1);
  }
  clean = clean.replace(/[^\d,.\-]/g, "");
  if (clean.startsWith("-")) {
    negative = true;
    clean = clean.slice(1);
  }
  const hasComma = clean.includes(",");
  const hasDot = clean.includes(".");
  if (hasComma && hasDot) {
    const lastComma = clean.lastIndexOf(",");
    const lastDot = clean.lastIndexOf(".");
    if (lastComma > lastDot) {
      clean = clean.replace(/\./g, "").replace(",", ".");
    } else {
      clean = clean.replace(/,/g, "");
    }
  } else if (hasComma) {
    if (/^\d{1,3}(,\d{3})+$/.test(clean)) {
      clean = clean.replace(/,/g, "");
    } else {
      clean = clean.replace(",", ".");
    }
  }
  const amount = Number(clean);
  if (!Number.isFinite(amount)) return null;
  return negative ? -Math.abs(amount) : amount;
}

function transactionTypeFromRow(
  typeValue: string,
  debitOrCredit: "debit" | "credit" | "unknown",
  amount: number,
): TransactionType {
  const value = typeValue.toLowerCase();
  if (/refund|reversal|chargeback|returned/.test(value)) return "refund";
  if (/declin|fail|reject|unsuccess/.test(value)) return "declined";
  if (/card\s*(check|verification)|authori[sz]ation/.test(value)) return "card_check";
  if (/transfer|withdrawal/.test(value)) return "transfer";
  if (/credit|deposit|received/.test(value)) return "incoming";
  if (debitOrCredit === "credit" || amount < 0) return "refund";
  return "payment";
}

const CURRENCY_SYMBOL: Record<string, string> = {
  "₵": "GHS",
  "¢": "GHS",
  $: "USD",
  "€": "EUR",
  "£": "GBP",
  "₦": "NGN",
  "₹": "INR",
  "¥": "JPY",
};

function currencyCode(value: string, fallback: string): string {
  const clean = value.trim();
  if (!clean) return normalizeCurrency(fallback);
  const upper = clean.toUpperCase();
  if (["GHS", "USD", "EUR", "GBP", "NGN", "KES", "ZAR", "XOF", "CFA", "CAD", "AUD"].includes(upper)) {
    return upper;
  }
  const symbol = Object.entries(CURRENCY_SYMBOL).find(([key]) => clean.includes(key));
  if (symbol) return symbol[1] ?? fallback;
  if (/\bGH[S₵¢]\b|CEDI/i.test(clean)) return "GHS";
  return fallback;
}

/** Validates a mapping against the parsed header row. */
export function validateCsvMapping(
  headers: string[],
  mapping: CsvMapping,
): string[] {
  const errors: string[] = [];
  const require = (name: string, value: string | null | undefined) => {
    if (!value) errors.push(`${name} column is required`);
    else if (!headers.includes(value)) errors.push(`${name} column "${value}" was not found`);
  };
  require("Date", mapping.date);
  require("Merchant", mapping.merchant);
  if (!mapping.amount && !mapping.debit && !mapping.credit) {
    errors.push("Choose an amount column, or separate debit and credit columns");
  }
  for (const value of [mapping.amount, mapping.debit, mapping.credit, mapping.currency, mapping.type, mapping.reference]) {
    if (value && !headers.includes(value)) errors.push(`Column "${value}" was not found`);
  }
  return errors;
}

export function mapCsvRows(
  parsed: ParsedCsv,
  mapping: CsvMapping,
): CsvMapResult {
  const index = (header: string | null | undefined) =>
    header ? parsed.headers.indexOf(header) : -1;
  const dateIndex = index(mapping.date);
  const merchantIndex = index(mapping.merchant);
  const amountIndex = index(mapping.amount);
  const debitIndex = index(mapping.debit);
  const creditIndex = index(mapping.credit);
  const currencyIndex = index(mapping.currency);
  const typeIndex = index(mapping.type);
  const referenceIndex = index(mapping.reference);
  const defaultCurrency = normalizeCurrency(mapping.defaultCurrency ?? "GHS");

  const transactions: CsvTransaction[] = [];
  const errors: CsvRowError[] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  parsed.rows.forEach((row, offset) => {
    const rowNumber = offset + 2; // header is row 1
    const cell = (position: number) => (position >= 0 ? row[position]?.trim() ?? "" : "");
    const rawDate = cell(dateIndex);
    const rawMerchant = cell(merchantIndex);
    const dateResult = parseDateValue(rawDate, mapping.dateFormat);
    if (!rawDate) {
      errors.push({ row: rowNumber, message: "Missing transaction date" });
      return;
    }
    if (dateResult.ambiguous) {
      errors.push({
        row: rowNumber,
        message: `Date "${rawDate}" is ambiguous. Choose day-first or month-first for this file.`,
      });
      return;
    }
    if (!dateResult.date) {
      errors.push({ row: rowNumber, message: `Unrecognised date "${rawDate}"` });
      return;
    }
    if (!rawMerchant) {
      errors.push({ row: rowNumber, message: "Missing merchant or description" });
      return;
    }

    let amount: number | null = null;
    let debitOrCredit: "debit" | "credit" | "unknown" = "unknown";
    if (amountIndex >= 0) {
      amount = parseCsvAmount(cell(amountIndex));
      if (amount !== null) {
        if (amount < 0) {
          debitOrCredit = "debit";
        } else if (typeIndex >= 0 && /credit|deposit|received/i.test(cell(typeIndex))) {
          debitOrCredit = "credit";
        } else {
          debitOrCredit = "debit";
        }
      }
    } else {
      const debit = debitIndex >= 0 ? parseCsvAmount(cell(debitIndex)) : null;
      const credit = creditIndex >= 0 ? parseCsvAmount(cell(creditIndex)) : null;
      if (debit !== null && debit !== 0) {
        amount = Math.abs(debit);
        debitOrCredit = "debit";
      } else if (credit !== null && credit !== 0) {
        amount = Math.abs(credit);
        debitOrCredit = "credit";
      }
    }

    if (amount === null) {
      errors.push({ row: rowNumber, message: "Missing or unreadable amount" });
      return;
    }

    const typeValue = cell(typeIndex);
    const type = transactionTypeFromRow(typeValue, debitOrCredit, amount);
    const currency = currencyCode(cell(currencyIndex) || cell(amountIndex), defaultCurrency);
    const reference = cell(referenceIndex) || null;
    const amountMinor = majorToMinor(Math.abs(amount), currency);
    const fingerprint = paymentFingerprint({
      merchant: rawMerchant,
      amountMinor,
      currency,
      occurredAt: dateResult.date,
      reference,
    });
    const duplicate = seen.has(fingerprint);
    if (duplicate) duplicates += 1;
    seen.add(fingerprint);

    transactions.push({
      row: rowNumber,
      merchant: displayMerchant(rawMerchant),
      amountMinor,
      currency,
      occurredAt: dateResult.date,
      type,
      reference,
      debitOrCredit,
      duplicate,
    });
  });

  return { transactions, errors, duplicates };
}
