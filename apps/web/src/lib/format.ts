import {
  cycleLabel,
  daysBetween,
  formatDate,
  formatMoney,
  formatMoneyCompact,
  kindLabel,
  todayInTimeZone,
  type BillingCycle,
  type OccurrenceView,
  type RecordKind,
  type RecordStatus,
} from "@dueradar/domain";

export {
  cycleLabel,
  formatDate,
  formatMoney,
  formatMoneyCompact,
  kindLabel,
  todayInTimeZone,
};

export function todayFor(timezone: string): string {
  return todayInTimeZone(timezone);
}

/** The device's local calendar date, used to seed form defaults. */
export function todayLocal(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

export function money(
  amountMinor: number,
  currency: string,
  locale = "en-GH",
): string {
  try {
    return formatMoney(amountMinor, currency, locale);
  } catch {
    return `${currency} ${(amountMinor / 100).toFixed(2)}`;
  }
}

export function moneyCompact(
  amountMinor: number,
  currency: string,
  locale = "en-GH",
): string {
  try {
    return formatMoneyCompact(amountMinor, currency, locale);
  } catch {
    return `${currency} ${(amountMinor / 100).toFixed(2)}`;
  }
}

export function dueLabel(dueDate: string, today: string): string {
  const days = daysBetween(today, dueDate);
  if (days < -1) return `Overdue by ${Math.abs(days)} days`;
  if (days === -1) return "Overdue by 1 day";
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days <= 7) return `Due in ${days} days`;
  if (days <= 31) return `In ${Math.ceil(days / 7)} weeks`;
  return formatDate(dueDate, "en-GH", { day: "numeric", month: "short" });
}

export function shortDate(date: string): string {
  return formatDate(date, "en-GH", { day: "numeric", month: "short" });
}

export function longDate(date: string): string {
  return formatDate(date, "en-GH", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function statusLabel(status: RecordStatus): string {
  switch (status) {
    case "active":
      return "Active";
    case "paused":
      return "Paused";
    case "cancelled":
      return "Cancelled";
  }
}

export function viewLabel(view: OccurrenceView): string {
  switch (view) {
    case "overdue":
      return "Overdue";
    case "due":
      return "Due soon";
    case "upcoming":
      return "Upcoming";
    case "paid":
      return "Paid";
    case "skipped":
      return "Skipped";
    case "canceled":
      return "Cancelled";
  }
}

export function cycleShort(cycle: BillingCycle, customDays?: number | null): string {
  return cycleLabel(cycle, customDays);
}

export function kindShort(kind: RecordKind): string {
  return kindLabel(kind);
}

export function initials(name: string | null | undefined, email?: string): string {
  const source = name?.trim() || email?.split("@")[0] || "?";
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return formatDate(new Date(then).toISOString().slice(0, 10));
}

export function daysUntilLabel(days: number): string {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 0) return `${Math.abs(days)}d late`;
  return `in ${days}d`;
}
