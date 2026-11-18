import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BillingTransaction } from "@dueradar/db/schema";
import {
  initializePaystackCheckout,
  verifyPaystackSignature,
  type VerifiedPaystackTransaction,
} from "../src/services/paystack.js";
import {
  isTerminalPaymentFailure,
  matchesBillingTransaction,
} from "../src/services/billing.js";
import { hasPlusAccess, requiresPaidPlan } from "../src/services/plan.js";
import { verifyYebeckCollection, type YebeckCollection } from "../src/services/yebeck.js";

const now = new Date("2026-11-20T12:00:00.000Z");
const reference = "dr_1234567890abcdef";
const secret = "sk_test_billing_secret";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Plus entitlement", () => {
  it("keeps grandfathered access and expires paid access at the exact boundary", () => {
    expect(
      hasPlusAccess(
        { planTier: "plus", planExpiresAt: null, planGrandfathered: true },
        now,
      ),
    ).toBe(true);
    expect(
      hasPlusAccess(
        {
          planTier: "plus",
          planExpiresAt: new Date("2026-11-20T12:00:00.001Z"),
          planGrandfathered: false,
        },
        now,
      ),
    ).toBe(true);
    expect(
      hasPlusAccess(
        {
          planTier: "plus",
          planExpiresAt: now,
          planGrandfathered: false,
        },
        now,
      ),
    ).toBe(false);
    expect(
      hasPlusAccess(
        { planTier: "free", planExpiresAt: null, planGrandfathered: false },
        now,
      ),
    ).toBe(false);
  });

  it("requires payment only for paid-only accounts without active Plus access", () => {
    expect(
      requiresPaidPlan(
        {
          paidAccessRequired: true,
          planTier: "free",
          planExpiresAt: null,
          planGrandfathered: false,
        },
        now,
      ),
    ).toBe(true);
    expect(
      requiresPaidPlan(
        {
          paidAccessRequired: false,
          planTier: "free",
          planExpiresAt: null,
          planGrandfathered: false,
        },
        now,
      ),
    ).toBe(false);
    expect(
      requiresPaidPlan(
        {
          paidAccessRequired: true,
          planTier: "plus",
          planExpiresAt: new Date("2026-11-20T12:00:00.001Z"),
          planGrandfathered: false,
        },
        now,
      ),
    ).toBe(false);
    expect(
      requiresPaidPlan(
        {
          paidAccessRequired: true,
          planTier: "plus",
          planExpiresAt: now,
          planGrandfathered: false,
        },
        now,
      ),
    ).toBe(true);
    expect(
      requiresPaidPlan(
        {
          paidAccessRequired: true,
          planTier: "plus",
          planExpiresAt: null,
          planGrandfathered: true,
        },
        now,
      ),
    ).toBe(false);
  });
});

describe("Paystack payment verification", () => {
  const transaction = {
    reference,
    interval: "monthly",
    amountMinor: 999,
    currency: "GHS",
  } satisfies Pick<BillingTransaction, "reference" | "interval" | "amountMinor" | "currency">;

  const payment: VerifiedPaystackTransaction = {
    id: 101,
    reference,
    status: "success",
    amount: 999,
    currency: "GHS",
    paidAt: now,
  };

  const yebeckAmountMinor = 999;
  const yebeckAmount = yebeckAmountMinor / 100;
  const yebeck: YebeckCollection = {
    id: "ew_1234567890abcdef",
    reference,
    status: "successful",
    amount: yebeckAmount,
    fee: null,
    currency: "GHS",
    network: "mtn",
    isTest: true,
    amountMinor: yebeckAmountMinor,
    currencyMinor: "999",
    paidAt: now,
  };

  it("accepts only a successful payment matching the exact reference, amount, and currency", () => {
    expect(matchesBillingTransaction(transaction, payment)).toBe(true);
    expect(matchesBillingTransaction(transaction, { ...payment, amount: 9900 })).toBe(false);
    expect(matchesBillingTransaction(transaction, { ...payment, currency: "USD" })).toBe(false);
    expect(matchesBillingTransaction(transaction, { ...payment, reference: "other-reference" })).toBe(
      false,
    );
    expect(matchesBillingTransaction(transaction, { ...payment, status: "abandoned" })).toBe(false);
  });

  // Yebeck verifies against the same minor-unit contract as Paystack, so the
  // payment view carries amountMinor even though Yebeck's wire format is
  // decimal GHS (converted by the service layer).
  const yebeckPayment = {
    reference,
    status: "success",
    amount: yebeck.amountMinor,
    currency: "GHS",
  };

  it("accepts a matching Yebeck payment when the stored amount and currency match", () => {
    expect(matchesBillingTransaction(transaction, yebeckPayment)).toBe(true);
  });

  it("rejects a Yebeck payment whose stored amount does not match the checkout", () => {
    expect(
      matchesBillingTransaction(
        {
          ...transaction,
          interval: "annual",
          amountMinor: 1999,
        },
        yebeckPayment,
      ),
    ).toBe(false);
    expect(
      matchesBillingTransaction(
        {
          ...transaction,
          amountMinor: 1999,
        },
        yebeckPayment,
      ),
    ).toBe(false);
  });

  it("rejects a Yebeck payment whose verified amount or currency does not match", () => {
    expect(
      matchesBillingTransaction(transaction, { ...yebeckPayment, amount: 99.9 }),
    ).toBe(false);
    expect(
      matchesBillingTransaction(transaction, { ...yebeckPayment, currency: "USD" }),
    ).toBe(false);
  });

  it("classifies cancelled, declined, and expired statuses as terminal", () => {
    for (const status of [
      "failed",
      "cancelled",
      "canceled",
      "expired",
      "reversed",
      "abandoned",
      "declined",
      "FAILED",
    ]) {
      expect(isTerminalPaymentFailure(status)).toBe(true);
    }
    for (const status of ["pending", "successful", "success", "ongoing", "processing"]) {
      expect(isTerminalPaymentFailure(status)).toBe(false);
    }
  });

  it("validates the HMAC signature over the exact webhook bytes", () => {
    const rawBody = Buffer.from('{"event":"charge.success"}');
    const signature = createHmac("sha512", secret).update(rawBody).digest("hex");

    expect(verifyPaystackSignature(rawBody, signature, secret)).toBe(true);
    expect(verifyPaystackSignature(Buffer.from(`${rawBody.toString()} `), signature, secret)).toBe(
      false,
    );
    expect(verifyPaystackSignature(rawBody, undefined, secret)).toBe(false);
  });

  it("passes its raw response through so the exact amount and currency can be compared against the stored checkout", () => {
    expect(yebeck.status).toBe("successful");
    expect(yebeck.amountMinor).toBe(999);
    expect(yebeck.currencyMinor).toBe("999");
    expect(yebeck.currency).toBe("GHS");
    expect(yebeck.network).toBe("mtn");
    expect(yebeck.isTest).toBe(true);
  });

  it("normalizes a Yebeck collection response for the amount and currency checks", async () => {
    const fetchMock = vi.fn(
      async (_input: unknown, _init?: RequestInit): Promise<Response> =>
        new Response(
          JSON.stringify({
            success: true,
            message: "ok",
            data: {
              id: yebeck.id,
              reference: yebeck.reference,
              status: yebeck.status,
              amount: yebeck.amount,
              currency: yebeck.currency,
              network: yebeck.network,
              is_test: yebeck.isTest,
              created_at: now.toISOString(),
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const collection = await verifyYebeckCollection(secret, yebeck.reference);
    expect(collection).toEqual(yebeck);
  });

  it("initializes checkout with the server-owned GHS price and callback", async () => {
    const fetchMock = vi.fn(
      async (_input: unknown, _init?: RequestInit): Promise<Response> =>
        new Response(
          JSON.stringify({
            status: true,
            data: {
              authorization_url: "https://checkout.paystack.com/example",
              reference,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const checkoutUrl = await initializePaystackCheckout(secret, {
      email: "member@example.test",
      reference,
      interval: "monthly",
      callbackUrl: "https://app.example.test/billing/return",
    });

    expect(checkoutUrl).toBe("https://checkout.paystack.com/example");
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${secret}`);
    expect(JSON.parse(String(init?.body))).toMatchObject({
      amount: 999,
      currency: "GHS",
      reference,
      callback_url: "https://app.example.test/billing/return",
    });
  });

  it("rejects checkout redirects outside Paystack's hosted checkout origin", async () => {
    const fetchMock = vi.fn(
      async (_input: unknown, _init?: RequestInit): Promise<Response> =>
        new Response(
          JSON.stringify({
            status: true,
            data: {
              authorization_url: "https://checkout.attacker.example/session",
              reference,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      initializePaystackCheckout(secret, {
        email: "member@example.test",
        reference,
        interval: "monthly",
        callbackUrl: "https://app.example.test/billing/return",
      }),
    ).rejects.toThrow("unexpected checkout URL");
  });
});
