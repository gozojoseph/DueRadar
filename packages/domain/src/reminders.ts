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

export function reminderDedupeKey(
  occurrenceId: string,
  channel: ReminderChannel,
  offsetDays: number,
): string {
  return `${occurrenceId}:${channel}:${offsetDays}`;
}

/**
 * Plans every reminder for one occurrence. Reminders whose fire time has
 * passed are caught up only while the occurrence is still live (not overdue)
 * and only inside the grace window; this keeps a newly added bill from
 * silently missing today's reminder without spamming old ones.
 */
export function planReminders(input: ReminderPlanInput): PlannedReminder[] {
  const { occurrenceId, dueDate, offsets, channels, profile, now } = input;
  const catchUpHours = input.catchUpHours ?? 20;
  const today = todayInTimeZone(profile.timeZone, now);
  if (compareDates(dueDate, today) < 0) return [];

  const plans: PlannedReminder[] = [];
  const seen = new Set<string>();

  for (const offsetDays of [...new Set(offsets)].sort((a, b) => b - a)) {
    if (!Number.isInteger(offsetDays) || offsetDays < 0 || offsetDays > 60) continue;
    const reminderDate = addDaysToDate(dueDate, -offsetDays);
    const scheduled = zonedWallTimeToUtc(reminderDate, profile.reminderTime, profile.timeZone);
    const quiet = applyQuietHours(
      scheduled,
      profile.quietHoursStart,
      profile.quietHoursEnd,
      dueDate,
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
      const dedupeKey = reminderDedupeKey(occurrenceId, channel, offsetDays);
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      plans.push({ channel, offsetDays, fireAt, dedupeKey, catchUp, skipped: false });
    }
  }

  return plans;
}

/** Human label such as "3 days before" or "on the day". */
export function offsetLabel(offsetDays: number): string {
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
