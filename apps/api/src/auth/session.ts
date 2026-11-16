import type { Env } from "../env.js";
import type { AuthUser } from "./jwt.js";

/**
 * Server-side session lookup through Neon Auth's `get-session` endpoint.
 * Used as a fallback when a bearer JWT is absent and, importantly, keeps the
 * browser's session cookie first-party because it never leaves our proxy.
 */
export async function sessionFromCookie(cookieHeader: string, env: Env): Promise<AuthUser | null> {
  try {
    const response = await fetch(`${env.NEON_AUTH_BASE_URL.replace(/\/$/, "")}/get-session`, {
      method: "GET",
      headers: { accept: "application/json", cookie: cookieHeader },
      signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok) return null;
    const body = (await response.json().catch(() => null)) as
      | { user?: { id?: string; email?: string; name?: string } }
      | { data?: { user?: { id?: string; email?: string; name?: string } } }
      | null;
    const user = (body as { user?: unknown })?.user ?? (body as { data?: { user?: unknown } })?.data?.user;
    if (!user || typeof user !== "object" || typeof (user as { id?: unknown }).id !== "string") return null;
    const record = user as { id: string; email?: string; name?: string };
    const resolved: AuthUser = {
      id: record.id,
      email: record.email ?? null,
      name: record.name ?? null,
      source: "session",
    };
    return resolved;
  } catch {
    return null;
  }
}
