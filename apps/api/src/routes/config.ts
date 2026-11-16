import type { FastifyInstance } from "fastify";
import type { Env } from "../env.js";

export async function registerConfigRoutes(app: FastifyInstance, env: Env): Promise<void> {
  const handler = async () => ({
    appName: "DueRadar",
    environment: env.NODE_ENV,
    supportEmail: env.SUPPORT_EMAIL,
    vapidPublicKey: env.VAPID_PUBLIC_KEY ?? null,
    pushConfigured: Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY),
    emailConfigured: Boolean(env.RESEND_API_KEY),
    defaults: {
      timezone: "Africa/Accra",
      currency: "GHS",
      locale: "en-GH",
      reminderTime: "09:00",
      quietHoursStart: "21:00",
      quietHoursEnd: "07:00",
      weekStartsOn: 1,
    },
  });

  app.get("/api/config", handler);
  app.get("/api/v1/config", handler);
}
