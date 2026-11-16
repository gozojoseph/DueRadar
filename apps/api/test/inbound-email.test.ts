import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import type { Database } from "../src/db.js";
import { isInboundEmailConfigured, loadEnv } from "../src/env.js";
import {
  baseAliasAddress,
  extractEmailAddress,
  extractEmailAddresses,
} from "../src/services/email-alias.js";
import {
  fetchReceivedEmail,
  InboundEmailError,
  parseResendEvent,
} from "../src/services/inbound-email.js";
import { verifySvixSignature } from "../src/routes/webhooks.js";

const baseEnv = {
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  DATABASE_URL: "postgresql://dueradar:secret@localhost:5432/dueradar",
  NEON_AUTH_BASE_URL: "https://auth.example.test/dueradar/auth",
  APP_ORIGIN: "http://localhost:5173",
  SERVE_WEB: "false",
};

describe("inbound email configuration", () => {
  it("requires a receiving domain and API key in every environment", () => {
    expect(
      isInboundEmailConfigured(
        loadEnv({
          ...baseEnv,
          INBOUND_EMAIL_DOMAIN: "in.dueradar.cloud",
          RESEND_API_KEY: "re_test",
        }),
      ),
    ).toBe(true);

    expect(
      isInboundEmailConfigured(
        loadEnv({
          ...baseEnv,
          RESEND_API_KEY: "re_test",
        }),
      ),
    ).toBe(false);
  });

  it("requires the webhook signing secret in production", () => {
    expect(
      isInboundEmailConfigured(
        loadEnv({
          ...baseEnv,
          NODE_ENV: "production",
          INBOUND_EMAIL_DOMAIN: "in.dueradar.cloud",
          RESEND_API_KEY: "re_test",
        }),
      ),
    ).toBe(false);
    expect(
      isInboundEmailConfigured(
        loadEnv({
          ...baseEnv,
          NODE_ENV: "production",
          INBOUND_EMAIL_DOMAIN: "in.dueradar.cloud",
          RESEND_API_KEY: "re_test",
          RESEND_WEBHOOK_SECRET: "whsec_test",
        }),
      ),
    ).toBe(true);
  });
});

describe("alias address matching", () => {
  it("accepts bare, angle-bracket and display-name addresses", () => {
    expect(extractEmailAddress("billing@netflix.com")).toBe("billing@netflix.com");
    expect(extractEmailAddress("Netflix <Billing@Netflix.com>")).toBe("billing@netflix.com");
    expect(extractEmailAddress("<dr-abc@inbound.dueradar.cloud>")).toBe(
      "dr-abc@inbound.dueradar.cloud",
    );
  });

  it("strips trailing punctuation and rejects nonsense", () => {
    expect(extractEmailAddress("billing@netflix.com.")).toBe("billing@netflix.com");
    expect(extractEmailAddress("not an address")).toBeNull();
    expect(extractEmailAddress("@netflix.com")).toBeNull();
    expect(extractEmailAddress("")).toBeNull();
  });

  it("deduplicates recipients while preserving order", () => {
    expect(
      extractEmailAddresses([
        "A <a@example.com>",
        "a@example.com",
        "b@example.com",
        "invalid",
      ]),
    ).toEqual(["a@example.com", "b@example.com"]);
  });

  it("routes plus-tagged mail to the base forwarding address", () => {
    expect(baseAliasAddress("dr-abc+netflix@inbound.dueradar.cloud")).toBe(
      "dr-abc@inbound.dueradar.cloud",
    );
    expect(baseAliasAddress("dr-abc@inbound.dueradar.cloud")).toBe(
      "dr-abc@inbound.dueradar.cloud",
    );
  });
});

describe("parseResendEvent", () => {
  it("reads the received-email metadata and tolerates extra fields", () => {
    const event = parseResendEvent({
      type: "email.received",
      created_at: "2026-11-16T10:00:00.000Z",
      data: {
        email_id: "abc12345",
        message_id: "<msg@example.com>",
        subject: "Your receipt",
        from: "Netflix <billing@netflix.com>",
        to: ["dr-abc@inbound.dueradar.cloud"],
        cc: [],
        bcc: [],
        received_for: ["dr-abc@inbound.dueradar.cloud"],
        attachments: [],
      },
    });

    expect(event.type).toBe("email.received");
    expect(event.data?.email_id).toBe("abc12345");
    expect(event.data?.to).toEqual(["dr-abc@inbound.dueradar.cloud"]);
  });

  it("rejects payloads without an event type", () => {
    expect(() => parseResendEvent({ data: {} })).toThrow();
  });
});

describe("verifySvixSignature", () => {
  const secret = `whsec_${Buffer.from("webhook-test-secret").toString("base64")}`;
  const body = Buffer.from(JSON.stringify({ type: "email.received" }));
  const id = "msg_123";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", Buffer.from(secret.replace(/^whsec_/, ""), "base64"))
    .update(Buffer.concat([Buffer.from(`${id}.${timestamp}.`), body]))
    .digest("base64");

  it("accepts a correctly signed payload", () => {
    expect(
      verifySvixSignature(
        { id, timestamp, signature: `v1,${signature}` },
        body,
        secret,
      ),
    ).toEqual({ ok: true });
  });

  it("rejects a changed body", () => {
    expect(
      verifySvixSignature(
        { id, timestamp, signature: `v1,${signature}` },
        Buffer.from("{}"),
        secret,
      ).ok,
    ).toBe(false);
  });

  it("rejects an old timestamp and missing headers", () => {
    const old = String(Math.floor(Date.now() / 1000) - 601);
    expect(
      verifySvixSignature({ id, timestamp: old, signature: `v1,${signature}` }, body, secret).ok,
    ).toBe(false);
    expect(
      verifySvixSignature({ id: undefined, timestamp, signature }, body, secret).ok,
    ).toBe(false);
  });
});

describe("fetchReceivedEmail", () => {
  it("requests HTML without remote images and reads the body", async () => {
    let requested: string | undefined;
    let authorization: string | undefined;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      requested = String(url);
      authorization = new Headers(init?.headers).get("authorization") ?? undefined;
      return new Response(
        JSON.stringify({
          text: "Charged GHS 65.00",
          html: "<p>Charged GHS 65.00</p>",
          subject: "Receipt",
          from: "Netflix <billing@netflix.com>",
          message_id: "<msg@example.com>",
          received_for: ["dr-abc@inbound.dueradar.cloud"],
          attachments: [{ id: "a" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const body = await fetchReceivedEmail("re_test", "abc12345", fetchImpl);

    expect(requested).toBe(
      "https://api.resend.com/emails/receiving/abc12345?html_format=cid",
    );
    expect(authorization).toBe("Bearer re_test");
    expect(body).toMatchObject({
      text: "Charged GHS 65.00",
      subject: "Receipt",
      messageId: "<msg@example.com>",
      attachmentCount: 1,
    });
    expect(body.receivedFor).toEqual(["dr-abc@inbound.dueradar.cloud"]);
  });

  it("refuses provider-unreadable ids before making a request", async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response("{}");
    }) as typeof fetch;

    await expect(fetchReceivedEmail("re_test", "../etc/passwd", fetchImpl)).rejects.toMatchObject({
      code: "invalid_email_id",
      retryable: false,
    });
    expect(called).toBe(false);
  });

  it("marks provider 5xx failures as retryable and 4xx as permanent", async () => {
    const failing = (status: number) =>
      (async () => new Response("{}", { status })) as typeof fetch;

    await expect(fetchReceivedEmail("re_test", "abc12345", failing(503))).rejects.toMatchObject({
      code: "email_fetch_503",
      retryable: true,
    });
    await expect(fetchReceivedEmail("re_test", "abc12345", failing(404))).rejects.toMatchObject({
      code: "email_fetch_404",
      retryable: false,
    });
  });

  it("rejects an oversized body", async () => {
    const fetchImpl = (async () =>
      new Response("{}", {
        status: 200,
        headers: { "content-length": String(2 * 1024 * 1024 + 1) },
      })) as typeof fetch;

    await expect(
      fetchReceivedEmail("re_test", "abc12345", fetchImpl),
    ).rejects.toBeInstanceOf(InboundEmailError);
    await expect(fetchReceivedEmail("re_test", "abc12345", fetchImpl)).rejects.toMatchObject({
      code: "email_too_large",
      retryable: false,
    });
  });

  it.each([undefined, "2"])(
    "enforces the actual byte limit when content-length is %s",
    async (contentLength) => {
      const oversized = new Uint8Array(2 * 1024 * 1024 + 1);
      const fetchImpl = (async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(oversized);
              controller.close();
            },
          }),
          {
            status: 200,
            headers: contentLength ? { "content-length": contentLength } : {},
          },
        )) as typeof fetch;

      await expect(fetchReceivedEmail("re_test", "abc12345", fetchImpl)).rejects.toMatchObject({
        code: "email_too_large",
        retryable: false,
      });
    },
  );
});

describe("Resend webhook route", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("rejects an unsigned or wrongly signed delivery before parsing", async () => {
    const secret = `whsec_${Buffer.from("route-test-secret").toString("base64")}`;
    const app = await buildApp({
      env: loadEnv({ ...baseEnv, RESEND_WEBHOOK_SECRET: secret }),
      db: {} as Database,
      pool: {
        query: async () => ({ rows: [{ "?column?": 1 }] }),
      } as never,
    });
    apps.push(app);
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/api/webhooks/resend",
      headers: {
        "content-type": "application/json",
        "svix-id": "msg_1",
        "svix-timestamp": String(Math.floor(Date.now() / 1000)),
        "svix-signature": "v1,AAAA",
      },
      payload: JSON.stringify({ type: "email.received", data: { email_id: "abc12345" } }),
    });

    expect(response.statusCode).toBe(401);
  });

  it("acknowledges nothing until inbound receiving is configured", async () => {
    const app = await buildApp({
      env: loadEnv(baseEnv),
      db: {} as Database,
      pool: {
        query: async () => ({ rows: [{ "?column?": 1 }] }),
      } as never,
    });
    apps.push(app);
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/api/webhooks/resend",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ type: "email.received", data: { email_id: "abc12345" } }),
    });

    // Test mode skips the signature only when no secret is set, then refuses to
    // accept mail that no readable body could ever be fetched for.
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: { code: "receiving_not_configured" } });
  });
});
