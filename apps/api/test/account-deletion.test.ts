import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { registerActiveAccountGuard } from "../src/auth/guard.js";
import { sessionFromCookie } from "../src/auth/session.js";
import type { Database } from "../src/db.js";
import { loadEnv } from "../src/env.js";
import { ApiError } from "../src/lib/errors.js";
import { clearAuthCookies } from "../src/routes/account.js";
import { ensureProfile } from "../src/services/profile.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const DELETED_USER_ID = "22222222-2222-4222-8222-222222222222";

let jwksServer: Server;
let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let env: ReturnType<typeof loadEnv>;

beforeAll(async () => {
  const pair = await generateKeyPair("EdDSA", { crv: "Ed25519" });
  privateKey = pair.privateKey;
  const jwk = await exportJWK(pair.publicKey);
  jwk.kid = "test-key";
  jwk.alg = "EdDSA";

  jwksServer = createServer((request, response) => {
    if (request.url === "/jwks.json") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    response.writeHead(404);
    response.end();
  });

  await new Promise<void>((resolve) => jwksServer.listen(0, "127.0.0.1", resolve));
  const { port } = jwksServer.address() as AddressInfo;

  env = loadEnv({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    DATABASE_URL: "postgresql://dueradar:secret@localhost:5432/dueradar",
    NEON_AUTH_BASE_URL: "https://auth.example.test/dueradar/auth",
    NEON_AUTH_JWKS_URL: `http://127.0.0.1:${port}/jwks.json`,
    APP_ORIGIN: "http://localhost:5173",
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    jwksServer.close((error) => (error ? reject(error) : resolve())),
  );
});

async function tokenFor(userId: string): Promise<string> {
  return new SignJWT({ email: "tester@example.test" })
    .setProtectedHeader({ alg: "EdDSA", kid: "test-key" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(privateKey);
}

async function buildGuardedApp(rowCount: number): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const pool = {
    query: vi.fn(async () => ({ rowCount })),
  };

  registerActiveAccountGuard(app, env, pool as never);
  app.get("/api/v1/probe", async () => ({ ok: true }));
  app.setErrorHandler((error, _request, reply) => {
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : "Request failed.";
    return reply.code(statusCode).send({ error: { message } });
  });
  await app.ready();

  return app;
}

const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.unstubAllGlobals();
});

describe("deleted account access", () => {
  it("rejects a still-valid bearer token once the auth user row is gone", async () => {
    const app = await buildGuardedApp(0);
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/probe",
      headers: { authorization: `Bearer ${await tokenFor(DELETED_USER_ID)}` },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { message: /no longer exists/i } });
  });

  it("allows a bearer token while the auth user still exists", async () => {
    const app = await buildGuardedApp(1);
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/probe",
      headers: { authorization: `Bearer ${await tokenFor(USER_ID)}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it("leaves cookie-based requests to Neon Auth", async () => {
    const app = await buildGuardedApp(0);
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/probe",
      headers: { cookie: "better-auth.session_token=anything" },
    });

    expect(response.statusCode).toBe(200);
  });

  it("does not recreate a profile for a deleted auth user", async () => {
    const inserted: unknown[] = [];
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => [] }),
        }),
      }),
      execute: async () => ({ rows: [] }),
      insert: (...args: unknown[]) => {
        inserted.push(args);
        throw new Error("ensureProfile must not insert for a deleted auth user");
      },
    } as unknown as Database;

    await expect(
      ensureProfile(db, { id: DELETED_USER_ID, email: null, name: null, source: "jwt" }),
    ).rejects.toMatchObject({ statusCode: 401, code: "unauthorized" });
    expect(inserted).toHaveLength(0);
  });

  it("clears both managed and self-hosted session cookie names", () => {
    const header = vi.fn();
    clearAuthCookies({ header } as unknown as FastifyReply, env);

    expect(header).toHaveBeenCalledWith(
      "set-cookie",
      expect.arrayContaining([
        expect.stringContaining("__Secure-neon-auth.session_token=;"),
        expect.stringContaining("neon-auth.session_token=;"),
        expect.stringContaining("__Secure-better-auth.session_token=;"),
        expect.stringContaining("better-auth.session_token=;"),
      ]),
    );
  });

  it("checks the auth service on every cookie session lookup", async () => {
    const cookie = "better-auth.session_token=cached-deletion-test";
    const authFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ user: { id: USER_ID, email: "cached@example.test" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ user: null }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal(
      "fetch",
      authFetch,
    );

    const first = await sessionFromCookie(cookie, env);
    expect(first?.id).toBe(USER_ID);

    const afterDeletion = await sessionFromCookie(cookie, env);
    expect(afterDeletion).toBeNull();
    expect(authFetch).toHaveBeenCalledTimes(2);
  });
});
