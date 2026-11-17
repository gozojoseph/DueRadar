import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { and, eq, gt, inArray, lte } from "drizzle-orm";
import { imports, providerConnections, providerOAuthStates } from "@dueradar/db/schema";
import { z } from "zod";
import { ApiError, conflict } from "../lib/errors.js";
import type { Database } from "../db.js";
import type { Env } from "../env.js";
import { createMessageImport, type SuggestionDto } from "./detection.js";
import { createDetectionNotifier } from "./detection-notify.js";
import type { DraftEnhancer } from "./llm-detect.js";

const GMAIL_PROVIDER = "gmail";
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GMAIL_API_URL = "https://gmail.googleapis.com/gmail/v1/users/me";
const OAUTH_STATE_TTL_MS = 10 * 60_000;
const GMAIL_PAGE_SIZE = 25;
const GMAIL_SEARCH_QUERY = "newer_than:365d {receipt invoice subscription renewal trial billing}";

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
});

const GmailProfileSchema = z.object({
  emailAddress: z.string().email(),
});

export interface GmailTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
}

interface GmailMessageList {
  messages?: Array<{ id?: string }>;
  nextPageToken?: string;
}

interface GmailMessage {
  id?: string;
  internalDate?: string;
  snippet?: string;
  payload?: GmailPart;
}

interface GmailPart {
  mimeType?: string;
  headers?: Array<{ name?: string; value?: string }>;
  body?: { data?: string };
  parts?: GmailPart[];
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
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenKey(env), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(tokens), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function openGmailTokens(value: string, env: Env): GmailTokens {
  const [version, encodedIv, encodedTag, encodedCiphertext, ...rest] = value.split(".");
  if (
    version !== "v1" ||
    !encodedIv ||
    !encodedTag ||
    !encodedCiphertext ||
    rest.length > 0
  ) {
    throw new ApiError(500, "provider_token_invalid", "Stored Gmail credentials are invalid.");
  }

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      tokenKey(env),
      Buffer.from(encodedIv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encodedCiphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const tokens = JSON.parse(plaintext) as unknown;
    const parsed = z
      .object({
        accessToken: z.string().min(1),
        refreshToken: z.string().min(1),
        expiresAt: z.number().int().positive(),
        scopes: z.array(z.string()),
      })
      .safeParse(tokens);
    if (!parsed.success) {
      throw new ApiError(500, "provider_token_invalid", "Stored Gmail credentials are invalid.");
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, "provider_token_invalid", "Stored Gmail credentials could not be decrypted.");
  }
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

async function refreshGmailAccessToken(
  db: Database,
  userId: string,
  env: Env,
  connection: typeof providerConnections.$inferSelect,
  current: GmailTokens,
): Promise<GmailTokens> {
  const { clientId, clientSecret } = requireOAuthConfig(env);
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: current.refreshToken,
    grant_type: "refresh_token",
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
  const refreshed: GmailTokens = {
    accessToken: parsed.data.access_token,
    refreshToken: current.refreshToken,
    expiresAt: Date.now() + parsed.data.expires_in * 1000,
    scopes: parsed.data.scope?.split(/\s+/).filter(Boolean) ?? current.scopes,
  };
  await db
    .update(providerConnections)
    .set({ encryptedTokens: sealGmailTokens(refreshed, env), status: "active" })
    .where(
      and(
        eq(providerConnections.id, connection.id),
        eq(providerConnections.userId, userId),
      ),
    );
  return refreshed;
}

async function currentGmailTokens(
  db: Database,
  userId: string,
  env: Env,
  forceRefresh = false,
): Promise<{ connection: typeof providerConnections.$inferSelect; tokens: GmailTokens }> {
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
  if (!connection?.encryptedTokens || connection.status !== "active") {
    throw conflict("Connect Gmail before scanning messages.");
  }
  const tokens = openGmailTokens(connection.encryptedTokens, env);
  if (forceRefresh || tokens.expiresAt <= Date.now() + 60_000) {
    return {
      connection,
      tokens: await refreshGmailAccessToken(db, userId, env, connection, tokens),
    };
  }
  return { connection, tokens };
}

async function gmailApiRequest<T>(
  db: Database,
  userId: string,
  env: Env,
  path: string,
  initial: { connection: typeof providerConnections.$inferSelect; tokens: GmailTokens },
): Promise<{ data: T; current: { connection: typeof providerConnections.$inferSelect; tokens: GmailTokens } }> {
  try {
    const data = (await requestGoogleJson(`${GMAIL_API_URL}${path}`, {
      headers: { authorization: `Bearer ${initial.tokens.accessToken}` },
    })) as T;
    return { data, current: initial };
  } catch (error) {
    if (!(error instanceof ApiError) || error.statusCode !== 401) throw error;
    const refreshed = await currentGmailTokens(db, userId, env, true);
    const data = (await requestGoogleJson(`${GMAIL_API_URL}${path}`, {
      headers: { authorization: `Bearer ${refreshed.tokens.accessToken}` },
    })) as T;
    return { data, current: refreshed };
  }
}

function decodePart(data: string | undefined): string {
  if (!data) return "";
  return Buffer.from(data, "base64url").toString("utf8");
}

function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractGmailText(message: GmailMessage): string {
  const plain: string[] = [];
  const html: string[] = [];
  const visit = (part: GmailPart | undefined): void => {
    if (!part) return;
    const mimeType = part.mimeType?.split(";")[0]?.trim().toLowerCase();
    const decoded = decodePart(part.body?.data);
    if (mimeType === "text/plain" && decoded) plain.push(decoded);
    else if (mimeType === "text/html" && decoded) html.push(decoded);
    for (const child of part.parts ?? []) visit(child);
  };
  visit(message.payload);
  const text = plain.length > 0 ? plain.join("\n") : html.map(htmlToText).join("\n");
  return (text || message.snippet || "").slice(0, 30_000);
}

function header(message: GmailMessage, name: string): string | null {
  const value = message.payload?.headers?.find(
    (entry) => entry.name?.toLowerCase() === name.toLowerCase(),
  )?.value;
  return typeof value === "string" ? value.slice(0, 500) : null;
}

async function mapConcurrent<T, U>(
  entries: T[],
  concurrency: number,
  callback: (entry: T) => Promise<U>,
): Promise<U[]> {
  const results = new Array<U>(entries.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, entries.length) }, async () => {
    while (true) {
      const index = next++;
      const entry = entries[index];
      if (entry === undefined) return;
      results[index] = await callback(entry);
    }
  });
  await Promise.all(workers);
  return results;
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
  let current = await currentGmailTokens(db, userId, env);
  const listUrl = new URL(`${GMAIL_API_URL}/messages`);
  listUrl.searchParams.set("q", GMAIL_SEARCH_QUERY);
  listUrl.searchParams.set("maxResults", String(GMAIL_PAGE_SIZE));
  if (current.connection.cursor) {
    listUrl.searchParams.set("pageToken", current.connection.cursor);
  }

  const listed = await gmailApiRequest<GmailMessageList>(
    db,
    userId,
    env,
    `${listUrl.pathname.replace("/gmail/v1/users/me", "")}${listUrl.search}`,
    current,
  );
  current = listed.current;
  const messageIds = (listed.data.messages ?? [])
    .map((item) => item.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  const importIds = messageIds.map((id) => `gmail:${id}`);
  const existingImports =
    importIds.length > 0
      ? await db
          .select({ messageId: imports.messageId })
          .from(imports)
          .where(
            and(
              eq(imports.userId, userId),
              eq(imports.source, "email"),
              inArray(imports.messageId, importIds),
            ),
          )
      : [];
  const importedIds = new Set(
    existingImports.map((entry) => entry.messageId).filter((value): value is string => Boolean(value)),
  );
  const newIds = messageIds.filter((id) => !importedIds.has(`gmail:${id}`));

  const messages = await mapConcurrent(newIds, 5, async (id) => {
    const response = await gmailApiRequest<GmailMessage>(
      db,
      userId,
      env,
      `/messages/${encodeURIComponent(id)}?format=full`,
      current,
    );
    current = response.current;
    return response.data;
  });

  let detected = 0;
  let imported = 0;
  const collected: SuggestionDto[] = [];
  for (const message of messages) {
    if (!message.id) continue;
    const text = extractGmailText(message);
    if (!text.trim()) continue;
    const result = await createMessageImport(
      db,
      userId,
      {
        source: "email",
        text,
        subject: header(message, "subject"),
        fromAddress: header(message, "from"),
        messageId: `gmail:${message.id}`,
        metadata: {
          provider: GMAIL_PROVIDER,
          gmailMessageId: message.id,
          internalDate: message.internalDate ?? null,
        },
      },
      {
        now: options.now,
        enhance: options.enhance,
        onNewDetections: (fresh) => {
          collected.push(...fresh);
        },
      },
    );
    imported += 1;
    detected += result.summary.detected;
  }

  // One batched notification per sync run, never one per message. The user is
  // not looking at the app when Gmail finds something, so push as well.
  if (collected.length > 0) {
    const notifier = createDetectionNotifier(db, userId, env);
    await notifier.notify({
      sourceLabel: "your Gmail",
      suggestions: collected,
      withPush: true,
    });
  }

  const syncedAt = (options.now ?? new Date()).toISOString();
  const hasMore = Boolean(listed.data.nextPageToken);
  const metadata = {
    ...(current.connection.metadata ?? {}),
    lastSyncedAt: syncedAt,
  };
  await db
    .update(providerConnections)
    .set({
      cursor: listed.data.nextPageToken ?? null,
      metadata,
    })
    .where(
      and(
        eq(providerConnections.id, current.connection.id),
        eq(providerConnections.userId, userId),
      ),
    );

  const skippedDuplicates = messageIds.length - newIds.length;
  const message =
    imported > 0
      ? `Imported ${imported} Gmail ${imported === 1 ? "message" : "messages"} and found ${detected} ${detected === 1 ? "candidate" : "candidates"}.${hasMore ? " Scan again to continue through older messages." : ""}`
      : skippedDuplicates > 0
        ? "No new matching messages were found in this batch."
        : "No matching billing messages were found in this batch.";
  return { imported, skippedDuplicates, detected, hasMore, message };
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
