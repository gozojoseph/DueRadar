import { describe, expect, it, vi } from "vitest";
import { validatePushEndpoint } from "../src/index.js";

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
