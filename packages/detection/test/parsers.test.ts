import { describe, expect, it } from "vitest";
import {
  analyzeMessage,
  detectRecurringCandidates,
  type RecurringTransaction,
} from "../src/index.js";

describe("MoMo alerts", () => {
  it("turns a payment receipt with an expiry into a reviewable bill", () => {
    const result = analyzeMessage(
      "MTN Mobile Money: Payment made on 01 August 2026 for GHS 30.00 to ECG prepaid. " +
        "Your new balance is GHS 7.45. Bundle expires on 15 August 2026. Ref: 1234567890.",
      { today: "2026-08-01" },
    );
    expect(result.parser).toBe("momo");
    const draft = result.drafts[0]!;
    expect(draft.kind).toBe("bill");
    expect(draft.merchant).toBe("ECG");
    expect(draft.amountMinor).toBe(3000);
    expect(draft.currency).toBe("GHS");
    expect(draft.occurredAt).toBe("2026-08-01");
    expect(draft.renewalDate).toBe("2026-08-15");
    expect(draft.eligible).toBe(true);
    expect(draft.evidence.some((entry) => entry.field === "amount")).toBe(true);
  });

  it("does not use the wallet balance as the charge", () => {
    const draft = analyzeMessage(
      "Your MTN MoMo balance is GHS 200.00. Payment made to Glovo for GHS 45.50 on 12 March 2026.",
    ).drafts[0]!;
    expect(draft.amountMinor).toBe(4550);
    expect(draft.merchant).toBe("Glovo");
  });

  it("flags money received instead of a payment", () => {
    const draft = analyzeMessage(
      "You have received GHS 100.00 from Kofi Mensah on 02 April 2026. Your new balance is GHS 150.00.",
    ).drafts[0]!;
    expect(draft.kind).toBe("payment");
    expect(draft.transactionType).toBe("incoming");
    expect(draft.eligible).toBe(false);
    expect(draft.warnings.some((warning) => warning.code === "incoming_funds")).toBe(true);
  });
});

describe("card alerts", () => {
  it("reads a Visa purchase alert", () => {
    const draft = analyzeMessage(
      "Visa purchase alert: GHS 55.00 was charged on your card ending 4412 at NETFLIX.COM on 03 May 2026.",
    ).drafts[0]!;
    expect(draft.parser).toBe("card");
    expect(draft.merchant).toBe("Netflix");
    expect(draft.amountMinor).toBe(5500);
    expect(draft.occurredAt).toBe("2026-05-03");
    expect(draft.kind).toBe("payment");
    expect(draft.warnings.some((warning) => warning.code === "one_off_payment")).toBe(true);
  });

  it("never turns a refund into a subscription", () => {
    const draft = analyzeMessage(
      "Refund processed: GHS 55.00 has been credited back to your Visa card ending 4412 for NETFLIX.COM.",
    ).drafts[0]!;
    expect(draft.kind).toBe("payment");
    expect(draft.transactionType).toBe("refund");
    expect(draft.eligible).toBe(false);
    expect(draft.warnings.some((warning) => warning.code === "refund")).toBe(true);
  });

  it("never turns a zero-value card check into a subscription", () => {
    const draft = analyzeMessage(
      "Card verification alert: a temporary hold of GHS 0.00 was placed on your Visa card ending 4412 at NETFLIX.COM.",
    ).drafts[0]!;
    expect(draft.kind).toBe("payment");
    expect(draft.transactionType).toBe("card_check");
    expect(draft.eligible).toBe(false);
    expect(draft.warnings.some((warning) => warning.code === "card_check")).toBe(true);
    expect(draft.warnings.some((warning) => warning.code === "zero_value")).toBe(true);
  });

  it("flags declined payments", () => {
    const draft = analyzeMessage(
      "Your payment of GHS 100.00 to SPOTIFY was declined due to insufficient funds.",
    ).drafts[0]!;
    expect(draft.kind).toBe("payment");
    expect(draft.transactionType).toBe("declined");
    expect(draft.eligible).toBe(false);
  });
});

describe("trial and renewal confirmations", () => {
  it("captures trial expiry and first charge separately", () => {
    const result = analyzeMessage(
      "Your Netflix free trial ends on 12 June 2026. Your first payment of GHS 75.00 " +
        "will be charged on 19 June 2026. Cancel anytime before the trial ends.",
    );
    expect(result.parser).toBe("trial");
    const draft = result.drafts[0]!;
    expect(draft.kind).toBe("trial");
    expect(draft.merchant).toBe("Netflix");
    expect(draft.trialEndsAt).toBe("2026-06-12");
    expect(draft.firstChargeAt).toBe("2026-06-19");
    expect(draft.amountMinor).toBe(7500);
    expect(draft.eligible).toBe(true);
  });

  it("calculates a trial end from a stated duration and start date", () => {
    const draft = analyzeMessage(
      "Your Spotify 14-day free trial started on 1 June 2026 and converts to a paid plan after the trial.",
    ).drafts[0]!;
    expect(draft.kind).toBe("trial");
    expect(draft.trialEndsAt).toBe("2026-06-15");
    expect(draft.warnings.some((warning) => warning.code === "trial_end_estimated")).toBe(true);
  });

  it("asks for a missing trial end instead of guessing", () => {
    const draft = analyzeMessage("Your free trial has started. Manage your plan in the app.").drafts[0]!;
    expect(draft.kind).toBe("trial");
    expect(draft.trialEndsAt).toBeNull();
    expect(draft.eligible).toBe(false);
    expect(draft.warnings.some((warning) => warning.code === "trial_end_missing")).toBe(true);
  });

  it("reads an explicit renewal notice", () => {
    const draft = analyzeMessage(
      "Your Spotify Premium subscription will renew on 3 July 2026 for GHS 39.00. Plan: monthly.",
    ).drafts[0]!;
    expect(draft.kind).toBe("subscription");
    expect(draft.merchant).toBe("Spotify Premium");
    expect(draft.amountMinor).toBe(3900);
    expect(draft.renewalDate).toBe("2026-07-03");
    expect(draft.cycle).toBe("monthly");
    expect(draft.eligible).toBe(true);
  });

  it("asks for clarification on an ambiguous numeric date", () => {
    const draft = analyzeMessage(
      "Your Netflix subscription renews on 05/06/2026 for GHS 75.00.",
    ).drafts[0]!;
    expect(draft.renewalDate).toBeNull();
    expect(draft.warnings.some((warning) => warning.code === "date_ambiguous")).toBe(true);
  });
});

describe("recurring candidates", () => {
  const charge = (
    date: string,
    amount = 5500,
    merchant = "Netflix",
    type: RecurringTransaction["type"] = "payment",
  ): RecurringTransaction => ({
    merchant,
    amountMinor: amount,
    currency: "GHS",
    occurredAt: date,
    type,
  });

  it("treats three matching monthly charges as strong evidence", () => {
    const candidates = detectRecurringCandidates([
      charge("2026-01-15"),
      charge("2026-02-15"),
      charge("2026-03-15"),
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.cycle).toBe("monthly");
    expect(candidates[0]?.nextDate).toBe("2026-04-15");
    expect(candidates[0]?.strong).toBe(true);
    expect(candidates[0]?.estimated).toBe(true);
    expect(candidates[0]?.confidence).toBeGreaterThanOrEqual(70);
  });

  it("keeps a one-off charge out of recurring suggestions", () => {
    expect(detectRecurringCandidates([charge("2026-01-15")])).toHaveLength(0);
  });

  it("ignores refunds, declines, card checks and zero-value attempts", () => {
    const candidates = detectRecurringCandidates([
      charge("2026-01-15", 5500, "Netflix", "refund"),
      charge("2026-02-15", 5500, "Netflix", "declined"),
      charge("2026-03-15", 0, "Netflix", "card_check"),
      charge("2026-04-15", 5500, "Netflix", "payment"),
    ]);
    expect(candidates).toHaveLength(0);
  });

  it("separates two plans from the same merchant", () => {
    const candidates = detectRecurringCandidates([
      charge("2026-01-05", 5500, "Netflix"),
      charge("2026-02-05", 5500, "Netflix"),
      charge("2026-03-05", 5500, "Netflix"),
      charge("2026-01-20", 13000, "Netflix"),
      charge("2026-02-20", 13000, "Netflix"),
      charge("2026-03-20", 13000, "Netflix"),
    ]);
    expect(candidates).toHaveLength(2);
    expect(candidates.map((entry) => entry.amountMinor).sort((a, b) => a - b)).toEqual([5500, 13000]);
  });

  it("merges the same payment arriving from two sources", () => {
    const candidates = detectRecurringCandidates([
      charge("2026-01-15"),
      charge("2026-01-15"),
      charge("2026-02-15"),
      charge("2026-03-15"),
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.transactions).toHaveLength(3);
    expect(candidates[0]?.duplicatePayments).toBe(1);
  });

  it("allows two charges only with independent evidence", () => {
    const two = [charge("2026-01-15"), charge("2026-02-15")];
    expect(detectRecurringCandidates(two)).toHaveLength(0);
    const withEvidence = detectRecurringCandidates(two, { independentEvidence: true });
    expect(withEvidence).toHaveLength(1);
    expect(withEvidence[0]?.strong).toBe(false);
    expect(withEvidence[0]?.confidence).toBeLessThan(70);
  });
});
