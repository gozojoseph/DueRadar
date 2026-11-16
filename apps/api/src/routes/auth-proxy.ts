import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Env } from "../env.js";
import { secureCookies } from "../env.js";

const PREFIX = "/api/auth";

function rewriteSetCookie(cookie: string, secure: boolean): string {
  const segments = cookie.split(";").map((segment) => segment.trim()).filter(Boolean);
  const pair = segments.shift();
  if (!pair) return cookie;

  const kept = segments.filter((attribute) => {
    const lower = attribute.toLowerCase();
    return (
      !lower.startsWith("domain=") &&
      !lower.startsWith("path=") &&
      !lower.startsWith("samesite=") &&
      lower !== "partitioned"
    );
  });

  kept.push("Path=/", "SameSite=Lax");
  if (secure && !kept.some((attribute) => attribute.toLowerCase() === "secure")) {
    kept.push("Secure");
  }
  return [pair, ...kept].join("; ");
}

function shouldForwardRequestHeader(name: string): boolean {
  return [
    "accept",
    "accept-language",
    "content-type",
    "cookie",
    "origin",
    "referer",
    "user-agent",
  ].includes(name);
}

/**
 * First-party proxy for Neon Auth. Safari's ITP blocks the managed auth
 * service's third-party cookie; serving `/api/auth/*` from our own origin
 * makes the session cookie first-party. Request bodies are forwarded as raw
 * bytes and Set-Cookie attributes are normalised for our domain.
 */
export async function registerAuthProxy(app: FastifyInstance, env: Env): Promise<void> {
  await app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", { parseAs: "buffer" }, (_request, body, done) => {
      done(null, body);
    });

    const handler = async (request: FastifyRequest, reply: FastifyReply) => {
      const rawUrl = request.raw.url ?? request.url;
      const queryIndex = rawUrl.indexOf("?");
      const pathOnly = queryIndex >= 0 ? rawUrl.slice(0, queryIndex) : rawUrl;
      const search = queryIndex >= 0 ? rawUrl.slice(queryIndex) : "";
      const suffix = pathOnly.slice(PREFIX.length) || "/";
      const target = `${env.NEON_AUTH_BASE_URL.replace(/\/$/, "")}${suffix}${search}`;

      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (!value || !shouldForwardRequestHeader(name)) continue;
        headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      }
      // Neon Auth rejects an `x-forwarded-host` that differs from its own
      // hostname. The browser's Origin is forwarded above, which is what
      // Managed Better Auth uses for its trusted-origin check and redirects.
      headers.set("x-forwarded-proto", request.protocol);
      headers.set("x-forwarded-for", request.ip);

      const hasBody = !["GET", "HEAD"].includes(request.method);
      const body = hasBody && Buffer.isBuffer(request.body) ? request.body : undefined;

      let upstream: Response;
      try {
        upstream = await fetch(target, {
          method: request.method,
          headers,
          body,
          redirect: "manual",
          signal: AbortSignal.timeout(20_000),
        });
      } catch (error) {
        request.log.error({ err: error, target: pathOnly }, "Neon Auth proxy request failed");
        return reply.code(502).send({
          error: { code: "auth_unavailable", message: "Authentication is temporarily unavailable." },
        });
      }

      reply.code(upstream.status);
      for (const [name, value] of upstream.headers) {
        if (name === "set-cookie") continue;
        if (["content-encoding", "content-length", "transfer-encoding", "connection"].includes(name)) {
          continue;
        }
        reply.header(name, value);
      }

      const cookies = upstream.headers.getSetCookie();
      if (cookies.length > 0) {
        reply.header(
          "set-cookie",
          cookies.map((cookie) => rewriteSetCookie(cookie, secureCookies(env))),
        );
      }

      const location = upstream.headers.get("location");
      if (location) {
        const base = env.NEON_AUTH_BASE_URL.replace(/\/$/, "");
        if (location.startsWith(base)) {
          reply.header("location", `${PREFIX}${location.slice(base.length)}`);
        }
      }

      const payload = Buffer.from(await upstream.arrayBuffer());
      return reply.send(payload);
    };

    scope.all(PREFIX, { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, handler);
    scope.all(`${PREFIX}/*`, { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, handler);
  });
}
