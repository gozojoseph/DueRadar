import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  Inbox,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { minorToMajor, parseMoneyInput } from "@dueradar/domain";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  LoadingBlock,
  Modal,
  Note,
  PageHeader,
  Segmented,
  Select,
  Textarea,
  cx,
  useToast,
} from "../components/ui";
import {
  useAcceptDetection,
  useCategories,
  useDetectionSummary,
  useDetections,
  useMe,
  usePaymentMethods,
  useRejectAllDetections,
  useRejectDetection,
} from "../lib/queries";
import { errorMessage } from "../lib/api";
import { cycleLabel, longDate, money, shortDate, timeAgo } from "../lib/format";
import type {
  BillingCycle,
  DetectionSuggestion,
} from "../lib/types";

const CURRENCIES = ["GHS", "USD", "EUR", "GBP", "NGN", "ZAR", "KES", "XOF", "CAD"];
const CYCLES: Array<{ value: BillingCycle; label: string }> = [
  { value: "weekly", label: "Every week" },
  { value: "monthly", label: "Every month" },
  { value: "quarterly", label: "Every 3 months" },
  { value: "semiannual", label: "Every 6 months" },
  { value: "annual", label: "Every year" },
  { value: "custom_days", label: "Custom number of days" },
];

const KIND_LABELS: Record<string, string> = {
  subscription: "Subscription",
  bill: "Bill",
  trial: "Free trial",
  payment: "One-off payment",
};

export function kindTone(kind: string | null): "brand" | "amber" | "sky" | "slate" {
  if (kind === "trial") return "amber";
  if (kind === "bill") return "sky";
  if (kind === "subscription") return "brand";
  return "slate";
}

export function confidenceLabel(confidence: number): string {
  if (confidence >= 80) return "Strong match";
  if (confidence >= 60) return "Likely match";
  return "Check the details";
}

function amountText(suggestion: DetectionSuggestion): string {
  const draft = suggestion.draft;
  if (draft.amountMinor === null) return "Amount not found";
  return money(draft.amountMinor, draft.currency);
}

function destination(suggestion: DetectionSuggestion): string | null {
  const draft = suggestion.draft;
  if (draft.kind === "trial") {
    return draft.trialEndsAt ? `Trial ends ${longDate(draft.trialEndsAt)}` : null;
  }
  if (draft.renewalDate) return `Next payment ${longDate(draft.renewalDate)}`;
  if (draft.occurredAt) return `Charged ${longDate(draft.occurredAt)}`;
  return null;
}

function sourceLabel(suggestion: DetectionSuggestion): string {
  const source = suggestion.source;
  if (!source) return "Imported message";
  const names: Record<string, string> = {
    paste: "Pasted text",
    email: "Forwarded email",
    csv: "CSV import",
    ocr: "Screenshot text",
    upload: "Uploaded text",
    api: "API import",
  };
  const name = names[source.source] ?? "Import";
  const extra = source.subject ? ` · ${source.subject}` : source.fromAddress ? ` · ${source.fromAddress}` : "";
  return `${name}${extra}`;
}

export function DetectionsPage() {
  const [tab, setTab] = useState<"pending" | "accepted" | "rejected">("pending");
  const [reviewing, setReviewing] = useState<DetectionSuggestion | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const summary = useDetectionSummary();
  const list = useDetections(tab);
  const reject = useRejectDetection();
  const rejectAll = useRejectAllDetections();
  const toast = useToast();

  async function dismiss(suggestion: DetectionSuggestion) {
    try {
      await reject.mutateAsync({ id: suggestion.id });
      toast("Dismissed. This message will not be suggested again.", "info");
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  }

  async function dismissAll() {
    try {
      const result = await rejectAll.mutateAsync(undefined);
      setConfirmAll(false);
      toast(`Dismissed ${result.rejected} ${result.rejected === 1 ? "item" : "items"}.`, "info");
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  }

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow="Review inbox"
        title="Detected payments"
        description="Everything found in a forwarded email, pasted message, or statement waits here. Nothing becomes a reminder until you confirm it."
        actions={
          <>
            <Link to="/import">
              <Button variant="secondary">
                <Inbox className="h-4 w-4" />
                Import more
              </Button>
            </Link>
            {tab === "pending" && (summary.data?.pending ?? 0) > 0 ? (
              <Button variant="ghost" onClick={() => setConfirmAll(true)}>
                <Trash2 className="h-4 w-4" />
                Dismiss all
              </Button>
            ) : null}
          </>
        }
      />

      {summary.data && (summary.data.pending > 0 || summary.data.blocked > 0) ? (
        <div className="mb-5 grid gap-2 sm:grid-cols-3">
          <SummaryTile
            label="Ready to save"
            value={summary.data.ready}
            tone="brand"
            detail="Enough detail to add"
          />
          <SummaryTile
            label="Need a date"
            value={summary.data.needsDetails}
            tone="amber"
            detail="Open one and fill the gap"
          />
          <SummaryTile
            label="Not a charge"
            value={summary.data.blocked}
            tone="slate"
            detail="Refunds, declines and holds"
          />
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "pending", label: `To review${summary.data?.pending ? ` (${summary.data.pending})` : ""}` },
            { value: "accepted", label: "Saved" },
            { value: "rejected", label: "Dismissed" },
          ]}
        />
        <button
          type="button"
          onClick={() => {
            void list.refetch();
            void summary.refetch();
          }}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-ink"
        >
          <RefreshCw className={cx("h-3.5 w-3.5", list.isFetching && "animate-spin")} />
          Refresh
        </button>
      </div>

      {list.isLoading ? <LoadingBlock label="Loading detected payments" /> : null}

      {list.isError ? (
        <Note tone="error">
          Could not load reviewed items. {errorMessage(list.error)}
        </Note>
      ) : null}

      {list.data && list.data.suggestions.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="h-5 w-5" />}
          title={tab === "pending" ? "Nothing waiting for review" : "Nothing here yet"}
          description={
            tab === "pending"
              ? "Forward a receipt to your DueRadar address, paste a message, or import a statement. New finds appear here for approval."
              : "Items you review will be listed here."
          }
          action={
            <Link to="/import">
              <Button>
                <Inbox className="h-4 w-4" />
                Import a message
              </Button>
            </Link>
          }
        />
      ) : null}

      <div className="space-y-3">
        {tab === "pending"
          ? list.data?.suggestions
              .filter((entry) => entry.actionable)
              .map((suggestion) => (
                <SuggestionCard
                  key={suggestion.id}
                  suggestion={suggestion}
                  onReview={() => setReviewing(suggestion)}
                  onDismiss={() => void dismiss(suggestion)}
                  dismissing={reject.isPending}
                />
              ))
          : list.data?.suggestions.map((suggestion) => (
              <ResolvedCard key={suggestion.id} suggestion={suggestion} />
            ))}
      </div>

      {tab === "pending" && (list.data?.suggestions.some((entry) => !entry.actionable) ?? false) ? (
        <section className="mt-8">
          <div className="mb-3">
            <h2 className="font-display text-lg font-semibold text-ink">Messages that are not charges</h2>
            <p className="text-xs text-muted">
              Refunds, reversals, declines, card checks and wallet transfers are never turned into a
              bill. They stay here so the message is accounted for.
            </p>
          </div>
          <div className="space-y-2">
            {list.data?.suggestions
              .filter((entry) => !entry.actionable)
              .map((suggestion) => (
                <BlockedCard
                  key={suggestion.id}
                  suggestion={suggestion}
                  onDismiss={() => void dismiss(suggestion)}
                />
              ))}
          </div>
        </section>
      ) : null}

      {reviewing ? (
        <ReviewModal
          suggestion={reviewing}
          onClose={() => setReviewing(null)}
        />
      ) : null}

      <ConfirmDialog
        open={confirmAll}
        onClose={() => setConfirmAll(false)}
        onConfirm={() => void dismissAll()}
        title="Dismiss every pending item?"
        description="They will not be suggested again, even if the same message is imported later. You can always add a record by hand."
        confirmLabel="Dismiss all"
        loading={rejectAll.isPending}
      />
    </div>
  );
}

function SummaryTile({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: number;
  detail: string;
  tone: "brand" | "amber" | "slate";
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-muted">{label}</p>
        <Badge tone={tone}>{value}</Badge>
      </div>
      <p className="mt-1 text-xs text-muted">{detail}</p>
    </div>
  );
}

function SuggestionCard({
  suggestion,
  onReview,
  onDismiss,
  dismissing,
}: {
  suggestion: DetectionSuggestion;
  onReview: () => void;
  onDismiss: () => void;
  dismissing: boolean;
}) {
  const draft = suggestion.draft;
  const place = destination(suggestion);
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={kindTone(draft.kind)}>{KIND_LABELS[draft.kind] ?? draft.kind}</Badge>
            <Badge tone={draft.confidence >= 80 ? "brand" : draft.confidence >= 60 ? "amber" : "slate"}>
              {confidenceLabel(draft.confidence)}
            </Badge>
            {suggestion.needsDetails ? <Badge tone="amber">Missing a date</Badge> : null}
          </div>
          <h2 className="mt-2.5 font-display text-lg font-semibold tracking-[-0.01em] text-ink">
            {draft.merchant ?? "Unknown merchant"}
          </h2>
          <p className="mt-0.5 text-sm text-ink-soft">
            <span className="font-semibold tabular-nums">{amountText(suggestion)}</span>
            {draft.cycle ? ` · ${cycleLabel(draft.cycle, draft.customIntervalDays)}` : ""}
            {place ? ` · ${place}` : ""}
          </p>
          <p className="mt-1.5 text-xs text-muted">{sourceLabel(suggestion)}</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Button onClick={onReview}>
            <Check className="h-4 w-4" />
            Review and save
          </Button>
          <Button variant="ghost" onClick={onDismiss} loading={dismissing}>
            <X className="h-4 w-4" />
            Dismiss
          </Button>
        </div>
      </div>

      {draft.evidence.length > 0 ? (
        <div className="mt-3 rounded-xl bg-paper-deep/50 px-3 py-2.5">
          <p className="text-[0.65rem] font-bold uppercase tracking-[0.12em] text-muted">Why we think so</p>
          <ul className="mt-1.5 space-y-1">
            {draft.evidence.slice(0, 3).map((item, index) => (
              <li key={`${item.field}-${index}`} className="text-xs leading-relaxed text-ink-soft">
                <span className="font-semibold text-ink">{item.field}:</span> {item.text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {draft.warnings.length > 0 ? (
        <ul className="mt-2.5 flex flex-wrap gap-1.5">
          {draft.warnings.slice(0, 4).map((warning) => (
            <li key={warning.code} className="rounded-full bg-amber-soft px-2.5 py-1 text-[0.7rem] font-medium text-amber-strong">
              {warning.message}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function BlockedCard({
  suggestion,
  onDismiss,
}: {
  suggestion: DetectionSuggestion;
  onDismiss: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface/70 px-4 py-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-paper-deep text-muted">
        <AlertTriangle className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">
          {suggestion.draft.merchant ?? "Unknown merchant"}
          {suggestion.draft.amountMinor !== null
            ? ` · ${money(suggestion.draft.amountMinor, suggestion.draft.currency)}`
            : ""}
        </p>
        <p className="text-xs text-muted">{suggestion.blockedReason}</p>
      </div>
      <Button size="sm" variant="ghost" onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  );
}

function ResolvedCard({ suggestion }: { suggestion: DetectionSuggestion }) {
  const accepted = suggestion.status === "accepted";
  return (
    <Card className="flex flex-wrap items-center gap-3 p-4">
      <span
        className={cx(
          "grid h-9 w-9 shrink-0 place-items-center rounded-xl",
          accepted ? "bg-brand-50 text-brand-700" : "bg-paper-deep text-muted",
        )}
      >
        {accepted ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">
          {suggestion.draft.merchant ?? "Unknown merchant"} · {amountText(suggestion)}
        </p>
        <p className="text-xs text-muted">
          {accepted ? "Saved to tracked items" : "Dismissed"} ·{" "}
          {suggestion.resolvedAt ? timeAgo(suggestion.resolvedAt) : timeAgo(suggestion.createdAt)}
        </p>
      </div>
      {accepted && suggestion.acceptedSubscriptionId ? (
        <Link
          to={`/subscriptions/${suggestion.acceptedSubscriptionId}`}
          className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"
        >
          Open
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      ) : null}
    </Card>
  );
}

function ReviewModal({
  suggestion,
  onClose,
}: {
  suggestion: DetectionSuggestion;
  onClose: () => void;
}) {
  const draft = suggestion.draft;
  const me = useMe();
  const categories = useCategories();
  const methods = usePaymentMethods();
  const accept = useAcceptDetection();
  const toast = useToast();
  const [kind, setKind] = useState<"subscription" | "bill" | "trial">(
    draft.kind === "bill" || draft.kind === "trial" ? draft.kind : "subscription",
  );
  const [name, setName] = useState(draft.merchant ?? "");
  const [vendor, setVendor] = useState(draft.vendor ?? "");
  const [amount, setAmount] = useState(
    draft.amountMinor === null ? "" : minorToMajor(draft.amountMinor, draft.currency).toFixed(2),
  );
  const [currency, setCurrency] = useState(draft.currency || me.data?.profile.currency || "GHS");
  const [cycle, setCycle] = useState<BillingCycle>(draft.cycle ?? "monthly");
  const [customDays, setCustomDays] = useState(String(draft.customIntervalDays ?? 30));
  const [anchorDate, setAnchorDate] = useState(draft.renewalDate ?? "");
  const [trialEndsAt, setTrialEndsAt] = useState(draft.trialEndsAt ?? "");
  const [categoryId, setCategoryId] = useState("");
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    const nextErrors: Record<string, string> = {};
    const amountMinor = parseMoneyInput(amount, currency);
    if (!name.trim()) nextErrors.name = "Add a name.";
    if (amountMinor === null) nextErrors.amount = "Enter a valid amount.";
    else if (amountMinor === 0 && kind !== "trial") nextErrors.amount = "Use a positive amount, or dismiss this.";
    if (kind === "trial" && !trialEndsAt) nextErrors.trialEndsAt = "Trials need an end date.";
    if (kind !== "trial" && !anchorDate) nextErrors.anchorDate = "Add the next payment date.";
    if (cycle === "custom_days") {
      const days = Number(customDays);
      if (!Number.isInteger(days) || days < 1 || days > 366) {
        nextErrors.customDays = "Use a whole number from 1 to 366.";
      }
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setFormError("Check the highlighted fields. We only save dates you confirm.");
      return;
    }

    try {
      const result = await accept.mutateAsync({
        id: suggestion.id,
        overrides: {
          kind,
          name: name.trim(),
          vendor: vendor.trim() || null,
          amountMinor: amountMinor ?? 0,
          currency,
          cycle,
          customIntervalDays: cycle === "custom_days" ? Number(customDays) : null,
          anchorDate: kind === "trial" ? trialEndsAt : anchorDate,
          trialEndsAt: kind === "trial" ? trialEndsAt : null,
          categoryId: categoryId || null,
          paymentMethodId: paymentMethodId || null,
          notes: notes.trim() || null,
        },
      });
      toast(
        result.recordedPayments > 0
          ? `Saved with ${result.recordedPayments} past ${result.recordedPayments === 1 ? "payment" : "payments"} in history.`
          : "Saved. Reminders are being planned.",
      );
      onClose();
    } catch (error) {
      setFormError(errorMessage(error));
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Review before saving"
      description="This becomes a tracked record and reminders only after you save it. Edit anything that looks wrong."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={accept.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="detection-review-form" loading={accept.isPending}>
            <Check className="h-4 w-4" />
            Save record
          </Button>
        </>
      }
    >
      <Note tone="info" className="mb-4">
        {sourceLabel(suggestion)} · {confidenceLabel(draft.confidence)}.{" "}
        {draft.occurredAt ? `Message date ${shortDate(draft.occurredAt)}.` : "No charge date was stated."}
      </Note>

      {formError ? (
        <Note tone="error" className="mb-4">
          {formError}
        </Note>
      ) : null}

      {draft.evidence.length > 0 ? (
        <div className="mb-4 rounded-xl border border-line bg-paper-deep/40 px-3 py-2.5">
          <p className="text-[0.65rem] font-bold uppercase tracking-[0.12em] text-muted">Evidence</p>
          <ul className="mt-1.5 space-y-1">
            {draft.evidence.slice(0, 4).map((item, index) => (
              <li key={`${item.field}-${index}`} className="text-xs leading-relaxed text-ink-soft">
                <span className="font-semibold text-ink">{item.field}:</span> {item.text}
                <span className="ml-1 text-[0.65rem] uppercase tracking-wide text-muted">
                  ({item.origin})
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <form id="detection-review-form" onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid grid-cols-3 gap-2">
          {(["bill", "subscription", "trial"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={kind === value}
              onClick={() => setKind(value)}
              className={cx(
                "rounded-xl border px-3 py-2 text-sm font-semibold transition",
                kind === value
                  ? "border-brand-600 bg-brand-50 text-brand-900"
                  : "border-line bg-surface text-muted hover:border-line-strong",
              )}
            >
              {value === "bill" ? "Bill" : value === "subscription" ? "Subscription" : "Free trial"}
            </button>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="detection-name" error={errors.name}>
            <Input
              id="detection-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Netflix, ECG, Spotify…"
            />
          </Field>
          <Field label="Vendor" htmlFor="detection-vendor" hint="Optional. Kept on exports.">
            <Input
              id="detection-vendor"
              value={vendor}
              onChange={(event) => setVendor(event.target.value)}
              placeholder="Netflix Inc."
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-[1.2fr_0.8fr]">
          <Field
            label={kind === "trial" ? "Price after the trial" : "Amount"}
            htmlFor="detection-amount"
            error={errors.amount}
            hint={kind === "trial" ? "Use 0 if you plan to cancel before the charge." : undefined}
          >
            <Input
              id="detection-amount"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00"
            />
          </Field>
          <Field label="Currency" htmlFor="detection-currency">
            <Select
              id="detection-currency"
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
            >
              {CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {kind !== "trial" ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Repeats" htmlFor="detection-cycle">
                <Select
                  id="detection-cycle"
                  value={cycle}
                  onChange={(event) => setCycle(event.target.value as BillingCycle)}
                >
                  {CYCLES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </Select>
              </Field>
              {cycle === "custom_days" ? (
                <Field label="Days between payments" htmlFor="detection-days" error={errors.customDays}>
                  <Input
                    id="detection-days"
                    inputMode="numeric"
                    value={customDays}
                    onChange={(event) => setCustomDays(event.target.value.replace(/\D/g, ""))}
                  />
                </Field>
              ) : null}
            </div>
            <Field
              label="Next payment date"
              htmlFor="detection-anchor"
              error={errors.anchorDate}
              hint="Required. We will not guess a renewal date from a one-off charge."
            >
              <Input
                id="detection-anchor"
                type="date"
                value={anchorDate}
                onChange={(event) => setAnchorDate(event.target.value)}
              />
            </Field>
          </>
        ) : (
          <Field
            label="Trial ends on"
            htmlFor="detection-trial-end"
            error={errors.trialEndsAt}
            hint="We remind you 3 and 1 days before this date. The first paid charge stays separate."
          >
            <Input
              id="detection-trial-end"
              type="date"
              value={trialEndsAt}
              onChange={(event) => setTrialEndsAt(event.target.value)}
            />
          </Field>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category" htmlFor="detection-category">
            <Select
              id="detection-category"
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
            >
              <option value="">No category</option>
              {(categories.data?.categories ?? []).map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Paid with" htmlFor="detection-method">
            <Select
              id="detection-method"
              value={paymentMethodId}
              onChange={(event) => setPaymentMethodId(event.target.value)}
            >
              <option value="">Not specified</option>
              {(methods.data?.paymentMethods ?? []).map((method) => (
                <option key={method.id} value={method.id}>
                  {method.label}
                  {method.last4 ? ` ····${method.last4}` : ""}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Notes" htmlFor="detection-notes" hint="Optional.">
          <Textarea
            id="detection-notes"
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Cancel before renewal · family plan"
          />
        </Field>

        {draft.transactions && draft.transactions.length > 0 ? (
          <div className="rounded-xl border border-line bg-paper-deep/40 px-3 py-2.5">
            <p className="text-[0.65rem] font-bold uppercase tracking-[0.12em] text-muted">
              Payment history to import
            </p>
            <p className="mt-1 text-xs text-muted">
              {draft.transactions.length} confirmed {draft.transactions.length === 1 ? "charge" : "charges"} from the statement will be added to this record's history. Duplicates are skipped.
            </p>
          </div>
        ) : null}

        <div className="flex items-start gap-2 rounded-xl bg-paper-deep/50 px-3.5 py-3 text-xs leading-relaxed text-muted">
          <CalendarDays className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            Future amounts are projections from this schedule, not confirmed charges. You can edit
            the record at any time.
          </span>
        </div>
      </form>
    </Modal>
  );
}
