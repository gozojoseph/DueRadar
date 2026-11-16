import type { FastifyInstance, FastifyRequest } from "fastify";
import type { createDatabase } from "@dueradar/db";
import type { Env } from "../env.js";
import { unauthorized } from "../lib/errors.js";
import { verifyAuthToken, type AuthUser } from "./jwt.js";
import { sessionFromCookie } from "./session.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Pool = ReturnType<typeof createDatabase>["pool"];

/**
 * Bearer tokens are stateless for their 15-minute lifetime, so a token issued
 * before account deletion would otherwise keep working. Cookie sessions are
 * invalidated by Neon Auth itself, but every bearer request is checked against
 * the still-existing `neon_auth.user` row before a handler can touch data.
 */
export function registerActiveAccountGuard(
  app: FastifyInstance,
  env: Env,
  pool: Pool,
): void {
  app.addHook("onRequest", async (request: FastifyRequest) => {
    if (!request.url.startsWith("/api/v1/")) return;

    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) return;
    const token = authorization.slice("Bearer ".length).trim();
    if (!token) return;

    const user = await verifyAuthToken(token, env);
    if (!UUID_PATTERN.test(user.id)) {
      throw unauthorized("Your session is invalid. Sign in again.");
    }

    const result = await pool.query(
      'select 1 from neon_auth."user" where id = $1::uuid limit 1',
      [user.id],
    );
    if ((result.rowCount ?? 0) === 0) {
      throw unauthorized("Your account no longer exists. Sign in again.");
    }
  });
}

/**
 * Resolves the caller from a bearer JWT (preferred) or the first-party
 * session cookie. An invalid bearer token is rejected rather than silently
 * downgraded to the cookie.
 */
export async function resolveUser(request: FastifyRequest, env: Env): Promise<AuthUser | null> {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length).trim();
    if (!token) throw unauthorized("Missing session token.");
    return verifyAuthToken(token, env);
  }

  const cookie = request.headers.cookie;
  if (!cookie) return null;

  const user = await sessionFromCookie(cookie, env);
  if (user) return user;

  // A cookie may be present but the JWT absent during the initial auth
  // handshake. Treat it as anonymous rather than an error.
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
