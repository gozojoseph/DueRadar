import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  BellRing,
  CalendarDays,
  Check,
  CreditCard,
  Info,
  Landmark,
  Plus,
  Smartphone,
  Sparkles,
  Tag,
  Wallet,
} from "lucide-react";
import { minorToMajor, parseMoneyInput } from "@dueradar/domain";
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  LoadingBlock,
  Note,
  Select,
  Switch,
  Textarea,
  cx,
  useToast,
} from "../components/ui";
import { PageHeader } from "../components/ui";
import {
  useCategories,
  useCreateSubscription,
  useMe,
  usePaymentMethods,
  useSubscription,
  useUpdateSubscription,
} from "../lib/queries";
import { todayLocal } from "../lib/format";
import { errorMessage } from "../lib/api";
import type { BillingCycle, RecordKind, ReminderChannel } from "../lib/types";

const KINDS: Array<{ value: RecordKind; label: string; icon: typeof CreditCard }> = [
  { value: "bill", label: "Bill", icon: CalendarDays },
  { value: "subscription", label: "Subscription", icon: CreditCard },
  { value: "trial", label: "Free trial", icon: Sparkles },
  { value: "prepaid", label: "Prepaid", icon: Smartphone },
  { value: "installment", label: "Instalment", icon: Landmark },
];

const CURRENCIES = ["GHS", "USD", "EUR", "GBP", "NGN", "ZAR", "KES", "XOF", "CAD"];

const CYCLES: Array<{ value: BillingCycle; label: string }> = [
  { value: "weekly", label: "Every week" },
  { value: "monthly", label: "Every month" },
  { value: "quarterly", label: "Every 3 months" },
  { value: "semiannual", label: "Every 6 months" },
  { value: "annual", label: "Every year" },
  { value: "custom_days", label: "Custom number of days" },
];

const OFFSET_OPTIONS = [7, 3, 1, 0];

const TEMPLATES: Record<string, Partial<{ kind: RecordKind; name: string; vendor: string }>> = {
  bill: { kind: "bill" },
  subscription: { kind: "subscription" },
  trial: { kind: "trial" },
  prepaid: { kind: "prepaid" },
  installment: { kind: "installment" },
};

const QUICK_PICKS: Array<{ name: string; kind: RecordKind; vendor?: string }> = [
  { name: "ECG prepaid", kind: "bill", vendor: "Electricity Company of Ghana" },
  { name: "Ghana Water", kind: "bill", vendor: "Ghana Water Company" },
  { name: "MTN Fibre", kind: "bill", vendor: "MTN Ghana" },
  { name: "Netflix", kind: "subscription" },
  { name: "Spotify", kind: "subscription" },
  { name: "YouTube Premium", kind: "subscription" },
];

function cycleDefault(kind: RecordKind): BillingCycle {
  return "monthly";
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year ?? 2026, (month ?? 1) - 1, (day ?? 1) + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(
    next.getUTCDate(),
  ).padStart(2, "0")}`;
}

function initialAnchorDate(value: string | null): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : addDays(todayLocal(), 7);
}

export function SubscriptionFormPage({ mode }: { mode: "create" | "edit" }) {
  const params = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const me = useMe();
  const existing = useSubscription(mode === "edit" ? params.id : undefined);
  const categories = useCategories();
  const methods = usePaymentMethods();
  const create = useCreateSubscription();
  const update = useUpdateSubscription(params.id ?? "");
  const template = TEMPLATES[search.get("template") ?? ""] ?? {};

  const [kind, setKind] = useState<RecordKind>(template.kind ?? "bill");
  const [name, setName] = useState(template.name ?? "");
  const [vendor, setVendor] = useState(template.vendor ?? "");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("GHS");
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [customDays, setCustomDays] = useState("30");
  const [anchorDate, setAnchorDate] = useState(() => initialAnchorDate(search.get("date")));
  const [endOfMonthMode, setEndOfMonthMode] = useState(false);
  const [trialEndsAt, setTrialEndsAt] = useState(addDays(todayLocal(), 14));
  const [categoryId, setCategoryId] = useState("");
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [offsets, setOffsets] = useState<number[]>([3, 1]);
  const [channels, setChannels] = useState<ReminderChannel[]>(["in_app", "email"]);
  const [status, setStatus] = useState<"active" | "paused" | "cancelled">("active");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const editing = mode === "edit";
  const saving = create.isPending || update.isPending;

  useEffect(() => {
    if (!me.data || loaded) return;
    setCurrency(me.data.profile.currency || "GHS");
    setChannels(
      me.data.profile.emailReminders
        ? ["in_app", "email"]
        : ["in_app"],
    );
  }, [me.data, loaded]);

  useEffect(() => {
    if (editing || loaded) return;
    setOffsets(kind === "trial" ? [3, 1] : [7, 1]);
    if (kind === "trial") {
      setAnchorDate(addDays(todayLocal(), 14));
      setTrialEndsAt(addDays(todayLocal(), 14));
    }
    setCycle(cycleDefault(kind));
  }, [kind, editing, loaded]);

  useEffect(() => {
    if (editing) return;
    setOffsets(kind === "trial" ? [3, 1] : kind === "bill" ? [7, 1] : [3, 1]);
  }, [kind, editing]);

  useEffect(() => {
    if (!editing || loaded || !existing.data) return;
    const record = existing.data.subscription;
    setKind(record.kind);
    setName(record.name);
    setVendor(record.vendor ?? "");
    setAmount(minorToMajor(record.amountMinor, record.currency).toFixed(2));
    setCurrency(record.currency);
    setCycle(record.cycle);
    setCustomDays(String(record.customIntervalDays ?? 30));
    setAnchorDate(record.anchorDate);
    setEndOfMonthMode(record.endOfMonthMode);
    setTrialEndsAt(record.trialEndsAt ?? addDays(record.anchorDate, 14));
    setCategoryId(record.categoryId ?? "");
    setPaymentMethodId(record.paymentMethodId ?? "");
    setUrl(record.url ?? "");
    setNotes(record.notes ?? "");
    setOffsets(record.reminderOffsets ?? (record.kind === "trial" ? [3, 1] : record.kind === "bill" ? [7, 1] : [3, 1]));
    setChannels(record.reminderChannels ?? ["in_app"]);
    setStatus(record.status);
    setLoaded(true);
  }, [editing, existing.data, loaded]);

  const title = editing ? "Edit record" : "Add something to track";
  const sortedMethods = useMemo(
    () =>
      [...(methods.data?.paymentMethods ?? [])].sort((a, b) =>
        Number(b.isDefault) - Number(a.isDefault),
      ),
    [methods.data],
  );

  function toggleOffset(value: number) {
    setOffsets((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value].sort((a, b) => b - a),
    );
  }

  function toggleChannel(value: ReminderChannel) {
    setChannels((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const nextErrors: Record<string, string> = {};

    if (name.trim().length < 1) nextErrors.name = "Give this a name.";
    const amountMinor = parseMoneyInput(amount, currency);
    if (amountMinor === null) nextErrors.amount = "Enter a valid amount.";
    if (cycle === "custom_days") {
      const days = Number(customDays);
      if (!Number.isInteger(days) || days < 1 || days > 366) {
        nextErrors.customDays = "Use a whole number from 1 to 366.";
      }
    }
    if (kind === "trial" && !trialEndsAt) {
      nextErrors.trialEndsAt = "Trials need an end date.";
    }
    if (!anchorDate) nextErrors.anchorDate = "Choose the next due date.";
    if (channels.length === 0) nextErrors.channels = "Pick at least one reminder channel.";

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setFormError("Check the highlighted fields.");
      return;
    }

    const payload = {
      name: name.trim(),
      vendor: vendor.trim() || null,
      kind,
      amountMinor: amountMinor ?? 0,
      currency,
      cycle,
      customIntervalDays: cycle === "custom_days" ? Number(customDays) : null,
      anchorDate: kind === "trial" ? trialEndsAt : anchorDate,
      endOfMonthMode: kind === "trial" ? false : endOfMonthMode,
      trialEndsAt: kind === "trial" ? trialEndsAt : null,
      categoryId: categoryId || null,
      paymentMethodId: paymentMethodId || null,
      url: url.trim() || null,
      notes: notes.trim() || null,
      reminderOffsets: offsets,
      reminderChannels: channels,
      status,
    };

    try {
      if (editing && params.id) {
        const result = await update.mutateAsync(payload);
        toast("Changes saved.");
        navigate(`/subscriptions/${result.subscription.id}`, { replace: true });
      } else {
        const result = await create.mutateAsync(payload);
        toast("Added. Reminders are being planned.");
        navigate(`/subscriptions/${result.subscription.id}`, { replace: true });
      }
    } catch (caught) {
      setFormError(errorMessage(caught));
    }
  }

  if (editing && existing.isLoading) {
    return <LoadingBlock label="Loading this record" />;
  }

  if (editing && (existing.isError || !existing.data)) {
    return (
      <div>
        <PageHeader title="Record not found" description="It may have been deleted." />
        <Link to="/subscriptions">
          <Button variant="secondary">
            <ArrowLeft className="h-4 w-4" />
            Back to tracked items
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="animate-rise">
      <Link
        to={editing && params.id ? `/subscriptions/${params.id}` : "/subscriptions"}
        className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {editing ? "Back to record" : "Back to tracked items"}
      </Link>

      <PageHeader
        eyebrow={editing ? "Edit" : "New record"}
        title={title}
        description={
          editing
            ? "Changes to the schedule rebuild future dates. Payments you already logged stay in history."
            : "A name, the next date, and how often it repeats. Everything else is optional."
        }
      />

      {formError ? (
        <Note tone="error" className="mb-5">
          {formError}
        </Note>
      ) : null}

      <form onSubmit={submit} className="space-y-5" noValidate>
        <Card className="p-5 sm:p-6">
          <p className="mb-3 text-[0.7rem] font-bold uppercase tracking-[0.14em] text-muted">
            What is it?
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {KINDS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => {
                  setKind(item.value);
                  if (item.value === "trial") setTrialEndsAt(trialEndsAt || addDays(todayLocal(), 14));
                }}
                className={cx(
                  "flex flex-col items-start gap-1.5 rounded-xl border px-3 py-2.5 text-left transition",
                  kind === item.value
                    ? "border-brand-600 bg-brand-50 text-brand-900"
                    : "border-line bg-surface text-ink-soft hover:border-line-strong",
                )}
                aria-pressed={kind === item.value}
              >
                <item.icon className="h-4 w-4" aria-hidden />
                <span className="text-[0.8125rem] font-semibold">{item.label}</span>
              </button>
            ))}
          </div>

          {!editing ? (
            <div className="mt-4">
              <p className="mb-2 text-[0.7rem] font-semibold text-muted">Quick picks</p>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_PICKS.map((pick) => (
                  <button
                    key={pick.name}
                    type="button"
                    onClick={() => {
                      setName(pick.name);
                      setVendor(pick.vendor ?? "");
                      setKind(pick.kind);
                    }}
                    className="rounded-full border border-line bg-surface px-2.5 py-1 text-[0.7rem] font-medium text-ink-soft hover:border-brand-300 hover:text-ink"
                  >
                    {pick.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="record-name" error={errors.name}>
              <Input
                id="record-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="MTN Fibre, Rent, Netflix…"
                autoComplete="off"
              />
            </Field>
            <Field label="Vendor or provider" htmlFor="record-vendor" hint="Optional. Useful when you export.">
              <Input
                id="record-vendor"
                value={vendor}
                onChange={(event) => setVendor(event.target.value)}
                placeholder="MTN Ghana"
                autoComplete="off"
              />
            </Field>
          </div>
        </Card>

        <Card className="p-5 sm:p-6">
          <p className="mb-3 text-[0.7rem] font-bold uppercase tracking-[0.14em] text-muted">
            Amount and schedule
          </p>
          <div className="grid gap-4 sm:grid-cols-[1.2fr_0.8fr]">
            <Field
              label={kind === "trial" ? "Price after the trial" : "Amount"}
              htmlFor="record-amount"
              error={errors.amount}
              hint={
                kind === "trial"
                  ? "What the service charges once the trial ends. Use 0 if you will cancel."
                  : "Enter the amount as it appears on the bill."
              }
            >
              <Input
                id="record-amount"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </Field>
            <Field label="Currency" htmlFor="record-currency" hint="Kept as-is per record.">
              <Select
                id="record-currency"
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
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Repeats" htmlFor="record-cycle">
                <Select
                  id="record-cycle"
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
                <Field label="Days between payments" htmlFor="record-custom-days" error={errors.customDays}>
                  <Input
                    id="record-custom-days"
                    inputMode="numeric"
                    value={customDays}
                    onChange={(event) => setCustomDays(event.target.value.replace(/\D/g, ""))}
                  />
                </Field>
              ) : (
                <Field label="Next due date" htmlFor="record-anchor" error={errors.anchorDate}>
                  <Input
                    id="record-anchor"
                    type="date"
                    value={anchorDate}
                    onChange={(event) => setAnchorDate(event.target.value)}
                  />
                </Field>
              )}
            </div>
          ) : (
            <div className="mt-4">
              <Field
                label="Trial ends on"
                htmlFor="record-trial-end"
                error={errors.trialEndsAt}
                hint="We remind you 3 and 1 days before this date."
              >
                <Input
                  id="record-trial-end"
                  type="date"
                  value={trialEndsAt}
                  onChange={(event) => setTrialEndsAt(event.target.value)}
                />
              </Field>
            </div>
          )}

          {kind !== "trial" && cycle === "custom_days" ? (
            <div className="mt-4">
              <Field label="Next due date" htmlFor="record-anchor-custom" error={errors.anchorDate}>
                <Input
                  id="record-anchor-custom"
                  type="date"
                  value={anchorDate}
                  onChange={(event) => setAnchorDate(event.target.value)}
                />
              </Field>
            </div>
          ) : null}

          {kind !== "trial" && (cycle === "monthly" || cycle === "quarterly" || cycle === "semiannual" || cycle === "annual") ? (
            <div className="mt-2">
              <Switch
                checked={endOfMonthMode}
                onChange={setEndOfMonthMode}
                label="Always use the last day of the month"
                description="Useful when a provider charges at month end rather than on a fixed day."
              />
            </div>
          ) : null}

          <div className="mt-3 flex items-start gap-2 rounded-xl bg-paper-deep/50 px-3.5 py-3 text-xs leading-relaxed text-muted">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              Future amounts are projections from this schedule. They are not confirmed charges, and
              DueRadar never moves money.
            </span>
          </div>
        </Card>

        <Card className="p-5 sm:p-6">
          <p className="mb-3 text-[0.7rem] font-bold uppercase tracking-[0.14em] text-muted">
            Organise
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category" htmlFor="record-category">
              <Select
                id="record-category"
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
              <p className="mt-1.5 text-xs text-muted">
                <Link to="/settings#categories" className="font-semibold text-brand-700 hover:underline">
                  Manage categories
                </Link>
              </p>
            </Field>
            <Field label="Paid with" htmlFor="record-method">
              <Select
                id="record-method"
                value={paymentMethodId}
                onChange={(event) => setPaymentMethodId(event.target.value)}
              >
                <option value="">Not specified</option>
                {sortedMethods.map((method) => (
                  <option key={method.id} value={method.id}>
                    {method.label}
                    {method.last4 ? ` ····${method.last4}` : ""}
                  </option>
                ))}
              </Select>
              <p className="mt-1.5 text-xs text-muted">
                <Link to="/settings#payment-methods" className="font-semibold text-brand-700 hover:underline">
                  Manage payment methods
                </Link>
              </p>
            </Field>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Website or app" htmlFor="record-url" hint="optional">
              <Input
                id="record-url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="netflix.com"
                autoComplete="url"
              />
            </Field>
            <Field label="Notes" htmlFor="record-notes" hint="optional">
              <Textarea
                id="record-notes"
                rows={2}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Cancel before renewal · family plan"
              />
            </Field>
          </div>
        </Card>

        <Card className="p-5 sm:p-6">
          <div className="mb-3 flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-brand-50 text-brand-700">
              <BellRing className="h-4 w-4" aria-hidden />
            </span>
            <div>
              <p className="text-sm font-semibold text-ink">Reminders</p>
              <p className="text-xs text-muted">When and where we should nudge you.</p>
            </div>
          </div>

          <p className="mb-2 text-[0.7rem] font-semibold text-muted">Days before</p>
          <div className="flex flex-wrap gap-1.5">
            {OFFSET_OPTIONS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => toggleOffset(value)}
                aria-pressed={offsets.includes(value)}
                className={cx(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                  offsets.includes(value)
                    ? "border-brand-600 bg-brand-50 text-brand-900"
                    : "border-line bg-surface text-muted hover:border-line-strong",
                )}
              >
                {offsets.includes(value) ? <Check className="h-3 w-3" /> : null}
                {value === 0 ? "On the day" : `${value} ${value === 1 ? "day" : "days"}`}
              </button>
            ))}
          </div>
          {offsets.length === 0 ? (
            <p className="mt-2 text-xs text-amber-strong">
              No reminders for this record. You will only see it in the list.
            </p>
          ) : null}

          <p className="mb-2 mt-5 text-[0.7rem] font-semibold text-muted">Channels</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {(
              [
                { value: "in_app", label: "In app", icon: BellRing },
                { value: "email", label: "Email", icon: Wallet },
                { value: "push", label: "Push", icon: Smartphone },
              ] as const
            ).map((channel) => (
              <button
                key={channel.value}
                type="button"
                onClick={() => toggleChannel(channel.value)}
                aria-pressed={channels.includes(channel.value)}
                className={cx(
                  "flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition",
                  channels.includes(channel.value)
                    ? "border-brand-600 bg-brand-50 text-brand-900"
                    : "border-line bg-surface text-muted hover:border-line-strong",
                )}
              >
                <channel.icon className="h-4 w-4" />
                {channel.label}
              </button>
            ))}
          </div>
          {errors.channels ? (
            <p className="mt-2 text-xs font-medium text-danger-strong">{errors.channels}</p>
          ) : null}
          <p className="mt-3 text-xs leading-relaxed text-muted">
            Reminders fire at your profile reminder time. Quiet hours move them to the morning boundary.
          </p>

          {editing ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Status" htmlFor="record-status">
                <Select
                  id="record-status"
                  value={status}
                  onChange={(event) =>
                    setStatus(event.target.value as "active" | "paused" | "cancelled")
                  }
                >
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="cancelled">Cancelled</option>
                </Select>
              </Field>
            </div>
          ) : null}
        </Card>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Link to={editing && params.id ? `/subscriptions/${params.id}` : "/subscriptions"}>
            <Button type="button" variant="secondary" fullWidth className="sm:w-auto">
              Cancel
            </Button>
          </Link>
          <Button type="submit" size="lg" loading={saving} fullWidth className="sm:w-auto">
            {editing ? (
              <>
                <Check className="h-4 w-4" />
                Save changes
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" />
                Add record
              </>
            )}
          </Button>
        </div>

        {!editing ? (
          <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-muted">
            <Badge tone="brand">
              <Tag className="h-3 w-3" /> {kind === "trial" ? "Trial" : currency}
            </Badge>
            <span>You can change all of this later.</span>
          </div>
        ) : null}
      </form>
    </div>
  );
}
