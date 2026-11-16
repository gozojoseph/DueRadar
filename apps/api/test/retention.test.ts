import { describe, expect, it } from "vitest";
import { retentionCutoffs } from "@dueradar/scheduling";

const DAY_MS = 86_400_000;

describe("retentionCutoffs", () => {
  const now = new Date("2026-11-16T12:00:00.000Z");

  it("keeps webhook dedupe records for 30 days", () => {
    expect(retentionCutoffs(now).webhookAt.toISOString()).toBe(
      new Date(now.getTime() - 30 * DAY_MS).toISOString(),
    );
  });

  it("keeps delivery attempts for 12 months", () => {
    expect(retentionCutoffs(now).deliveryAttemptAt.toISOString()).toBe(
      new Date(now.getTime() - 365 * DAY_MS).toISOString(),
    );
  });

  it("keeps audit events, including account deletion rows, for 12 months", () => {
    expect(retentionCutoffs(now).auditAt.toISOString()).toBe(
      new Date(now.getTime() - 365 * DAY_MS).toISOString(),
    );
  });
});
