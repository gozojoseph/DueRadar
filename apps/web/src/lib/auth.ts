import { createAuthClient } from "@neon/neon-js/auth";

/**
 * The auth client talks to our own origin. The API proxies Neon Auth at
 * `/api/auth/*`, which makes the session cookie first-party and keeps Safari's
 * tracking prevention from dropping it.
 */
export const authClient = createAuthClient(`${window.location.origin}/api/auth`);

export interface AuthSession {
  user: { id: string; email: string; name?: string | null; image?: string | null };
  session: { token: string; expiresAt: string | Date };
}

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

function tokenFromSession(
  session: AuthSession | null,
): { token: string; expires: number } | null {
  if (!session?.session?.token) return null;
  return {
    token: session.session.token,
    expires: new Date(session.session.expiresAt).getTime(),
  };
}

/** Returns a JWT if it is safe to reuse for another few minutes. */
export async function getAuthToken(force = false): Promise<string | null> {
  if (!force && cachedToken && tokenExpiresAt - Date.now() > 2 * 60_000) {
    return cachedToken;
  }
  const { data } = await authClient.getSession();
  const session = (data ?? null) as AuthSession | null;
  const token = tokenFromSession(session);
  if (!token) {
    cachedToken = null;
    tokenExpiresAt = 0;
    return null;
  }
  cachedToken = token.token;
  tokenExpiresAt = token.expires;
  return cachedToken;
}

export function clearAuthToken(): void {
  cachedToken = null;
  tokenExpiresAt = 0;
}

export function authErrorMessage(error: unknown): string {
  if (!error) return "Something went wrong. Try again.";
  if (typeof error === "string") return error;
  if (typeof error === "object") {
    const record = error as { message?: string; statusText?: string; code?: string };
    if (record.message) return record.message;
    if (record.statusText) return record.statusText;
    if (record.code) return record.code;
  }
  return "Something went wrong. Try again.";
}
