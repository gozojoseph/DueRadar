import { describe, expect, it } from "vitest";
import {
  mapCsvRows,
  parseCsv,
  parseCsvAmount,
  suggestCsvMapping,
  validateCsvMapping,
} from "../src/index.js";

describe("CSV parsing", () => {
  it("handles quotes, escaped quotes and newlines inside fields", () => {
    const parsed = parseCsv(
      'Date,Description,Amount\n2026-03-01,"Netflix, Inc.",55.00\n2026-03-02,"Shop ""A""",10.00\n',
    );
    expect(parsed.headers).toEqual(["Date", "Description", "Amount"]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]?.[1]).toBe("Netflix, Inc.");
    expect(parsed.rows[1]?.[1]).toBe('Shop "A"');
  });

  it("detects semicolon and tab delimiters", () => {
    expect(parseCsv("Date;Amount\n2026-03-01;10,00").delimiter).toBe(";");
    expect(parseCsv("Date\tAmount\n2026-03-01\t10.00").delimiter).toBe("\t");
  });

  it("suggests a mapping from common headers", () => {
    const mapping = suggestCsvMapping([
      "Transaction Date",
      "Narration",
      "Debit",
      "Credit",
      "Currency",
      "Reference",
    ]);
    expect(mapping.date).toBe("Transaction Date");
    expect(mapping.merchant).toBe("Narration");
    expect(mapping.debit).toBe("Debit");
    expect(mapping.credit).toBe("Credit");
    expect(mapping.currency).toBe("Currency");
    expect(mapping.reference).toBe("Reference");
    expect(validateCsvMapping(
      ["Transaction Date", "Narration", "Debit", "Credit", "Currency", "Reference"],
      mapping,
    )).toEqual([]);
  });

  it("parses amounts with thousands separators, decimal commas and parentheses", () => {
    expect(parseCsvAmount("GHS 1,234.56")).toBe(1234.56);
    expect(parseCsvAmount("1 234,56")).toBe(1234.56);
    expect(parseCsvAmount("(500.00)")).toBe(-500);
    expect(parseCsvAmount("-1,000")).toBe(-1000);
  });

  it("maps rows and reports ambiguous dates and duplicate rows", () => {
    const parsed = parseCsv(
      [
        "Date,Description,Amount,Currency",
        "15/03/2026,Netflix,55.00,GHS",
        "05/06/2026,Spotify,39.00,GHS",
        "15/03/2026,Netflix,55.00,GHS",
        "not-a-date,Glovo,10.00,GHS",
      ].join("\n"),
    );
    const mapping = suggestCsvMapping(parsed.headers);
    const mapped = mapCsvRows(parsed, mapping);
    expect(mapped.transactions).toHaveLength(2);
    expect(mapped.transactions[0]?.occurredAt).toBe("2026-03-15");
    expect(mapped.transactions[0]?.amountMinor).toBe(5500);
    expect(mapped.transactions[1]?.duplicate).toBe(true);
    expect(mapped.duplicates).toBe(1);
    expect(mapped.errors.some((error) => error.row === 3 && /ambiguous/i.test(error.message))).toBe(true);
    expect(mapped.errors.some((error) => error.row === 5)).toBe(true);
  });

  it("splits debit and credit columns and marks credits as refunds", () => {
    const parsed = parseCsv(
      ["Date,Description,Debit,Credit", "2026-03-01,Netflix,55.00,", "2026-03-02,Refund,,55.00"].join("\n"),
    );
    const mapping = suggestCsvMapping(parsed.headers);
    const mapped = mapCsvRows(parsed, mapping);
    expect(mapped.transactions[0]?.amountMinor).toBe(5500);
    expect(mapped.transactions[0]?.type).toBe("payment");
    expect(mapped.transactions[1]?.type).toBe("refund");
  });
});
