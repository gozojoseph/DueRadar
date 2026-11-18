import { z } from "zod";

/**
 * Yebeck collections adapter (mobile money only — MTN, Telecel, AT).
 *
 * Key differences from Paystack, by design:
 * - No hosted checkout: DueRadar collects the network + number and
 *   initiates the collection itself; the user approves a prompt on their
 *   phone and the transaction starts `pending`.
 * - Amounts are decimal GHS over the wire (we store minor units).
 * - Live webhooks are not signed and not yet delivered in live mode, so
 *   every webhook and every user-triggered verify re-checks the status
 *   server-to-server before Plus is activated.
 */

const YEBECK_API = "https://api.yebeck.com/api/v1";

export type MomoNetwork = "mtn" | "telecel" | "at";

const collectionSchema = z.object({
  success: z.literal(true),
  data: z
    .object({
      id: z.string().optional(),
      reference: z.string().min(1),
      status: z.string().min(1),
      amount: z.number(),
      fee: z.number().optional(),
      currency: z.string().min(1),
      network: z.string().optional(),
      is_test: z.boolean().optional(),
      created_at: z.string().optional(),
    })
    .passthrough(),
});

export interface YebeckCollection {
  id: string;
  reference: string;
  status: string;
  amountMinor: number;
  currency: string;
  paidAt: Date | null;
}

async function yebeckRequest(
  secretKey: string,
  path: string,
  init: RequestInit,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${YEBECK_API}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${secretKey}`,
        accept: "application/json",
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("Could not reach Yebeck. Please try again.");
  }

  if (!response.ok) {
    throw new Error(`Yebeck request failed with status ${response.status}.`);
  }

  try {
    return await response.json();
  } catch {
    throw new Error("Yebeck returned an unreadable response.");
  }
}

function normalizeCollection(data: {
  id?: string;
  reference: string;
  status: string;
  amount: number;
  currency: string;
  created_at?: string;
}): YebeckCollection {
  return {
    id: data.id ?? data.reference,
    reference: data.reference,
    status: data.status,
    amountMinor: Math.round(data.amount * 100),
    currency: data.currency,
    paidAt: data.created_at ? new Date(data.created_at) : null,
  };
}

/**
 * Charges the customer's mobile money wallet. Resolves instantly to
 * `successful` with test keys; live keys return `pending` until the
 * mobile network confirms the prompt was approved.
 */
export async function initializeYebeckCollection(
  secretKey: string,
  input: {
    amountMinor: number;
    network: MomoNetwork;
    customerMsisdn: string;
    customerName?: string | null;
    narration?: string | null;
  },
): Promise<YebeckCollection> {
  const body = {
    amount: input.amountMinor / 100,
    network: input.network,
    customer_msisdn: input.customerMsisdn,
    ...(input.customerName ? { customer_name: input.customerName } : {}),
    ...(input.narration ? { narration: input.narration } : {}),
  };
  const response = await yebeckRequest(secretKey, "/collections", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const parsed = collectionSchema.safeParse(response);
  if (!parsed.success) {
    throw new Error("Yebeck could not initialize the collection.");
  }
  return normalizeCollection(parsed.data.data);
}

/** Re-checks a collection's status server-to-server by its MVN- reference. */
export async function verifyYebeckCollection(
  secretKey: string,
  reference: string,
): Promise<YebeckCollection> {
  const response = await yebeckRequest(
    secretKey,
    `/collections/${encodeURIComponent(reference)}`,
    { method: "GET" },
  );
  const parsed = collectionSchema.safeParse(response);
  if (!parsed.success) {
    throw new Error("Yebeck returned an invalid verification response.");
  }
  return normalizeCollection(parsed.data.data);
}

/**
 * Ghana mobile money numbers: 0 + 9 digits where the second digit is 2
 * (MTN/Telecel) or 5 (MTN/AT prefixes). Accepts +233 / 233 / 9-digit forms.
 */
export function normalizeGhanaMsisdn(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  let local = digits;
  if (local.startsWith("233")) local = `0${local.slice(3)}`;
  else if (local.length === 9) local = `0${local}`;
  if (!/^0[25]\d{8}$/.test(local)) return null;
  return local;
}
