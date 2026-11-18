import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lte } from "drizzle-orm";
import { providerConnections, providerOAuthStates } from "@dueradar/db/schema";
import { z } from "zod";
import { ApiError, conflict } from "../lib/errors.js";
import type { Database } from "../db.js";
import type { Env } from "../env.js";
import { createClients } from "../lib/clients.js";
import type { DraftEnhancer } from "./llm-detect.js";
import {
  deriveProviderKey,
  extractGmailText,
  GMAIL_API_URL,
  GMAIL_PROVIDER,
  openTokens,
  sealTokens,
  syncGmailConnection,
  TokenResponseSchema,
  ProviderError,
  type GmailTokens,
} from "@dueradar/providers";

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const OAUTH_STATE_TTL_MS = 10 * 60_000;

const GmailProfileSchema = z.object({
  emailAddress: z.string().email(),
});

/** Maps package errors onto the API's HTTP error type. */
function rethrowProviderError(error: unknown): void {
  if (error instanceof ProviderError) {
    throw new ApiError(error.statusCode, error.code, error.message);
  }
}

function tokenKey(env: Env): Buffer {
  const encoded = env.PROVIDER_TOKEN_ENCRYPTION_KEY;
  if (!encoded) {
    throw new ApiError(
      503,
      "gmail_not_configured",
      "Gmail is not configured. Add the Gmail OAuth credentials and provider encryption key.",
    );
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) {
    throw new ApiError(
      503,
      "gmail_not_configured",
      "The provider encryption key must be a base64-encoded 32-byte key.",
    );
  }
  return key;
}

export function isGmailOAuthConfigured(env: Env): boolean {
  if (!env.GMAIL_OAUTH_CLIENT_ID || !env.GMAIL_OAUTH_CLIENT_SECRET) return false;
  try {
    tokenKey(env);
    return true;
  } catch {
    return false;
  }
}

export function sealGmailTokens(tokens: GmailTokens, env: Env): string {
  return sealTokens(tokens, tokenKey(env));
}

export function openGmailTokens(value: string, env: Env): GmailTokens {
  return openTokens(value, tokenKey(env));
}

function redirectUri(env: Env): string {
  return `${env.APP_ORIGIN.replace(/\/$/, "")}/oauth/gmail/callback`;
}

function requireOAuthConfig(env: Env): { clientId: string; clientSecret: string } {
  if (!env.GMAIL_OAUTH_CLIENT_ID || !env.GMAIL_OAUTH_CLIENT_SECRET) {
    throw new ApiError(
      503,
      "gmail_not_configured",
      "Gmail is not configured. Add the Gmail OAuth client ID, client secret, and provider encryption key.",
    );
  }
  tokenKey(env);
  return {
    clientId: env.GMAIL_OAUTH_CLIENT_ID,
    clientSecret: env.GMAIL_OAUTH_CLIENT_SECRET,
  };
}

function hashState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

export async function beginGmailOAuth(
  db: Database,
  userId: string,
  env: Env,
): Promise<{ authorizationUrl: string }> {
  const { clientId } = requireOAuthConfig(env);
  const state = randomBytes(32).toString("base64url");
  const now = new Date();

  await db
    .delete(providerOAuthStates)
    .where(lte(providerOAuthStates.expiresAt, now));
  await db
    .delete(providerOAuthStates)
    .where(
      and(
        eq(providerOAuthStates.userId, userId),
        eq(providerOAuthStates.provider, GMAIL_PROVIDER),
      ),
    );
  await db.insert(providerOAuthStates).values({
    stateHash: hashState(state),
    userId,
    provider: GMAIL_PROVIDER,
    expiresAt: new Date(now.getTime() + OAUTH_STATE_TTL_MS),
  });

  const authorization = new URL(GOOGLE_AUTH_URL);
  authorization.searchParams.set("client_id", clientId);
  authorization.searchParams.set("redirect_uri", redirectUri(env));
  authorization.searchParams.set("response_type", "code");
  authorization.searchParams.set("scope", GMAIL_SCOPE);
  authorization.searchParams.set("access_type", "offline");
  authorization.searchParams.set("prompt", "consent");
  authorization.searchParams.set("state", state);

  return { authorizationUrl: authorization.toString() };
}

async function requestGoogleJson(
  url: string,
  init: RequestInit,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    const timedOut =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    throw new ApiError(
      timedOut ? 504 : 502,
      timedOut ? "google_timeout" : "google_unavailable",
      timedOut
        ? "Google did not respond in time. Try again."
        : "Could not reach Google. Check the server's network and try again.",
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(502, "google_invalid_response", "Google returned an invalid response.");
  }
  if (!response.ok) {
    if (response.status === 401) {
      throw new ApiError(401, "gmail_token_expired", "Gmail access expired and needs renewal.");
    }
    throw new ApiError(502, "google_request_failed", "Google could not complete the request.");
  }
  return payload;
}

async function exchangeCode(
  env: Env,
  code: string,
): Promise<z.infer<typeof TokenResponseSchema>> {
  const { clientId, clientSecret } = requireOAuthConfig(env);
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri(env),
  });
  const payload = await requestGoogleJson(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const parsed = TokenResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError(502, "google_invalid_response", "Google returned incomplete token details.");
  }
  return parsed.data;
}

async function readGmailProfile(accessToken: string): Promise<z.infer<typeof GmailProfileSchema>> {
  const payload = await requestGoogleJson(`${GMAIL_API_URL}/profile`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const parsed = GmailProfileSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError(502, "gmail_profile_invalid", "Google did not return a valid Gmail profile.");
  }
  return parsed.data;
}

export async function completeGmailOAuth(
  db: Database,
  userId: string,
  env: Env,
  input: { code: string; state: string },
): Promise<{ emailAddress: string }> {
  requireOAuthConfig(env);
  const [claimedState] = await db
    .delete(providerOAuthStates)
    .where(
      and(
        eq(providerOAuthStates.stateHash, hashState(input.state)),
        eq(providerOAuthStates.userId, userId),
        eq(providerOAuthStates.provider, GMAIL_PROVIDER),
        gt(providerOAuthStates.expiresAt, new Date()),
      ),
    )
    .returning({ userId: providerOAuthStates.userId });
  if (!claimedState) {
    throw conflict("That Gmail connection request expired or was already used. Start again.");
  }

  const tokenResponse = await exchangeCode(env, input.code);
  const grantedScopes = tokenResponse.scope?.split(/\s+/).filter(Boolean) ?? [];
  if (!grantedScopes.includes(GMAIL_SCOPE)) {
    throw new ApiError(
      403,
      "gmail_scope_missing",
      "Gmail read access was not granted. Connect again and allow the requested permission.",
    );
  }

  const [existing] = await db
    .select()
    .from(providerConnections)
    .where(
      and(
        eq(providerConnections.userId, userId),
        eq(providerConnections.provider, GMAIL_PROVIDER),
      ),
    )
    .limit(1);
  const oldTokens =
    existing?.encryptedTokens
      ? openGmailTokens(existing.encryptedTokens, env)
      : null;
  const refreshToken = tokenResponse.refresh_token ?? oldTokens?.refreshToken;
  if (!refreshToken) {
    throw new ApiError(
      502,
      "gmail_refresh_token_missing",
      "Google did not provide ongoing read access. Disconnect Gmail in your Google account and try again.",
    );
  }

  const profile = await readGmailProfile(tokenResponse.access_token);
  const tokens: GmailTokens = {
    accessToken: tokenResponse.access_token,
    refreshToken,
    expiresAt: Date.now() + tokenResponse.expires_in * 1000,
    scopes: grantedScopes,
  };
  const encryptedTokens = sealGmailTokens(tokens, env);
  const metadata = {
    emailAddress: profile.emailAddress,
    scopes: grantedScopes,
    lastSyncedAt: null,
  };

  await db
    .insert(providerConnections)
    .values({
      userId,
      provider: GMAIL_PROVIDER,
      status: "active",
      encryptedTokens,
      cursor: null,
      metadata,
      revokedAt: null,
    })
    .onConflictDoUpdate({
      target: [providerConnections.userId, providerConnections.provider],
      set: {
        status: "active",
        encryptedTokens,
        cursor: null,
        metadata,
        revokedAt: null,
      },
    });

  return { emailAddress: profile.emailAddress };
}

function stringFromMetadata(
  metadata: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = metadata?.[key];
  return typeof value === "string" ? value : null;
}

export async function getGmailConnectionStatus(
  db: Database,
  userId: string,
  env: Env,
): Promise<{
  configured: boolean;
  connected: boolean;
  status: "active" | "revoked" | "error" | null;
  emailAddress: string | null;
  lastSyncedAt: string | null;
  hasMore: boolean;
}> {
  const [connection] = await db
    .select()
    .from(providerConnections)
    .where(
      and(
        eq(providerConnections.userId, userId),
        eq(providerConnections.provider, GMAIL_PROVIDER),
      ),
    )
    .limit(1);
  return {
    configured: isGmailOAuthConfigured(env),
    connected: connection?.status === "active",
    status: connection?.status ?? null,
    emailAddress: stringFromMetadata(connection?.metadata ?? null, "emailAddress"),
    lastSyncedAt: stringFromMetadata(connection?.metadata ?? null, "lastSyncedAt"),
    hasMore: Boolean(connection?.cursor),
  };
}

export async function syncGmailMessages(
  db: Database,
  userId: string,
  env: Env,
  options: { now?: Date; enhance?: DraftEnhancer } = {},
): Promise<{
  imported: number;
  skippedDuplicates: number;
  detected: number;
  hasMore: boolean;
  message: string;
}> {
  if (!isGmailOAuthConfigured(env)) {
    throw new ApiError(
      503,
      "gmail_not_configured",
      "Gmail is not configured. Add the Gmail OAuth client ID, client secret, and provider encryption key.",
    );
  }
  const oauth = requireOAuthConfig(env);
  try {
    return await syncGmailConnection(
      {
        db,
        userId,
        config: oauth,
        encryptionKey: deriveProviderKey(env.PROVIDER_TOKEN_ENCRYPTION_KEY),
        appOrigin: env.APP_ORIGIN,
        push: createClients(env).push,
      },
      { now: options.now, enhance: options.enhance },
    );
  } catch (error) {
    rethrowProviderError(error);
    throw error;
  }
}

export async function disconnectGmail(
  db: Database,
  userId: string,
  env: Env,
): Promise<{ disconnected: boolean; revokeWarning: string | null }> {
  await db
    .delete(providerOAuthStates)
    .where(
      and(
        eq(providerOAuthStates.userId, userId),
        eq(providerOAuthStates.provider, GMAIL_PROVIDER),
      ),
    );
  const [connection] = await db
    .select()
    .from(providerConnections)
    .where(
      and(
        eq(providerConnections.userId, userId),
        eq(providerConnections.provider, GMAIL_PROVIDER),
      ),
    )
    .limit(1);
  if (!connection) return { disconnected: false, revokeWarning: null };

  let tokens: GmailTokens | null = null;
  let revokeWarning: string | null = null;
  if (connection.encryptedTokens) {
    try {
      tokens = openGmailTokens(connection.encryptedTokens, env);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      revokeWarning =
        "DueRadar removed its saved access, but could not decrypt the credentials to notify Google. You can remove DueRadar in your Google Account security settings.";
    }
  }
  await db
    .update(providerConnections)
    .set({
      status: "revoked",
      encryptedTokens: null,
      cursor: null,
      metadata: null,
      revokedAt: new Date(),
    })
    .where(
      and(
        eq(providerConnections.id, connection.id),
        eq(providerConnections.userId, userId),
      ),
    );

  if (!tokens?.refreshToken) return { disconnected: true, revokeWarning };
  try {
    const response = await fetch(GOOGLE_REVOKE_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: tokens.refreshToken }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return {
        disconnected: true,
        revokeWarning: "DueRadar removed its saved access, but Google did not confirm revocation. You can also remove DueRadar in your Google Account security settings.",
      };
    }
  } catch {
    return {
      disconnected: true,
      revokeWarning: "DueRadar removed its saved access, but could not reach Google to revoke it. You can also remove DueRadar in your Google Account security settings.",
    };
  }
  return { disconnected: true, revokeWarning: null };
}

export { extractGmailText };
export type { GmailTokens };
