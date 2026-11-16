import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export interface DatabaseOptions {
  max?: number;
  applicationName?: string;
}

export type Database = ReturnType<typeof createDatabase>["db"];

export function createDatabase(connectionString: string, options: DatabaseOptions = {}) {
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: options.applicationName ?? "dueradar",
  });
  pool.on("error", (error) => {
    console.error("[db] idle client error", error.message);
  });
  const db = drizzle(pool, { schema });
  return { pool, db };
}
