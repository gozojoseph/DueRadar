import { buildApp } from "./app.js";
import { warmUpJwks } from "./auth/jwt.js";
import { db, pool } from "./db.js";
import { loadEnv } from "./env.js";
import { runMigrations } from "@dueradar/db";

const env = loadEnv();

if (env.RUN_MIGRATIONS !== "false") {
  try {
    await runMigrations(db, {
      pool,
      log: (message) => console.info(`[db] ${message}`),
    });
  } catch (error) {
    console.error("[db] Migration failed; refusing to start with an out-of-date schema.", error);
    process.exit(1);
  }
}

const app = await buildApp({ env, db, pool });

// Prime the Neon Auth JWKS cache in the background; failures are harmless
// because verification fetches lazily anyway.
warmUpJwks(env);

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "Shutting down");
  const timer = setTimeout(() => {
    app.log.error("Forced exit after 10s");
    process.exit(1);
  }, 10_000);
  timer.unref();
  try {
    await app.close();
    await pool.end();
    process.exit(0);
  } catch (error) {
    app.log.error({ err: error }, "Shutdown failed");
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

try {
  await app.listen({ port: env.PORT, host: env.HOST });
  app.log.info(
    { port: env.PORT, environment: env.NODE_ENV, origin: env.APP_ORIGIN },
    "DueRadar API listening",
  );
} catch (error) {
  app.log.error({ err: error }, "Failed to start");
  process.exit(1);
}
