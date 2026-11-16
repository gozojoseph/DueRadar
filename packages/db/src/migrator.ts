import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Database } from "./client.js";

/**
 * Absolute path to the SQL migrations shipped with this package. Resolved from
 * the module URL so it works from `tsx`, compiled output, and a container.
 */
export const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

const LOCK_ID = 728_491_002;

export interface RunMigrationsOptions {
  /** Pool used only for the advisory lock. Defaults to the drizzle client's pool. */
  pool: { query: (text: string, values?: unknown[]) => Promise<unknown> };
  folder?: string;
  log?: (message: string) => void;
}

/**
 * Applies pending migrations under a Postgres advisory lock so that a web
 * service and a worker booting at the same time cannot race each other.
 */
export async function runMigrations(
  db: Database,
  options: RunMigrationsOptions,
): Promise<void> {
  const log = options.log ?? ((message: string) => console.log(message));
  await options.pool.query("select pg_advisory_lock($1)", [LOCK_ID]);
  try {
    await migrate(db, { migrationsFolder: options.folder ?? migrationsFolder });
    log("Migrations applied.");
  } finally {
    await options.pool.query("select pg_advisory_unlock($1)", [LOCK_ID]);
  }
}
