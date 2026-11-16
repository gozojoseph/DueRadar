import {
  addDaysToDate,
  addMonthsClamped,
  daysInMonth,
  makeDateString,
  todayInTimeZone,
} from "@dueradar/domain";
import { monthNumber } from "./text.js";

export interface DateMention {
  raw: string;
  index: number;
  /** Null when the numeric form is genuinely ambiguous (both parts ≤ 12). */
  date: string | null;
  alternative: string | null;
  ambiguous: boolean;
  /** Provider-stated text vs. a date calculated from a duration. */
  origin: "provider" | "estimate";
}

const MONTH_NAME =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

function valid(year: number, month: number, day: number): string | null {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (year < 1900 || year > 2200) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return makeDateString(year, month, day);
}

function expandYear(value: number): number {
  if (value >= 100) return value;
  return value >= 70 ? 1900 + value : 2000 + value;
}

function pushMention(
  mentions: DateMention[],
  raw: string,
  index: number,
  date: string | null,
  alternative: string | null,
  ambiguous: boolean,
  origin: "provider" | "estimate" = "provider",
) {
  if (mentions.some((mention) => mention.index === index && mention.raw === raw)) return;
  mentions.push({ raw, index, date, alternative, ambiguous, origin });
}

/**
 * Extracts absolute dates plus a small set of relative phrases. Numeric dates
 * with both parts ≤ 12 are ambiguous, so `date` stays null and the review
 * screen asks the user instead of guessing between DD/MM and MM/DD.
 */
export function findDateMentions(text: string, today?: string): DateMention[] {
  const mentions: DateMention[] = [];
  const base = today ?? todayInTimeZone("Africa/Accra");

  const iso = /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/g;
  for (const match of text.matchAll(iso)) {
    const date = valid(Number(match[1]), Number(match[2]), Number(match[3]));
    pushMention(mentions, match[0], match.index ?? 0, date, null, false);
  }

  const dayMonthName = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_NAME})[,.]?\\s+(\\d{2,4})\\b`,
    "gi",
  );
  for (const match of text.matchAll(dayMonthName)) {
    const month = monthNumber(match[2] ?? "");
    const date = month ? valid(expandYear(Number(match[3])), month, Number(match[1])) : null;
    pushMention(mentions, match[0], match.index ?? 0, date, null, false);
  }

  const monthNameDay = new RegExp(
    `\\b(${MONTH_NAME})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,)?\\s+(\\d{2,4})\\b`,
    "gi",
  );
  for (const match of text.matchAll(monthNameDay)) {
    const month = monthNumber(match[1] ?? "");
    const date = month ? valid(expandYear(Number(match[3])), month, Number(match[2])) : null;
    pushMention(mentions, match[0], match.index ?? 0, date, null, false);
  }

  const numeric = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/g;
  for (const match of text.matchAll(numeric)) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    const year = expandYear(Number(match[3]));
    if (first <= 12 && second <= 12 && first !== second) {
      const dayFirst = valid(year, second, first);
      const monthFirst = valid(year, first, second);
      pushMention(
        mentions,
        match[0],
        match.index ?? 0,
        dayFirst,
        monthFirst !== dayFirst ? monthFirst : null,
        true,
      );
      continue;
    }
    // The larger part is the day; Ghanaian alerts normally use DD/MM/YYYY.
    const date =
      first > 12 ? valid(year, second, first) : valid(year, first, second);
    pushMention(mentions, match[0], match.index ?? 0, date, null, false);
  }

  const relative = /\b(?:in|after)\s+(\d{1,3})\s*(day|days|week|weeks|month|months)\b/gi;
  for (const match of text.matchAll(relative)) {
    const count = Number(match[1]);
    const unit = (match[2] ?? "").toLowerCase();
    if (!Number.isFinite(count) || count <= 0 || count > 730) continue;
    const date = unit.startsWith("day")
      ? addDaysToDate(base, count)
      : unit.startsWith("week")
        ? addDaysToDate(base, count * 7)
        : addMonthsClamped(base, count);
    pushMention(mentions, match[0], match.index ?? 0, date, null, false, "estimate");
  }

  const tomorrow = /\btomorrow\b/gi;
  for (const match of text.matchAll(tomorrow)) {
    pushMention(mentions, match[0], match.index ?? 0, addDaysToDate(base, 1), null, false, "estimate");
  }

  return mentions.sort((a, b) => a.index - b.index);
}

export type DateRole = "trial_end" | "first_charge" | "renewal" | "payment" | "ambiguous";

const TRIAL_END = /(trial|free trial)[^.\n]{0,60}(end|ends|ending|expire|expires|expiry|conclude|lasts?)|(end|expiry|expires?)[^.\n]{0,30}(of\s+)?(your\s+)?(free\s+)?trial/i;
const FIRST_CHARGE =
  /first\s+(paid\s+)?(charge|payment|billing|bill)|first\s+time[^.\n]{0,40}(charged|billed)|will\s+be\s+charged\s+(on|after)|billing\s+(starts?|begins?)\s+(on|after)|charge(?:d)?\s+after\s+the\s+trial/i;
const RENEWAL =
  /renew|renewal|next\s+(payment|billing|charge|due|bill)|billing\s+(date|cycle)|due\s+(on|date)|expires?|expiry|valid\s+(until|through)|paid\s+until|auto(?:matic(?:ally)?)?[\s-]*(renew|charge)|subscription\s+(ends?|expires?)|plan\s+(ends?|expires?)/i;

/**
 * Classifies each date by the wording immediately around it. A date can serve
 * both as a trial end and a first-charge date when a message uses one deadline.
 */
export function classifyDates(
  text: string,
  mentions: DateMention[],
): Array<DateMention & { roles: DateRole[] }> {
  return mentions.map((mention) => {
    const before = text.slice(Math.max(0, mention.index - 110), mention.index);
    const after = text.slice(
      mention.index + mention.raw.length,
      mention.index + mention.raw.length + 30,
    );

    const lastMatch = (pattern: RegExp, value: string): number => {
      let position = -1;
      const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
      for (const match of value.matchAll(new RegExp(pattern.source, flags))) {
        position = match.index ?? -1;
      }
      return position;
    };

    const trialAt = lastMatch(TRIAL_END, before);
    const firstAt = lastMatch(FIRST_CHARGE, before);
    const renewalAt = lastMatch(RENEWAL, before);
    const closest = Math.max(trialAt, firstAt, renewalAt);

    const roles: DateRole[] = [];
    if (mention.ambiguous) roles.push("ambiguous");
    if (closest >= 0 && before.length - closest <= 90) {
      if (closest === trialAt) roles.push("trial_end");
      else if (closest === firstAt) roles.push("first_charge");
      else roles.push("renewal");
    } else if (mention.ambiguous) {
      roles.push("payment");
    } else if (TRIAL_END.test(`${before} ${after}`)) {
      roles.push("trial_end");
    } else if (FIRST_CHARGE.test(`${before} ${after}`)) {
      roles.push("first_charge");
    } else if (RENEWAL.test(`${before} ${after}`)) {
      roles.push("renewal");
    } else {
      roles.push("payment");
    }
    return { ...mention, roles };
  });
}

const DURATION =
  /(\d{1,3})[\s-]*(?:day|days)[\s-]*(?:free\s*)?trial|trial(?:\s+period)?\s*(?:of|for|is)?\s*(\d{1,3})\s*(?:day|days)/i;

/** Start date plus a stated trial duration, labelled as an estimate. */
export function trialEndFromDuration(
  text: string,
  dates: Array<DateMention & { roles: DateRole[] }>,
): { date: string; days: number; start: DateMention } | null {
  const match = DURATION.exec(text);
  if (!match) return null;
  const days = Number(match[1] ?? match[2]);
  if (!Number.isFinite(days) || days < 1 || days > 365) return null;

  const start = dates.find(
    (date) =>
      date.date &&
      !date.ambiguous &&
      (date.roles.includes("payment") || date.roles.includes("first_charge")) &&
      /(start|started|begin|began|from|sign(?:ed)?\s*up|activated)/i.test(
        text.slice(Math.max(0, date.index - 80), date.index),
      ),
  );
  if (!start?.date) return null;
  return { date: addDaysToDate(start.date, days), days, start };
}
