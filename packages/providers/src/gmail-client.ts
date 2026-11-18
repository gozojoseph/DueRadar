import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { providerConnections } from "@dueradar/db/schema";
import { z } from "zod";
import { ProviderError } from "./errors.js";
import type { Database } from "./database.js";

export const GMAIL_PROVIDER = "gmail";
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GMAIL_API_URL = "https://gmail.googleapis.com/gmail/v1/users/me";
export const GMAIL_PAGE_SIZE = 25;
export const GMAIL_SEARCH_QUERY =
  "newer_than:365d {receipt invoice subscription renewal trial billing}";

export interface GmailTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
}

export interface GmailClientConfig {
  clientId: string;
  clientSecret: string;
}

export interface GmailClientContext {
  db: Database;
  userId: string;
  config: GmailClientConfig;
  encryptionKey: Buffer;
}

export interface GmailConnectionState {
  connection: typeof providerConnections.$inferSelect;
  tokens: GmailTokens;
}

export const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
});

interface GmailMessageList {
  messages?: Array<{ id?: string }>;
  nextPageToken?: string;
}

export interface GmailMessage {
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

/* ------------------------------ token storage ------------------------------ */

/** Must stay byte-compatible with tokens sealed by the API service. */
export function deriveProviderKey(encoded: string | undefined): Buffer {
  if (!encoded) {
    throw new ProviderError(
      503,
      "gmail_not_configured",
      "Gmail is not configured. Add the Gmail OAuth credentials and provider encryption key.",
    );
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) {
    throw new ProviderError(
      503,
      "gmail_not_configured",
      "The provider encryption key must be a base64-encoded 32-byte key.",
    );
  }
  return key;
}

export function sealTokens(tokens: GmailTokens, encryptionKey: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(tokens), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function openTokens(value: string, encryptionKey: Buffer): GmailTokens {
  const [version, encodedIv, encodedTag, encodedCiphertext, ...rest] = value.split(".");
  if (
    version !== "v1" ||
    !encodedIv ||
    !encodedTag ||
    !encodedCiphertext ||
    rest.length > 0
  ) {
    throw new ProviderError(500, "provider_token_invalid", "Stored Gmail credentials are invalid.");
  }

  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(encodedIv, "base64url"));
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
      throw new ProviderError(500, "provider_token_invalid", "Stored Gmail credentials are invalid.");
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(
      500,
      "provider_token_invalid",
      "Stored Gmail credentials could not be decrypted.",
    );
  }
}

/* ---------------------------- Google transport ----------------------------- */

export async function requestGoogleJson(url: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    const timedOut =
      error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new ProviderError(
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
    throw new ProviderError(502, "google_invalid_response", "Google returned an invalid response.");
  }
  if (!response.ok) {
    if (response.status === 401) {
      throw new ProviderError(401, "gmail_token_expired", "Gmail access expired and needs renewal.");
    }
    throw new ProviderError(502, "google_request_failed", "Google could not complete the request.");
  }
  return payload;
}

/* ------------------------------ token refresh ------------------------------ */

async function refreshGmailAccessToken(
  ctx: GmailClientContext,
  connection: typeof providerConnections.$inferSelect,
  current: GmailTokens,
): Promise<GmailTokens> {
  const body = new URLSearchParams({
    client_id: ctx.config.clientId,
    client_secret: ctx.config.clientSecret,
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
    throw new ProviderError(502, "google_invalid_response", "Google returned incomplete token details.");
  }
  const refreshed: GmailTokens = {
    accessToken: parsed.data.access_token,
    refreshToken: current.refreshToken,
    expiresAt: Date.now() + parsed.data.expires_in * 1000,
    scopes: parsed.data.scope?.split(/\s+/).filter(Boolean) ?? current.scopes,
  };
  await ctx.db
    .update(providerConnections)
    .set({ encryptedTokens: sealTokens(refreshed, ctx.encryptionKey), status: "active" })
    .where(
      and(
        eq(providerConnections.id, connection.id),
        eq(providerConnections.userId, ctx.userId),
      ),
    );
  return refreshed;
}

export async function currentGmailTokens(
  ctx: GmailClientContext,
  forceRefresh = false,
): Promise<GmailConnectionState> {
  const [connection] = await ctx.db
    .select()
    .from(providerConnections)
    .where(
      and(
        eq(providerConnections.userId, ctx.userId),
        eq(providerConnections.provider, GMAIL_PROVIDER),
      ),
    )
    .limit(1);
  if (!connection?.encryptedTokens || connection.status !== "active") {
    throw new ProviderError(409, "conflict", "Connect Gmail before scanning messages.");
  }
  const tokens = openTokens(connection.encryptedTokens, ctx.encryptionKey);
  if (forceRefresh || tokens.expiresAt <= Date.now() + 60_000) {
    return {
      connection,
      tokens: await refreshGmailAccessToken(ctx, connection, tokens),
    };
  }
  return { connection, tokens };
}

export async function gmailApiRequest<T>(
  ctx: GmailClientContext,
  path: string,
  initial: GmailConnectionState,
): Promise<{ data: T; current: GmailConnectionState }> {
  try {
    const data = (await requestGoogleJson(`${GMAIL_API_URL}${path}`, {
      headers: { authorization: `Bearer ${initial.tokens.accessToken}` },
    })) as T;
    return { data, current: initial };
  } catch (error) {
    if (!(error instanceof ProviderError) || error.statusCode !== 401) throw error;
    const refreshed = await currentGmailTokens(ctx, true);
    const data = (await requestGoogleJson(`${GMAIL_API_URL}${path}`, {
      headers: { authorization: `Bearer ${refreshed.tokens.accessToken}` },
    })) as T;
    return { data, current: refreshed };
  }
}

/* ---------------------------- message extraction --------------------------- */

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

export function header(message: GmailMessage, name: string): string | null {
  const value = message.payload?.headers?.find(
    (entry) => entry.name?.toLowerCase() === name.toLowerCase(),
  )?.value;
  return typeof value === "string" ? value.slice(0, 500) : null;
}

export async function mapConcurrent<T, U>(
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
