import { createDatabase } from "./client.js";
import { runMigrations } from "./migrator.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is required to run migrations.");
  process.exit(1);
}

const { pool, db } = createDatabase(connectionString, {
  max: 1,
  applicationName: "dueradar-migrate",
});

try {
  await runMigrations(db, { pool });
} catch (error) {
  console.error("Migration failed:", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
