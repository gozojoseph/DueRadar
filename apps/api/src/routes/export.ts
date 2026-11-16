import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import {
  billingTransactions,
  billingOccurrences,
  categories,
  detectionSuggestions,
  devices,
  emailAliases,
  imports,
  notifications,
  paymentMethods,
  payments,
  profiles,
  providerConnections,
  subscriptions,
} from "@dueradar/db/schema";
import { todayInTimeZone } from "@dueradar/domain";
import { requireUser, userWithEmail } from "../auth/guard.js";
import type { Database } from "../db.js";
import type { Env } from "../env.js";
import { ensureProfile } from "../services/profile.js";

export async function registerExportRoutes(
  app: FastifyInstance,
  deps: { env: Env; db: Database },
): Promise<void> {
  const { env, db } = deps;

  app.get("/api/v1/export", async (request, reply) => {
    const user = await userWithEmail(request, env, await requireUser(request, env));
    const profile = await ensureProfile(db, user);

    const [
      subscriptionRows,
      occurrenceRows,
      paymentRows,
      billingRows,
      categoryRows,
      methodRows,
      notificationRows,
      deviceRows,
      aliasRows,
      providerRows,
      importRows,
      suggestionRows,
    ] = await Promise.all([
      db.select().from(subscriptions).where(eq(subscriptions.userId, user.id)),
      db.select().from(billingOccurrences).where(eq(billingOccurrences.userId, user.id)),
      db.select().from(payments).where(eq(payments.userId, user.id)),
      db
        .select()
        .from(billingTransactions)
        .where(eq(billingTransactions.userId, user.id)),
      db.select().from(categories).where(eq(categories.userId, user.id)),
      db.select().from(paymentMethods).where(eq(paymentMethods.userId, user.id)),
      db.select().from(notifications).where(eq(notifications.userId, user.id)),
      db.select().from(devices).where(eq(devices.userId, user.id)),
      db.select().from(emailAliases).where(eq(emailAliases.userId, user.id)),
      db.select().from(providerConnections).where(eq(providerConnections.userId, user.id)),
      db.select().from(imports).where(eq(imports.userId, user.id)),
      db
        .select()
        .from(detectionSuggestions)
        .where(eq(detectionSuggestions.userId, user.id)),
    ]);

    const payload = {
      exportedAt: new Date().toISOString(),
      app: "DueRadar",
      schemaVersion: 3,
      profile,
      subscriptions: subscriptionRows,
      occurrences: occurrenceRows,
      payments: paymentRows,
      billingTransactions: billingRows,
      categories: categoryRows,
      paymentMethods: methodRows,
      notifications: notificationRows,
      devices: deviceRows.map((device) => ({
        id: device.id,
        platform: device.platform,
        userAgent: device.userAgent,
        lastSeenAt: device.lastSeenAt,
        createdAt: device.createdAt,
        disabledAt: device.disabledAt,
      })),
      emailAliases: aliasRows,
      providerConnections: providerRows.map((connection) => ({
        id: connection.id,
        provider: connection.provider,
        status: connection.status,
        createdAt: connection.createdAt,
        revokedAt: connection.revokedAt,
      })),
      // Raw message text is deliberately excluded: it is erased after 72 hours
      // and may already be gone when this export runs.
      imports: importRows.map(({ rawText: _rawText, ...rest }) => rest),
      detectionSuggestions: suggestionRows,
    };

    const filename = `dueradar-export-${todayInTimeZone(profile.timezone)}.json`;
    return reply
      .header("content-type", "application/json; charset=utf-8")
      .header("content-disposition", `attachment; filename="${filename}"`)
      .send(JSON.stringify(payload, null, 2));
  });
}
