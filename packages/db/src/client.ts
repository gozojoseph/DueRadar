import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export interface DatabaseOptions {
  max?: number;
  applicationName?: string;
}

export type Database = ReturnType<typeof createDatabase>["db"];
export type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DatabaseExecutor = Database | DatabaseTransaction;

export function createDatabase(connectionString: string, options: DatabaseOptions = {}) {
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Detect half-open sockets (e.g. a VPN or radio drop to Neon) so requests
    // fail fast instead of hanging until the OS TCP timeout.
    keepAlive: true,
    application_name: options.applicationName ?? "dueradar",
  });
  pool.on("error", (error) => {
    console.error("[db] idle client error", error.message);
  });
  const db = drizzle(pool, { schema });
  return { pool, db };
}
