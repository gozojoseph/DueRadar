import { describe, expect, it } from "vitest";
import {
  addDaysToDate,
  addMonthsClamped,
  applyQuietHours,
  daysBetween,
  zonedWallTimeToUtc,
  dateInTimeZone,
} from "../src/dates.js";
import { generateOccurrences, occurrenceDate, recurrenceIndexFor } from "../src/recurrence.js";
import { formatMoney, parseMoneyInput, sumByCurrency } from "../src/money.js";
import { planReminders } from "../src/reminders.js";

describe("calendar date math", () => {
  it("adds days across month and year boundaries", () => {
    expect(addDaysToDate("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDaysToDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToDate("2028-02-28", 1)).toBe("2028-02-29");
    expect(daysBetween("2026-01-01", "2026-03-01")).toBe(59);
  });

  it("clamps month addition without losing the anchor day", () => {
    expect(addMonthsClamped("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsClamped("2026-01-31", 2)).toBe("2026-03-31");
    expect(addMonthsClamped("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonthsClamped("2026-08-31", 6)).toBe("2027-02-28");
  });
});

describe("recurrence", () => {
  const monthly = {
    anchorDate: "2026-01-31",
    cycle: "monthly" as const,
    endOfMonthMode: false,
  };

  it("preserves the anchor day across short months", () => {
    expect(occurrenceDate(monthly, 0)).toBe("2026-01-31");
    expect(occurrenceDate(monthly, 1)).toBe("2026-02-28");
    expect(occurrenceDate(monthly, 2)).toBe("2026-03-31");
    expect(occurrenceDate(monthly, 3)).toBe("2026-04-30");
    expect(occurrenceDate(monthly, 4)).toBe("2026-05-31");
  });

  it("supports explicit end-of-month mode", () => {
    const eom = { anchorDate: "2026-01-30", cycle: "monthly" as const, endOfMonthMode: true };
    expect(occurrenceDate(eom, 1)).toBe("2026-02-28");
    expect(occurrenceDate(eom, 2)).toBe("2026-03-31");
    expect(occurrenceDate(eom, 3)).toBe("2026-04-30");
  });

  it("handles leap-day annual renewals", () => {
    const annual = { anchorDate: "2024-02-29", cycle: "annual" as const };
    expect(occurrenceDate(annual, 1)).toBe("2025-02-28");
    expect(occurrenceDate(annual, 2)).toBe("2026-02-28");
    expect(occurrenceDate(annual, 4)).toBe("2028-02-29");
  });

  it("handles weekly and custom intervals", () => {
    const weekly = { anchorDate: "2026-11-02", cycle: "weekly" as const };
    expect(occurrenceDate(weekly, 3)).toBe("2026-11-23");
    const custom = {
      anchorDate: "2026-11-02",
      cycle: "custom_days" as const,
      customIntervalDays: 10,
    };
    expect(occurrenceDate(custom, 3)).toBe("2026-12-02");
  });

  it("builds periods and a bounded horizon", () => {
    const rows = generateOccurrences(monthly, "2026-04-30");
    expect(rows.map((row) => row.dueDate)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
    expect(rows[0]?.periodEnd).toBe("2026-02-27");
    expect(rows.at(-1)?.periodEnd).toBe("2026-05-30");
  });

  it("finds the next occurrence without drift after paid dates", () => {
    const pauseAnchor = { anchorDate: "2026-01-15", cycle: "monthly" as const };
    expect(recurrenceIndexFor(pauseAnchor, "2026-03-01")).toBe(2);
    expect(occurrenceDate(pauseAnchor, 2)).toBe("2026-03-15");
  });
});

describe("time zones and quiet hours", () => {
  it("converts Accra wall time to UTC (GMT, no DST)", () => {
    expect(zonedWallTimeToUtc("2026-06-01", "09:00", "Africa/Accra").toISOString()).toBe(
      "2026-06-01T09:00:00.000Z",
    );
    expect(dateInTimeZone(new Date("2026-06-01T23:30:00Z"), "Africa/Accra")).toBe("2026-06-01");
  });

  it("converts across a DST boundary", () => {
    const before = zonedWallTimeToUtc("2026-03-07", "09:00", "America/New_York");
    const after = zonedWallTimeToUtc("2026-03-08", "09:00", "America/New_York");
    expect(before.toISOString()).toBe("2026-03-07T14:00:00.000Z");
    expect(after.toISOString()).toBe("2026-03-08T13:00:00.000Z");
  });

  it("moves overnight quiet-hour sends to the morning", () => {
    const fire = zonedWallTimeToUtc("2026-11-14", "22:30", "Africa/Accra");
    const result = applyQuietHours(fire, "21:00", "07:00", "2026-11-15", "Africa/Accra");
    expect(result.shifted).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.fireAt.toISOString()).toBe("2026-11-15T07:00:00.000Z");
  });

  it("skips a same-day reminder pushed past the deadline", () => {
    const fire = zonedWallTimeToUtc("2026-11-15", "22:30", "Africa/Accra");
    const result = applyQuietHours(fire, "21:00", "07:00", "2026-11-15", "Africa/Accra");
    expect(result.skipped).toBe(true);
  });
});

describe("reminder planning", () => {
  const profile = {
    timeZone: "Africa/Accra",
    reminderTime: "09:00",
    quietHoursStart: "21:00",
    quietHoursEnd: "07:00",
  };

  it("plans channel-specific jobs at 09:00 local", () => {
    const plans = planReminders({
      occurrenceId: "occ-1",
      dueDate: "2026-11-20",
      offsets: [3, 1],
      channels: ["email", "in_app"],
      profile,
      now: new Date("2026-11-15T08:00:00Z"),
    });
    expect(plans).toHaveLength(4);
    expect(plans.map((plan) => plan.fireAt.toISOString())).toEqual([
      "2026-11-17T09:00:00.000Z",
      "2026-11-17T09:00:00.000Z",
      "2026-11-19T09:00:00.000Z",
      "2026-11-19T09:00:00.000Z",
    ]);
    expect(new Set(plans.map((plan) => plan.dedupeKey)).size).toBe(4);
  });

  it("skips reminders for overdue occurrences", () => {
    const plans = planReminders({
      occurrenceId: "occ-2",
      dueDate: "2026-11-14",
      offsets: [1],
      channels: ["email"],
      profile,
      now: new Date("2026-11-15T08:00:00Z"),
    });
    expect(plans).toEqual([]);
  });

  it("catches up a same-day reminder only within the grace window", () => {
    const now = new Date("2026-11-19T12:00:00Z");
    const catchUp = planReminders({
      occurrenceId: "occ-3",
      dueDate: "2026-11-20",
      offsets: [1],
      channels: ["email"],
      profile,
      now,
    });
    expect(catchUp).toHaveLength(1);
    expect(catchUp[0]?.catchUp).toBe(true);
    expect(catchUp[0]?.fireAt.getTime()).toBe(now.getTime() + 60_000);

    const tooLate = planReminders({
      occurrenceId: "occ-4",
      dueDate: "2026-11-20",
      offsets: [1],
      channels: ["email"],
      profile,
      now: new Date("2026-11-20T09:00:00Z"),
      catchUpHours: 20,
    });
    expect(tooLate).toEqual([]);
  });
});

describe("money", () => {
  it("formats GHS with two minor digits", () => {
    expect(formatMoney(123_450, "GHS", "en-GH")).toContain("1,234.50");
    expect(formatMoney(123_450, "GHS", "en-GH")).toContain("GH");
  });

  it("parses Ghanaian and international amount formats", () => {
    expect(parseMoneyInput("1,234.56", "GHS")).toBe(123_456);
    expect(parseMoneyInput("GH₵ 1 234,56", "GHS")).toBe(123_456);
    expect(parseMoneyInput("99", "GHS")).toBe(9_900);
    expect(parseMoneyInput("1,234", "GHS")).toBe(123_400);
    expect(parseMoneyInput("abc", "GHS")).toBeNull();
  });

  it("keeps currencies separate in totals", () => {
    expect(
      sumByCurrency([
        { amountMinor: 1000, currency: "GHS" },
        { amountMinor: 2500, currency: "USD" },
        { amountMinor: 500, currency: "GHS" },
      ]),
    ).toEqual([
      { currency: "GHS", amountMinor: 1500 },
      { currency: "USD", amountMinor: 2500 },
    ]);
  });
});
