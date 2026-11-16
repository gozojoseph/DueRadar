import type { FastifyInstance, FastifyReply } from "fastify";
import type { createDatabase } from "@dueradar/db";
import type { Env } from "../env.js";

type Pool = ReturnType<typeof createDatabase>["pool"];

export async function registerHealthRoutes(
  app: FastifyInstance,
  deps: { env: Env; pool: Pool },
): Promise<void> {
  const { env, pool } = deps;

  const handler = async (_request: unknown, reply: FastifyReply) => {
    try {
      await pool.query("select 1");
      return reply.send({
        status: "ok",
        database: "ok",
        environment: env.NODE_ENV,
        time: new Date().toISOString(),
      });
    } catch {
      return reply.code(503).send({
        status: "unavailable",
        database: "error",
        environment: env.NODE_ENV,
        time: new Date().toISOString(),
      });
    }
  };

  app.get("/api/health", handler);
  app.get("/api/healthz", handler);
}
