import { and, count, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import {
  detectionSuggestions,
  imports,
  payments,
  subscriptions,
} from "@dueradar/db/schema";
import type {
  BillingCycle,
  DetectionSuggestion,
  Import,
  RecordKind,
} from "@dueradar/db/schema";
import {
  analyzeMessage,
  detectRecurringCandidates,
  draftFromCharge,
  mapCsvRows,
  parseCsv,
  redactSensitive,
  sameMerchant,
  stripTrackingLinks,
  suggestCsvMapping,
  validateCsvMapping,
  withEstimatedRenewal,
  type CsvMapping,
  type CsvRowError,
  type DetectionDraft,
  type DetectionEvidence,
  type ParsedCsv,
  type RecurringCandidate,
  type RecurringTransaction,
} from "@dueradar/detection";
import { cancelSubscriptionReminders } from "@dueradar/scheduling";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import type { Database } from "../db.js";
import { createSubscription, type SubscriptionInput } from "./subscriptions.js";
import { enforceActiveItemLimit, lockPlanForUser } from "./plan.js";
import type { DraftEnhancer } from "./llm-detect.js";

const HOUR_MS = 3_600_000;
const RAW_TEXT_LIMIT = 20_000;
const PAYMENT_HISTORY_LIMIT = 24;

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

function displayImportSource(
  source: string,
  metadata: Record<string, unknown> | null | undefined,
): string {
  return source === "email" && metadata?.provider === "gmail" ? "gmail" : source;
}

function draftPayload(row: DetectionSuggestion): SuggestionPayload {
  return row.payload as unknown as SuggestionPayload;
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

interface DraftToPersist {
  draft: DetectionDraft;
  transactions?: RecurringTransaction[];
}

async function persistDrafts(
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

async function runWithImport(
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

function sourceFor(row: Import) {
  return {
    id: row.id,
    source: displayImportSource(row.source, row.metadata),
    subject: row.subject,
    fromAddress: row.fromAddress,
    createdAt: row.createdAt,
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

/* -------------------------------- CSV import ------------------------------- */

export interface PreparedCsv {
  parsed: ParsedCsv;
  mapping: CsvMapping;
  suggestedMapping: CsvMapping;
  mapped: ReturnType<typeof mapCsvRows>;
}

export function prepareCsv(input: { csv: string; mapping?: CsvMapping | null }): PreparedCsv {
  const parsed = parseCsv(input.csv);
  if (parsed.headers.length < 2) {
    throw badRequest("The file needs a header row with at least a date and a description.");
  }
  const suggestedMapping = suggestCsvMapping(parsed.headers);
  const mapping = input.mapping ?? suggestedMapping;
  const mappingErrors = validateCsvMapping(parsed.headers, mapping);
  if (mappingErrors.length > 0) {
    throw badRequest("Check the selected columns.", mappingErrors);
  }
  const mapped = mapCsvRows(parsed, mapping);
  return { parsed, mapping, suggestedMapping, mapped };
}

export interface CsvPreviewResult {
  headers: string[];
  delimiter: string;
  truncated: boolean;
  suggestedMapping: CsvMapping;
  mapping: CsvMapping;
  sampleRows: string[][];
  transactions: ReturnType<typeof mapCsvRows>["transactions"];
  totals: {
    rows: number;
    transactions: number;
    duplicates: number;
    errors: number;
  };
  errors: CsvRowError[];
}

export function previewCsv(input: {
  csv: string;
  mapping?: CsvMapping | null;
}): CsvPreviewResult {
  const { parsed, mapping, suggestedMapping, mapped } = prepareCsv(input);
  return {
    headers: parsed.headers,
    delimiter: parsed.delimiter,
    truncated: parsed.truncated,
    suggestedMapping,
    mapping,
    sampleRows: parsed.rows.slice(0, 5),
    transactions: mapped.transactions.slice(0, 20),
    totals: {
      rows: parsed.rows.length,
      transactions: mapped.transactions.length,
      duplicates: mapped.duplicates,
      errors: mapped.errors.length,
    },
    errors: mapped.errors.slice(0, 50),
  };
}

function recurrenceEvidence(candidate: RecurringCandidate): DetectionEvidence {
  const first = candidate.transactions[0]?.occurredAt ?? "";
  const last = candidate.transactions[candidate.transactions.length - 1]?.occurredAt ?? "";
  return {
    field: "recurring charges",
    text: `${candidate.transactions.length} matching ${candidate.merchant} charges between ${first} and ${last}, about every ${candidate.customIntervalDays ?? cycleDays(candidate.cycle)} days.`,
    origin: "estimate",
  };
}

function cycleDays(cycle: BillingCycle): number {
  switch (cycle) {
    case "weekly":
      return 7;
    case "monthly":
      return 30;
    case "quarterly":
      return 91;
    case "semiannual":
      return 182;
    case "annual":
      return 365;
    case "custom_days":
      return 30;
  }
}

export function candidateDraft(candidate: RecurringCandidate): DetectionDraft {
  const latest = candidate.transactions[candidate.transactions.length - 1];
  const draft = draftFromCharge({
    merchant: candidate.merchant,
    amountMinor: candidate.amountMinor,
    currency: candidate.currency,
    occurredAt: latest?.occurredAt ?? candidate.nextDate,
    kind: "subscription",
    cycle: candidate.cycle,
    renewalDate: candidate.nextDate,
    source: "CSV import",
  });
  return withEstimatedRenewal(draft, candidate.nextDate, [recurrenceEvidence(candidate)]);
}

export interface CsvImportResult {
  import: ImportDto;
  suggestions: SuggestionDto[];
  summary: {
    rows: number;
    transactions: number;
    duplicates: number;
    errors: CsvRowError[];
    candidates: number;
    skippedExisting: number;
    autoTracked: number;
    message: string;
  };
}

export async function createCsvImport(
  db: Database,
  userId: string,
  input: {
    csv: string;
    mapping: CsvMapping;
    fileName?: string | null;
    retentionHours?: number;
    now?: Date;
    timeZone: string;
    /** Called with suggestions still awaiting review; auto-tracked ones are not reported. */
    onNewDetections?: (fresh: SuggestionDto[]) => void | Promise<void>;
  },
): Promise<CsvImportResult> {
  const prepared = prepareCsv({ csv: input.csv, mapping: input.mapping });
  const now = input.now ?? new Date();
  const transactions = prepared.mapped.transactions.filter((entry) => !entry.duplicate);
  const hasUsableRows = prepared.mapped.transactions.length > 0;

  const candidates = detectRecurringCandidates(
    transactions.map((entry) => ({
      merchant: entry.merchant,
      amountMinor: entry.amountMinor,
      currency: entry.currency,
      occurredAt: entry.occurredAt,
      type: entry.type,
      source: "csv",
      reference: entry.reference,
    })),
    { today: now.toISOString().slice(0, 10) },
  ).filter((candidate) => candidate.strong);

  const existing = await db
    .select({ name: subscriptions.name, vendor: subscriptions.vendor })
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, "active")));

  const fresh: RecurringCandidate[] = [];
  let skippedExisting = 0;
  for (const candidate of candidates) {
    const alreadyTracked = existing.some(
      (row) =>
        sameMerchant(row.name, candidate.merchant) ||
        (row.vendor ? sameMerchant(row.vendor, candidate.merchant) : false),
    );
    if (alreadyTracked) {
      skippedExisting += 1;
      continue;
    }
    fresh.push(candidate);
  }

  const drafts: DraftToPersist[] = fresh.map((candidate) => ({
    draft: candidateDraft(candidate),
    transactions: candidate.transactions,
  }));

  const metadata = {
    fileName: input.fileName ?? null,
    delimiter: prepared.parsed.delimiter,
    rows: prepared.parsed.rows.length,
    transactions: prepared.mapped.transactions.length,
    duplicates: prepared.mapped.duplicates,
    errors: prepared.mapped.errors.length,
    candidates: candidates.length,
    skippedExisting,
    truncated: prepared.parsed.truncated,
  };

  const { row, suggestions, fresh: freshSuggestions } = await runWithImport(
    db,
    {
      userId,
      source: "csv",
      status: hasUsableRows ? "processed" : "failed",
      error: hasUsableRows ? null : "No usable rows",
      rawText: null,
      rawRetentionUntil: null,
      metadata,
      processedAt: now,
    },
    drafts,
  );

  let autoTracked = 0;
  const resolvedSuggestions: SuggestionDto[] = [];
  for (const suggestion of suggestions) {
    if (
      suggestion.status === "pending" &&
      suggestion.eligible &&
      suggestion.actionable &&
      !suggestion.autoTrackIgnored
    ) {
      const accepted = await acceptSuggestion(
        db,
        userId,
        suggestion.id,
        {},
        input.timeZone,
        true,
      );
      resolvedSuggestions.push({
        ...accepted.suggestion,
        source: suggestion.source,
      });
      autoTracked += 1;
    } else {
      resolvedSuggestions.push(suggestion);
    }
  }

  if (input.onNewDetections) {
    const stillPending = freshSuggestions.filter(
      (entry) =>
        resolvedSuggestions.find((resolved) => resolved.id === entry.id)?.status === "pending",
    );
    if (stillPending.length > 0) {
      try {
        await input.onNewDetections(stillPending);
      } catch (error) {
        console.error(
          "[detections] detection notification hook failed:",
          error instanceof Error ? error.message : "unknown error",
        );
      }
    }
  }

  const importMetadata = {
    ...metadata,
    suggestions: suggestions.length,
    autoTracked,
  };
  await db
    .update(imports)
    .set({ metadata: importMetadata })
    .where(eq(imports.id, row.id));

  const pendingCount = resolvedSuggestions.filter(
    (suggestion) => suggestion.status === "pending",
  ).length;
  let message: string;
  if (autoTracked > 0) {
    message = `${autoTracked} recurring ${autoTracked === 1 ? "charge was" : "charges were"} automatically tracked. You can undo this from the Saved list.`;
  } else if (pendingCount > 0) {
    message = `${pendingCount} recurring ${pendingCount === 1 ? "charge needs" : "charges need"} review before tracking.`;
  } else if (!hasUsableRows) {
    message = "No usable rows were found. Check the column mapping and date format.";
  } else if (skippedExisting > 0) {
    message = "Everything found is already tracked.";
  } else {
    message = "No recurring charges with at least three payments were found.";
  }

  return {
    import: toImportDto({ ...row, metadata: importMetadata }),
    suggestions: resolvedSuggestions.map((entry) => ({
      ...entry,
      source: entry.source ?? sourceFor(row),
    })),
    summary: {
      rows: prepared.parsed.rows.length,
      transactions: prepared.mapped.transactions.length,
      duplicates: prepared.mapped.duplicates,
      errors: prepared.mapped.errors.slice(0, 50),
      candidates: candidates.length,
      skippedExisting,
      autoTracked,
      message,
    },
  };
}

/* ------------------------------- reading data ------------------------------- */

const suggestionSourceColumns = {
  id: imports.id,
  source: imports.source,
  metadata: imports.metadata,
  subject: imports.subject,
  fromAddress: imports.fromAddress,
  createdAt: imports.createdAt,
};

export async function listImportHistory(
  db: Database,
  userId: string,
  limit = 20,
): Promise<
  Array<
    ImportDto & {
      suggestionCount: number;
      pendingCount: number;
    }
  >
> {
  const rows = await db
    .select()
    .from(imports)
    .where(eq(imports.userId, userId))
    .orderBy(desc(imports.createdAt))
    .limit(Math.min(100, Math.max(1, limit)));

  if (rows.length === 0) return [];

  const counts = await db
    .select({
      importId: detectionSuggestions.importId,
      status: detectionSuggestions.status,
      total: count(),
    })
    .from(detectionSuggestions)
    .where(
      and(
        eq(detectionSuggestions.userId, userId),
        inArray(
          detectionSuggestions.importId,
          rows.map((row) => row.id),
        ),
      ),
    )
    .groupBy(detectionSuggestions.importId, detectionSuggestions.status);

  return rows.map((row) => {
    const related = counts.filter((entry) => entry.importId === row.id);
    return {
      ...toImportDto(row),
      suggestionCount: related.reduce((total, entry) => total + Number(entry.total), 0),
      pendingCount: related
        .filter((entry) => entry.status === "pending")
        .reduce((total, entry) => total + Number(entry.total), 0),
    };
  });
}

export async function getImportDetail(
  db: Database,
  userId: string,
  importId: string,
): Promise<{
  import: ImportDto;
  suggestions: SuggestionDto[];
} | null> {
  const [row] = await db
    .select()
    .from(imports)
    .where(and(eq(imports.id, importId), eq(imports.userId, userId)))
    .limit(1);
  if (!row) return null;

  const suggestionRows = await db
    .select()
    .from(detectionSuggestions)
    .where(
      and(
        eq(detectionSuggestions.userId, userId),
        eq(detectionSuggestions.importId, importId),
      ),
    )
    .orderBy(desc(detectionSuggestions.confidence))
    .limit(200);

  return {
    import: toImportDto(row),
    suggestions: suggestionRows.map((entry) => toSuggestionDto(entry, sourceFor(row))),
  };
}

export async function deleteImport(
  db: Database,
  userId: string,
  importId: string,
): Promise<boolean> {
  const [existing] = await db
    .select({ id: imports.id })
    .from(imports)
    .where(and(eq(imports.id, importId), eq(imports.userId, userId)))
    .limit(1);
  if (!existing) return false;
  await db.delete(imports).where(eq(imports.id, importId));
  return true;
}

export interface DetectionListFilters {
  status?: "pending" | "accepted" | "rejected" | "all";
  includeBlocked?: boolean;
  limit?: number;
}

export async function listDetectionSuggestions(
  db: Database,
  userId: string,
  filters: DetectionListFilters = {},
): Promise<SuggestionDto[]> {
  const status = filters.status ?? "pending";
  const limit = Math.min(200, Math.max(1, filters.limit ?? 50));

  const rows = await db
    .select({
      suggestion: detectionSuggestions,
      importId: suggestionSourceColumns.id,
      source: suggestionSourceColumns.source,
      metadata: suggestionSourceColumns.metadata,
      subject: suggestionSourceColumns.subject,
      fromAddress: suggestionSourceColumns.fromAddress,
      sourceCreatedAt: suggestionSourceColumns.createdAt,
    })
    .from(detectionSuggestions)
    .leftJoin(imports, eq(imports.id, detectionSuggestions.importId))
    .where(
      and(
        eq(detectionSuggestions.userId, userId),
        status === "all" ? undefined : eq(detectionSuggestions.status, status),
      ),
    )
    .orderBy(desc(detectionSuggestions.confidence), desc(detectionSuggestions.createdAt))
    .limit(status === "pending" ? 200 : limit);

  const mapped = rows.map((row) =>
    toSuggestionDto(
      row.suggestion,
      row.importId
        ? {
            id: row.importId,
            source: displayImportSource(row.source ?? "paste", row.metadata),
            subject: row.subject,
            fromAddress: row.fromAddress,
            createdAt: row.sourceCreatedAt ?? row.suggestion.createdAt,
          }
        : null,
    ),
  );

  return mapped
    .filter((entry) => filters.includeBlocked === false ? entry.actionable : true)
    .slice(0, limit);
}

export async function getDetectionSummary(
  db: Database,
  userId: string,
): Promise<{
  pending: number;
  ready: number;
  needsDetails: number;
  blocked: number;
  latest: SuggestionDto[];
}> {
  const rows = await db
    .select({ suggestion: detectionSuggestions })
    .from(detectionSuggestions)
    .where(
      and(
        eq(detectionSuggestions.userId, userId),
        eq(detectionSuggestions.status, "pending"),
      ),
    )
    .orderBy(desc(detectionSuggestions.confidence), desc(detectionSuggestions.createdAt))
    .limit(300);

  const mapped = rows.map((row) => toSuggestionDto(row.suggestion));
  const actionable = mapped.filter((entry) => entry.actionable);
  return {
    pending: actionable.length,
    ready: actionable.filter((entry) => entry.eligible).length,
    needsDetails: actionable.filter((entry) => !entry.eligible).length,
    blocked: mapped.length - actionable.length,
    latest: actionable.slice(0, 5),
  };
}

export async function getOwnedSuggestion(
  db: Database,
  userId: string,
  suggestionId: string,
): Promise<DetectionSuggestion | null> {
  const [row] = await db
    .select()
    .from(detectionSuggestions)
    .where(
      and(
        eq(detectionSuggestions.id, suggestionId),
        eq(detectionSuggestions.userId, userId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getDetectionSuggestion(
  db: Database,
  userId: string,
  suggestionId: string,
): Promise<SuggestionDto | null> {
  const row = await getOwnedSuggestion(db, userId, suggestionId);
  if (!row) return null;
  let source = null;
  if (row.importId) {
    const [importRow] = await db
      .select(suggestionSourceColumns)
      .from(imports)
      .where(eq(imports.id, row.importId))
      .limit(1);
    if (importRow) source = importRow;
  }
  return toSuggestionDto(row, source);
}

/* ------------------------------- accept/reject ------------------------------ */

export interface DetectionOverrides {
  name?: string;
  vendor?: string | null;
  kind?: Exclude<RecordKind, "prepaid" | "installment">;
  amountMinor?: number;
  currency?: string;
  cycle?: BillingCycle;
  customIntervalDays?: number | null;
  anchorDate?: string;
  trialEndsAt?: string | null;
  categoryId?: string | null;
  paymentMethodId?: string | null;
  url?: string | null;
  notes?: string | null;
  reminderOffsets?: number[] | null;
  reminderChannels?: Array<"email" | "push" | "in_app"> | null;
}

/**
 * Pure mapping from a suggestion to a subscription payload. It never invents a
 * date: a missing renewal or trial end is an error the review screen must fix.
 */
export function suggestionToSubscriptionInput(
  draft: SuggestionPayload,
  overrides: DetectionOverrides = {},
): SubscriptionInput {
  const blocked = blockedReason(draft);
  if (blocked) throw badRequest(blocked);

  const kind: RecordKind | null =
    overrides.kind ?? (draft.kind === "payment" ? null : draft.kind);
  if (!kind) {
    throw badRequest("Choose whether to track this as a bill, subscription, or trial.");
  }
  if (kind !== "subscription" && kind !== "bill" && kind !== "trial") {
    throw badRequest("Only bills, subscriptions, and trials can be tracked.");
  }

  const name = (overrides.name ?? draft.merchant ?? "").trim();
  if (!name) throw badRequest("Add a name for this item.");

  const amountMinor = overrides.amountMinor ?? draft.amountMinor;
  if (amountMinor === null || amountMinor === undefined) {
    throw badRequest("Add the amount that will be charged.");
  }
  if (amountMinor === 0 && kind !== "trial") {
    throw badRequest("A zero-value charge cannot be tracked. Dismiss it instead.");
  }

  let anchorDate: string;
  let trialEndsAt: string | null = null;
  if (kind === "trial") {
    trialEndsAt = overrides.trialEndsAt ?? draft.trialEndsAt;
    if (!trialEndsAt) throw badRequest("Add the date this trial ends.");
    anchorDate = trialEndsAt;
  } else {
    const candidate = overrides.anchorDate ?? draft.renewalDate;
    if (!candidate) {
      throw badRequest("Add the next renewal date so DueRadar can remind you.");
    }
    anchorDate = candidate;
  }

  const chosenCycle = overrides.cycle ?? draft.cycle;
  if (!chosenCycle && kind !== "trial") {
    throw badRequest("Choose how often this repeats.");
  }
  const cycle = chosenCycle ?? "monthly";
  const customIntervalDays =
    overrides.customIntervalDays !== undefined
      ? overrides.customIntervalDays
      : draft.customIntervalDays;
  if (cycle === "custom_days" && !customIntervalDays) {
    throw badRequest("Choose how many days between payments.");
  }

  return {
    name,
    vendor: overrides.vendor !== undefined ? overrides.vendor : draft.vendor,
    kind,
    amountMinor,
    currency: overrides.currency ?? draft.currency,
    cycle,
    customIntervalDays:
      cycle === "custom_days" ? customIntervalDays ?? null : null,
    anchorDate,
    endOfMonthMode: false,
    trialEndsAt,
    categoryId: overrides.categoryId ?? null,
    paymentMethodId: overrides.paymentMethodId ?? null,
    url: overrides.url ?? null,
    notes: overrides.notes ?? null,
    reminderOffsets: overrides.reminderOffsets ?? null,
    reminderChannels: overrides.reminderChannels ?? null,
  };
}

function paymentDate(date: string): Date {
  return new Date(`${date}T12:00:00.000Z`);
}

function isDateValue(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Stores confirmed history behind an accepted suggestion. The newest 24 charges
 * are enough to explain a pattern without copying an entire statement.
 */
export async function recordSuggestionPayments(
  db: Database,
  userId: string,
  draft: SuggestionPayload,
  subscriptionId: string,
  source: "import" | "detection",
): Promise<number> {
  const transactions: RecurringTransaction[] = (
    draft.transactions ?? [
      {
        merchant: draft.merchant ?? "Imported charge",
        amountMinor: draft.amountMinor ?? 0,
        currency: draft.currency,
        occurredAt: draft.occurredAt ?? "",
        type: draft.transactionType,
        reference: draft.reference,
      },
    ]
  )
    .filter(
      (entry) =>
        entry.type === "payment" &&
        entry.amountMinor > 0 &&
        isDateValue(entry.occurredAt),
    )
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
    .slice(-PAYMENT_HISTORY_LIMIT);

  if (transactions.length === 0) return 0;

  const dates = transactions.map((entry) => entry.occurredAt).sort();
  const earliest = dates[0];
  const latest = dates[dates.length - 1];
  if (!earliest || !latest) return 0;

  const existing = await db
    .select({
      amountMinor: payments.amountMinor,
      currency: payments.currency,
      paidAt: payments.paidAt,
      reference: payments.reference,
      description: payments.description,
    })
    .from(payments)
    .where(
      and(
        eq(payments.userId, userId),
        gte(payments.paidAt, new Date(`${earliest}T00:00:00.000Z`)),
        lte(payments.paidAt, new Date(`${latest}T23:59:59.999Z`)),
      ),
    );

  let inserted = 0;
  for (const entry of transactions) {
    const duplicate = existing.some((payment) => {
      const sameReference =
        entry.reference &&
        payment.reference &&
        entry.reference.toLowerCase() === payment.reference.toLowerCase();
      if (sameReference) return true;
      return (
        payment.amountMinor === entry.amountMinor &&
        payment.currency.toUpperCase() === entry.currency.toUpperCase() &&
        payment.paidAt.toISOString().slice(0, 10) === entry.occurredAt &&
        sameMerchant(payment.description ?? "", entry.merchant)
      );
    });
    if (duplicate) continue;

    await db.insert(payments).values({
      userId,
      subscriptionId,
      occurrenceId: null,
      amountMinor: entry.amountMinor,
      currency: entry.currency.toUpperCase(),
      paidAt: paymentDate(entry.occurredAt),
      method: draft.paymentRail === "unknown" ? null : draft.paymentRail,
      reference: entry.reference ?? null,
      source,
      description: entry.merchant,
      notes: source === "import" ? "Imported from CSV" : "Detected from a message",
    });
    inserted += 1;
  }
  return inserted;
}

export async function acceptSuggestion(
  db: Database,
  userId: string,
  suggestionId: string,
  overrides: DetectionOverrides,
  timeZone: string,
  autoTrack = false,
): Promise<{
  suggestion: SuggestionDto;
  subscriptionId: string;
  recordedPayments: number;
}> {
  const existing = await getOwnedSuggestion(db, userId, suggestionId);
  if (!existing) throw notFound("Suggestion not found.");
  if (existing.status === "accepted") {
    if (existing.acceptedSubscriptionId) {
      return {
        suggestion: toSuggestionDto(existing),
        subscriptionId: existing.acceptedSubscriptionId,
        recordedPayments: 0,
      };
    }
    throw conflict("This suggestion is already being saved.");
  }
  if (existing.status === "rejected") {
    throw conflict("This suggestion was dismissed. Import the message again to review it.");
  }

  const draft = draftPayload(existing);
  const input = suggestionToSubscriptionInput(draft, overrides);
  const source = draft.transactions ? "import" : "detection";
  const acceptedPayload: SuggestionPayload = {
    ...draft,
    autoTracked: autoTrack,
  };

  const accepted = await db.transaction(async (tx) => {
    await lockPlanForUser(tx, userId);
    await enforceActiveItemLimit(tx, userId);
    const [claimed] = await tx
      .update(detectionSuggestions)
      .set({
        status: "accepted",
        resolvedAt: new Date(),
        payload: acceptedPayload as unknown as Record<string, unknown>,
      })
      .where(
        and(
          eq(detectionSuggestions.id, suggestionId),
          eq(detectionSuggestions.userId, userId),
          eq(detectionSuggestions.status, "pending"),
        ),
      )
      .returning();
    if (!claimed) throw conflict("This suggestion is already being reviewed.");

    const created = await createSubscription(tx, userId, input, timeZone);
    const [updated] = await tx
      .update(detectionSuggestions)
      .set({ acceptedSubscriptionId: created.id })
      .where(eq(detectionSuggestions.id, suggestionId))
      .returning();
    if (!updated) throw new Error("Failed to link accepted suggestion to subscription");

    return { subscriptionId: created.id, suggestion: toSuggestionDto(updated) };
  });

  let recordedPayments = 0;
  try {
    recordedPayments = await recordSuggestionPayments(
      db,
      userId,
      draft,
      accepted.subscriptionId,
      source,
    );
  } catch (error) {
    // The subscription and reminders are more important than history. Do not
    // roll back a completed save because an optional payment row failed.
    console.error(
      "[detection] payment history import failed:",
      error instanceof Error ? error.message : "unknown error",
    );
  }

  return {
    suggestion: accepted.suggestion,
    subscriptionId: accepted.subscriptionId,
    recordedPayments,
  };
}

export async function undoAutoTrackedSuggestion(
  db: Database,
  userId: string,
  suggestionId: string,
): Promise<SuggestionDto> {
  const existing = await getOwnedSuggestion(db, userId, suggestionId);
  if (!existing) throw notFound("Suggestion not found.");
  const payload = draftPayload(existing);
  const subscriptionId = existing.acceptedSubscriptionId;
  if (
    existing.status !== "accepted" ||
    payload.autoTracked !== true ||
    !subscriptionId
  ) {
    throw conflict("Only automatically tracked items can be undone here.");
  }

  return db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(detectionSuggestions)
      .set({
        status: "pending",
        acceptedSubscriptionId: null,
        resolvedAt: null,
        payload: {
          ...payload,
          autoTracked: false,
          autoTrackIgnored: true,
        } as unknown as Record<string, unknown>,
      })
      .where(
        and(
          eq(detectionSuggestions.id, suggestionId),
          eq(detectionSuggestions.userId, userId),
          eq(detectionSuggestions.status, "accepted"),
          eq(detectionSuggestions.acceptedSubscriptionId, subscriptionId),
        ),
      )
      .returning();
    if (!claimed) throw conflict("This automatic track was already changed.");

    await cancelSubscriptionReminders(tx, subscriptionId);
    const [deleted] = await tx
      .delete(subscriptions)
      .where(
        and(
          eq(subscriptions.id, subscriptionId),
          eq(subscriptions.userId, userId),
        ),
      )
      .returning({ id: subscriptions.id });
    if (!deleted) throw notFound("Tracked item not found.");

    return toSuggestionDto(claimed);
  });
}

export async function rejectSuggestion(
  db: Database,
  userId: string,
  suggestionId: string,
  _reason?: string | null,
): Promise<SuggestionDto> {
  const existing = await getOwnedSuggestion(db, userId, suggestionId);
  if (!existing) throw notFound("Suggestion not found.");
  if (existing.status === "accepted") {
    throw conflict("This suggestion was already saved. Delete the record if it was a mistake.");
  }
  if (existing.status === "rejected") return toSuggestionDto(existing);

  const [updated] = await db
    .update(detectionSuggestions)
    .set({ status: "rejected", resolvedAt: new Date() })
    .where(
      and(
        eq(detectionSuggestions.id, suggestionId),
        eq(detectionSuggestions.userId, userId),
        eq(detectionSuggestions.status, "pending"),
      ),
    )
    .returning();
  return toSuggestionDto(updated ?? existing);
}

export async function rejectSuggestions(
  db: Database,
  userId: string,
  ids?: string[],
): Promise<number> {
  const rows = await db
    .update(detectionSuggestions)
    .set({ status: "rejected", resolvedAt: new Date() })
    .where(
      and(
        eq(detectionSuggestions.userId, userId),
        eq(detectionSuggestions.status, "pending"),
        ids && ids.length > 0 ? inArray(detectionSuggestions.id, ids) : undefined,
      ),
    )
    .returning({ id: detectionSuggestions.id });
  return rows.length;
}
