import { describe, expect, it } from "vitest";
import type { DetectionDraft } from "@dueradar/detection";
import {
  blockedReason,
  redactSenderAddress,
  retentionUntil,
  suggestionToSubscriptionInput,
  type SuggestionDto,
  type SuggestionPayload,
} from "../src/services/detection.js";
import { buildDetectionNotification } from "../src/services/detection-notify.js";

const HOUR_MS = 3_600_000;

function draft(overrides: Partial<DetectionDraft> = {}): SuggestionPayload {
  return {
    kind: "subscription",
    merchant: "Netflix",
    vendor: "Netflix",
    amountMinor: 6500,
    currency: "GHS",
    occurredAt: "2026-11-01",
    trialEndsAt: null,
    firstChargeAt: null,
    renewalDate: "2026-12-01",
    cycle: "monthly",
    customIntervalDays: null,
    transactionType: "payment",
    paymentRail: "card",
    reference: null,
    parser: "subscription",
    confidence: 80,
    eligible: true,
    warnings: [],
    evidence: [],
    dedupeKey: "test",
    ...overrides,
  };
}

describe("retentionUntil", () => {
  const now = new Date("2026-11-16T12:00:00.000Z");

  it("defaults to the promised 72-hour window", () => {
    expect(retentionUntil(now, 72).toISOString()).toBe(
      new Date(now.getTime() + 72 * HOUR_MS).toISOString(),
    );
  });

  it("clamps unexpected values instead of retaining raw text for longer", () => {
    expect(retentionUntil(now, 100).toISOString()).toBe(
      new Date(now.getTime() + 72 * HOUR_MS).toISOString(),
    );
    expect(retentionUntil(now, 0).toISOString()).toBe(
      new Date(now.getTime() + 1 * HOUR_MS).toISOString(),
    );
  });
});

describe("redactSenderAddress", () => {
  it("keeps only the provider domain", () => {
    expect(redactSenderAddress("Billing <billing@netflix.com>")).toBe("[email]@netflix.com");
  });

  it("keeps unrecognised values as-is after redaction", () => {
    expect(redactSenderAddress("billing@netflix.com")).toBe("[email]@netflix.com");
    expect(redactSenderAddress("no-domain")).toBe("no-domain");
  });
});

describe("blockedReason", () => {
  it("allows a successful subscription payment", () => {
    expect(blockedReason(draft())).toBeNull();
  });

  it("blocks transactions that are not successful charges", () => {
    for (const transactionType of [
      "card_check",
      "refund",
      "declined",
      "transfer",
      "incoming",
      "unknown",
    ] as const) {
      expect(blockedReason(draft({ transactionType }))).toBeTruthy();
    }
  });

  it("blocks zero-value charges but not a free trial", () => {
    expect(blockedReason(draft({ amountMinor: 0 }))).toContain("zero-value");
    expect(blockedReason(draft({ kind: "trial", amountMinor: 0, trialEndsAt: "2026-11-30" }))).toBeNull();
  });
});

describe("suggestionToSubscriptionInput", () => {
  it("maps a renewal notice to a subscription without inventing fields", () => {
    const input = suggestionToSubscriptionInput(draft());

    expect(input).toMatchObject({
      name: "Netflix",
      vendor: "Netflix",
      kind: "subscription",
      amountMinor: 6500,
      currency: "GHS",
      cycle: "monthly",
      anchorDate: "2026-12-01",
      trialEndsAt: null,
    });
  });

  it("refuses blocked transactions", () => {
    expect(() => suggestionToSubscriptionInput(draft({ transactionType: "refund" }))).toThrow(
      /refund/i,
    );
  });

  it("asks which kind to use when the message only proves a payment", () => {
    expect(() =>
      suggestionToSubscriptionInput(draft({ kind: "payment", cycle: null, renewalDate: null })),
    ).toThrow(/bill, subscription, or trial/i);
  });

  it("asks for a renewal date instead of using the charge date", () => {
    expect(() =>
      suggestionToSubscriptionInput(draft({ renewalDate: null })),
    ).toThrow(/next renewal date/i);
  });

  it("asks how often a custom cycle repeats", () => {
    expect(() =>
      suggestionToSubscriptionInput(draft({ cycle: "custom_days", customIntervalDays: null })),
    ).toThrow(/how many days/i);

    expect(
      suggestionToSubscriptionInput(draft({ cycle: "custom_days", customIntervalDays: 45 }))
        .customIntervalDays,
    ).toBe(45);
  });

  it("uses the trial end as the anchor and keeps the first charge separate", () => {
    const input = suggestionToSubscriptionInput(
      draft({
        kind: "trial",
        amountMinor: 0,
        renewalDate: null,
        trialEndsAt: "2026-11-30",
        firstChargeAt: "2026-12-03",
      }),
    );

    expect(input).toMatchObject({
      kind: "trial",
      amountMinor: 0,
      anchorDate: "2026-11-30",
      trialEndsAt: "2026-11-30",
    });
  });

  it("requires a trial end date", () => {
    expect(() =>
      suggestionToSubscriptionInput(draft({ kind: "trial", trialEndsAt: null })),
    ).toThrow(/trial ends/i);
  });

  it("lets the review screen override every important field", () => {
    const input = suggestionToSubscriptionInput(draft(), {
      name: "Netflix Premium",
      amountMinor: 9000,
      cycle: "annual",
      anchorDate: "2027-01-15",
    });

    expect(input).toMatchObject({
      name: "Netflix Premium",
      amountMinor: 9000,
      cycle: "annual",
      anchorDate: "2027-01-15",
    });
  });
});

describe("buildDetectionNotification", () => {
  function suggestionOf(kind: DetectionDraft["kind"]): SuggestionDto {
    const payload = draft({
      kind,
      ...(kind === "trial" ? { amountMinor: 0, trialEndsAt: "2026-11-30" } : {}),
    });
    return { draft: payload } as unknown as SuggestionDto;
  }

  it("summarises a single detection with the right pronouns", () => {
    const copy = buildDetectionNotification([suggestionOf("trial")], "your Gmail");
    expect(copy.title).toBe("1 new item to review");
    expect(copy.body).toBe(
      "DueRadar detected a free trial in your Gmail. Open Review to check it.",
    );
  });

  it("batches mixed kinds into one notification, never one per detection", () => {
    const copy = buildDetectionNotification(
      [
        suggestionOf("subscription"),
        suggestionOf("bill"),
        suggestionOf("trial"),
        suggestionOf("trial"),
      ],
      "your CSV import",
    );
    expect(copy.title).toBe("4 new items to review");
    expect(copy.body).toBe(
      "DueRadar detected a subscription charge, a bill, 2 free trials in your CSV import. Open Review to check them.",
    );
  });
});
