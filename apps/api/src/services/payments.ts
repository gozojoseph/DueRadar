import { eq } from "drizzle-orm";
import { appSettings, type CheckoutProvider } from "@dueradar/db/schema";
import type { Database } from "../db.js";
import type { Env } from "../env.js";
import { badRequest } from "../lib/errors.js";

/** The app_settings row that records which checkout provider serves new checkouts. */
export const CHECKOUT_PROVIDER_KEY = "checkout_provider";

export async function getCheckoutProvider(db: Database): Promise<CheckoutProvider> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, CHECKOUT_PROVIDER_KEY))
    .limit(1);
  return row?.value === "yebeck" ? "yebeck" : "paystack";
}

export async function setCheckoutProvider(
  db: Database,
  provider: CheckoutProvider,
): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key: CHECKOUT_PROVIDER_KEY, value: provider, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: provider, updatedAt: new Date() },
    });
}

export interface CheckoutProviderStatus {
  id: CheckoutProvider;
  name: string;
  /** Credentials exist so the provider could serve traffic. */
  configured: boolean;
  /** The integration is implemented end to end (checkout + verify + webhook). */
  available: boolean;
}

/**
 * Which providers this deployment can actually serve. Yebeck stays
 * unavailable until its adapter (checkout, verify, webhook) is implemented;
 * the admin toggle refuses to activate an unavailable provider, so checkouts
 * can never be pointed at something that cannot collect payment.
 */
export function checkoutProviderStatuses(env: Env): CheckoutProviderStatus[] {
  const paystackConfigured = Boolean(env.PAYSTACK_SECRET_KEY);
  return [
    {
      id: "paystack",
      name: "Paystack",
      configured: paystackConfigured,
      available: paystackConfigured,
    },
    {
      id: "yebeck",
      name: "Yebeck",
      configured: false,
      available: false,
    },
  ];
}

export function parseCheckoutProvider(value: string): CheckoutProvider {
  if (value === "paystack" || value === "yebeck") return value;
  throw badRequest("Unknown payment provider.");
}
