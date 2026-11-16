import type { FastifyInstance } from "fastify";
import type { Database } from "../db.js";
import type { Env } from "../env.js";
import type { Clients } from "../lib/clients.js";
import { registerAccountRoutes } from "./account.js";
import { registerAuthProxy } from "./auth-proxy.js";
import { registerCategoryRoutes } from "./categories.js";
import { registerConfigRoutes } from "./config.js";
import { registerDashboardRoutes } from "./dashboard.js";
import { registerDetectionRoutes } from "./detections.js";
import { registerDeviceRoutes } from "./devices.js";
import { registerEmailAliasRoutes } from "./email-alias.js";
import { registerExportRoutes } from "./export.js";
import { registerImportRoutes } from "./imports.js";
import { registerNotificationRoutes } from "./notifications.js";
import { registerOccurrenceRoutes } from "./occurrences.js";
import { registerPaymentMethodRoutes } from "./payment-methods.js";
import { registerProfileRoutes } from "./profile.js";
import { registerSubscriptionRoutes } from "./subscriptions.js";
import { registerTestRoutes } from "./test.js";
import { registerWebhookRoutes } from "./webhooks.js";

export interface RouteDependencies {
  env: Env;
  db: Database;
  clients: Clients;
}

export async function registerRoutes(
  app: FastifyInstance,
  deps: RouteDependencies,
): Promise<void> {
  await registerConfigRoutes(app, deps.env);
  await registerAuthProxy(app, deps.env);
  await registerWebhookRoutes(app, deps);
  await registerProfileRoutes(app, deps);
  await registerCategoryRoutes(app, deps);
  await registerPaymentMethodRoutes(app, deps);
  await registerSubscriptionRoutes(app, deps);
  await registerOccurrenceRoutes(app, deps);
  await registerImportRoutes(app, deps);
  await registerDetectionRoutes(app, deps);
  await registerEmailAliasRoutes(app, deps);
  await registerDashboardRoutes(app, deps);
  await registerNotificationRoutes(app, deps);
  await registerDeviceRoutes(app, deps);
  await registerTestRoutes(app, deps);
  await registerExportRoutes(app, deps);
  await registerAccountRoutes(app, deps);
}
