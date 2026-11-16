import { describe, expect, it } from "vitest";
import { describePushFailure } from "../src/routes/test.js";

describe("describePushFailure", () => {
  it("identifies VAPID authentication rejection", () => {
    expect(describePushFailure(403)).toContain("VAPID authentication");
  });

  it("identifies expired subscriptions", () => {
    expect(describePushFailure(410)).toContain("subscription has expired");
  });

  it("reports provider and network failures without exposing subscription data", () => {
    expect(describePushFailure(503)).toContain("HTTP 503");
    expect(describePushFailure(undefined)).toContain("network and DNS");
  });
});
