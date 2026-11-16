import { sql } from "drizzle-orm";
import type { DatabaseExecutor } from "@dueradar/db";
import type { FastifyRequest } from "fastify";
import { requireUser } from "../auth/guard.js";
import type { Env } from "../env.js";
import { forbidden } from "../lib/errors.js";

export function isAdminEmail(email: string | null | undefined, allowlist: string[]): boolean {
  const normalizedEmail = email?.trim().toLowerCase();
  return Boolean(normalizedEmail && allowlist.includes(normalizedEmail));
}

export async function isAdminUser(
  db: DatabaseExecutor,
  env: Env,
  userId: string,
): Promise<boolean> {
  if (env.ADMIN_EMAILS.length === 0) return false;

  const result = await db.execute(sql`
    select email
    from neon_auth."user"
    where id = ${userId}::uuid and "emailVerified" = true
    limit 1
  `);
  const rows = (result as unknown as { rows: Array<{ email?: string | null }> }).rows;
  return isAdminEmail(rows[0]?.email, env.ADMIN_EMAILS);
}

export async function requireAdmin(
  request: FastifyRequest,
  env: Env,
  db: DatabaseExecutor,
) {
  const user = await requireUser(request, env);
  if (!(await isAdminUser(db, env, user.id))) {
    throw forbidden("You are not authorized to use the admin dashboard.");
  }
  return user;
}
