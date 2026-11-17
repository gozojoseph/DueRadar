import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CSV_MAX_BYTES } from "@dueradar/detection";
import { requireUser } from "../auth/guard.js";
import type { Database } from "../db.js";
import type { Env } from "../env.js";
import { recordAudit } from "../lib/audit.js";
import { notFound, parseBody } from "../lib/errors.js";
import {
  csvImportSchema,
  csvPreviewSchema,
  importMessageSchema,
} from "../schemas.js";
import { ensureProfile } from "../services/profile.js";
import {
  createCsvImport,
  createMessageImport,
  deleteImport,
  getImportDetail,
  listImportHistory,
  previewCsv,
  type MessageImportInput,
} from "../services/detection.js";
import { createDetectionNotifier } from "../services/detection-notify.js";
import { createLlmEnhancer } from "../services/llm-detect.js";

const CSV_BODY_LIMIT = CSV_MAX_BYTES + 512 * 1024;

const MESSAGE_SOURCE_LABELS: Record<string, string> = {
  paste: "pasted text",
  ocr: "a scanned receipt",
  upload: "an uploaded file",
  email: "a forwarded email",
  api: "an API import",
};

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export async function registerImportRoutes(
  app: FastifyInstance,
  deps: { env: Env; db: Database },
): Promise<void> {
  const { env, db } = deps;
  const enhance = createLlmEnhancer(env) ?? undefined;

  app.post(
    "/api/v1/imports/message",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const user = await requireUser(request, env);
      const input = parseBody(importMessageSchema, request.body);
      const notifier = createDetectionNotifier(db, user.id, env);
      const result = await createMessageImport(
        db,
        user.id,
        input as MessageImportInput,
        {
          retentionHours: env.DETECTION_RAW_RETENTION_HOURS,
          enhance,
          onNewDetections: (fresh) =>
            notifier.notify({
              sourceLabel: MESSAGE_SOURCE_LABELS[input.source] ?? "an import",
              suggestions: fresh,
            }),
        },
      );
      await recordAudit(db, request, {
        userId: user.id,
        action: "import.message",
        entityType: "import",
        entityId: result.import.id,
        metadata: {
          source: input.source,
          detected: result.summary.detected,
          actionable: result.summary.actionable,
        },
      });
      return reply.code(201).send(result);
    },
  );

  app.post(
    "/api/v1/imports/csv/preview",
    {
      bodyLimit: CSV_BODY_LIMIT,
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (request) => {
      await requireUser(request, env);
      const input = parseBody(csvPreviewSchema, request.body);
      return { preview: previewCsv({ csv: input.csv, mapping: input.mapping ?? null }) };
    },
  );

  app.post(
    "/api/v1/imports/csv",
    {
      bodyLimit: CSV_BODY_LIMIT,
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const user = await requireUser(request, env);
      const input = parseBody(csvImportSchema, request.body);
      const profile = await ensureProfile(db, user);
      const notifier = createDetectionNotifier(db, user.id, env);
      const result = await createCsvImport(db, user.id, {
        csv: input.csv,
        mapping: input.mapping,
        fileName: input.fileName ?? null,
        retentionHours: env.DETECTION_RAW_RETENTION_HOURS,
        timeZone: profile.timezone,
        onNewDetections: (fresh) =>
          notifier.notify({ sourceLabel: "your CSV import", suggestions: fresh }),
      });
      await recordAudit(db, request, {
        userId: user.id,
        action: "import.csv",
        entityType: "import",
        entityId: result.import.id,
        metadata: {
          rows: result.summary.rows,
          transactions: result.summary.transactions,
          candidates: result.summary.candidates,
          autoTracked: result.summary.autoTracked,
        },
      });
      return reply.code(201).send(result);
    },
  );

  app.get("/api/v1/imports", async (request) => {
    const user = await requireUser(request, env);
    const query = parseBody(historyQuerySchema, request.query);
    return { imports: await listImportHistory(db, user.id, query.limit ?? 20) };
  });

  app.get("/api/v1/imports/:id", async (request) => {
    const user = await requireUser(request, env);
    const { id } = request.params as { id: string };
    if (!z.string().uuid().safeParse(id).success) throw notFound("Import not found.");
    const detail = await getImportDetail(db, user.id, id);
    if (!detail) throw notFound("Import not found.");
    return detail;
  });

  app.delete("/api/v1/imports/:id", async (request, reply) => {
    const user = await requireUser(request, env);
    const { id } = request.params as { id: string };
    if (!z.string().uuid().safeParse(id).success) throw notFound("Import not found.");
    const deleted = await deleteImport(db, user.id, id);
    if (!deleted) throw notFound("Import not found.");
    await recordAudit(db, request, {
      userId: user.id,
      action: "import.deleted",
      entityType: "import",
      entityId: id,
    });
    return reply.code(204).send();
  });
}
