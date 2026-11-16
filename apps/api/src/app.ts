import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify, { LogController, type FastifyInstance } from "fastify";
import type { createDatabase } from "@dueradar/db";
import { createClients } from "./lib/clients.js";
import { ApiError } from "./lib/errors.js";
import { registerActiveAccountGuard } from "./auth/guard.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerRoutes } from "./routes/index.js";
import type { Database } from "./db.js";
import type { Env } from "./env.js";

export interface BuildAppOptions {
  env: Env;
  db: Database;
  pool: ReturnType<typeof createDatabase>["pool"];
}

const CSP_DIRECTIVES = {
  defaultSrc: ["'self'"],
  baseUri: ["'self'"],
  objectSrc: ["'none'"],
  frameAncestors: ["'self'"],
  formAction: ["'self'"],
  // The optional screenshot reader loads Tesseract's worker, WASM core and
  // English model only when the user picks an image. The image itself never
  // leaves the device. Keep this list narrow; no other third-party script runs.
  scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", "data:", "blob:"],
  fontSrc: ["'self'", "data:"],
  connectSrc: ["'self'", "https://cdn.jsdelivr.net", "https://tessdata.projectnaptha.com"],
  workerSrc: ["'self'", "blob:", "https://cdn.jsdelivr.net"],
  manifestSrc: ["'self'"],
  upgradeInsecureRequests: [],
};

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { env, db, pool } = options;
  const clients = createClients(env);

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "res.headers['set-cookie']",
          "*.password",
          "*.token",
        ],
        remove: true,
      },
    },
    bodyLimit: 256 * 1024,
    trustProxy: true,
    logController: new LogController({
      disableRequestLogging: env.NODE_ENV === "production",
    }),
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: CSP_DIRECTIVES as never,
    },
    crossOriginEmbedderPolicy: false,
    hsts: env.APP_ORIGIN.startsWith("https://")
      ? { maxAge: 15_552_000, includeSubDomains: true, preload: false }
      : false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  });

  await app.register(cookie, {
    hook: "onRequest",
    parseOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: env.APP_ORIGIN.startsWith("https://"),
      path: "/",
    },
  });

  await app.register(rateLimit, {
    global: false,
    max: 240,
    timeWindow: "1 minute",
    ban: 3,
    keyGenerator: (request) =>
      `${request.ip}:${request.headers["user-agent"] ?? "-"}`.slice(0, 200),
    errorResponseBuilder: () => ({
      error: { code: "rate_limited", message: "Too many requests. Try again shortly." },
    }),
  });

  registerActiveAccountGuard(app, env, pool);

  if (env.NODE_ENV === "production") {
    const appHost = new URL(env.APP_ORIGIN).hostname;
    const allowedHosts = new Set([appHost, `www.${appHost}`]);
    app.addHook("onRequest", async (request, reply) => {
      const host = request.hostname;
      if (!host) return undefined;
      if (allowedHosts.has(host)) return undefined;
      if (host.endsWith(".onrender.com")) return undefined;
      request.log.warn({ host }, "Rejected request with unexpected Host header");
      return reply.code(421).send({ error: { code: "bad_host", message: "Unexpected host." } });
    });
  }

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details ?? undefined },
      });
    }
    const rawStatus = (error as { statusCode?: number }).statusCode;
    const statusCode = typeof rawStatus === "number" ? rawStatus : 500;
    if (statusCode >= 500) {
      request.log.error({ err: error }, "Unhandled request error");
      return reply.code(500).send({
        error: { code: "internal_error", message: "Something went wrong. Try again." },
      });
    }
    request.log.warn({ err: error }, "Request rejected");
    return reply.code(statusCode).send({
      error: {
        code: "request_error",
        message: (error as Error).message || "That request could not be completed.",
      },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) {
      return reply.code(404).send({ error: { code: "not_found", message: "Endpoint not found." } });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return reply
        .code(405)
        .send({ error: { code: "method_not_allowed", message: "Method not allowed." } });
    }
    return reply
      .header("Cache-Control", "no-cache")
      .type("text/html; charset=utf-8")
      .send(webIndex(env));
  });

  await registerHealthRoutes(app, { env, pool });
  await registerRoutes(app, { env, db, clients });

  const webRoot = webDistPath(env);
  if (webRoot) {
    await app.register(fastifyStatic, {
      root: webRoot,
      prefix: "/",
      wildcard: false,
      setHeaders: (response, filePath) => {
        if (filePath.endsWith("sw.js") || filePath.includes("workbox")) {
          response.header("Cache-Control", "no-cache, no-store, must-revalidate");
        } else if (/[\\/]assets[\\/]/.test(filePath)) {
          // Everything Vite emits under assets/ carries a content hash.
          response.header("Cache-Control", "public, max-age=31536000, immutable");
        } else if (filePath.endsWith(".html") || filePath.endsWith("manifest.webmanifest")) {
          response.header("Cache-Control", "no-cache");
        }
      },
    });
  }

  return app;
}

/**
 * Resolves the built SPA. Returns null when the directory or its index is
 * absent, which keeps API-only tests and `tsx` development simple.
 */
function webDistPath(env: Env): string | null {
  if (env.SERVE_WEB === "false") return null;
  const root = resolve(process.cwd(), env.WEB_DIST ?? "../web/dist");
  return existsSync(resolve(root, "index.html")) ? root : null;
}

function webIndex(env: Env): string {
  const root = webDistPath(env);
  if (!root) {
    return "<!doctype html><title>DueRadar API</title><p>The web build is not present in this environment.</p>";
  }
  return readFileSync(resolve(root, "index.html"), "utf8");
}
