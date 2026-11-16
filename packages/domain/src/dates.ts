/**
 * Calendar-date and time-zone helpers.
 *
 * DueRadar stores calendar dates (billing days, trial expiries) as ISO
 * `YYYY-MM-DD` strings so a user's "15th of the month" never shifts when the
 * server or browser happens to be in another time zone. Instants (reminder
 * fire times, payment timestamps) are `Date`/`timestamptz`.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/;

export interface DateParts {
  year: number;
  month: number; // 1-12
  day: number;
}

export function isDateString(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

export function parseDateString(value: string): DateParts {
  const match = ISO_DATE.exec(value);
  if (!match) throw new Error(`Invalid ISO date: ${value}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function makeDateString(year: number, month: number, day: number): string {
  const normalized = new Date(Date.UTC(year, month - 1, day));
  return `${normalized.getUTCFullYear()}-${pad(normalized.getUTCMonth() + 1)}-${pad(normalized.getUTCDate())}`;
}

export function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isLastDayOfMonth(date: string): boolean {
  const { year, month, day } = parseDateString(date);
  return day === daysInMonth(year, month);
}

export function addDaysToDate(date: string, days: number): string {
  const { year, month, day } = parseDateString(date);
  return makeDateString(year, month, day + days);
}

/** Adds months while preserving the original day where possible (Jan 31 -> Feb 28). */
export function addMonthsClamped(date: string, months: number): string {
  const { year, month, day } = parseDateString(date);
  return addMonthsFromAnchor(year, month, day, months, false);
}

/**
 * Adds months relative to an original anchor. Computing always from the
 * anchor (rather than iteratively) keeps Jan 31 -> Feb 28 -> Mar 31 correct.
 */
export function addMonthsFromAnchor(
  anchorYear: number,
  anchorMonth: number,
  anchorDay: number,
  months: number,
  endOfMonthMode: boolean,
): string {
  const zeroBased = anchorMonth - 1 + months;
  const targetYear = anchorYear + Math.floor(zeroBased / 12);
  const targetMonth = (zeroBased % 12 + 12) % 12 + 1;
  const last = daysInMonth(targetYear, targetMonth);
  const day = endOfMonthMode ? last : Math.min(anchorDay, last);
  return `${targetYear}-${pad(targetMonth)}-${pad(day)}`;
}

export function dayOfWeek(date: string): number {
  const { year, month, day } = parseDateString(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function startOfWeek(date: string, weekStartsOn = 1): string {
  const diff = (dayOfWeek(date) - weekStartsOn + 7) % 7;
  return addDaysToDate(date, -diff);
}

export function daysBetween(from: string, to: string): number {
  const a = parseDateString(from);
  const b = parseDateString(to);
  const start = Date.UTC(a.year, a.month - 1, a.day);
  const end = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((end - start) / 86_400_000);
}

export function compareDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minDate(a: string, b: string): string {
  return a <= b ? a : b;
}

export function maxDate(a: string, b: string): string {
  return a >= b ? a : b;
}

/** Formats a calendar date without applying the runtime's time zone. */
export function formatDate(
  date: string,
  locale = "en-GH",
  options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" },
): string {
  const { year, month, day } = parseDateString(date);
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, day, 12)),
  );
}

export function formatMonth(
  year: number,
  month: number,
  locale = "en-GH",
  options: Intl.DateTimeFormatOptions = { month: "long", year: "numeric" },
): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1, 12)),
  );
}

function partsInTimeZone(date: Date, timeZone: string): Record<string, number> {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const result: Record<string, number> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") result[part.type] = Number(part.value);
  }
  return result;
}

/** The calendar date at an instant in a given time zone. */
export function dateInTimeZone(date: Date, timeZone: string): string {
  const p = partsInTimeZone(date, timeZone);
  return `${p.year}-${pad(p.month ?? 1)}-${pad(p.day ?? 1)}`;
}

export function timeInTimeZone(date: Date, timeZone: string): string {
  const p = partsInTimeZone(date, timeZone);
  return `${pad(p.hour ?? 0)}:${pad(p.minute ?? 0)}`;
}

export function minutesInTimeZone(date: Date, timeZone: string): number {
  const p = partsInTimeZone(date, timeZone);
  return (p.hour ?? 0) * 60 + (p.minute ?? 0);
}

export function todayInTimeZone(timeZone: string, now = new Date()): string {
  return dateInTimeZone(now, timeZone);
}

function offsetMs(date: Date, timeZone: string): number {
  const p = partsInTimeZone(date, timeZone);
  const asUtc = Date.UTC(
    p.year ?? 1970,
    (p.month ?? 1) - 1,
    p.day ?? 1,
    p.hour ?? 0,
    p.minute ?? 0,
    p.second ?? 0,
  );
  return asUtc - (date.getTime() - date.getMilliseconds());
}

export function timeStringToMinutes(time: string): number {
  const match = TIME_OF_DAY.exec(time);
  if (!match) throw new Error(`Invalid time of day: ${time}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

export function isValidTimeOfDay(time: string): boolean {
  return TIME_OF_DAY.test(time);
}

/**
 * Converts a wall-clock date and time in `timeZone` to a UTC instant.
 * Handles DST transitions with a second offset pass.
 */
export function zonedWallTimeToUtc(date: string, time: string, timeZone: string): Date {
  const { year, month, day } = parseDateString(date);
  const minutes = timeStringToMinutes(time);
  const wallAsUtc = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60, 0, 0);
  let offset = offsetMs(new Date(wallAsUtc), timeZone);
  let instant = wallAsUtc - offset;
  const corrected = offsetMs(new Date(instant), timeZone);
  if (corrected !== offset) {
    offset = corrected;
    instant = wallAsUtc - offset;
  }
  return new Date(instant);
}

export function formatInstant(
  date: Date,
  timeZone: string,
  locale = "en-GH",
  options: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  },
): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(date);
}

export interface QuietHoursResult {
  fireAt: Date;
  shifted: boolean;
  skipped: boolean;
}

/**
 * Moves a send time out of quiet hours. When quiet hours cross midnight the
 * send lands at the morning boundary. Returns `skipped` when the shifted time
 * would fall after the occurrence deadline (end of the due date).
 */
export function applyQuietHours(
  fireAt: Date,
  quietStart: string,
  quietEnd: string,
  dueDate: string,
  timeZone: string,
): QuietHoursResult {
  const start = timeStringToMinutes(quietStart);
  const end = timeStringToMinutes(quietEnd);
  if (start === end) return { fireAt, shifted: false, skipped: false };

  const localMinutes = minutesInTimeZone(fireAt, timeZone);
  const inQuietHours =
    start < end
      ? localMinutes >= start && localMinutes < end
      : localMinutes >= start || localMinutes < end;

  if (!inQuietHours) return { fireAt, shifted: false, skipped: false };

  const localDate = dateInTimeZone(fireAt, timeZone);
  let shifted: Date;
  if (start < end) {
    shifted = zonedWallTimeToUtc(localDate, quietEnd, timeZone);
  } else if (localMinutes >= start) {
    shifted = zonedWallTimeToUtc(addDaysToDate(localDate, 1), quietEnd, timeZone);
  } else {
    shifted = zonedWallTimeToUtc(localDate, quietEnd, timeZone);
  }

  const deadline = zonedWallTimeToUtc(dueDate, "23:59", timeZone);
  if (shifted.getTime() > deadline.getTime()) {
    return { fireAt: shifted, shifted: true, skipped: true };
  }
  return { fireAt: shifted, shifted: true, skipped: false };
}

export function monthKey(date: string): string {
  return date.slice(0, 7);
}

export function yearMonth(date: string): { year: number; month: number } {
  const { year, month } = parseDateString(date);
  return { year, month };
}
