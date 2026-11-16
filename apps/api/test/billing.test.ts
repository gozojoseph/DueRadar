import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BillingTransaction } from "@dueradar/db/schema";
import { matchesBillingTransaction } from "../src/services/billing.js";
import {
  initializePaystackCheckout,
  verifyPaystackSignature,
  type VerifiedPaystackTransaction,
} from "../src/services/paystack.js";
import { hasPlusAccess, requiresPaidPlan } from "../src/services/plan.js";

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

  it("accepts only a successful payment matching the exact reference, amount, and currency", () => {
    expect(matchesBillingTransaction(transaction, payment)).toBe(true);
    expect(matchesBillingTransaction(transaction, { ...payment, amount: 9900 })).toBe(false);
    expect(matchesBillingTransaction(transaction, { ...payment, currency: "USD" })).toBe(false);
    expect(matchesBillingTransaction(transaction, { ...payment, reference: "other-reference" })).toBe(
      false,
    );
    expect(matchesBillingTransaction(transaction, { ...payment, status: "abandoned" })).toBe(false);
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
