import { createDatabase } from "@dueradar/db";
import { loadEnv } from "./env.js";

const env = loadEnv();

export const { pool, db } = createDatabase(env.DATABASE_URL, {
  max: env.NODE_ENV === "production" ? 10 : 5,
  applicationName: "dueradar-api",
});

export type Database = typeof db;
