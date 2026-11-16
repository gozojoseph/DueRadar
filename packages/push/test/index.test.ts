import { describe, expect, it, vi } from "vitest";
import webpush from "web-push";
import { createPushClient, validatePushEndpoint } from "../src/index.js";

describe("createPushClient", () => {
  it("bounds each outgoing push request", async () => {
    const keys = webpush.generateVAPIDKeys();
    const sendNotification = vi.spyOn(webpush, "sendNotification").mockResolvedValue({
      statusCode: 201,
      body: "",
      headers: {},
    });
    const client = createPushClient({
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      subject: "mailto:test@example.com",
    });

    await client.send(
      {
        endpoint: "https://8.8.8.8/push",
        p256dh: "test",
        auth: "test",
      },
      { title: "Test", body: "Test" },
    );

    expect(sendNotification).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(String),
      expect.objectContaining({ timeout: 10_000 }),
    );
    sendNotification.mockRestore();
  });
});

describe("validatePushEndpoint", () => {
  it.each([
    "http://push.example.test/endpoint",
    "https://user:password@push.example.test/endpoint",
    "https://push.example.test:8443/endpoint",
    "https://127.0.0.1/endpoint",
    "https://[::1]/endpoint",
  ])("rejects unsafe endpoint %s", async (endpoint) => {
    const resolver = vi.fn(async () => [{ address: "203.0.113.1", family: 4 }]);

    await expect(validatePushEndpoint(endpoint, resolver)).rejects.toThrow();
    expect(resolver).not.toHaveBeenCalled();
  });

  it("accepts a hostname that resolves only to public addresses", async () => {
    const resolver = vi.fn(async () => [{ address: "8.8.8.8", family: 4 }]);

    await expect(
      validatePushEndpoint("https://push.example.test/endpoint", resolver),
    ).resolves.toBeUndefined();
    expect(resolver).toHaveBeenCalledWith("push.example.test", {
      all: true,
      verbatim: true,
    });
  });

  it("rejects a hostname if any DNS answer is non-public", async () => {
    const resolver = vi.fn(async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "10.0.0.2", family: 4 },
    ]);

    await expect(
      validatePushEndpoint("https://push.example.test/endpoint", resolver),
    ).rejects.toThrow(/public IP addresses/);
  });
});
