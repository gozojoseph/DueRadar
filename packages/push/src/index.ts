import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import https from "node:https";
import ipaddr from "ipaddr.js";
import webpush from "web-push";

export interface PushSubscriptionRecord {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

export interface PushResult {
  ok: boolean;
  gone: boolean;
  skipped?: boolean;
  statusCode?: number;
  error?: string;
}

export interface PushClientConfig {
  publicKey?: string | null;
  privateKey?: string | null;
  subject: string;
}

export class PushEndpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PushEndpointError";
  }
}

interface ResolvedEndpoint {
  hostname: string;
  address: string;
  family: number;
}

type EndpointLookup = typeof lookup;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function resolvePublicEndpoint(
  endpoint: string,
  lookupImpl: EndpointLookup = lookup,
): Promise<ResolvedEndpoint> {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new PushEndpointError("Push endpoint must be an absolute HTTPS URL.");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !hostname ||
    url.hash
  ) {
    throw new PushEndpointError("Push endpoint must use public HTTPS without credentials.");
  }

  try {
    const addresses = isIP(hostname)
      ? [{ address: hostname, family: isIP(hostname) }]
      : await lookupImpl(hostname, { all: true, verbatim: true });

    if (addresses.length === 0) {
      throw new PushEndpointError("Push endpoint hostname has no public address.");
    }

    for (const address of addresses) {
      if (ipaddr.parse(address.address).range() !== "unicast") {
        throw new PushEndpointError("Push endpoint must resolve only to public IP addresses.");
      }
    }

    const selected = addresses[0];
    if (!selected) {
      throw new PushEndpointError("Push endpoint hostname has no public address.");
    }
    return { hostname, address: selected.address, family: selected.family };
  } catch (error) {
    if (error instanceof PushEndpointError) throw error;
    throw new PushEndpointError("Push endpoint hostname could not be resolved.");
  }
}

export async function validatePushEndpoint(
  endpoint: string,
  lookupImpl: EndpointLookup = lookup,
): Promise<void> {
  await resolvePublicEndpoint(endpoint, lookupImpl);
}

export function createPushClient(config: PushClientConfig) {
  const configured = Boolean(config.publicKey && config.privateKey);
  if (configured) {
    webpush.setVapidDetails(config.subject, config.publicKey!, config.privateKey!);
  }

  async function send(subscription: PushSubscriptionRecord, payload: PushPayload): Promise<PushResult> {
    if (!configured) {
      console.info("[push] VAPID keys not set; skipped push to", subscription.endpoint.slice(0, 32));
      return { ok: false, gone: false, skipped: true, error: "Push is not configured" };
    }

    let agent: https.Agent | undefined;
    try {
      const resolved = await withTimeout(
        resolvePublicEndpoint(subscription.endpoint),
        5_000,
        "Push endpoint DNS resolution timed out.",
      );
      agent = new https.Agent({
        lookup: (hostname, _options, callback) => {
          if (hostname.replace(/^\[|\]$/g, "").toLowerCase() !== resolved.hostname) {
            callback(new Error("Unexpected push endpoint hostname"), "", 0);
            return;
          }
          callback(null, resolved.address, resolved.family);
        },
      });
      const response = await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        JSON.stringify(payload),
        { TTL: 60 * 60 * 6, urgency: "normal", timeout: 10_000, agent },
      );
      return { ok: true, gone: false, statusCode: response.statusCode };
    } catch (error) {
      const statusCode =
        typeof error === "object" && error !== null && "statusCode" in error
          ? Number((error as { statusCode?: number }).statusCode)
          : undefined;
      const gone = statusCode === 404 || statusCode === 410;
      return {
        ok: false,
        gone,
        statusCode,
        error: error instanceof Error ? error.message : "Unknown push error",
      };
    } finally {
      agent?.destroy();
    }
  }

  return {
    send,
    configured,
    publicKey: config.publicKey ?? null,
    validateEndpoint: validatePushEndpoint,
  };
}

export type PushClient = ReturnType<typeof createPushClient>;

/**
 * Lock-screen previews stay generic by default: merchant and amount are
 * revealed only after the user opens DueRadar.
 */
export function buildReminderPush(options: {
  isTrial: boolean;
  daysBefore: number;
  appOrigin: string;
}): PushPayload {
  const when =
    options.daysBefore === 0 ? "today" : options.daysBefore === 1 ? "tomorrow" : "soon";
  return {
    title: options.isTrial ? "A free trial ends soon" : "A payment is due soon",
    body: options.isTrial
      ? `A trial ends ${when}. Open DueRadar to review it.`
      : `An upcoming payment is due ${when}. Open DueRadar to see it.`,
    url: `${options.appOrigin}/dashboard`,
    tag: `dueradar-${options.isTrial ? "trial" : "payment"}-${when}`,
  };
}
