import { z } from "zod";
import {
  BILLING_CYCLES,
  isDateString,
  isSupportedCurrency,
  normalizeCurrency,
} from "@dueradar/domain";
import {
  blockedReason,
  redactImportText,
  type SuggestionPayload,
} from "./detection.js";
import type {
  DetectionDraft,
  DetectionEvidence,
  DetectionKind,
  DetectionWarning,
} from "@dueradar/detection";
import type { Env } from "../env.js";
import { llmDetectionEnabled } from "../env.js";

const MAX_PROMPT_CHARS = 4000;
const MAX_RESPONSE_BYTES = 200_000;

const LlmResultSchema = z
  .object({
    kind: z.enum(["subscription", "bill", "trial", "payment"]).nullable(),
    merchant: z.string().trim().max(120).nullable(),
    amountMinor: z.number().int().min(0).max(1_000_000_000_000).nullable(),
    currency: z.string().trim().length(3).nullable(),
    occurredAt: z.string().trim().nullable(),
    trialEndsAt: z.string().trim().nullable(),
    firstChargeAt: z.string().trim().nullable(),
    renewalDate: z.string().trim().nullable(),
    cycle: z.enum(BILLING_CYCLES).nullable(),
    customIntervalDays: z.number().int().min(1).max(366).nullable(),
    transactionType: z
      .enum(["payment", "card_check", "refund", "declined", "transfer", "incoming", "unknown"])
      .nullable(),
    reference: z.string().trim().max(60).nullable(),
    confidence: z.number().int().min(0).max(100),
  })
  .strict();

type LlmResult = z.infer<typeof LlmResultSchema>;

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "kind",
    "merchant",
    "amountMinor",
    "currency",
    "occurredAt",
    "trialEndsAt",
    "firstChargeAt",
    "renewalDate",
    "cycle",
    "customIntervalDays",
    "transactionType",
    "reference",
    "confidence",
  ],
  properties: {
    kind: {
      type: ["string", "null"],
      enum: ["subscription", "bill", "trial", "payment", null],
    },
    merchant: { type: ["string", "null"] },
    amountMinor: { type: ["integer", "null"], minimum: 0 },
    currency: { type: ["string", "null"] },
    occurredAt: { type: ["string", "null"] },
    trialEndsAt: { type: ["string", "null"] },
    firstChargeAt: { type: ["string", "null"] },
    renewalDate: { type: ["string", "null"] },
    cycle: {
      type: ["string", "null"],
      enum: [...BILLING_CYCLES, null],
    },
    customIntervalDays: { type: ["integer", "null"], minimum: 1, maximum: 366 },
    transactionType: {
      type: ["string", "null"],
      enum: [
        "payment",
        "card_check",
        "refund",
        "declined",
        "transfer",
        "incoming",
        "unknown",
        null,
      ],
    },
    reference: { type: ["string", "null"] },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
  },
} as const;

const SYSTEM_PROMPT = [
  "You extract billing details from a redacted receipt, SMS, or email for a subscription tracker.",
  "Rules:",
  "- Only describe a successful payment as payment. Refunds, reversals, declines, card checks, wallet transfers, and incoming funds must keep their own transactionType.",
  "- Never invent a date, amount, currency, merchant, or billing cycle. Use null when the text does not state it.",
  "- Dates must be YYYY-MM-DD. A trial end and the first paid charge are separate dates.",
  "- A single purchase is kind payment unless the text states a renewal, subscription, or trial.",
  "- amountMinor is an integer in the currency's smallest unit (GHS 39.00 is 3900).",
  "- Return only the JSON object, no commentary.",
].join("\n");

function needsHelp(draft: DetectionDraft): boolean {
  if (blockedReason(draft)) return false;
  return (
    draft.confidence < 65 ||
    !draft.merchant ||
    draft.amountMinor === null ||
    (draft.kind === "trial" && !draft.trialEndsAt) ||
    ((draft.kind === "subscription" || draft.kind === "bill") && !draft.renewalDate)
  );
}

function validDate(value: string | null): string | null {
  if (!value) return null;
  return isDateString(value) ? value : null;
}

function resolvedWarnings(draft: DetectionDraft, result: LlmResult): DetectionWarning[] {
  const resolved = new Set<string>();
  if (result.merchant) resolved.add("merchant_missing");
  if (result.amountMinor !== null) resolved.add("amount_missing");
  if (result.occurredAt) resolved.add("date_missing");
  if (result.renewalDate) resolved.add("renewal_date_missing");
  if (result.trialEndsAt) resolved.add("trial_end_missing");
  if (result.firstChargeAt) resolved.add("first_charge_missing");
  return draft.warnings.filter((warning) => !resolved.has(warning.code));
}

/**
 * Applies only the fields the deterministic parser left empty. A provider's
 * stated payment type is never downgraded, and no date is copied unless it is a
 * real calendar date.
 */
export function mergeLlmResult(
  draft: DetectionDraft,
  result: LlmResult,
): DetectionDraft {
  const merchant = draft.merchant ?? result.merchant;
  const currency =
    result.currency && isSupportedCurrency(result.currency)
      ? normalizeCurrency(result.currency)
      : draft.currency;
  const amountMinor = draft.amountMinor ?? result.amountMinor;
  const occurredAt = draft.occurredAt ?? validDate(result.occurredAt);
  const trialEndsAt = draft.trialEndsAt ?? validDate(result.trialEndsAt);
  const firstChargeAt = draft.firstChargeAt ?? validDate(result.firstChargeAt);
  const renewalDate = draft.renewalDate ?? validDate(result.renewalDate);
  const cycle = draft.cycle ?? result.cycle;
  const customIntervalDays =
    draft.customIntervalDays ?? (cycle === "custom_days" ? result.customIntervalDays : null);
  const transactionType =
    draft.transactionType === "unknown" && result.transactionType
      ? result.transactionType
      : draft.transactionType;
  const reference = draft.reference ?? result.reference;
  const kind: DetectionKind =
    draft.kind === "payment" &&
    result.kind &&
    result.kind !== "payment" &&
    transactionType === "payment"
      ? result.kind
      : draft.kind;

  const destination =
    kind === "trial" ? trialEndsAt : kind === "subscription" || kind === "bill" ? renewalDate : null;
  const zeroBlocked = amountMinor === 0 && kind !== "trial";
  const blocked = transactionType !== "payment" || zeroBlocked;
  const eligible = !blocked && Boolean(merchant) && (kind === "trial" ? Boolean(trialEndsAt) : kind === "payment" ? false : Boolean(destination) && amountMinor !== null);

  const changed =
    merchant !== draft.merchant ||
    amountMinor !== draft.amountMinor ||
    occurredAt !== draft.occurredAt ||
    trialEndsAt !== draft.trialEndsAt ||
    renewalDate !== draft.renewalDate ||
    firstChargeAt !== draft.firstChargeAt ||
    cycle !== draft.cycle ||
    transactionType !== draft.transactionType ||
    kind !== draft.kind;

  const evidence: DetectionEvidence[] = changed
    ? [
        {
          field: "AI extraction",
          text: "Optional AI fallback reviewed the redacted text. Confirm every field.",
          origin: "estimate",
        },
      ]
    : [];

  return {
    ...draft,
    kind,
    merchant,
    vendor: draft.vendor ?? merchant,
    amountMinor,
    currency,
    occurredAt,
    trialEndsAt,
    firstChargeAt,
    renewalDate,
    cycle,
    customIntervalDays,
    transactionType,
    reference,
    confidence: Math.min(85, Math.max(draft.confidence, result.confidence)),
    eligible,
    warnings: [
      ...resolvedWarnings(draft, result),
      ...(changed
        ? [
            {
              code: "llm_assisted" as const,
              message: "Some fields were suggested by the optional AI fallback. Check them.",
            },
          ]
        : []),
    ],
    evidence: [...draft.evidence, ...evidence].slice(0, 10),
  };
}

async function requestCompletion(
  env: Env,
  text: string,
): Promise<LlmResult | null> {
  if (!env.DETECTION_LLM_URL || !env.DETECTION_LLM_API_KEY || !env.DETECTION_LLM_MODEL) {
    return null;
  }
  const response = await fetch(env.DETECTION_LLM_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.DETECTION_LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.DETECTION_LLM_MODEL,
      temperature: 0,
      max_tokens: 500,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `REDACTED SOURCE TEXT:\n${text}` },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "due_radar_detection",
          strict: true,
          schema: RESPONSE_SCHEMA,
        },
      },
    }),
    signal: AbortSignal.timeout(env.DETECTION_LLM_TIMEOUT_MS),
  });

  if (!response.ok) return null;
  const raw = await response.text();
  if (raw.length > MAX_RESPONSE_BYTES) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }

  const content = (payload as { choices?: Array<{ message?: { content?: unknown } }> })
    .choices?.[0]?.message?.content;
  if (typeof content !== "string") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  const result = LlmResultSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

export type DraftEnhancer = (
  draft: SuggestionPayload,
  text: string,
) => Promise<DetectionDraft>;

/**
 * Builds the optional redacted fallback. Failures are silent and temporary:
 * after three consecutive errors the fallback pauses for five minutes so a
 * provider outage cannot slow every import.
 */
export function createLlmEnhancer(env: Env): DraftEnhancer | null {
  if (!llmDetectionEnabled(env)) return null;

  let failures = 0;
  let pausedUntil = 0;

  return async (draft, text) => {
    if (Date.now() < pausedUntil) return draft;
    if (!needsHelp(draft)) return draft;

    try {
      const result = await requestCompletion(env, redactImportText(text).slice(0, MAX_PROMPT_CHARS));
      failures = 0;
      return result ? mergeLlmResult(draft, result) : draft;
    } catch {
      failures += 1;
      if (failures >= 3) {
        failures = 0;
        pausedUntil = Date.now() + 5 * 60_000;
      }
      return draft;
    }
  };
}
