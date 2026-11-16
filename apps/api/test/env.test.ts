import { describe, expect, it } from "vitest";
import { isProduction, loadEnv, secureCookies } from "../src/env.js";

const base = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://dueradar:secret@localhost:5432/dueradar",
  NEON_AUTH_BASE_URL: "https://auth.example.test/dueradar/auth",
};

describe("loadEnv", () => {
  it("applies defaults for omitted optional values", () => {
    const env = loadEnv({ ...base, NODE_ENV: undefined });

    expect(env.NODE_ENV).toBe("development");
    expect(env.PORT).toBe(3001);
    expect(env.HOST).toBe("0.0.0.0");
    expect(env.APP_ORIGIN).toBe("http://localhost:5173");
    expect(env.SUPPORT_EMAIL).toBe("support@dueradar.cloud");
    expect(env.VAPID_SUBJECT).toBe("mailto:support@dueradar.cloud");
  });

  it("coerces numeric strings and keeps explicit overrides", () => {
    const env = loadEnv({ ...base, PORT: "8080", SERVE_WEB: "false" });

    expect(env.PORT).toBe(8080);
    expect(env.SERVE_WEB).toBe("false");
  });

  it("names every missing required variable", () => {
    expect(() => loadEnv({ NODE_ENV: "test" })).toThrow(/DATABASE_URL: /);
    expect(() => loadEnv({ NODE_ENV: "test" })).toThrow(/NEON_AUTH_BASE_URL: /);
  });

  it("rejects an unknown NODE_ENV instead of guessing", () => {
    expect(() => loadEnv({ ...base, NODE_ENV: "staging" })).toThrow(/NODE_ENV/);
  });

  it("does not accept an empty database URL", () => {
    expect(() => loadEnv({ ...base, DATABASE_URL: "" })).toThrow(/DATABASE_URL/);
  });
});

describe("cookie policy", () => {
  it("marks cookies secure when the app origin is https", () => {
    const env = loadEnv({ ...base, APP_ORIGIN: "https://app.dueradar.cloud" });
    expect(secureCookies(env)).toBe(true);
  });

  it("keeps cookies non-secure for plain http development", () => {
    const env = loadEnv({ ...base, APP_ORIGIN: "http://localhost:5173" });
    expect(secureCookies(env)).toBe(false);
  });

  it("lets an explicit override win in both directions", () => {
    const forcedOn = loadEnv({
      ...base,
      APP_ORIGIN: "http://localhost:5173",
      COOKIE_SECURE: "true",
    });
    const forcedOff = loadEnv({
      ...base,
      APP_ORIGIN: "https://app.dueradar.cloud",
      COOKIE_SECURE: "false",
    });

    expect(secureCookies(forcedOn)).toBe(true);
    expect(secureCookies(forcedOff)).toBe(false);
  });
});

describe("isProduction", () => {
  it("only treats the production environment as production", () => {
    expect(isProduction(loadEnv({ ...base, NODE_ENV: "production" }))).toBe(true);
    expect(isProduction(loadEnv({ ...base, NODE_ENV: "development" }))).toBe(false);
    expect(isProduction(loadEnv({ ...base, NODE_ENV: "test" }))).toBe(false);
  });
});
