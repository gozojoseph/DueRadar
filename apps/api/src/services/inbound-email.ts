import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { imports } from "@dueradar/db/schema";
import type { Database } from "../db.js";
import type { Env } from "../env.js";
import {
  createFailedImport,
  createMessageImport,
  type MessageImportResult,
} from "./detection.js";
import type { DraftEnhancer } from "./llm-detect.js";
import { getPlanAccess } from "./plan.js";
import {
  extractEmailAddresses,
  findActiveAlias,
  touchAlias,
} from "./email-alias.js";

const MAX_EMAIL_BYTES = 2 * 1024 * 1024;
const EMAIL_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

const receivedEventSchema = z
  .object({
    type: z.string().max(120),
    data: z
      .object({
        email_id: z.string().max(128).optional(),
        message_id: z.string().max(1000).nullable().optional(),
        subject: z.string().max(2000).nullable().optional(),
        from: z.string().max(500).nullable().optional(),
        to: z.array(z.string().max(500)).max(60).optional(),
        cc: z.array(z.string().max(500)).max(60).optional(),
        bcc: z.array(z.string().max(500)).max(60).optional(),
        received_for: z.array(z.string().max(500)).max(60).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type ResendReceivedEvent = z.infer<typeof receivedEventSchema>;

export function parseResendEvent(payload: unknown): ResendReceivedEvent {
  return receivedEventSchema.parse(payload);
}

export class InboundEmailError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = "InboundEmailError";
    this.code = code;
    this.retryable = retryable;
  }
}

export interface ReceivedEmailBody {
  text: string | null;
  html: string | null;
  subject: string | null;
  from: string | null;
  messageId: string | null;
  receivedFor: string[];
  attachmentCount: number;
}

/**
 * Fetches the body through the authenticated Resend API. The request is
 * bounded by a timeout and a byte ceiling, and HTML is requested with `cid:`
 * image references so no remote asset is ever downloaded.
 */
export async function fetchReceivedEmail(
  apiKey: string,
  emailId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ReceivedEmailBody> {
  if (!EMAIL_ID_PATTERN.test(emailId)) {
    throw new InboundEmailError("invalid_email_id", "The provider sent an invalid email id.", false);
  }

  let response: Response;
  try {
    response = await fetchImpl(
      `https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}?html_format=cid`,
      {
        method: "GET",
        headers: {
          authorization: `Bearer ${apiKey}`,
          accept: "application/json",
        },
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new InboundEmailError(
      timedOut ? "email_fetch_timeout" : "email_fetch_failed",
      "Could not reach the email provider.",
      true,
    );
  }

  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500;
    throw new InboundEmailError(
      `email_fetch_${response.status}`,
      `The email provider returned ${response.status}.`,
      retryable,
    );
  }

  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_EMAIL_BYTES) {
    throw new InboundEmailError("email_too_large", "The email body is too large to inspect.", false);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new InboundEmailError("email_invalid_json", "The email provider returned unreadable data.", false);
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_EMAIL_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new InboundEmailError(
          "email_too_large",
          "The email body is too large to inspect.",
          false,
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof InboundEmailError) throw error;
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new InboundEmailError(
      timedOut ? "email_fetch_timeout" : "email_fetch_failed",
      "Could not read the email provider response.",
      true,
    );
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const raw = new TextDecoder().decode(bytes);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new InboundEmailError("email_invalid_json", "The email provider returned unreadable data.", false);
  }

  const body = parsed as Record<string, unknown>;
  const asString = (value: unknown): string | null =>
    typeof value === "string" && value.length > 0 ? value : null;
  const asArray = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string").slice(0, 60)
      : [];

  return {
    text: asString(body.text),
    html: asString(body.html),
    subject: asString(body.subject)?.slice(0, 2000) ?? null,
    from: asString(body.from)?.slice(0, 500) ?? null,
    messageId: asString(body.message_id)?.slice(0, 1000) ?? null,
    receivedFor: asArray(body.received_for),
    attachmentCount: Array.isArray(body.attachments) ? body.attachments.length : 0,
  };
}

export interface InboundResult {
  outcome: "processed" | "ignored" | "duplicate" | "failed";
  reason?: string;
  importId?: string;
  userId?: string;
  result?: MessageImportResult;
}

export interface InboundDependencies {
  env: Env;
  db: Database;
  fetchImpl?: typeof fetch;
  enhance?: DraftEnhancer;
}

/**
 * Resolves the forwarding alias, fetches the body, and creates an import with
 * suggestions. Permanent failures (too large, empty, unknown alias) are stored
 * for the user but not retried; transient provider failures are thrown so the
 * webhook can ask Resend to retry.
 */
export async function processInboundEmail(
  deps: InboundDependencies,
  event: ResendReceivedEvent,
): Promise<InboundResult> {
  const { env, db, fetchImpl, enhance } = deps;

  if (event.type !== "email.received") {
    return { outcome: "ignored", reason: "event_type" };
  }
  const data = event.data;
  if (!data?.email_id) {
    throw new InboundEmailError("missing_email_id", "The webhook has no email id.", false);
  }

  const recipients = extractEmailAddresses([
    ...(data.to ?? []),
    ...(data.received_for ?? []),
    ...(data.cc ?? []),
    ...(data.bcc ?? []),
  ]);
  const match = await findActiveAlias(db, recipients);
  if (!match) return { outcome: "ignored", reason: "unknown_alias" };

  const { alias } = match;
  const fallbackMessageId = data.message_id ?? data.email_id;
  const metadata = {
    provider: "resend",
    emailId: data.email_id,
    aliasId: alias.id,
    attachmentCount: 0,
  };

  const plan = await getPlanAccess(db, alias.userId);
  if (!plan.canUseEmailImport) {
    const failed = await createFailedImport(db, alias.userId, {
      source: "email",
      error: "plus_required",
      subject: data.subject ?? null,
      fromAddress: data.from ?? null,
      messageId: fallbackMessageId,
      metadata: { ...metadata, reason: "plus_required" },
      retentionHours: env.DETECTION_RAW_RETENTION_HOURS,
    });
    await touchAlias(db, alias.id);
    return {
      outcome: "failed",
      reason: "plus_required",
      importId: failed.id,
      userId: alias.userId,
    };
  }

  const [existing] = await db
    .select({ id: imports.id })
    .from(imports)
    .where(
      and(eq(imports.userId, alias.userId), eq(imports.messageId, fallbackMessageId)),
    )
    .limit(1);
  if (existing) {
    await touchAlias(db, alias.id);
    return { outcome: "duplicate", importId: existing.id, userId: alias.userId };
  }

  if (!env.RESEND_API_KEY) {
    throw new InboundEmailError(
      "email_not_configured",
      "Inbound email is not configured.",
      false,
    );
  }

  let body: ReceivedEmailBody;
  try {
    body = await fetchReceivedEmail(env.RESEND_API_KEY, data.email_id, fetchImpl);
  } catch (error) {
    if (error instanceof InboundEmailError && !error.retryable) {
      const failed = await createFailedImport(db, alias.userId, {
        source: "email",
        error: error.code,
        subject: data.subject ?? null,
        fromAddress: data.from ?? null,
        messageId: fallbackMessageId,
        metadata: { ...metadata, reason: error.code },
        retentionHours: env.DETECTION_RAW_RETENTION_HOURS,
      });
      await touchAlias(db, alias.id);
      return {
        outcome: "failed",
        reason: error.code,
        importId: failed.id,
        userId: alias.userId,
      };
    }
    throw error;
  }

  const readable = body.text?.trim() ? body.text : body.html;
  const subject = body.subject ?? data.subject ?? null;
  const fromAddress = body.from ?? data.from ?? null;

  if (!readable?.trim()) {
    const failed = await createFailedImport(db, alias.userId, {
      source: "email",
      error: "no_readable_text",
      subject,
      fromAddress,
      messageId: body.messageId ?? fallbackMessageId,
      metadata: { ...metadata, attachmentCount: body.attachmentCount },
      retentionHours: env.DETECTION_RAW_RETENTION_HOURS,
    });
    await touchAlias(db, alias.id);
    return {
      outcome: "failed",
      reason: "no_readable_text",
      importId: failed.id,
      userId: alias.userId,
    };
  }

  const result = await createMessageImport(
    db,
    alias.userId,
    {
      source: "email",
      text: readable,
      subject,
      fromAddress,
      messageId: body.messageId ?? fallbackMessageId,
      aliasId: alias.id,
      metadata: { ...metadata, attachmentCount: body.attachmentCount },
    },
    { retentionHours: env.DETECTION_RAW_RETENTION_HOURS, enhance },
  );

  await touchAlias(db, alias.id);

  return {
    outcome: "processed",
    importId: result.import.id,
    userId: alias.userId,
    result,
  };
}
