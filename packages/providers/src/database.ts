import { createDatabase } from "@dueradar/db";

/** Same shape the API derives from its own db instance. */
export type Database = ReturnType<typeof createDatabase>["db"];
