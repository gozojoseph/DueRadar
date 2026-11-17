import {
  addDaysToDate,
  applyQuietHours,
  compareDates,
  dateInTimeZone,
  todayInTimeZone,
  zonedWallTimeToUtc,
} from "./dates.js";
import type { ReminderChannel } from "./subscriptions.js";

export interface ReminderProfile {
  timeZone: string;
  reminderTime: string;
  quietHoursStart: string;
  quietHoursEnd: string;
}

export interface ReminderPlanInput {
  occurrenceId: string;
  dueDate: string;
  offsets: number[];
  channels: ReminderChannel[];
  profile: ReminderProfile;
  now: Date;
  /** Grace after the scheduled fire time during which a catch-up is allowed. */
  catchUpHours?: number;
  /**
   * Days *after* the due date to nudge while the occurrence is still unpaid.
   * Encoded in plans as negative `offsetDays` (-3 = three days overdue).
   */
  overdueOffsets?: number[];
}

export interface PlannedReminder {
  channel: ReminderChannel;
  offsetDays: number;
  fireAt: Date;
  dedupeKey: string;
  catchUp: boolean;
  skipped: boolean;
  skipReason?: "quiet-hours-past-deadline";
}

/** Nudge schedule for unpaid occurrences: +1, +3, +7 days after the due date. */
export const OVERDUE_REMINDER_OFFSETS = [1, 3, 7];

export function reminderDedupeKey(
  occurrenceId: string,
  channel: ReminderChannel,
  offsetDays: number,
): string {
  return `${occurrenceId}:${channel}:${offsetDays}`;
}

/**
 * Plans every reminder for one occurrence: the pre-due reminders (offsets days
 * before the due date) and, while the occurrence stays unpaid, the overdue
 * nudges (offsets days after it). Reminders whose fire time has passed are
 * caught up only while the occurrence is still live and only inside the grace
 * window; this keeps a newly added bill from silently missing today's reminder
 * without spamming old ones — and stops the overdue nudges once their window
 * (last overdue offset) has passed.
 */
export function planReminders(input: ReminderPlanInput): PlannedReminder[] {
  const { occurrenceId, dueDate, offsets, channels, profile, now } = input;
  const catchUpHours = input.catchUpHours ?? 20;
  const overdueOffsets = input.overdueOffsets ?? [];
  const today = todayInTimeZone(profile.timeZone, now);
  const pastDue = compareDates(dueDate, today) < 0;
  if (pastDue && overdueOffsets.length === 0) return [];

  const plans: PlannedReminder[] = [];
  const seen = new Set<string>();

  // Pre-due reminders: the due date itself is the quiet-hours deadline.
  // Overdue nudges: fired days after the due date, so the nudge's own date
  // becomes the deadline — the original due date is already in the past.
  const candidates = (pastDue ? [] : offsets)
    .filter((offsetDays) => Number.isInteger(offsetDays) && offsetDays >= 0 && offsetDays <= 60)
    .map((offsetDays) => ({
      encoded: offsetDays,
      reminderDate: addDaysToDate(dueDate, -offsetDays),
      deadline: dueDate,
    }))
    .concat(
      [...new Set(overdueOffsets)]
        .filter((daysLate) => Number.isInteger(daysLate) && daysLate > 0 && daysLate <= 60)
        .map((daysLate) => ({
          encoded: -daysLate,
          reminderDate: addDaysToDate(dueDate, daysLate),
          deadline: addDaysToDate(dueDate, daysLate),
        })),
    )
    .sort((a, b) => a.reminderDate.localeCompare(b.reminderDate));

  for (const candidate of candidates) {
    const scheduled = zonedWallTimeToUtc(
      candidate.reminderDate,
      profile.reminderTime,
      profile.timeZone,
    );
    const quiet = applyQuietHours(
      scheduled,
      profile.quietHoursStart,
      profile.quietHoursEnd,
      candidate.deadline,
      profile.timeZone,
    );
    if (quiet.skipped) continue;

    let fireAt = quiet.fireAt;
    let catchUp = quiet.shifted;
    if (fireAt.getTime() <= now.getTime()) {
      const hoursLate = (now.getTime() - fireAt.getTime()) / 3_600_000;
      if (hoursLate > catchUpHours) continue;
      fireAt = new Date(now.getTime() + 60_000);
      catchUp = true;
    }

    for (const channel of channels) {
      const dedupeKey = reminderDedupeKey(occurrenceId, channel, candidate.encoded);
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      plans.push({
        channel,
        offsetDays: candidate.encoded,
        fireAt,
        dedupeKey,
        catchUp,
        skipped: false,
      });
    }
  }

  return plans;
}

/** Human label such as "3 days before", "on the day", or "3 days after due". */
export function offsetLabel(offsetDays: number): string {
  if (offsetDays < 0) {
    const daysLate = -offsetDays;
    return daysLate === 1 ? "1 day after due" : `${daysLate} days after due`;
  }
  if (offsetDays === 0) return "On the due date";
  if (offsetDays === 1) return "1 day before";
  return `${offsetDays} days before`;
}

/**
 * Quiet hours are local wall-clock times. Exposed for settings previews.
 */
export function quietHoursDescription(
  start: string,
  end: string,
  timeZone: string,
): string {
  return `${start}–${end} (${timeZone.replace("_", " ")})`;
}

/** True when today's local time currently sits inside quiet hours. */
export function inQuietHoursNow(
  start: string,
  end: string,
  timeZone: string,
  now = new Date(),
): boolean {
  const current = dateInTimeZone(now, timeZone);
  const at = zonedWallTimeToUtc(current, "12:00", timeZone);
  return applyQuietHours(at, start, end, current, timeZone).shifted;
}
