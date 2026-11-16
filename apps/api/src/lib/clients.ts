import { createEmailClient } from "@dueradar/email";
import { createPushClient } from "@dueradar/push";
import type { Env } from "../env.js";

export function createClients(env: Env) {
  const email = createEmailClient({
    apiKey: env.RESEND_API_KEY,
    from: env.EMAIL_FROM,
    replyTo: env.SUPPORT_EMAIL,
    appOrigin: env.APP_ORIGIN,
    supportEmail: env.SUPPORT_EMAIL,
  });
  const push = createPushClient({
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT,
  });
  return { email, push };
}

export type Clients = ReturnType<typeof createClients>;
