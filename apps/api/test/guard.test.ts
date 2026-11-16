import { describe, expect, it } from "vitest";
import { isPaidPlanExempt } from "../src/auth/guard.js";

describe("paid-plan API guard exceptions", () => {
  it("allows account recovery and billing routes", () => {
    const allowed = [
      { method: "GET", url: "/api/v1/me" },
      { method: "GET", url: "/api/v1/export?format=json" },
      { method: "GET", url: "/api/v1/billing" },
      { method: "POST", url: "/api/v1/billing/checkout" },
      { method: "POST", url: "/api/v1/billing/verify" },
      { method: "POST", url: "/api/v1/account/delete" },
      { method: "DELETE", url: "/api/v1/account" },
      { method: "PATCH", url: "/api/v1/admin/users/user-id/suspension" },
    ] as const;

    for (const request of allowed) {
      expect(isPaidPlanExempt(request)).toBe(true);
    }
  });

  it("does not exempt normal profile or app-data routes", () => {
    expect(isPaidPlanExempt({ method: "GET", url: "/api/v1/profile" })).toBe(false);
    expect(isPaidPlanExempt({ method: "POST", url: "/api/v1/profile/onboarding" })).toBe(false);
    expect(isPaidPlanExempt({ method: "GET", url: "/api/v1/subscriptions" })).toBe(false);
  });
});
