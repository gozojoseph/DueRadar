import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "../env.js";
import { unauthorized } from "../lib/errors.js";

export interface AuthUser {
  id: string;
  email: string | null;
  name: string | null;
  source: "jwt" | "session";
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksUrl: string | null = null;

function getJwks(env: Env) {
  const url = env.NEON_AUTH_JWKS_URL ?? `${env.NEON_AUTH_BASE_URL.replace(/\/$/, "")}/.well-known/jwks.json`;
  if (!jwks || jwksUrl !== url) {
    jwks = createRemoteJWKSet(new URL(url), {
      cacheMaxAge: 10 * 60_000,
      cooldownDuration: 30_000,
      timeoutDuration: 5_000,
    });
    jwksUrl = url;
  }
  return jwks;
}

/**
 * Warms the JWKS cache right after startup so the first bearer request does
 * not pay the initial remote fetch (~1s+ on a cold process). Never throws:
 * when the auth service is briefly unavailable, verification still works
 * lazily on the first real request.
 */
export function warmUpJwks(env: Env): void {
  void getJwks(env)({ alg: "EdDSA" }).catch(() => undefined);
}

/**
 * Verifies a Neon Auth access token (15-minute EdDSA JWT) against the
 * branch's JWKS. Issuer/audience checks are enabled when configured.
 */
export async function verifyAuthToken(token: string, env: Env): Promise<AuthUser> {
  try {
    const { payload } = await jwtVerify(token, getJwks(env), {
      issuer: env.NEON_AUTH_ISSUER || undefined,
      audience: env.NEON_AUTH_AUDIENCE || undefined,
      clockTolerance: 60,
    });
    if (typeof payload.sub !== "string" || payload.sub.length === 0) {
      throw new Error("missing subject");
    }
    return {
      id: payload.sub,
      email: typeof payload.email === "string" ? payload.email : null,
      name: typeof payload.name === "string" ? payload.name : null,
      source: "jwt",
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "verification failed";
    throw unauthorized(`Your session has expired. Sign in again. (${reason})`);
  }
}
