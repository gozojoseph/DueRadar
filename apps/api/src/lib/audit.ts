import type { FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { auditEvents } from "@dueradar/db/schema";
import type { DatabaseExecutor } from "@dueradar/db";

export async function recordAudit(
  db: DatabaseExecutor,
  request: FastifyRequest,
  event: {
    userId: string | null;
    action: string;
    entityType?: string;
    entityId?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(auditEvents).values({
    userId: event.userId,
    action: event.action,
    entityType: event.entityType ?? null,
    entityId: event.entityId ?? null,
    ip: request.ip ?? null,
    userAgent: request.headers["user-agent"]?.slice(0, 500) ?? null,
    metadata: event.metadata ?? null,
  });
}

export function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function clientSummary(request: FastifyRequest): string {
  const agent = request.headers["user-agent"] ?? "unknown";
  return agent.slice(0, 180);
}
