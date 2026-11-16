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

    try {
      const response = await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        JSON.stringify(payload),
        { TTL: 60 * 60 * 6, urgency: "normal" },
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
    }
  }

  return { send, configured, publicKey: config.publicKey ?? null };
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
