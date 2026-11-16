import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { PaidInterval } from "./plan.js";
import { PLUS_PRICES } from "./plan.js";

const PAYSTACK_API = "https://api.paystack.co";

const initializeResponseSchema = z.object({
  status: z.literal(true),
  data: z.object({
    authorization_url: z.string().url(),
    reference: z.string(),
  }),
});

const verifyResponseSchema = z.object({
  status: z.literal(true),
  data: z.object({
    id: z.number().int().positive(),
    reference: z.string(),
    status: z.string(),
    amount: z.number().int().nonnegative(),
    currency: z.string(),
    paid_at: z.string().nullable().optional(),
  }),
});

export interface VerifiedPaystackTransaction {
  id: number;
  reference: string;
  status: string;
  amount: number;
  currency: string;
  paidAt: Date | null;
}

async function paystackRequest(
  secretKey: string,
  path: string,
  init: RequestInit,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${PAYSTACK_API}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${secretKey}`,
        accept: "application/json",
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("Could not reach Paystack. Please try again.");
  }

  if (!response.ok) {
    throw new Error(`Paystack request failed with status ${response.status}.`);
  }

  try {
    return await response.json();
  } catch {
    throw new Error("Paystack returned an unreadable response.");
  }
}

export async function initializePaystackCheckout(
  secretKey: string,
  input: {
    email: string;
    reference: string;
    interval: PaidInterval;
    callbackUrl: string;
  },
): Promise<string> {
  const price = PLUS_PRICES[input.interval];
  const response = await paystackRequest(secretKey, "/transaction/initialize", {
    method: "POST",
    body: JSON.stringify({
      email: input.email,
      amount: price.amountMinor,
      currency: "GHS",
      reference: input.reference,
      callback_url: input.callbackUrl,
      metadata: {
        app: "DueRadar",
        plan_interval: input.interval,
      },
    }),
  });
  const parsed = initializeResponseSchema.safeParse(response);
  if (!parsed.success || parsed.data.data.reference !== input.reference) {
    throw new Error("Paystack could not initialize checkout.");
  }
  const authorizationUrl = new URL(parsed.data.data.authorization_url);
  if (
    authorizationUrl.protocol !== "https:" ||
    authorizationUrl.hostname !== "checkout.paystack.com"
  ) {
    throw new Error("Paystack returned an unexpected checkout URL.");
  }
  return authorizationUrl.toString();
}

export async function verifyPaystackCheckout(
  secretKey: string,
  reference: string,
): Promise<VerifiedPaystackTransaction> {
  const response = await paystackRequest(
    secretKey,
    `/transaction/verify/${encodeURIComponent(reference)}`,
    { method: "GET" },
  );
  const parsed = verifyResponseSchema.safeParse(response);
  if (!parsed.success) throw new Error("Paystack returned an invalid verification response.");
  const transaction = parsed.data.data;
  return {
    id: transaction.id,
    reference: transaction.reference,
    status: transaction.status,
    amount: transaction.amount,
    currency: transaction.currency,
    paidAt: transaction.paid_at ? new Date(transaction.paid_at) : null,
  };
}

export function verifyPaystackSignature(
  rawBody: Buffer,
  signature: string | undefined,
  secretKey: string,
): boolean {
  if (!signature || !/^[a-f\d]{128}$/i.test(signature)) return false;
  const expected = createHmac("sha512", secretKey).update(rawBody).digest();
  const provided = Buffer.from(signature, "hex");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
