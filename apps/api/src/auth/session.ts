import { createHash } from "node:crypto";
import type { Env } from "../env.js";
import type { AuthUser } from "./jwt.js";

interface SessionCacheEntry {
  user: AuthUser | null;
  expiresAt: number;
}

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, SessionCacheEntry>();

function cacheKey(cookieHeader: string): string {
  return createHash("sha256").update(cookieHeader).digest("hex");
}

function prune(): void {
  if (cache.size < 2_000) return;
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  if (cache.size >= 2_000) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
}

/**
 * Server-side session lookup through Neon Auth's `get-session` endpoint.
 * Used as a fallback when a bearer JWT is absent and, importantly, keeps the
 * browser's session cookie first-party because it never leaves our proxy.
 */
export async function sessionFromCookie(cookieHeader: string, env: Env): Promise<AuthUser | null> {
  const key = cacheKey(cookieHeader);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.user;

  try {
    const response = await fetch(`${env.NEON_AUTH_BASE_URL.replace(/\/$/, "")}/get-session`, {
      method: "GET",
      headers: { accept: "application/json", cookie: cookieHeader },
      signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok) {
      cache.set(key, { user: null, expiresAt: Date.now() + CACHE_TTL_MS });
      return null;
    }
    const body = (await response.json().catch(() => null)) as
      | { user?: { id?: string; email?: string; name?: string } }
      | { data?: { user?: { id?: string; email?: string; name?: string } } }
      | null;
    const user = (body as { user?: unknown })?.user ?? (body as { data?: { user?: unknown } })?.data?.user;
    if (!user || typeof user !== "object" || typeof (user as { id?: unknown }).id !== "string") {
      cache.set(key, { user: null, expiresAt: Date.now() + CACHE_TTL_MS });
      return null;
    }
    const record = user as { id: string; email?: string; name?: string };
    const resolved: AuthUser = {
      id: record.id,
      email: record.email ?? null,
      name: record.name ?? null,
      source: "session",
    };
    prune();
    cache.set(key, { user: resolved, expiresAt: Date.now() + CACHE_TTL_MS });
    return resolved;
  } catch {
    return null;
  }
}

export function clearSessionCache(): void {
  cache.clear();
}
