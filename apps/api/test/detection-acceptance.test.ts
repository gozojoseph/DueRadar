import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DetectionSuggestion } from "@dueradar/db/schema";
import type { Database } from "../src/db.js";

const { createSubscriptionMock, enforcePlanLimitMock, lockPlanMock } = vi.hoisted(() => ({
  createSubscriptionMock: vi.fn(),
  enforcePlanLimitMock: vi.fn(),
  lockPlanMock: vi.fn(),
}));

vi.mock("../src/services/subscriptions.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/services/subscriptions.js")>()),
  createSubscription: createSubscriptionMock,
}));

vi.mock("../src/services/plan.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/services/plan.js")>()),
  enforceActiveItemLimit: enforcePlanLimitMock,
  lockPlanForUser: lockPlanMock,
}));

import { acceptSuggestion } from "../src/services/detection.js";

const suggestionId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";

function makeSuggestion(): DetectionSuggestion {
  return {
    id: suggestionId,
    userId,
    importId: null,
    kind: "subscription",
    payload: {
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
      dedupeKey: "netflix-monthly",
    },
    confidence: 80,
    dedupeKey: "netflix-monthly",
    status: "pending",
    acceptedSubscriptionId: null,
    resolvedAt: null,
    createdAt: new Date("2026-11-16T12:00:00.000Z"),
  };
}

function makeDatabase(initial: DetectionSuggestion): {
  db: Database;
  getSuggestion: () => DetectionSuggestion;
} {
  let persisted = initial;
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [persisted],
        }),
      }),
    }),
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      let staged = { ...persisted };
      const tx = {
        update: () => ({
          set: (values: Partial<DetectionSuggestion>) => ({
            where: () => ({
              returning: async () => {
                staged = { ...staged, ...values };
                return [staged];
              },
            }),
          }),
        }),
      };
      const result = await callback(tx);
      persisted = staged;
      return result;
    },
  } as unknown as Database;
  return { db, getSuggestion: () => persisted };
}

describe("acceptSuggestion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("commits the suggestion claim, subscription, and linked id in one transaction", async () => {
    const { db, getSuggestion } = makeDatabase(makeSuggestion());
    createSubscriptionMock.mockResolvedValue({ id: "subscription-1" });

    const result = await acceptSuggestion(db, userId, suggestionId, {}, "UTC");

    expect(createSubscriptionMock).toHaveBeenCalledWith(
      expect.any(Object),
      userId,
      expect.objectContaining({ name: "Netflix" }),
      "UTC",
    );
    expect(getSuggestion()).toMatchObject({
      status: "accepted",
      acceptedSubscriptionId: "subscription-1",
    });
    expect(result.subscriptionId).toBe("subscription-1");
    expect(result.suggestion.acceptedSubscriptionId).toBe("subscription-1");
  });

  it("rolls back the accepted status when subscription creation fails", async () => {
    const { db, getSuggestion } = makeDatabase(makeSuggestion());
    createSubscriptionMock.mockRejectedValue(new Error("subscription creation failed"));

    await expect(acceptSuggestion(db, userId, suggestionId, {}, "UTC")).rejects.toThrow(
      "subscription creation failed",
    );

    expect(getSuggestion()).toMatchObject({ status: "pending", acceptedSubscriptionId: null });
  });
});
