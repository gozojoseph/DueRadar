import { describe, expect, it } from "vitest";
import { redactSensitive, sanitiseEvidence, stripTrackingLinks } from "../src/index.js";
import { paymentFingerprint, suggestionFingerprint } from "../src/dedupe.js";

describe("redaction", () => {
  it("keeps only the last four digits of a valid card number", () => {
    const redacted = redactSensitive("Card 4111 1111 1111 1111 was charged");
    expect(redacted).not.toContain("4111 1111 1111 1111");
    expect(redacted).toContain("1111");
  });

  it("redacts emails, phone numbers, OTPs and long account numbers", () => {
    const redacted = redactSensitive(
      "Email kofi@example.com, phone 024 123 4567, OTP 654321, account 123456789012.",
    );
    expect(redacted).not.toContain("kofi@example.com");
    expect(redacted).not.toContain("024 123 4567");
    expect(redacted).not.toContain("654321");
    expect(redacted).not.toContain("123456789012");
  });

  it("strips query strings and fragments from links", () => {
    expect(stripTrackingLinks("Open https://example.com/a?token=secret#x now")).toBe(
      "Open https://example.com/a now",
    );
  });

  it("caps evidence length", () => {
    expect(sanitiseEvidence("x".repeat(500)).length).toBeLessThanOrEqual(180);
  });
});

describe("fingerprints", () => {
  const base = {
    merchant: "Netflix",
    amountMinor: 5500,
    currency: "GHS",
    occurredAt: "2026-03-15",
  };

  it("is stable and merchant-alias aware", () => {
    expect(suggestionFingerprint(base)).toBe(
      suggestionFingerprint({ ...base, merchant: "NETFLIX.COM" }),
    );
    expect(paymentFingerprint(base)).toBe(paymentFingerprint({ ...base }));
  });

  it("changes when the charge actually changes", () => {
    expect(paymentFingerprint(base)).not.toBe(
      paymentFingerprint({ ...base, occurredAt: "2026-03-16" }),
    );
    expect(paymentFingerprint(base)).not.toBe(
      paymentFingerprint({ ...base, amountMinor: 7500 }),
    );
  });
});
