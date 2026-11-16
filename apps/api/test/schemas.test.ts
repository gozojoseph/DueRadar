import { describe, expect, it } from "vitest";
import {
  accountDeleteSchema,
  dateString,
  deviceInputSchema,
  paymentMethodInputSchema,
  profileUpdateSchema,
  subscriptionInputSchema,
  subscriptionUpdateSchema,
  timeOfDay,
} from "../src/schemas.js";

const baseSubscription = {
  name: "Netflix",
  kind: "subscription",
  amountMinor: 6_500,
  currency: "ghs",
  anchorDate: "2026-12-01",
};

describe("subscriptionInputSchema", () => {
  it("normalises the currency and applies schedule defaults", () => {
    const parsed = subscriptionInputSchema.parse(baseSubscription);

    expect(parsed.currency).toBe("GHS");
    expect(parsed.cycle).toBe("monthly");
    expect(parsed.endOfMonthMode).toBe(false);
    expect(parsed.name).toBe("Netflix");
  });

  it("accepts a real leap day and rejects an impossible date", () => {
    expect(dateString.safeParse("2028-02-29").success).toBe(true);
    expect(dateString.safeParse("2026-02-30").success).toBe(false);
    expect(dateString.safeParse("01-12-2026").success).toBe(false);
  });

  it("requires the interval when the cycle is custom days", () => {
    const result = subscriptionInputSchema.safeParse({
      ...baseSubscription,
      cycle: "custom_days",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join("."))).toContain(
        "customIntervalDays",
      );
    }
  });

  it("requires an end date for a free trial", () => {
    const result = subscriptionInputSchema.safeParse({
      ...baseSubscription,
      kind: "trial",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join("."))).toContain("trialEndsAt");
    }
  });

  it("accepts a trial with its end date", () => {
    const parsed = subscriptionInputSchema.parse({
      ...baseSubscription,
      kind: "trial",
      trialEndsAt: "2026-12-15",
    });

    expect(parsed.trialEndsAt).toBe("2026-12-15");
  });

  it("rejects unknown fields so clients cannot smuggle ownership columns", () => {
    const result = subscriptionInputSchema.safeParse({
      ...baseSubscription,
      userId: "00000000-0000-4000-8000-000000000000",
    });

    expect(result.success).toBe(false);
  });

  it("rejects an empty reminder channel list and too many offsets", () => {
    expect(
      subscriptionInputSchema.safeParse({ ...baseSubscription, reminderChannels: [] }).success,
    ).toBe(false);
    expect(
      subscriptionInputSchema.safeParse({
        ...baseSubscription,
        reminderOffsets: [1, 2, 3, 4, 5, 6, 7],
      }).success,
    ).toBe(false);
  });

  it("rejects an unsupported currency length", () => {
    expect(
      subscriptionInputSchema.safeParse({ ...baseSubscription, currency: "GB" }).success,
    ).toBe(false);
  });
});

describe("subscriptionUpdateSchema", () => {
  it("accepts an unrelated partial update without demanding schedule fields", () => {
    expect(subscriptionUpdateSchema.safeParse({ notes: "Renewed on the 3rd" }).success).toBe(true);
  });

  it("still enforces the custom interval when the cycle is changed", () => {
    expect(subscriptionUpdateSchema.safeParse({ cycle: "custom_days" }).success).toBe(false);
    expect(
      subscriptionUpdateSchema.safeParse({ cycle: "custom_days", customIntervalDays: 14 }).success,
    ).toBe(true);
  });

  it("still requires an end date when switching to a trial", () => {
    expect(subscriptionUpdateSchema.safeParse({ kind: "trial" }).success).toBe(false);
    expect(
      subscriptionUpdateSchema.safeParse({ kind: "trial", trialEndsAt: "2026-12-15" }).success,
    ).toBe(true);
  });
});

describe("profileUpdateSchema", () => {
  it("accepts a valid Ghana profile", () => {
    const parsed = profileUpdateSchema.parse({
      timezone: "Africa/Accra",
      currency: "ghs",
      weekStartsOn: 1,
      reminderTime: "09:00",
      quietHoursStart: "21:00",
      quietHoursEnd: "07:00",
    });

    expect(parsed.currency).toBe("GHS");
  });

  it("rejects an unknown time zone", () => {
    expect(profileUpdateSchema.safeParse({ timezone: "Mars/Olympus" }).success).toBe(false);
  });

  it("rejects a time that looks right but is out of range", () => {
    expect(timeOfDay.safeParse("24:00").success).toBe(false);
    expect(timeOfDay.safeParse("9:00").success).toBe(false);
    expect(profileUpdateSchema.safeParse({ reminderTime: "25:30" }).success).toBe(false);
  });
});

describe("accountDeleteSchema", () => {
  it("requires the literal confirmation word", () => {
    expect(accountDeleteSchema.safeParse({ confirm: "DELETE" }).success).toBe(true);
    expect(accountDeleteSchema.safeParse({ confirm: "delete" }).success).toBe(false);
    expect(accountDeleteSchema.safeParse({ reason: "moving on" }).success).toBe(false);
  });

  it("keeps an optional reason bounded", () => {
    expect(accountDeleteSchema.safeParse({ confirm: "DELETE", reason: "x".repeat(501) }).success).toBe(
      false,
    );
  });
});

describe("paymentMethodInputSchema", () => {
  it("stores only a label and the last four digits", () => {
    const parsed = paymentMethodInputSchema.parse({
      label: "Visa ending 4242",
      kind: "card",
      last4: "4242",
    });

    expect(parsed.last4).toBe("4242");
  });

  it("rejects anything longer than a last-four fragment", () => {
    expect(
      paymentMethodInputSchema.safeParse({
        label: "Card",
        kind: "card",
        last4: "4242424242424242",
      }).success,
    ).toBe(false);
    expect(
      paymentMethodInputSchema.safeParse({ label: "Card", kind: "card", last4: "42a2" }).success,
    ).toBe(false);
  });
});

describe("deviceInputSchema", () => {
  it("requires an absolute push endpoint and real keys", () => {
    expect(
      deviceInputSchema.safeParse({
        endpoint: "https://fcm.googleapis.com/fcm/send/abc",
        keys: { p256dh: "x".repeat(20), auth: "y".repeat(10) },
      }).success,
    ).toBe(true);
    expect(
      deviceInputSchema.safeParse({
        endpoint: "not-a-url",
        keys: { p256dh: "x".repeat(20), auth: "y".repeat(10) },
      }).success,
    ).toBe(false);
    expect(
      deviceInputSchema.safeParse({ endpoint: "https://example.test/push", keys: { p256dh: "short" } })
        .success,
    ).toBe(false);
  });
});
