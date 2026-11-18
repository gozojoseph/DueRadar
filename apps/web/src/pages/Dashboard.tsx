import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  CreditCard,
  Inbox,
  Plus,
  Receipt,
  Sparkles,
  Upload,
  Wallet,
} from "lucide-react";
import { Badge, Button, Card, CardSkeleton, EmptyState, PageHeader, cx } from "../components/ui";
import { OccurrenceRow, OccurrenceSheet } from "../components/records";
import { useDashboard, useDetectionSummary, useMe } from "../lib/queries";
import { formatDate, money, shortDate, todayLocal } from "../lib/format";
import type { DashboardData, Occurrence } from "../lib/types";

function greeting(timezone: string): string {
  try {
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", hour12: false }).format(
        new Date(),
      ),
    );
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  } catch {
    return "Hello";
  }
}

function primaryTotal(dashboard: DashboardData, key: keyof DashboardData["totals"]): string {
  const totals = dashboard.totals[key];
  if (totals.length === 0) return "—";
  return totals.map((total) => money(total.amountMinor, total.currency)).join(" + ");
}

export function DashboardPage() {
  const dashboard = useDashboard();
  const me = useMe();
  const detections = useDetectionSummary();
  const [selected, setSelected] = useState<Occurrence | null>(null);

  if (dashboard.isLoading) {
    return (
      <div>
        <PageHeader title="Your month" description="Loading what is due." />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <CardSkeleton key={index} />
          ))}
        </div>
        <div className="mt-6 grid gap-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="skeleton h-20 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  if (dashboard.isError || !dashboard.data) {
    return (
      <div>
        <PageHeader title="Your month" description="We could not load your dashboard." />
        <EmptyState
          icon={<AlertTriangle className="h-5 w-5" />}
          title="Could not load your dashboard"
          description="Check your connection and try again."
          action={
            <Button onClick={() => void dashboard.refetch()}>
              Try again
            </Button>
          }
        />
      </div>
    );
  }

  const data = dashboard.data;
  const profile = me.data?.profile;
  const timezone = profile?.timezone ?? data.timezone;
  const name = profile?.displayName?.split(" ")[0] ?? "";
  const nothingYet = data.counts.active === 0 && data.next.length === 0;
  const monthDate = `${data.today.slice(0, 7)}-01`;

  return (
    <div className="animate-rise">
      <section className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[0.7rem] font-bold uppercase tracking-[0.16em] text-brand-600">
            {formatDate(monthDate, profile?.locale ?? "en-GH", { month: "long", year: "numeric" })}
          </p>
          <h1 className="mt-1.5 font-display text-[1.9rem] leading-tight font-semibold tracking-[-0.03em] text-ink sm:text-[2.25rem]">
            {greeting(timezone)}
            {name ? `, ${name}` : ""}.
          </h1>
          <p className="mt-1 text-sm text-muted">
            {data.counts.overdue > 0
              ? `${data.counts.overdue} ${data.counts.overdue === 1 ? "item is" : "items are"} past due. Start there.`
              : data.counts.dueSoon > 0
                ? `${data.counts.dueSoon} ${data.counts.dueSoon === 1 ? "item is" : "items are"} due in the next 7 days.`
                : "Nothing is overdue. Here is the month ahead."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/import">
            <Button variant="secondary">
              <Upload className="h-4 w-4" />
              Import
            </Button>
          </Link>
          <Link to="/subscriptions/new">
            <Button>
              <Plus className="h-4 w-4" />
              Add something
            </Button>
          </Link>
        </div>
      </section>

      {detections.data && detections.data.pending > 0 ? (
        <Card className="mb-5 flex flex-wrap items-center gap-3 border-brand-600/25 bg-brand-50/70 p-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-brand-700">
            <Inbox className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">
              {detections.data.pending} detected{" "}
              {detections.data.pending === 1 ? "payment is" : "payments are"} waiting for you
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">
              {detections.data.needsDetails > 0
                ? `${detections.data.needsDetails} need a date before they can become reminders.`
                : "Confirm what to track. Nothing is added automatically."}
            </p>
          </div>
          <Link to="/detections">
            <Button size="sm">
              Review
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
        </Card>
      ) : null}

      {nothingYet ? (
        <Card className="overflow-hidden">
          <div className="grid gap-6 bg-brand-900 p-6 text-white sm:grid-cols-[1.1fr_0.9fr] sm:p-8">
            <div>
              <Badge tone="plain" className="bg-white/10 text-white">
                <Sparkles className="h-3 w-3" />
                First step
              </Badge>
              <h2 className="mt-3 font-display text-2xl font-semibold tracking-[-0.02em]">
                What comes out of your account every month?
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-brand-100/80">
                Add your rent, electricity, internet, or that streaming service. Even two or three
                records make the list useful.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link to="/subscriptions/new?template=bill">
                  <Button variant="inverse">
                    Add a bill
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
                <Link to="/subscriptions/new?template=trial">
                  <Button variant="ghostInverse">
                    Track a free trial
                  </Button>
                </Link>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 self-end">
              {[
                { label: "Rent", icon: Wallet },
                { label: "ECG", icon: Receipt },
                { label: "Internet", icon: CreditCard },
                { label: "Netflix", icon: Sparkles },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm font-medium text-brand-50"
                >
                  <item.icon className="h-4 w-4 text-brand-200" />
                  {item.label}
                </div>
              ))}
            </div>
          </div>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label={`Due in ${data.formatted.monthLabel}`}
              value={primaryTotal(data, "dueThisMonth")}
              detail={`${data.counts.dueSoon + data.counts.overdue} open · ${data.counts.active} active records`}
              icon={<CalendarDays className="h-4 w-4" />}
              tone="brand"
            />
            <StatCard
              label="Overdue"
              value={data.counts.overdue > 0 ? primaryTotal(data, "overdue") : "Nothing"}
              detail={
                data.counts.overdue > 0
                  ? `${data.counts.overdue} past due`
                  : "You are all caught up"
              }
              icon={data.counts.overdue > 0 ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              tone={data.counts.overdue > 0 ? "danger" : "success"}
            />
            <StatCard
              label="Next 30 days"
              value={primaryTotal(data, "next30")}
              detail={`${data.counts.upcoming + data.counts.dueSoon} scheduled`}
              icon={<CalendarDays className="h-4 w-4" />}
              tone="neutral"
            />
            <StatCard
              label="Paid this month"
              value={primaryTotal(data, "paidThisMonth")}
              detail={`${data.recentPayments.length > 0 ? "From your payment log" : "No payments logged yet"}`}
              icon={<CheckCircle2 className="h-4 w-4" />}
              tone="success"
            />
          </div>

          <div className="mt-7 grid gap-6 lg:grid-cols-[1.35fr_0.85fr]">
            <div className="min-w-0">
              <div className="mb-3 flex items-end justify-between gap-3">
                <div>
                  <h2 className="font-display text-xl font-semibold tracking-[-0.02em] text-ink">
                    Next up
                  </h2>
                  <p className="text-xs text-muted">Overdue and due-soon items, earliest first.</p>
                </div>
                <Link
                  to="/occurrences"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"
                >
                  See all
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>

              {data.next.length === 0 ? (
                <EmptyState
                  icon={<CheckCircle2 className="h-5 w-5" />}
                  title="Nothing due in the next while"
                  description="Your next scheduled item is further out. Add another bill if something is missing."
                  action={
                    <Link to="/subscriptions/new">
                      <Button variant="secondary" size="sm">
                        <Plus className="h-3.5 w-3.5" />
                        Add a record
                      </Button>
                    </Link>
                  }
                />
              ) : (
                <div className="space-y-2">
                  {data.next.map((occurrence) => (
                    <OccurrenceRow
                      key={occurrence.id}
                      occurrence={occurrence}
                      today={data.today}
                      onOpen={setSelected}
                    />
                  ))}
                </div>
              )}

              <p className="mt-3 flex items-start gap-1.5 text-[0.7rem] leading-relaxed text-muted">
                <Sparkles className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                Upcoming amounts are projections from the schedule you entered. They are not confirmed
                charges.
              </p>
            </div>

            <div className="min-w-0 space-y-6">
              {data.trials.length > 0 ? (
                <section>
                  <div className="mb-3 flex items-end justify-between gap-3">
                    <div>
                      <h2 className="font-display text-xl font-semibold tracking-[-0.02em] text-ink">
                        Trials ending
                      </h2>
                      <p className="text-xs text-muted">Cancel before the charge, not after.</p>
                    </div>
                    <Badge tone="amber">{data.trials.length}</Badge>
                  </div>
                  <div className="space-y-2">
                    {data.trials.slice(0, 4).map((trial) => (
                      <button
                        key={trial.id}
                        type="button"
                        onClick={() => setSelected(trial)}
                        className="flex w-full items-center gap-3 rounded-2xl border border-amber-strong/20 bg-amber-soft/50 p-3.5 text-left transition hover:bg-amber-soft"
                      >
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/70 text-amber-strong">
                          <Sparkles className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-ink">
                            {trial.name}
                          </span>
                          <span className="text-xs text-amber-strong">
                            Ends {shortDate(trial.dueDate)}
                          </span>
                        </span>
                        <span className="text-sm font-semibold tabular-nums text-ink">
                          {money(trial.amountMinor, trial.currency)}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}

              <section>
                <div className="mb-3 flex items-end justify-between gap-3">
                  <div>
                    <h2 className="font-display text-xl font-semibold tracking-[-0.02em] text-ink">
                      Recently paid
                    </h2>
                    <p className="text-xs text-muted">Confirmed payments you logged.</p>
                  </div>
                  <Link
                    to="/occurrences?status=paid"
                    className="text-xs font-semibold text-brand-700 hover:underline"
                  >
                    History
                  </Link>
                </div>
                {data.recentPayments.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-line-strong px-4 py-6 text-center text-sm text-muted">
                    Nothing logged yet. Mark an item paid and it shows here.
                  </div>
                ) : (
                  <div className="card divide-y divide-line/70">
                    {data.recentPayments.map((payment) => (
                      <div key={payment.id} className="flex items-center gap-3 px-4 py-3">
                        <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-50 text-brand-700">
                          <CheckCircle2 className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-ink">
                            {payment.description || "Payment"}
                          </p>
                          <p className="text-[0.7rem] text-muted">
                            {formatDate(payment.paidAt.slice(0, 10), profile?.locale ?? "en-GH", {
                              day: "numeric",
                              month: "short",
                            })}
                            {payment.method ? ` · ${payment.method}` : ""}
                          </p>
                        </div>
                        <span className="text-sm font-semibold tabular-nums text-ink">
                          {money(payment.amountMinor, payment.currency)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        </>
      )}

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface/60 px-4 py-3">
        <p className="text-xs leading-relaxed text-muted">
          Today is {formatDate(data.today, profile?.locale ?? "en-GH", { weekday: "long", day: "numeric", month: "long" })} in{" "}
          {timezone.replaceAll("_", " ")}.
        </p>
        <Link
          to="/calendar"
          className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"
        >
          Open calendar
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <OccurrenceSheet
        occurrence={selected}
        today={data.today || todayLocal()}
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  detail,
  icon,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  icon: ReactNode;
  tone: "brand" | "danger" | "success" | "neutral";
}) {
  const styles = {
    brand: "bg-brand-50 text-brand-700",
    danger: "bg-danger-soft text-danger-strong",
    success: "bg-brand-50 text-brand-700",
    neutral: "bg-paper-deep text-ink-soft",
  } as const;

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[0.7rem] font-bold uppercase tracking-[0.1em] text-muted">{label}</p>
        <span className={cx("grid h-8 w-8 shrink-0 place-items-center rounded-xl", styles[tone])}>
          {icon}
        </span>
      </div>
      <p className="mt-2 font-display text-[1.45rem] leading-tight font-semibold tracking-[-0.02em] text-ink tabular-nums">
        {value}
      </p>
      <p className="mt-1 text-[0.7rem] leading-relaxed text-muted">{detail}</p>
    </Card>
  );
}
