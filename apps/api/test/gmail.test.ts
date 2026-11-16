import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/env.js";
import {
  beginGmailOAuth,
  extractGmailText,
  isGmailOAuthConfigured,
  openGmailTokens,
  sealGmailTokens,
  type GmailTokens,
} from "../src/services/gmail.js";
import type { Database } from "../src/db.js";

const encryptionKey = Buffer.alloc(32, 7).toString("base64");
const env = loadEnv({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test:test@localhost:5432/dueradar",
  NEON_AUTH_BASE_URL: "https://auth.example.test/dueradar/auth",
  APP_ORIGIN: "https://app.example.test",
  GMAIL_OAUTH_CLIENT_ID: "test-client-id",
  GMAIL_OAUTH_CLIENT_SECRET: "test-client-secret",
  PROVIDER_TOKEN_ENCRYPTION_KEY: encryptionKey,
});

describe("Gmail OAuth helpers", () => {
  it("encrypts provider tokens and authenticates them on decrypt", () => {
    const tokens: GmailTokens = {
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
      expiresAt: 1_800_000_000_000,
      scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    };

    const encrypted = sealGmailTokens(tokens, env);
    expect(encrypted).not.toContain(tokens.refreshToken);
    expect(openGmailTokens(encrypted, env)).toEqual(tokens);

    const parts = encrypted.split(".");
    parts[2] = `${parts[2]?.startsWith("a") ? "b" : "a"}${parts[2]?.slice(1)}`;
    expect(() => openGmailTokens(parts.join("."), env)).toThrow(
      "Stored Gmail credentials could not be decrypted.",
    );
  });

  it("builds a Gmail-only authorization request with a hashed, user-bound state record", async () => {
    let insertedState: { stateHash: string; userId: string; provider: string } | undefined;
    const db = {
      delete: () => ({ where: async () => [] }),
      insert: () => ({
        values: async (value: typeof insertedState) => {
          insertedState = value;
          return [];
        },
      }),
    } as unknown as Database;

    const { authorizationUrl } = await beginGmailOAuth(db, "user-1", env);
    const authorization = new URL(authorizationUrl);
    const state = authorization.searchParams.get("state");

    expect(authorization.origin).toBe("https://accounts.google.com");
    expect(authorization.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/gmail.readonly",
    );
    expect(authorization.searchParams.get("redirect_uri")).toBe(
      "https://app.example.test/oauth/gmail/callback",
    );
    expect(state).toHaveLength(43);
    expect(insertedState).toMatchObject({
      userId: "user-1",
      provider: "gmail",
    });
    expect(insertedState?.stateHash).not.toBe(state);
  });

  it("rejects malformed encryption configuration as not configured", () => {
    const invalidEnv = loadEnv({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test:test@localhost:5432/dueradar",
      NEON_AUTH_BASE_URL: "https://auth.example.test/dueradar/auth",
      GMAIL_OAUTH_CLIENT_ID: "test-client-id",
      GMAIL_OAUTH_CLIENT_SECRET: "test-client-secret",
      PROVIDER_TOKEN_ENCRYPTION_KEY: "not-a-key",
    });

    expect(isGmailOAuthConfigured(invalidEnv)).toBe(false);
  });
});

describe("Gmail message extraction", () => {
  it("prefers plain text from multipart messages", () => {
    const plain = Buffer.from("Charged GHS 42.00 for a subscription").toString("base64url");
    const html = Buffer.from("<b>different html copy</b>").toString("base64url");
    const text = extractGmailText({
      payload: {
        mimeType: "multipart/alternative",
        parts: [
          { mimeType: "text/plain", body: { data: plain } },
          { mimeType: "text/html", body: { data: html } },
        ],
      },
    });

    expect(text).toBe("Charged GHS 42.00 for a subscription");
  });

  it("strips HTML tags and script content when no plain-text part exists", () => {
    const html = Buffer.from(
      "<p>Subscription charged GHS 19.00</p><script>ignore this</script>",
    ).toString("base64url");
    const text = extractGmailText({
      payload: { mimeType: "text/html", body: { data: html } },
    });

    expect(text).toContain("Subscription charged GHS 19.00");
    expect(text).not.toContain("ignore this");
  });
});
