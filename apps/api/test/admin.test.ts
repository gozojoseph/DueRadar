import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/env.js";
import { isAdminEmail } from "../src/services/admin.js";

describe("admin email allowlist", () => {
  it("normalizes the comma-separated Render configuration", () => {
    const env = loadEnv({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://dueradar:secret@localhost:5432/dueradar",
      NEON_AUTH_BASE_URL: "https://auth.example.test/dueradar/auth",
      ADMIN_EMAILS: " Admin@example.com,second@example.com ",
    });

    expect(env.ADMIN_EMAILS).toEqual(["admin@example.com", "second@example.com"]);
  });

  it("rejects malformed administrator addresses", () => {
    expect(() =>
      loadEnv({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://dueradar:secret@localhost:5432/dueradar",
        NEON_AUTH_BASE_URL: "https://auth.example.test/dueradar/auth",
        ADMIN_EMAILS: "not-an-email",
      }),
    ).toThrow(/ADMIN_EMAILS contains invalid email/i);
  });

  it("matches verified account emails case-insensitively", () => {
    expect(isAdminEmail(" Admin@Example.com ", ["admin@example.com"])).toBe(true);
  });

  it("does not grant access for missing or unlisted email addresses", () => {
    expect(isAdminEmail(null, ["admin@example.com"])).toBe(false);
    expect(isAdminEmail("other@example.com", ["admin@example.com"])).toBe(false);
    expect(isAdminEmail("admin@example.com", [])).toBe(false);
  });
});
