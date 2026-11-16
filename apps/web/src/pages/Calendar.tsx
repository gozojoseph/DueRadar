import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import {
  daysInMonth,
  dayOfWeek,
  formatMonth,
  sumByCurrency,
} from "@dueradar/domain";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  LoadingBlock,
  PageHeader,
  cx,
} from "../components/ui";
import { OccurrenceRow, OccurrenceSheet } from "../components/records";
import { useCalendar, useMe } from "../lib/queries";
import { formatDate, money, todayLocal } from "../lib/format";
import type { Occurrence } from "../lib/types";

export function CalendarPage() {
  const me = useMe();
  const profile = me.data?.profile;
  const weekStartsOn = profile?.weekStartsOn ?? 1;
  const locale = profile?.locale ?? "en-GH";
  const timezone = profile?.timezone ?? "Africa/Accra";

  const [cursor, setCursor] = useState(() => {
    const today = todayLocal();
    return { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [sheetItem, setSheetItem] = useState<Occurrence | null>(null);
  const [initialised, setInitialised] = useState(false);

  useEffect(() => {
    if (initialised || !profile) return;
    const today = perZoneToday(timezone);
    setCursor({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) });
    setSelected(today);
    setInitialised(true);
  }, [profile, timezone, initialised]);

  const query = useCalendar(cursor.year, cursor.month);
  const today = query.data?.today ?? (profile ? perZoneToday(timezone) : todayLocal());
  const occurrences = query.data?.occurrences ?? [];

  const byDate = useMemo(() => {
    const map = new Map<string, Occurrence[]>();
    for (const occurrence of occurrences) {
      const list = map.get(occurrence.dueDate);
      if (list) list.push(occurrence);
      else map.set(occurrence.dueDate, [occurrence]);
    }
    return map;
  }, [occurrences]);

  const days = useMemo(() => {
    const firstDow = dayOfWeek(
      `${cursor.year}-${String(cursor.month).padStart(2, "0")}-01`,
    );
    const offset = (firstDow - weekStartsOn + 7) % 7;
    const count = daysInMonth(cursor.year, cursor.month);
    const cells: Array<{ day: number; date: string } | null> = [];
    for (let index = 0; index < offset; index += 1) cells.push(null);
    for (let day = 1; day <= count; day += 1) {
      cells.push({
        day,
        date: `${cursor.year}-${String(cursor.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      });
    }
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [cursor, weekStartsOn]);

  const monthTotals = sumByCurrency(occurrences.filter((item) => item.status === "pending"));
  const selectedItems = selected ? (byDate.get(selected) ?? []) : [];

  function shift(delta: number) {
    setCursor((current) => {
      const next = new Date(Date.UTC(current.year, current.month - 1 + delta, 1));
      return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1 };
    });
    setSelected(null);
  }

  function goToday() {
    const current = perZoneToday(timezone);
    setCursor({ year: Number(current.slice(0, 4)), month: Number(current.slice(5, 7)) });
    setSelected(current);
  }

  const weekdayLabels = useMemo(() => {
    const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return [...labels.slice(weekStartsOn), ...labels.slice(0, weekStartsOn)];
  }, [weekStartsOn]);

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow="Calendar"
        title="The month at a glance"
        description="Tap a day to see what lands there. Dots mark scheduled items; red means overdue."
        actions={
          <Link to="/subscriptions/new">
            <Button variant="secondary">
              <Plus className="h-4 w-4" />
              Add
            </Button>
          </Link>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1.4fr_0.8fr]">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-line/80 px-4 py-3">
            <Button variant="ghost" size="icon" onClick={() => shift(-1)} aria-label="Previous month">
              <ChevronLeft className="h-4.5 w-4.5" />
            </Button>
            <div className="text-center">
              <p className="font-display text-lg font-semibold tracking-[-0.02em] text-ink">
                {formatMonth(cursor.year, cursor.month, locale)}
              </p>
              <button
                type="button"
                onClick={goToday}
                className="text-[0.7rem] font-semibold text-brand-700 hover:underline"
              >
                Jump to today
              </button>
            </div>
            <Button variant="ghost" size="icon" onClick={() => shift(1)} aria-label="Next month">
              <ChevronRight className="h-4.5 w-4.5" />
            </Button>
          </div>

          {query.isLoading ? (
            <LoadingBlock label="Loading this month" />
          ) : query.isError ? (
            <div className="p-6">
              <EmptyState
                icon={<CalendarDays className="h-5 w-5" />}
                title="Could not load the calendar"
                description="Check your connection and try again."
                action={<Button onClick={() => void query.refetch()}>Try again</Button>}
              />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-7 border-b border-line/70 bg-paper-deep/35">
                {weekdayLabels.map((label) => (
                  <div
                    key={label}
                    className="py-2 text-center text-[0.65rem] font-bold uppercase tracking-[0.08em] text-muted"
                  >
                    {label}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {days.map((cell, index) => {
                  if (!cell) {
                    return (
                      <div
                        key={`blank-${index}`}
                        className="min-h-[4.2rem] border-b border-r border-line/50 bg-paper/30 last:border-r-0 sm:min-h-[5.2rem]"
                      />
                    );
                  }
                  const items = byDate.get(cell.date) ?? [];
                  const open = items.filter((item) => item.status === "pending");
                  const isToday = cell.date === today;
                  const isSelected = cell.date === selected;
                  const hasOverdue = open.some((item) => item.view === "overdue");
                  const hasTrial = open.some((item) => item.kind === "trial");
                  return (
                    <button
                      key={cell.date}
                      type="button"
                      onClick={() => setSelected(cell.date)}
                      className={cx(
                        "relative min-h-[4.2rem] border-b border-r border-line/50 p-1.5 text-left transition hover:bg-brand-50/40 sm:min-h-[5.2rem]",
                        isSelected && "bg-brand-50/80 hover:bg-brand-50",
                      )}
                      aria-label={`${formatDate(cell.date, locale, {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                      })}${open.length > 0 ? `, ${open.length} scheduled` : ""}`}
                      aria-pressed={isSelected}
                    >
                      <span
                        className={cx(
                          "grid h-6 w-6 place-items-center rounded-full text-xs font-semibold tabular-nums",
                          isToday
                            ? "bg-brand-800 text-white"
                            : hasOverdue
                              ? "text-danger-strong"
                              : "text-ink-soft",
                        )}
                      >
                        {cell.day}
                      </span>
                      <span className="mt-1 flex flex-wrap gap-0.5">
                        {open.slice(0, 3).map((item) => (
                          <span
                            key={item.id}
                            className={cx(
                              "h-1.5 w-1.5 rounded-full",
                              item.view === "overdue"
                                ? "bg-danger-strong"
                                : item.kind === "trial"
                                  ? "bg-amber-strong"
                                  : "bg-brand-500",
                            )}
                          />
                        ))}
                      </span>
                      {open.length > 0 ? (
                        <span className="mt-0.5 hidden truncate text-[0.6rem] font-medium tabular-nums text-muted sm:block">
                          {money(
                            open.reduce((sum, item) => sum + item.amountMinor, 0),
                            open[0]?.currency ?? "GHS",
                          )}
                        </span>
                      ) : hasTrial ? (
                        <span className="mt-0.5 hidden text-[0.6rem] font-semibold text-amber-strong sm:block">
                          Trial
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-[0.7rem] text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-brand-500" /> Scheduled
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-strong" /> Trial
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-danger-strong" /> Overdue
                </span>
              </div>
            </>
          )}
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <p className="text-[0.7rem] font-bold uppercase tracking-[0.12em] text-muted">
              {formatMonth(cursor.year, cursor.month, locale)}
            </p>
            <p className="mt-1 font-display text-[1.7rem] font-semibold tracking-[-0.03em] text-ink tabular-nums">
              {monthTotals.length === 0
                ? "—"
                : monthTotals.map((total) => money(total.amountMinor, total.currency)).join(" + ")}
            </p>
            <p className="mt-1 text-xs text-muted">
              {occurrences.filter((item) => item.status === "pending").length} scheduled ·{" "}
              {occurrences.filter((item) => item.status === "paid").length} paid
            </p>
            {occurrences.filter((item) => item.status === "pending" && item.view === "overdue").length >
            0 ? (
              <div className="mt-3">
                <Badge tone="danger">
                  <AlertBadge />
                  {occurrences.filter((item) => item.status === "pending" && item.view === "overdue").length}{" "}
                  overdue this month
                </Badge>
              </div>
            ) : null}
          </Card>

          <Card className="p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-ink">
                {selected
                  ? formatDate(selected, locale, {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                    })
                  : "Pick a day"}
              </h2>
              {selected ? <Badge tone="slate">{selectedItems.length}</Badge> : null}
            </div>
            {!selected ? (
              <p className="mt-2 text-sm leading-relaxed text-muted">
                Select a date in the calendar to see the items scheduled for it.
              </p>
            ) : selectedItems.length === 0 ? (
              <div className="mt-3">
                <p className="text-sm text-muted">Nothing scheduled for this day.</p>
                <Link
                  to={`/subscriptions/new?date=${selected}`}
                  className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add something on this date
                </Link>
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                {selectedItems.map((item) => (
                  <OccurrenceRow
                    key={item.id}
                    occurrence={item}
                    today={today}
                    compact
                    onOpen={setSheetItem}
                  />
                ))}
              </div>
            )}
          </Card>

          <div className="rounded-2xl border border-line bg-surface/60 px-4 py-3 text-xs leading-relaxed text-muted">
            A busy day can mix projections and paid rows. Paid rows are confirmed; everything else is a
            due date from your schedule.
          </div>
        </div>
      </div>

      <OccurrenceSheet
        occurrence={sheetItem}
        today={today}
        open={Boolean(sheetItem)}
        onClose={() => setSheetItem(null)}
        onChanged={() => void query.refetch()}
      />
    </div>
  );
}

function AlertBadge() {
  return <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />;
}

function perZoneToday(timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return todayLocal();
  }
}
