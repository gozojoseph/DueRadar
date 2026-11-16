import type { FastifyInstance, FastifyRequest } from "fastify";
import type { createDatabase } from "@dueradar/db";
import type { Env } from "../env.js";
import { forbidden, unauthorized } from "../lib/errors.js";
import { verifyAuthToken, type AuthUser } from "./jwt.js";
import { sessionFromCookie } from "./session.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Pool = ReturnType<typeof createDatabase>["pool"];
const resolvedUsers = new WeakMap<FastifyRequest, AuthUser | null>();

/**
 * Bearer tokens are stateless for their 15-minute lifetime, so a token issued
 * before account deletion would otherwise keep working. Check both bearer and
 * cookie sessions against the auth row and enforce suspensions before handlers
 * can access application data.
 */
export function registerActiveAccountGuard(
  app: FastifyInstance,
  env: Env,
  pool: Pool,
): void {
  app.addHook("onRequest", async (request: FastifyRequest) => {
    if (!request.url.startsWith("/api/v1/")) return;

    const user = await resolveUser(request, env);
    if (!user) return;
    if (!UUID_PATTERN.test(user.id)) {
      throw unauthorized("Your session is invalid. Sign in again.");
    }

    const result = await pool.query(
      `select p.suspended_at
       from neon_auth."user" as u
       left join public.profiles as p on p.user_id = u.id::text
       where u.id = $1::uuid
       limit 1`,
      [user.id],
    );
    const account = result.rows[0] as { suspended_at?: Date | string | null } | undefined;
    if (!account) {
      throw unauthorized("Your account no longer exists. Sign in again.");
    }
    if (account.suspended_at && !isSuspensionExempt(request)) {
      throw forbidden(
        "Your account is suspended. You can still export your data or delete your account.",
      );
    }
  });
}

function isSuspensionExempt(request: FastifyRequest): boolean {
  const path = request.url.split("?")[0] ?? request.url;
  if (path.startsWith("/api/v1/admin/")) return true;
  return (
    (request.method === "GET" && (path === "/api/v1/me" || path === "/api/v1/export")) ||
    (request.method === "DELETE" && path === "/api/v1/account") ||
    (request.method === "POST" && path === "/api/v1/account/delete")
  );
}

/**
 * Resolves the caller from a bearer JWT (preferred) or the first-party
 * session cookie. An invalid bearer token is rejected rather than silently
 * downgraded to the cookie.
 */
export async function resolveUser(request: FastifyRequest, env: Env): Promise<AuthUser | null> {
  if (resolvedUsers.has(request)) return resolvedUsers.get(request) ?? null;

  const authorization = request.headers.authorization;
  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length).trim();
    if (!token) throw unauthorized("Missing session token.");
    const user = await verifyAuthToken(token, env);
    resolvedUsers.set(request, user);
    return user;
  }

  const cookie = request.headers.cookie;
  if (!cookie) {
    resolvedUsers.set(request, null);
    return null;
  }

  const user = await sessionFromCookie(cookie, env);
  if (user) {
    resolvedUsers.set(request, user);
    return user;
  }

  // A cookie may be present but the JWT absent during the initial auth
  // handshake. Treat it as anonymous rather than an error.
  resolvedUsers.set(request, null);
  return null;
}

export async function requireUser(request: FastifyRequest, env: Env): Promise<AuthUser> {
  const user = await resolveUser(request, env);
  if (!user) throw unauthorized();
  return user;
}

/** Ensures a profile has an email even when the JWT omits the claim. */
export async function userWithEmail(
  request: FastifyRequest,
  env: Env,
  user: AuthUser,
): Promise<AuthUser> {
  if (user.email) return user;
  const cookie = request.headers.cookie;
  if (!cookie) return user;
  const session = await sessionFromCookie(cookie, env);
  if (session && session.id === user.id) {
    return { ...user, email: session.email, name: user.name ?? session.name };
  }
  return user;
}
