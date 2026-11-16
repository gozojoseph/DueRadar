import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  Check,
  Clock,
  CreditCard,
  ExternalLink,
  Pause,
  Pencil,
  Play,
  Plus,
  Repeat,
  Sparkles,
  Trash2,
  Wallet,
  XCircle,
} from "lucide-react";
import {
  defaultReminderChannels,
  defaultReminderOffsets,
  daysBetween,
} from "@dueradar/domain";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  LoadingBlock,
  Modal,
  Note,
  PageHeader,
  Segmented,
  cx,
  useToast,
} from "../components/ui";
import { OccurrenceSheet } from "../components/records";
import {
  useDeleteSubscription,
  useMe,
  useSubscription,
  useSubscriptionAction,
} from "../lib/queries";
import { cycleShort, formatDate, kindShort, money, shortDate, todayLocal } from "../lib/format";
import { errorMessage } from "../lib/api";
import type { Occurrence, SubscriptionDetail } from "../lib/types";

export function SubscriptionDetailPage() {
  const params = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const me = useMe();
  const query = useSubscription(params.id);
  const action = useSubscriptionAction(params.id ?? "");
  const remove = useDeleteSubscription(params.id ?? "");
  const [tab, setTab] = useState<"upcoming" | "history">("upcoming");
  const [selected, setSelected] = useState<Occurrence | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subscription = query.data?.subscription;

  const occurrences = useMemo(() => {
    if (!subscription) return { upcoming: [] as Occurrence[], history: [] as Occurrence[] };
    const mapped: Occurrence[] = subscription.occurrences.map((occurrence) => ({
      ...occurrence,
      userId: occurrence.userId,
      name: subscription.name,
      vendor: subscription.vendor,
      kind: subscription.kind,
      cycle: subscription.cycle,
      subscriptionStatus: subscription.status,
      categoryName: subscription.categoryName ?? null,
      categoryColor: subscription.categoryColor ?? null,
      daysUntil: daysBetween(subscription.anchorDate, occurrence.dueDate),
    }));
    return {
      upcoming: mapped
        .filter((occurrence) => occurrence.status === "pending")
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
      history: mapped
        .filter((occurrence) => occurrence.status !== "pending")
        .sort((a, b) => b.dueDate.localeCompare(a.dueDate)),
    };
  }, [subscription]);

  if (query.isLoading) return <LoadingBlock label="Loading this record" />;

  if (query.isError || !subscription) {
    return (
      <div>
        <PageHeader title="Record not found" description="It may have been deleted, or it belongs to another account." />
        <Link to="/subscriptions">
          <Button variant="secondary">
            <ArrowLeft className="h-4 w-4" />
            Back to tracked items
          </Button>
        </Link>
      </div>
    );
  }

  const profile = me.data?.profile;
  const locale = profile?.locale ?? "en-GH";
  const today = profile ? todayInZone(profile.timezone) : todayLocal();
  const nextPending = occurrences.upcoming[0] ?? null;
  const offsets = subscription.reminderOffsets ?? defaultReminderOffsets(subscription.kind);
  const channels =
    subscription.reminderChannels ??
    (profile
      ? defaultReminderChannels(profile)
      : (["in_app"] as Array<"in_app" | "email" | "push">));

  async function runAction(kind: "pause" | "resume" | "cancel") {
    setError(null);
    try {
      await action.mutateAsync(kind);
      setConfirmCancel(false);
      toast(
        kind === "pause"
          ? "Record paused. Reminders are off."
          : kind === "resume"
            ? "Record resumed. Reminders are back on."
            : "Record cancelled.",
      );
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function deleteRecord() {
    setError(null);
    try {
      await remove.mutateAsync();
      toast("Record deleted.");
      navigate("/subscriptions", { replace: true });
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <div className="animate-rise">
      <Link
        to="/subscriptions"
        className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to tracked items
      </Link>

      {error ? (
        <Note tone="error" className="mb-4">
          {error}
        </Note>
      ) : null}

      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            {kindShort(subscription.kind)} · {cycleShort(subscription.cycle, subscription.customIntervalDays)}
          </span>
        }
        title={subscription.name}
        description={subscription.vendor ?? undefined}
        actions={
          <>
            <Link to={`/subscriptions/${subscription.id}/edit`}>
              <Button variant="secondary" size="sm">
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </Button>
            </Link>
            {subscription.status === "active" ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void runAction("pause")}
                loading={action.isPending}
              >
                <Pause className="h-3.5 w-3.5" />
                Pause
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void runAction("resume")}
                loading={action.isPending}
              >
                <Play className="h-3.5 w-3.5" />
                Resume
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1.35fr_0.85fr]">
        <div className="min-w-0 space-y-5">
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-start justify-between gap-4 p-5 sm:p-6">
              <div>
                <p className="text-[0.7rem] font-bold uppercase tracking-[0.12em] text-muted">
                  {subscription.kind === "trial" ? "Charges after trial" : "Amount"}
                </p>
                <p className="mt-1 font-display text-[2rem] leading-none font-semibold tracking-[-0.03em] text-ink tabular-nums">
                  {money(subscription.amountMinor, subscription.currency)}
                </p>
                <p className="mt-1.5 text-sm text-muted">
                  {subscription.kind === "trial"
                    ? subscription.trialEndsAt
                      ? `Trial ends ${formatDate(subscription.trialEndsAt, locale)}`
                      : "Trial end date not set"
                    : cycleShort(subscription.cycle, subscription.customIntervalDays)}
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <Badge
                  tone={
                    subscription.status === "active"
                      ? "brand"
                      : subscription.status === "paused"
                        ? "amber"
                        : "slate"
                  }
                >
                  {subscription.status === "active"
                    ? "Active"
                    : subscription.status === "paused"
                      ? "Paused"
                      : "Cancelled"}
                </Badge>
                {subscription.categoryName ? (
                  <Badge tone="plain">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: subscription.categoryColor || "#0f766e" }}
                    />
                    {subscription.categoryName}
                  </Badge>
                ) : null}
              </div>
            </div>

            <div className="border-t border-line/80 bg-paper-deep/35 px-5 py-4 sm:px-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-[0.7rem] font-bold uppercase tracking-[0.1em] text-muted">
                    Next scheduled
                  </p>
                  <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-ink">
                    <CalendarDays className="h-4 w-4 text-brand-700" />
                    {subscription.nextDueDate
                      ? formatDate(subscription.nextDueDate, locale, {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })
                      : subscription.status === "active"
                        ? "No pending date"
                        : "Not scheduled"}
                  </p>
                  {nextPending ? (
                    <p className="mt-0.5 text-xs text-muted">
                      Projected, not charged · {money(nextPending.amountMinor, nextPending.currency)}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {nextPending ? (
                    <Button onClick={() => setSelected(nextPending)}>
                      <Check className="h-4 w-4" />
                      Mark next paid
                    </Button>
                  ) : (
                    <Link to={`/subscriptions/${subscription.id}/edit`}>
                      <Button variant="secondary">
                        <Plus className="h-4 w-4" />
                        Adjust schedule
                      </Button>
                    </Link>
                  )}
                </div>
              </div>
            </div>
          </Card>

          <section>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-display text-xl font-semibold tracking-[-0.02em] text-ink">
                  Billing history
                </h2>
                <p className="text-xs text-muted">
                  {subscription.status === "active"
                    ? "Future rows are projections from your schedule."
                    : "This record is not generating reminders."}
                </p>
              </div>
              <Segmented
                value={tab}
                onChange={setTab}
                options={[
                  { value: "upcoming", label: `Upcoming ${occurrences.upcoming.length}` },
                  { value: "history", label: `History ${occurrences.history.length}` },
                ]}
              />
            </div>

            {tab === "upcoming" ? (
              occurrences.upcoming.length === 0 ? (
                <EmptyState
                  icon={<CalendarDays className="h-5 w-5" />}
                  title="No pending dates"
                  description={
                    subscription.status === "active"
                      ? "Adjust the schedule to create the next occurrence."
                      : "Resume this record to schedule future dates."
                  }
                  action={
                    <Link to={`/subscriptions/${subscription.id}/edit`}>
                      <Button variant="secondary" size="sm">
                        Edit schedule
                      </Button>
                    </Link>
                  }
                />
              ) : (
                <div className="space-y-2">
                  {occurrences.upcoming.slice(0, 12).map((occurrence) => (
                    <SimpleOccurrenceRow
                      key={occurrence.id}
                      occurrence={occurrence}
                      today={today}
                      projected
                      onOpen={() => setSelected(occurrence)}
                    />
                  ))}
                </div>
              )
            ) : occurrences.history.length === 0 ? (
              <EmptyState
                icon={<Clock className="h-5 w-5" />}
                title="No history yet"
                description="Mark an occurrence paid and it will stay here as a confirmed record."
              />
            ) : (
              <div className="space-y-2">
                {occurrences.history.slice(0, 24).map((occurrence) => (
                  <SimpleOccurrenceRow
                    key={occurrence.id}
                    occurrence={occurrence}
                    today={today}
                    onOpen={() => setSelected(occurrence)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="space-y-5">
          <Card className="p-5">
            <h2 className="text-sm font-semibold text-ink">Details</h2>
            <dl className="mt-3 space-y-3 text-sm">
              <DetailRow label="Type" value={kindShort(subscription.kind)} />
              <DetailRow
                label={subscription.kind === "trial" ? "Trial ends" : "Schedule anchor"}
                value={
                  subscription.kind === "trial" && subscription.trialEndsAt
                    ? formatDate(subscription.trialEndsAt, locale)
                    : formatDate(subscription.anchorDate, locale)
                }
              />
              {subscription.kind !== "trial" ? (
                <DetailRow
                  label="Repeats"
                  value={cycleShort(subscription.cycle, subscription.customIntervalDays)}
                />
              ) : null}
              <DetailRow
                label="Paid with"
                value={subscription.paymentMethodLabel ?? "Not specified"}
              />
              <DetailRow label="Category" value={subscription.categoryName ?? "Uncategorised"} />
              <DetailRow
                label="Added"
                value={formatDate(subscription.createdAt.slice(0, 10), locale)}
              />
              {subscription.url ? (
                <div className="flex items-start justify-between gap-3">
                  <dt className="text-muted">Link</dt>
                  <dd className="min-w-0 text-right">
                    <a
                      href={subscription.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex max-w-[12rem] items-center gap-1 truncate font-medium text-brand-700 hover:underline"
                    >
                      <span className="truncate">{safeHost(subscription.url)}</span>
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                  </dd>
                </div>
              ) : null}
            </dl>
            {subscription.notes ? (
              <div className="mt-4 rounded-xl bg-paper-deep/50 px-3.5 py-3 text-sm leading-relaxed text-ink-soft whitespace-pre-wrap">
                {subscription.notes}
              </div>
            ) : null}
          </Card>

          <Card className="p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Repeat className="h-4 w-4 text-brand-700" />
              Reminder plan
            </h2>
            <div className="mt-3 space-y-3 text-sm">
              <div>
                <p className="text-xs text-muted">Days before</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {offsets.length === 0 ? (
                    <Badge tone="slate">No reminders</Badge>
                  ) : (
                    offsets.map((offset) => (
                      <Badge key={offset} tone="brand">
                        {offset === 0 ? "On the day" : `${offset}d`}
                      </Badge>
                    ))
                  )}
                </div>
              </div>
              <div>
                <p className="text-xs text-muted">Channels</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {channels.map((channel) => (
                    <Badge key={channel} tone="slate">
                      {channel === "in_app" ? "In app" : channel === "email" ? "Email" : "Push"}
                    </Badge>
                  ))}
                </div>
              </div>
              <p className="text-xs leading-relaxed text-muted">
                Sent at {profile?.reminderTime ?? "09:00"} {profile?.timezone.replaceAll("_", " ") ?? "Africa/Accra"}.
                Quiet hours {profile?.quietHoursStart ?? "21:00"}–{profile?.quietHoursEnd ?? "07:00"}.
              </p>
              <Link
                to="/settings"
                className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"
              >
                Change reminder settings
              </Link>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-semibold text-ink">Danger zone</h2>
            <div className="mt-3 space-y-2">
              {subscription.status !== "cancelled" ? (
                <Button
                  variant="secondary"
                  fullWidth
                  onClick={() => setConfirmCancel(true)}
                  className="justify-start"
                >
                  <XCircle className="h-4 w-4" />
                  Cancel this record
                </Button>
              ) : null}
              <Button
                variant="ghost"
                fullWidth
                onClick={() => setConfirmDelete(true)}
                className="justify-start text-danger-strong hover:bg-danger-soft"
              >
                <Trash2 className="h-4 w-4" />
                Delete permanently
              </Button>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted">
              Cancelling stops reminders but keeps history. Deleting removes this record, its
              occurrences and its payment log entries.
            </p>
          </Card>
        </div>
      </div>

      <OccurrenceSheet
        occurrence={selected}
        today={today}
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        onChanged={() => void query.refetch()}
      />

      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={() => void runAction("cancel")}
        title="Cancel this record?"
        description="Reminders stop and future occurrences are cancelled. Past payments stay in your history. You can resume it later."
        confirmLabel="Cancel record"
        cancelLabel="Keep it"
        loading={action.isPending}
      />

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void deleteRecord()}
        title="Delete permanently?"
        description="This removes the record, every scheduled occurrence and its payment log entries. This cannot be undone. Export your data first if you need a copy."
        confirmLabel="Delete forever"
        cancelLabel="Keep it"
        loading={remove.isPending}
      />
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 text-right font-medium text-ink">{value}</dd>
    </div>
  );
}

function SimpleOccurrenceRow({
  occurrence,
  today,
  projected = false,
  onOpen,
}: {
  occurrence: Occurrence;
  today: string;
  projected?: boolean;
  onOpen: () => void;
}) {
  const tone =
    occurrence.view === "paid"
      ? "brand"
      : occurrence.view === "overdue"
        ? "danger"
        : occurrence.view === "due"
          ? "amber"
          : "slate";
  const label =
    occurrence.view === "paid"
      ? "Paid"
      : occurrence.view === "overdue"
        ? "Overdue"
        : occurrence.view === "skipped"
          ? "Skipped"
          : occurrence.view === "canceled"
            ? "Cancelled"
            : projected
              ? "Projected"
              : "Pending";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-left transition hover:border-line-strong"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-ink">
          {shortDate(occurrence.dueDate)}
        </span>
        <span className="text-xs text-muted">
          {occurrence.status === "paid" && occurrence.paidAt
            ? `Logged ${formatDate(occurrence.paidAt.slice(0, 10), "en-GH", {
                day: "numeric",
                month: "short",
              })}`
            : occurrence.snoozedUntil
              ? `Snoozed until ${shortDate(occurrence.snoozedUntil)}`
              : "Scheduled from your billing cycle"}
        </span>
      </span>
      <Badge tone={tone}>{label}</Badge>
      <span className="w-24 shrink-0 text-right text-sm font-semibold tabular-nums text-ink">
        {money(occurrence.amountMinor, occurrence.currency)}
      </span>
    </button>
  );
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function todayInZone(timezone: string): string {
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
