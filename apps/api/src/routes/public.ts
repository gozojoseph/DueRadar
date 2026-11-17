import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Env } from "../env.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function canonicalUrlHost(request: FastifyRequest): string {
  const host = request.headers["host"] ?? "app.dueradar.cloud";
  return `https://${host}`;
}

export interface PublicRouteOptions {
  webRoot: string;
}

export async function registerPublicRoutes(app: FastifyInstance, opts: PublicRouteOptions): Promise<void> {
  const { webRoot } = opts;

  // --- Android TWA app-link verification ------------------------------------
  // Bubblewrap/TWA verification requires /.well-known/assetlinks.json on the
  // app's domain. fastifyStatic does not serve dotfile paths, so this route
  // reads the file from the web build's public dir instead. Served no-cache so
  // fingerprint updates (e.g. after enabling Play App Signing) go live fast.
  app.get("/.well-known/assetlinks.json", async (_request, reply) => {
    try {
      const body = readFileSync(resolve(webRoot, ".well-known", "assetlinks.json"), "utf8");
      return reply
        .code(200)
        .type("application/json; charset=utf-8")
        .header("Cache-Control", "no-cache")
        .send(body);
    } catch {
      // File not present yet (no TWA build deployed) - plain 404.
      return reply.code(404).send();
    }
  });

  // --- landing HTML shell ----------------------------------------------------
  // The prerendered landing page is served at GET / ahead of the SPA fallback so
  // crawlers (and users without JS) receive the real heading, description,
  // canonical and copy in the initial HTML instead of an empty <div id="root">.
  // fastifyStatic is configured with wildcard:false + index:[] so it registers
  // routes for every built asset but never a `/` route, avoiding a collision
  // with this landing route (fastify-static auto-registers GET+HEAD / for
  // index.html when index is truthy). The landing.html ships in the web build.
  app.get(
    "/",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const landingPath = resolve(webRoot, "landing.html");
      try {
        // Prefer the prerendered landing HTML for the homepage (SEO-friendly).
        const landing = readFileSync(landingPath, "utf8");
        return reply
          .code(200)
          .type("text/html; charset=utf-8")
          .header("Cache-Control", "no-cache")
          .send(landing);
      } catch {
        // Landing HTML is absent (API-only / web build off); fall back to the
        // SPA shell so client-side routes render without a 404.
        return reply.code(200).type("text/html; charset=utf-8").header("Cache-Control", "no-cache").send(readFileSync(resolve(webRoot, "index.html"), "utf8"));
      }
    },
  );
}
