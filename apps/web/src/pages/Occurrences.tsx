import { useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, CheckCircle2, Plus } from "lucide-react";
import { sumByCurrency } from "@dueradar/domain";
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  Segmented,
  Select,
  cx,
  useToast,
} from "../components/ui";
import {
  OccurrenceRow,
  OccurrenceSheet,
  useOccurrenceGroups,
} from "../components/records";
import { useMe, useOccurrences } from "../lib/queries";
import { dueLabel, formatDate, money, todayLocal } from "../lib/format";
import type { Occurrence, RecordKind } from "../lib/types";

type Tab = "overdue" | "due" | "upcoming" | "paid" | "all";

const TABS: Array<{ value: Tab; label: string }> = [
  { value: "overdue", label: "Overdue" },
  { value: "due", label: "Due soon" },
  { value: "upcoming", label: "Upcoming" },
  { value: "paid", label: "Paid" },
  { value: "all", label: "All open" },
];

const KINDS: Array<{ value: "" | RecordKind; label: string }> = [
  { value: "", label: "All types" },
  { value: "bill", label: "Bills" },
  { value: "subscription", label: "Subscriptions" },
  { value: "trial", label: "Free trials" },
  { value: "prepaid", label: "Prepaid" },
  { value: "installment", label: "Instalments" },
];

export function OccurrencesPage() {
  const me = useMe();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("due");
  const [kind, setKind] = useState<"" | RecordKind>("");
  const [selected, setSelected] = useState<Occurrence | null>(null);

  const filters = {
    view: tab === "overdue" || tab === "due" || tab === "upcoming" ? tab : undefined,
    status: tab === "paid" ? "paid" : undefined,
    kind: kind || undefined,
  };
  const query = useOccurrences(filters);
  const today = me.data?.profile ? perZoneToday(me.data.profile.timezone) : todayLocal();
  const locale = me.data?.profile?.locale ?? "en-GH";
  const occurrences = query.data?.occurrences ?? [];
  const groups = useOccurrenceGroups(occurrences);

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow="Due dates"
        title="What is due"
        description="Overdue and upcoming items from every active record. Future rows are projections, not charges."
        actions={
          <Link to="/subscriptions/new">
            <Button variant="secondary">
              <Plus className="h-4 w-4" />
              Add
            </Button>
          </Link>
        }
      />

      <div className="mb-4 flex flex-col gap-3">
        <Segmented value={tab} onChange={setTab} options={TABS} />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted">
            {query.isLoading
              ? "Loading…"
              : `${occurrences.length} ${occurrences.length === 1 ? "date" : "dates"}${
                  tab === "overdue" || tab === "due" || tab === "upcoming" ? " in this view" : ""
                }`}
          </p>
          <Select
            value={kind}
            onChange={(event) => setKind(event.target.value as "" | RecordKind)}
            className="w-40"
            aria-label="Filter by type"
          >
            {KINDS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {query.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="skeleton h-[4.6rem] rounded-2xl" />
          ))}
        </div>
      ) : query.isError ? (
        <EmptyState
          icon={<CalendarDays className="h-5 w-5" />}
          title="Could not load due dates"
          description="Check your connection and try again."
          action={<Button onClick={() => void query.refetch()}>Try again</Button>}
        />
      ) : occurrences.length === 0 ? (
        <EmptyState
          icon={tab === "paid" ? <CheckCircle2 className="h-5 w-5" /> : <CalendarDays className="h-5 w-5" />}
          title={
            tab === "overdue"
              ? "Nothing overdue"
              : tab === "due"
                ? "Nothing due in the next 7 days"
                : tab === "paid"
                  ? "No payments logged yet"
                  : "Nothing scheduled here"
          }
          description={
            tab === "overdue"
              ? "You are all caught up. Future dates are under Upcoming."
              : tab === "paid"
                ? "Mark an item paid and it appears here with the date you logged."
                : "Add a bill or subscription so DueRadar can schedule it."
          }
          action={
            tab === "overdue" ? (
              <Button variant="secondary" onClick={() => setTab("upcoming")}>
                See upcoming
              </Button>
            ) : (
              <Link to="/subscriptions/new">
                <Button variant="secondary">
                  <Plus className="h-4 w-4" />
                  Add a record
                </Button>
              </Link>
            )
          }
        />
      ) : (
        <div className="space-y-6">
          {groups.map(([date, items]) => {
            const totals = sumByCurrency(items);
            return (
              <section key={date}>
                <div className="sticky top-[57px] z-10 -mx-1 mb-2 flex items-center justify-between gap-3 bg-paper/90 px-1 py-2 backdrop-blur-sm sm:top-[61px]">
                  <div className="flex items-baseline gap-2">
                    <h2 className="text-sm font-semibold text-ink">
                      {formatDate(date, locale, {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                      })}
                    </h2>
                    <span
                      className={cx(
                        "text-[0.7rem] font-medium",
                        date < today ? "text-danger-strong" : "text-muted",
                      )}
                    >
                      {date === today ? "Today" : dueLabel(date, today)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    {totals.map((total) => (
                      <Badge key={total.currency} tone="plain" className="tabular-nums">
                        {money(total.amountMinor, total.currency)}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  {items.map((occurrence) => (
                    <OccurrenceRow
                      key={occurrence.id}
                      occurrence={occurrence}
                      today={today}
                      compact
                      onOpen={setSelected}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <p className="mt-6 text-[0.7rem] leading-relaxed text-muted">
        Projected amounts come from the price and schedule on each record. They are not confirmed
        charges until you mark them paid.
      </p>

      <OccurrenceSheet
        occurrence={selected}
        today={today}
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        onChanged={() => {
          toast("Updating your list.");
          void query.refetch();
        }}
      />
    </div>
  );
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
