import { and, eq } from "drizzle-orm";
import {
  detectionSuggestions,
  imports,
} from "@dueradar/db/schema";
import type {
  DetectionSuggestion,
  Import,
} from "@dueradar/db/schema";
import {
  analyzeMessage,
  redactSensitive,
  stripTrackingLinks,
  type DetectionDraft,
  type RecurringTransaction,
} from "@dueradar/detection";
import type { Database } from "./database.js";

const HOUR_MS = 3_600_000;
const RAW_TEXT_LIMIT = 20_000;
const PAYMENT_HISTORY_LIMIT = 24;

/** The API's LLM enhancer; structurally identical so both sides interoperate. */
export type DraftEnhancer = (
  draft: DetectionDraft,
  text: string,
) => Promise<DetectionDraft> | DetectionDraft;

/* --------------------------------- helpers --------------------------------- */

/** Raw text must never outlive the promised window, whatever the env says. */
export function retentionUntil(now: Date, hours: number): Date {
  const bounded = Math.min(72, Math.max(1, Math.round(hours)));
  return new Date(now.getTime() + bounded * HOUR_MS);
}

export function redactImportText(text: string): string {
  return redactSensitive(stripTrackingLinks(text)).slice(0, RAW_TEXT_LIMIT);
}

/** Keeps the provider domain so the review screen can explain the source. */
export function redactSenderAddress(value: string): string {
  const at = value.lastIndexOf("@");
  if (at > 0 && at < value.length - 1) {
    const domain = value
      .slice(at + 1)
      .toLowerCase()
      .replace(/[^a-z0-9.-]/g, "")
      .slice(0, 120);
    if (domain.includes(".")) return `[email]@${domain}`;
  }
  return redactImportText(value).slice(0, 320);
}

export interface SuggestionPayload extends DetectionDraft {
  /** Prior successful charges behind a CSV recurring candidate, newest last. */
  transactions?: RecurringTransaction[];
  autoTracked?: boolean;
  autoTrackIgnored?: boolean;
}

export interface ImportDto {
  id: string;
  source: string;
  status: string;
  subject: string | null;
  fromAddress: string | null;
  messageId: string | null;
  processedAt: Date | null;
  error: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  rawRetentionUntil: Date | null;
  rawTextExpired: boolean;
}

export interface SuggestionDto {
  id: string;
  importId: string | null;
  kind: string | null;
  status: string;
  confidence: number;
  dedupeKey: string;
  acceptedSubscriptionId: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
  draft: SuggestionPayload;
  autoTracked: boolean;
  autoTrackIgnored: boolean;
  actionable: boolean;
  eligible: boolean;
  needsDetails: boolean;
  blockedReason: string | null;
  source: {
    id: string;
    source: string;
    subject: string | null;
    fromAddress: string | null;
    createdAt: Date;
  } | null;
}

export function toImportDto(row: Import): ImportDto {
  return {
    id: row.id,
    source: displayImportSource(row.source, row.metadata),
    status: row.status,
    subject: row.subject,
    fromAddress: row.fromAddress,
    messageId: row.messageId,
    processedAt: row.processedAt,
    error: row.error,
    metadata: row.metadata ?? null,
    createdAt: row.createdAt,
    rawRetentionUntil: row.rawRetentionUntil,
    rawTextExpired: row.rawText === null,
  };
}

export function draftPayload(row: DetectionSuggestion): SuggestionPayload {
  return row.payload as unknown as SuggestionPayload;
}

export function displayImportSource(
  source: string,
  metadata: Record<string, unknown> | null | undefined,
): string {
  return source === "email" && metadata?.provider === "gmail" ? "gmail" : source;
}

export function sourceFor(row: Import) {
  return {
    id: row.id,
    source: displayImportSource(row.source, row.metadata),
    subject: row.subject,
    fromAddress: row.fromAddress,
    createdAt: row.createdAt,
  };
}

/**
 * Refunds, declines, card checks, transfers and zero-value non-trials can be
 * explained to the user but never converted into a bill. They stay in the
 * review list with `actionable: false`.
 */
export function blockedReason(draft: DetectionDraft): string | null {
  if (draft.transactionType !== "payment") {
    const messages: Record<string, string> = {
      card_check: "This is a card check or temporary hold, not a charge.",
      refund: "This is a refund or reversal, not a charge.",
      declined: "This payment was declined or failed.",
      transfer: "This is a wallet transfer, not a subscription charge.",
      incoming: "This is money received, not a payment.",
      unknown: "This message does not describe a successful payment.",
    };
    return messages[draft.transactionType] ?? "This is not a successful payment.";
  }
  if (draft.amountMinor === 0 && draft.kind !== "trial") {
    return "A zero-value transaction is not a charge.";
  }
  return null;
}

export function toSuggestionDto(
  row: DetectionSuggestion,
  source?: {
    id: string;
    source: string;
    subject: string | null;
    fromAddress: string | null;
    createdAt: Date;
  } | null,
): SuggestionDto {
  const payload = draftPayload(row);
  const { autoTracked, autoTrackIgnored, ...draft } = payload;
  const blocked = blockedReason(draft);
  return {
    id: row.id,
    importId: row.importId,
    kind: row.kind,
    status: row.status,
    confidence: row.confidence,
    dedupeKey: row.dedupeKey,
    acceptedSubscriptionId: row.acceptedSubscriptionId,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
    draft,
    autoTracked: autoTracked === true,
    autoTrackIgnored: autoTrackIgnored === true,
    actionable: blocked === null,
    eligible: draft.eligible,
    needsDetails: blocked === null && !draft.eligible,
    blockedReason: blocked,
    source: source ?? null,
  };
}

function shouldPersist(draft: DetectionDraft): boolean {
  return Boolean(
    draft.merchant ||
      draft.amountMinor !== null ||
      draft.occurredAt ||
      draft.renewalDate ||
      draft.trialEndsAt ||
      draft.transactionType !== "payment",
  );
}

export interface DraftToPersist {
  draft: DetectionDraft;
  transactions?: RecurringTransaction[];
}

export async function persistDrafts(
  db: Database,
  userId: string,
  importId: string,
  entries: DraftToPersist[],
): Promise<{ suggestions: SuggestionDto[]; fresh: SuggestionDto[] }> {
  const saved: SuggestionDto[] = [];
  const fresh: SuggestionDto[] = [];

  for (const entry of entries) {
    const payload: SuggestionPayload = entry.transactions
      ? { ...entry.draft, transactions: entry.transactions.slice(-PAYMENT_HISTORY_LIMIT) }
      : entry.draft;

    const [inserted] = await db
      .insert(detectionSuggestions)
      .values({
        userId,
        importId,
        kind: entry.draft.kind,
        payload: payload as unknown as Record<string, unknown>,
        confidence: Math.round(entry.draft.confidence),
        dedupeKey: entry.draft.dedupeKey,
      })
      .onConflictDoNothing()
      .returning();

    if (inserted) {
      const dto = toSuggestionDto(inserted);
      saved.push(dto);
      fresh.push(dto);
      continue;
    }

    // The same alert may arrive twice (forwarded email plus pasted text). An
    // already accepted or rejected suggestion stays resolved; a pending one is
    // refreshed with the newest evidence.
    const [existing] = await db
      .select()
      .from(detectionSuggestions)
      .where(
        and(
          eq(detectionSuggestions.userId, userId),
          eq(detectionSuggestions.dedupeKey, entry.draft.dedupeKey),
        ),
      )
      .limit(1);
    if (!existing) continue;
    if (existing.status === "pending") {
      const existingPayload = draftPayload(existing);
      const nextPayload: SuggestionPayload = {
        ...payload,
        autoTrackIgnored: existingPayload.autoTrackIgnored === true,
      };
      const [updated] = await db
        .update(detectionSuggestions)
        .set({
          importId,
          kind: entry.draft.kind,
          payload: nextPayload as unknown as Record<string, unknown>,
          confidence: Math.round(entry.draft.confidence),
        })
        .where(eq(detectionSuggestions.id, existing.id))
        .returning();
      if (updated) saved.push(toSuggestionDto(updated));
    }
  }

  return { suggestions: saved, fresh };
}

export async function runWithImport(
  db: Database,
  input: {
    userId: string;
    source: string;
    subject?: string | null;
    fromAddress?: string | null;
    messageId?: string | null;
    rawText?: string | null;
    rawRetentionUntil?: Date | null;
    metadata?: Record<string, unknown> | null;
    status?: "pending" | "processed" | "failed";
    error?: string | null;
    processedAt?: Date | null;
  },
  drafts: DraftToPersist[],
): Promise<{ row: Import; suggestions: SuggestionDto[]; fresh: SuggestionDto[] }> {
  const [row] = await db
    .insert(imports)
    .values({
      userId: input.userId,
      source: input.source,
      status: input.status ?? "processed",
      subject: input.subject ?? null,
      fromAddress: input.fromAddress ?? null,
      messageId: input.messageId ?? null,
      rawText: input.rawText ?? null,
      rawRetentionUntil: input.rawRetentionUntil ?? null,
      metadata: input.metadata ?? null,
      error: input.error ?? null,
      processedAt: input.processedAt ?? new Date(),
    })
    .returning();
  if (!row) throw new Error("Failed to save import");

  try {
    const { suggestions, fresh } = await persistDrafts(db, input.userId, row.id, drafts);
    if (suggestions.length > 0 && row.metadata) {
      await db
        .update(imports)
        .set({ metadata: { ...row.metadata, suggestions: suggestions.length } })
        .where(eq(imports.id, row.id));
    }
    return { row, suggestions, fresh };
  } catch (error) {
    await db
      .update(imports)
      .set({ status: "failed", error: "suggestion_failed", processedAt: new Date() })
      .where(eq(imports.id, row.id));
    throw error;
  }
}

/* ------------------------------ message import ----------------------------- */

export interface MessageImportInput {
  source: "paste" | "ocr" | "upload" | "email" | "api";
  text: string;
  subject?: string | null;
  fromAddress?: string | null;
  messageId?: string | null;
  aliasId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ImportSummary {
  parser: string;
  detected: number;
  actionable: number;
  blocked: number;
  message: string;
}

export interface MessageImportResult {
  import: ImportDto;
  suggestions: SuggestionDto[];
  summary: ImportSummary;
}

function summarise(parser: string, suggestions: SuggestionDto[]): ImportSummary {
  const actionable = suggestions.filter((entry) => entry.actionable).length;
  const blocked = suggestions.length - actionable;
  let message: string;
  if (suggestions.length === 0) {
    message = "No bill, subscription or trial details were found. Try forwarding the full receipt.";
  } else if (actionable === 0) {
    message = "This message is not a successful charge, so nothing will be tracked.";
  } else if (actionable === 1) {
    message = "Found 1 item to review before it becomes a reminder.";
  } else {
    message = `Found ${actionable} items to review before they become reminders.`;
  }
  return { parser, detected: suggestions.length, actionable, blocked, message };
}

export async function createMessageImport(
  db: Database,
  userId: string,
  input: MessageImportInput,
  options: {
    retentionHours?: number;
    now?: Date;
    enhance?: DraftEnhancer;
    /** Called with the newly persisted suggestions; a failing hook never fails the import. */
    onNewDetections?: (fresh: SuggestionDto[]) => void | Promise<void>;
  } = {},
): Promise<MessageImportResult> {
  const now = options.now ?? new Date();
  const retention = retentionUntil(now, options.retentionHours ?? 72);
  const analysis = analyzeMessage(input.text, {
    source: input.source,
    today: now.toISOString().slice(0, 10),
    subject: input.subject ?? null,
    fromAddress: input.fromAddress ?? null,
    messageId: input.messageId ?? null,
  });

  let drafts: DraftToPersist[] = analysis.drafts
    .filter(shouldPersist)
    .map((draft) => ({ draft }));

  if (options.enhance && drafts.length === 1) {
    const entry = drafts[0];
    if (entry) {
      const enhanced = await options.enhance(entry.draft, analysis.text);
      drafts = [{ draft: enhanced }];
    }
  }

  const { row, suggestions, fresh } = await runWithImport(
    db,
    {
      userId,
      source: input.source,
      subject: input.subject ? redactImportText(input.subject).slice(0, 300) : null,
      fromAddress: input.fromAddress ? redactSenderAddress(input.fromAddress) : null,
      messageId: input.messageId ?? null,
      rawText: redactImportText(analysis.text),
      rawRetentionUntil: retention,
      status: "processed",
      metadata: {
        parser: analysis.parser,
        warnings: analysis.warnings.length,
        detected: drafts.length,
        ...(input.aliasId ? { aliasId: input.aliasId } : {}),
        ...(input.metadata ?? {}),
      },
    },
    drafts,
  );

  if (fresh.length > 0 && options.onNewDetections) {
    try {
      await options.onNewDetections(fresh);
    } catch (error) {
      console.error(
        "[detections] detection notification hook failed:",
        error instanceof Error ? error.message : "unknown error",
      );
    }
  }

  return {
    import: toImportDto(row),
    suggestions: suggestions.map((entry) => ({ ...entry, source: sourceFor(row) })),
    summary: summarise(analysis.parser, suggestions),
  };
}

/** Used by the inbound webhook when a message has no readable body. */
export async function createFailedImport(
  db: Database,
  userId: string,
  input: {
    source: string;
    error: string;
    subject?: string | null;
    fromAddress?: string | null;
    messageId?: string | null;
    metadata?: Record<string, unknown> | null;
    retentionHours?: number;
    now?: Date;
  },
): Promise<ImportDto> {
  const now = input.now ?? new Date();
  const [row] = await db
    .insert(imports)
    .values({
      userId,
      source: input.source,
      status: "failed",
      subject: input.subject ? redactImportText(input.subject).slice(0, 300) : null,
      fromAddress: input.fromAddress ? redactSenderAddress(input.fromAddress) : null,
      messageId: input.messageId ?? null,
      rawText: null,
      rawRetentionUntil: retentionUntil(now, input.retentionHours ?? 72),
      metadata: input.metadata ?? null,
      error: input.error.slice(0, 200),
      processedAt: now,
    })
    .returning();
  if (!row) throw new Error("Failed to save import");
  return toImportDto(row);
}
