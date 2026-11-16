import { describe, expect, it } from "vitest";
import { requiresPlusForImport } from "../src/auth/guard.js";

describe("Plus-only import API operations", () => {
  it("requires Plus for paste, screenshot, CSV, and detection acceptance", () => {
    const gated = [
      { method: "POST", url: "/api/v1/imports/message" },
      { method: "POST", url: "/api/v1/imports/message?source=ocr" },
      { method: "POST", url: "/api/v1/imports/csv/preview" },
      { method: "POST", url: "/api/v1/imports/csv" },
      { method: "POST", url: "/api/v1/email-alias" },
      { method: "POST", url: "/api/v1/detections/123e4567-e89b-12d3-a456-426614174000/accept" },
    ] as const;

    for (const request of gated) {
      expect(requiresPlusForImport(request)).toBe(true);
    }
  });

  it("leaves browsing and unrelated app operations available without Plus", () => {
    expect(requiresPlusForImport({ method: "GET", url: "/api/v1/imports" })).toBe(false);
    expect(requiresPlusForImport({ method: "POST", url: "/api/v1/profile/onboarding" })).toBe(false);
    expect(requiresPlusForImport({ method: "POST", url: "/api/v1/subscriptions" })).toBe(false);
    expect(requiresPlusForImport({ method: "DELETE", url: "/api/v1/email-alias" })).toBe(false);
  });
});
