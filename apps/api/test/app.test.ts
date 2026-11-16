import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { Database } from "../src/db.js";
import { loadEnv } from "../src/env.js";

const baseEnv = {
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  DATABASE_URL: "postgresql://dueradar:secret@localhost:5432/dueradar",
  NEON_AUTH_BASE_URL: "https://auth.example.test/dueradar/auth",
  APP_ORIGIN: "http://localhost:5173",
  PAYSTACK_SECRET_KEY: "sk_test_never_expose",
  SERVE_WEB: "false",
};

const env = loadEnv(baseEnv);

const apps: FastifyInstance[] = [];

function fakePool(healthy = true) {
  return {
    query: async () => {
      if (!healthy) throw new Error("connection refused");
      return { rows: [{ "?column?": 1 }] };
    },
  };
}

async function createApp(healthy = true): Promise<FastifyInstance> {
  const app = await buildApp({
    env,
    // Route handlers that touch data are exercised against a real database in
    // integration runs; these tests cover routing, validation and headers.
    db: {} as Database,
    pool: fakePool(healthy) as never,
  });
  apps.push(app);
  await app.ready();
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("health", () => {
  it("reports the database when a simple query succeeds", async () => {
    const app = await createApp();
    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      database: "ok",
      environment: "test",
    });
  });

  it("returns 503 rather than pretending to be healthy when the database is down", async () => {
    const app = await createApp(false);
    const response = await app.inject({ method: "GET", url: "/api/healthz" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: "unavailable", database: "error" });
  });
});

describe("public config", () => {
  it("serves the same Ghana-first defaults on both aliases", async () => {
    const app = await createApp();

    for (const url of ["/api/config", "/api/v1/config"]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        appName: "DueRadar",
        defaults: {
          timezone: "Africa/Accra",
          currency: "GHS",
          locale: "en-GH",
          reminderTime: "09:00",
          quietHoursStart: "21:00",
          quietHoursEnd: "07:00",
          weekStartsOn: 1,
        },
      });
    }
  });

  it("never exposes server secrets", async () => {
    const app = await createApp();
    const response = await app.inject({ method: "GET", url: "/api/config" });
    const body = response.body;

    expect(body).not.toContain("DATABASE_URL");
    expect(body).not.toContain("postgresql://");
    expect(body).not.toContain("VAPID_PRIVATE_KEY");
    expect(body).not.toContain("RESEND_API_KEY");
    expect(body).not.toContain("PAYSTACK_SECRET_KEY");
    expect(body).not.toContain("sk_test_never_expose");
  });
});

describe("security headers", () => {
  it("sets a self-only content security policy and basic hardening", async () => {
    const app = await createApp();
    const response = await app.inject({ method: "GET", url: "/api/config" });

    expect(response.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(response.headers["content-security-policy"]).toContain("object-src 'none'");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });
});

describe("routing", () => {
  it("returns a JSON 404 for unknown API endpoints", async () => {
    const app = await createApp();
    const response = await app.inject({ method: "GET", url: "/api/v1/does-not-exist" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: "not_found", message: "Endpoint not found." },
    });
  });

  it("requires authentication on private routes", async () => {
    const app = await createApp();
    const response = await app.inject({ method: "GET", url: "/api/v1/me" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: "unauthorized" } });
  });

  it("explains that the web build is absent instead of crashing", async () => {
    const app = await createApp();
    const response = await app.inject({ method: "GET", url: "/some/client/route" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("web build is not present");
  });

  it("rejects writes to unknown non-API routes", async () => {
    const app = await createApp();
    const response = await app.inject({ method: "POST", url: "/some/client/route" });

    expect(response.statusCode).toBe(405);
    expect(response.json()).toMatchObject({ error: { code: "method_not_allowed" } });
  });
});

describe("static web build", () => {
  it("serves the SPA and caches hashed assets and the service worker correctly", async () => {
    const root = mkdtempSync(join(tmpdir(), "dueradar-web-"));
    mkdirSync(join(root, "assets"));
    writeFileSync(join(root, "index.html"), "<!doctype html><title>DueRadar test build</title>");
    writeFileSync(join(root, "assets", "index-ABC123.js"), "console.log('ok');");
    writeFileSync(join(root, "sw.js"), "self.addEventListener('fetch', () => {});");

    try {
      const app = await buildApp({
        env: loadEnv({ ...baseEnv, SERVE_WEB: "true", WEB_DIST: root }),
        db: {} as Database,
        pool: fakePool() as never,
      });
      apps.push(app);
      await app.ready();

      const home = await app.inject({ method: "GET", url: "/" });
      expect(home.statusCode).toBe(200);
      expect(home.body).toContain("DueRadar test build");
      expect(home.headers["cache-control"]).toBe("no-cache");

      const asset = await app.inject({ method: "GET", url: "/assets/index-ABC123.js" });
      expect(asset.statusCode).toBe(200);
      expect(asset.headers["cache-control"]).toBe("public, max-age=31536000, immutable");

      const serviceWorker = await app.inject({ method: "GET", url: "/sw.js" });
      expect(serviceWorker.statusCode).toBe(200);
      expect(serviceWorker.headers["cache-control"]).toBe("no-cache, no-store, must-revalidate");

      const fallback = await app.inject({ method: "GET", url: "/dashboard" });
      expect(fallback.statusCode).toBe(200);
      expect(fallback.body).toContain("DueRadar test build");
      expect(fallback.headers["cache-control"]).toBe("no-cache");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
