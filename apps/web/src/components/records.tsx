import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  ChevronRight,
  Clock,
  CreditCard,
  RotateCcw,
  SkipForward,
  Sparkles,
  Undo2,
  Wallet,
} from "lucide-react";
import { parseMoneyInput } from "@dueradar/domain";
import type { Occurrence, Subscription } from "../lib/types";
import {
  useMe,
  useOccurrenceAction,
  usePaymentMethods,
  useSnoozeOccurrence,
} from "../lib/queries";
import { dueLabel, money, shortDate, todayLocal, cycleShort, kindShort, viewLabel } from "../lib/format";
import { Badge, Button, Field, Input, Modal, Note, Select, Textarea, cx, useToast } from "./ui";
import { errorMessage } from "../lib/api";

const VIEW_TONE = {
  overdue: "danger",
  due: "amber",
  upcoming: "slate",
  paid: "brand",
  skipped: "slate",
  canceled: "slate",
} as const;

export function occurrenceAccent(occurrence: Occurrence): string {
  return occurrence.categoryColor || "#0f766e";
}

export function OccurrenceRow({
  occurrence,
  today,
  compact = false,
  onOpen,
}: {
  occurrence: Occurrence;
  today: string;
  compact?: boolean;
  onOpen?: (occurrence: Occurrence) => void;
}) {
  const isOpen = occurrence.status === "pending";
  const late = occurrence.view === "overdue";

  return (
    <div
      className={cx(
        "group flex items-stretch gap-1 rounded-2xl border bg-surface transition hover:border-line-strong",
        late ? "border-danger-strong/25" : "border-line",
      )}
    >
      <button
        type="button"
        onClick={() => onOpen?.(occurrence)}
        className={cx(
          "flex min-w-0 flex-1 items-center gap-3 rounded-2xl text-left",
          compact ? "px-3.5 py-3" : "p-4",
        )}
      >
        <span
          className="mt-1 h-9 w-1 shrink-0 rounded-full"
          style={{ backgroundColor: occurrenceAccent(occurrence) }}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[0.9375rem] font-semibold text-ink">{occurrence.name}</span>
            {occurrence.kind === "trial" ? (
              <Badge tone="amber" className="shrink-0">
                <Sparkles className="h-3 w-3" aria-hidden />
                Trial
              </Badge>
            ) : null}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted">
            <span>{shortDate(occurrence.dueDate)}</span>
            <span aria-hidden>·</span>
            <span className={late ? "font-semibold text-danger-strong" : undefined}>
              {isOpen ? dueLabel(occurrence.dueDate, today) : viewLabel(occurrence.view)}
            </span>
            {occurrence.subscriptionStatus === "paused" ? (
              <>
                <span aria-hidden>·</span>
                <span>Paused</span>
              </>
            ) : null}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-[0.9375rem] font-semibold tabular-nums text-ink">
            {money(occurrence.amountMinor, occurrence.currency)}
          </span>
          <span className="mt-0.5 block text-[0.6875rem] font-medium text-muted">
            {occurrence.view === "paid" ? "Paid" : "Projected"}
          </span>
        </span>
      </button>
      {onOpen ? (
        <button
          type="button"
          onClick={() => onOpen(occurrence)}
          aria-label={`Actions for ${occurrence.name}`}
          className="grid w-10 shrink-0 place-items-center rounded-r-2xl text-muted transition hover:bg-ink/5 hover:text-ink"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}

export function SubscriptionCard({ subscription }: { subscription: Subscription }) {
  const me = useMe();
  const today = me.data?.profile ? todayLocalFor(me.data.profile.timezone) : todayLocal();
  const statusTone =
    subscription.status === "active" ? "brand" : subscription.status === "paused" ? "amber" : "slate";
  const due =
    subscription.nextDueDate && subscription.status === "active"
      ? dueLabel(subscription.nextDueDate, today)
      : subscription.status === "paused"
        ? "Paused"
        : "Cancelled";

  return (
    <Link
      to={`/subscriptions/${subscription.id}`}
      className="card group flex items-center gap-3.5 p-4 transition hover:-translate-y-0.5 hover:shadow-lift"
    >
      <span
        className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-sm font-bold text-white"
        style={{ backgroundColor: subscription.categoryColor || "#0b3b36" }}
        aria-hidden
      >
        {subscription.kind === "trial" ? (
          <Sparkles className="h-5 w-5" />
        ) : subscription.kind === "bill" ? (
          <CalendarClock className="h-5 w-5" />
        ) : (
          <CreditCard className="h-5 w-5" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[0.9375rem] font-semibold text-ink">{subscription.name}</span>
          {subscription.status !== "active" ? (
            <Badge tone={statusTone}>{subscription.status === "paused" ? "Paused" : "Cancelled"}</Badge>
          ) : null}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
          <span>{kindShort(subscription.kind)}</span>
          <span aria-hidden>·</span>
          <span>{cycleShort(subscription.cycle, subscription.customIntervalDays)}</span>
          {subscription.vendor ? (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{subscription.vendor}</span>
            </>
          ) : null}
        </span>
        <span className="mt-1 flex items-center gap-1 text-xs font-medium text-ink-soft">
          <span
            className={cx(
              "inline-block h-1.5 w-1.5 rounded-full",
              due.startsWith("Overdue") ? "bg-danger-strong" : "bg-brand-500",
            )}
          />
          {subscription.status === "active" && subscription.nextDueDate
            ? `${due} · ${shortDate(subscription.nextDueDate)}`
            : due}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-[0.9375rem] font-semibold tabular-nums text-ink">
          {money(subscription.amountMinor, subscription.currency)}
        </span>
        <ChevronRight className="ml-auto mt-1 h-4 w-4 text-line-strong transition group-hover:translate-x-0.5 group-hover:text-ink-soft" />
      </span>
    </Link>
  );
}

function todayLocalFor(timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    return parts;
  } catch {
    return todayLocal();
  }
}

type ActionMode = "view" | "pay" | "snooze" | "skip";

export function OccurrenceSheet({
  occurrence,
  today,
  open,
  onClose,
  onChanged,
}: {
  occurrence: Occurrence | null;
  today: string;
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const toast = useToast();
  const action = useOccurrenceAction();
  const snooze = useSnoozeOccurrence();
  const methods = usePaymentMethods();
  const [mode, setMode] = useState<ActionMode>("view");
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(todayLocal());
  const [method, setMethod] = useState("");
  const [notes, setNotes] = useState("");
  const [until, setUntil] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !occurrence) return;
    setMode("view");
    setError(null);
    setAmount((occurrence.amountMinor / 100).toFixed(2));
    setPaidAt(todayLocal());
    setMethod("");
    setNotes("");
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setUntil(
      `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(
        tomorrow.getDate(),
      ).padStart(2, "0")}`,
    );
  }, [open, occurrence]);

  if (!occurrence) return null;

  const pending = occurrence.status === "pending";
  const busy = action.isPending || snooze.isPending;

  async function settle(kind: "pay" | "skip" | "snooze" | "unpay" | "unsnooze") {
    if (!occurrence) return;
    setError(null);
    try {
      if (kind === "pay") {
        const amountMinor = parseMoneyInput(amount, occurrence.currency);
        if (amountMinor === null) {
          setError("Enter a valid amount.");
          return;
        }
        await action.mutateAsync({
          id: occurrence.id,
          action: "pay",
          body: {
            amountMinor,
            paidAt: new Date(`${paidAt}T12:00:00`).toISOString(),
            method: method || null,
            notes: notes || null,
          },
        });
        toast("Marked as paid.");
      } else if (kind === "skip") {
        await action.mutateAsync({ id: occurrence.id, action: "skip" });
        toast("Skipped this one.");
      } else if (kind === "unpay") {
        await action.mutateAsync({ id: occurrence.id, action: "unpay" });
        toast("Payment removed.");
      } else if (kind === "unsnooze") {
        await action.mutateAsync({ id: occurrence.id, action: "unsnooze" });
        toast("Reminder restored.");
      } else {
        await snooze.mutateAsync({ id: occurrence.id, until });
        toast(`Reminder set for ${shortDate(until)}.`);
      }
      onChanged?.();
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={occurrence.name}
      description={`${kindShort(occurrence.kind)} · ${money(
        occurrence.amountMinor,
        occurrence.currency,
      )} · ${shortDate(occurrence.dueDate)}`}
      footer={
        mode === "view" ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            {pending ? (
              <>
                <Button variant="secondary" onClick={() => setMode("skip")}>
                  Skip
                </Button>
                <Button onClick={() => setMode("pay")}>
                  <Check className="h-4 w-4" />
                  Mark paid
                </Button>
              </>
            ) : null}
          </>
        ) : mode === "pay" ? (
          <>
            <Button variant="secondary" onClick={() => setMode("view")} disabled={busy}>
              Back
            </Button>
            <Button loading={busy} onClick={() => void settle("pay")}>
              Save payment
            </Button>
          </>
        ) : mode === "snooze" ? (
          <>
            <Button variant="secondary" onClick={() => setMode("view")} disabled={busy}>
              Back
            </Button>
            <Button loading={busy} onClick={() => void settle("snooze")}>
              Snooze reminder
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={() => setMode("view")} disabled={busy}>
              Keep it
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void settle("skip")}>
              Skip occurrence
            </Button>
          </>
        )
      }
    >
      {error ? (
        <Note tone="error" className="mb-4">
          {error}
        </Note>
      ) : null}

      {mode === "view" ? (
        <div className="space-y-3">
          <div className="rounded-xl bg-paper-deep/60 px-4 py-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted">Status</span>
              <Badge tone={VIEW_TONE[occurrence.view]}>{viewLabel(occurrence.view)}</Badge>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="text-muted">Due</span>
              <span className="font-medium text-ink">{shortDate(occurrence.dueDate)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="text-muted">Amount</span>
              <span className="font-semibold tabular-nums text-ink">
                {money(occurrence.amountMinor, occurrence.currency)}
              </span>
            </div>
            {occurrence.snoozedUntil ? (
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-muted">Snoozed until</span>
                <span className="font-medium text-ink">{shortDate(occurrence.snoozedUntil)}</span>
              </div>
            ) : null}
          </div>

          <p className="text-xs leading-relaxed text-muted">
            Upcoming amounts are projections based on the billing schedule you entered. DueRadar does
            not charge you or move money.
          </p>

          <div className="grid grid-cols-2 gap-2">
            {pending ? (
              <>
                <Button variant="secondary" onClick={() => setMode("pay")}>
                  <Check className="h-4 w-4" />
                  Mark paid
                </Button>
                <Button variant="secondary" onClick={() => setMode("snooze")}>
                  <Clock className="h-4 w-4" />
                  Snooze
                </Button>
                <Button variant="secondary" onClick={() => setMode("skip")}>
                  <SkipForward className="h-4 w-4" />
                  Skip this one
                </Button>
                <Link
                  to={`/subscriptions/${occurrence.subscriptionId}`}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-line-strong bg-surface px-4 text-[0.9375rem] font-semibold text-ink hover:bg-paper-deep"
                >
                  <Wallet className="h-4 w-4" />
                  Open record
                </Link>
              </>
            ) : occurrence.status === "paid" ? (
              <>
                <Button variant="secondary" onClick={() => void settle("unpay")} loading={busy}>
                  <Undo2 className="h-4 w-4" />
                  Undo payment
                </Button>
                <Link
                  to={`/subscriptions/${occurrence.subscriptionId}`}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-line-strong bg-surface px-4 text-sm font-semibold text-ink hover:bg-paper-deep"
                >
                  Open record
                </Link>
              </>
            ) : (
              <Button variant="secondary" onClick={() => void settle("unpay")} loading={busy} disabled>
                <RotateCcw className="h-4 w-4" />
                Nothing to undo
              </Button>
            )}
          </div>

          {occurrence.snoozedUntil ? (
            <Button variant="ghost" fullWidth onClick={() => void settle("unsnooze")} loading={busy}>
              <RotateCcw className="h-4 w-4" />
              Clear snooze
            </Button>
          ) : null}
        </div>
      ) : null}

      {mode === "pay" ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Amount paid" htmlFor="pay-amount" hint={`Currency: ${occurrence.currency}`}>
              <Input
                id="pay-amount"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </Field>
            <Field label="Paid on" htmlFor="pay-date">
              <Input
                id="pay-date"
                type="date"
                value={paidAt}
                onChange={(event) => setPaidAt(event.target.value)}
              />
            </Field>
          </div>
          <Field label="Paid with" htmlFor="pay-method" hint="Optional. Add methods in Settings.">
            <Select
              id="pay-method"
              value={method}
              onChange={(event) => setMethod(event.target.value)}
            >
              <option value="">Not specified</option>
              {(methods.data?.paymentMethods ?? []).map((item) => (
                <option key={item.id} value={item.label}>
                  {item.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Note" htmlFor="pay-notes">
            <Textarea
              id="pay-notes"
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Reference, confirmation code, anything useful later"
            />
          </Field>
          <p className="text-xs leading-relaxed text-muted">
            This records a payment you already made. It is not a card charge.
          </p>
        </div>
      ) : null}

      {mode === "snooze" ? (
        <div className="space-y-4">
          <Field
            label="Remind me again on"
            htmlFor="snooze-date"
            hint="This hides earlier reminders for this occurrence. The due date itself stays the same."
          >
            <Input
              id="snooze-date"
              type="date"
              min={todayLocal()}
              value={until}
              onChange={(event) => setUntil(event.target.value)}
            />
          </Field>
          {occurrence.snoozedUntil ? (
            <Note tone="info">
              Currently snoozed until {shortDate(occurrence.snoozedUntil)}. Choosing a new date replaces
              that.
            </Note>
          ) : null}
        </div>
      ) : null}

      {mode === "skip" ? (
        <div className="space-y-3">
          <div className="flex items-start gap-3 rounded-xl bg-amber-soft px-4 py-3 text-sm leading-relaxed text-amber-strong">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p>
              Skipping marks this occurrence as not due. Use it for a waived bill or a cycle you did not
              use. It will no longer appear in totals or reminders.
            </p>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

export function useOccurrenceGroups(occurrences: Occurrence[]) {
  return useMemo(() => {
    const groups = new Map<string, Occurrence[]>();
    for (const occurrence of occurrences) {
      const existing = groups.get(occurrence.dueDate);
      if (existing) existing.push(occurrence);
      else groups.set(occurrence.dueDate, [occurrence]);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [occurrences]);
}

export function CategoryDot({ color }: { color: string | null }) {
  return (
    <span
      className="inline-block h-2 w-2 rounded-full"
      style={{ backgroundColor: color || "#0f766e" }}
      aria-hidden
    />
  );
}
