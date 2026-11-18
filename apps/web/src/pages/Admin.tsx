import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Search,
  ShieldAlert,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Link } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  LoadingBlock,
  Modal,
  Note,
  PageHeader,
  Select,
  Textarea,
  useToast,
} from "../components/ui";
import { errorMessage } from "../lib/api";
import {
  useAdminBilling,
  useAdminOverview,
  useAdminPayments,
  useAdminUsers,
  useMe,
  useSetAccountSuspension,
  useSetCheckoutProvider,
} from "../lib/queries";
import type {
  AdminBillingTransaction,
  AdminPayments,
  AdminUser,
  CheckoutProviderId,
} from "../lib/types";

const PAGE_SIZE = 25;

function formatMoney(amountMinor: number | string, currency = "GHS"): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(Number(amountMinor) / 100);
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : "—";
}

export function AdminPage() {
  const [section, setSection] = useState<"users" | "billing" | "payments">("users");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [billingStatus, setBillingStatus] =
    useState<"all" | "pending" | "paid" | "failed">("all");
  const [offset, setOffset] = useState(0);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [reason, setReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [providerChoice, setProviderChoice] = useState<CheckoutProviderId>("paystack");
  const [providerError, setProviderError] = useState<string | null>(null);
  const overview = useAdminOverview();
  const users = useAdminUsers(
    { search: appliedSearch, limit: PAGE_SIZE, offset },
    section === "users",
  );
  const billing = useAdminBilling({
    search: appliedSearch,
    status: billingStatus,
    limit: PAGE_SIZE,
    offset,
  }, section === "billing");
  const payments = useAdminPayments(section === "payments");
  const setProvider = useSetCheckoutProvider();
  const me = useMe();
  const setSuspension = useSetAccountSuspension();
  const toast = useToast();

  useEffect(() => {
    const timer = window.setTimeout(() => setAppliedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (payments.data) setProviderChoice(payments.data.activeProvider);
  }, [payments.data]);

  function changeSection(next: "users" | "billing" | "payments") {
    setSection(next);
    setOffset(0);
    setSearch("");
    setAppliedSearch("");
  }

  async function submitSuspension(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedUser) return;
    setActionError(null);
    try {
      await setSuspension.mutateAsync({
        userId: selectedUser.userId,
        suspended: !selectedUser.suspendedAt,
        reason: reason.trim(),
      });
      toast(selectedUser.suspendedAt ? "Account reactivated." : "Account suspended.");
      setSelectedUser(null);
      setReason("");
    } catch (error) {
      setActionError(errorMessage(error));
    }
  }

  async function submitProvider() {
    if (!payments.data || providerChoice === payments.data.activeProvider) return;
    setProviderError(null);
    try {
      await setProvider.mutateAsync({ provider: providerChoice });
      toast("Checkout provider updated.");
    } catch (error) {
      setProviderError(errorMessage(error));
    }
  }

  const isBilling = section === "billing";
  const currentPage = isBilling ? billing.data : users.data;
  const sectionError =
    section === "users"
      ? users.error
      : section === "billing"
        ? billing.error
        : payments.error;
  const pageError = overview.error ?? sectionError;
  const pageLoading =
    overview.isLoading ||
    (section === "users"
      ? users.isLoading
      : section === "billing"
        ? billing.isLoading
        : payments.isLoading);
  const total = currentPage?.total ?? 0;
  const pageEnd = Math.min(offset + PAGE_SIZE, total);

  return (
    <div className="animate-rise">
      <Link
        to="/"
        className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        Back to DueRadar
      </Link>

      <PageHeader
        eyebrow="Administration"
        title="Admin dashboard"
        description="Review account and billing status, and manage account access."
      />

      <Note tone="info" className="mb-5">
        Admin views contain account metadata and billing status only; tracked bills, notes and
        payment-log contents are not shown.
      </Note>

      {pageError ? (
        <Note tone="error" className="mb-5">
          {errorMessage(pageError)}
        </Note>
      ) : null}

      <section
        aria-label="Service overview"
        className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
      >
        <Metric
          label="Accounts"
          value={overview.data?.totalUsers}
          icon={<Users className="h-4 w-4" />}
        />
        <Metric label="Plus members" value={overview.data?.plusMembers} />
        <Metric label="Active items" value={overview.data?.activeItems} />
        <Metric label="Paid checkouts" value={overview.data?.paidTransactions} />
        <Metric
          label="Gross paid"
          value={overview.data ? formatMoney(overview.data.grossPaidMinor) : undefined}
          detail={
            overview.data
              ? `${overview.data.pendingPayments} payment${overview.data.pendingPayments === 1 ? "" : "s"} pending`
              : undefined
          }
        />
      </section>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/80 p-4 sm:px-5">
          <div
            className="flex gap-1 rounded-full bg-paper-deep p-1"
            role="tablist"
            aria-label="Admin sections"
          >
            <button
              type="button"
              role="tab"
              aria-selected={section === "users"}
              onClick={() => changeSection("users")}
              className={`rounded-full px-4 py-2 text-sm font-semibold ${section === "users" ? "bg-white text-brand-800 shadow-sm" : "text-muted"}`}
            >
              Users
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={section === "billing"}
              onClick={() => changeSection("billing")}
              className={`rounded-full px-4 py-2 text-sm font-semibold ${section === "billing" ? "bg-white text-brand-800 shadow-sm" : "text-muted"}`}
            >
              Billing
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={section === "payments"}
              onClick={() => changeSection("payments")}
              className={`rounded-full px-4 py-2 text-sm font-semibold ${section === "payments" ? "bg-white text-brand-800 shadow-sm" : "text-muted"}`}
            >
              Payments
            </button>
          </div>
          {section !== "payments" ? (
          <div className="flex w-full gap-2 sm:w-auto">
            <label className="relative min-w-0 flex-1 sm:w-72">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
                aria-hidden
              />
              <Input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setOffset(0);
                }}
                aria-label={isBilling ? "Search payments" : "Search users"}
                placeholder={isBilling ? "Email or reference" : "Name or email"}
                className="pl-9"
              />
            </label>
            {isBilling ? (
              <Select
                aria-label="Filter payments by status"
                value={billingStatus}
                onChange={(event) => {
                  setBillingStatus(event.target.value as typeof billingStatus);
                  setOffset(0);
                }}
                className="w-32"
              >
                <option value="all">All statuses</option>
                <option value="pending">Pending</option>
                <option value="paid">Paid</option>
                <option value="failed">Failed</option>
              </Select>
            ) : null}
          </div>
          ) : null}
        </div>

        {pageLoading ? (
          <LoadingBlock
            label={`Loading ${
              section === "billing"
                ? "billing records"
                : section === "payments"
                  ? "payment settings"
                  : "accounts"
            }`}
          />
        ) : section === "payments" ? (
          <PaymentsPanel
            payments={payments.data}
            choice={providerChoice}
            onChoice={setProviderChoice}
            onSave={() => void submitProvider()}
            saving={setProvider.isPending}
            error={providerError}
          />
        ) : isBilling ? (
          <BillingTable
            transactions={billing.data?.transactions ?? []}
            total={total}
            offset={offset}
            pageEnd={pageEnd}
            onPrevious={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            onNext={() => setOffset(offset + PAGE_SIZE)}
          />
        ) : (
          <UsersTable
            users={users.data?.users ?? []}
            total={total}
            offset={offset}
            pageEnd={pageEnd}
            currentUserId={me.data?.user.id}
            onAction={(user) => {
              setSuspension.reset();
              setActionError(null);
              setReason("");
              setSelectedUser(user);
            }}
            onPrevious={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            onNext={() => setOffset(offset + PAGE_SIZE)}
          />
        )}
      </Card>

      <Modal
        open={Boolean(selectedUser)}
        onClose={() => {
          if (!setSuspension.isPending) setSelectedUser(null);
        }}
        title={selectedUser?.suspendedAt ? "Reactivate account?" : "Suspend account?"}
        description={
          selectedUser
            ? `${selectedUser.email} will ${selectedUser.suspendedAt ? "regain" : "lose"} access to normal app features.`
            : undefined
        }
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setSelectedUser(null)}
              disabled={setSuspension.isPending}
            >
              Cancel
            </Button>
            <Button
              variant={selectedUser?.suspendedAt ? "primary" : "danger"}
              form="admin-suspension-form"
              type="submit"
              loading={setSuspension.isPending}
              disabled={reason.trim().length < 5}
            >
              {selectedUser?.suspendedAt ? "Reactivate account" : "Suspend account"}
            </Button>
          </>
        }
      >
        <form id="admin-suspension-form" onSubmit={(event) => void submitSuspension(event)}>
          {actionError ? (
            <Note tone="error" className="mb-4">
              {actionError}
            </Note>
          ) : null}
          <Field
            label={selectedUser?.suspendedAt ? "Reactivation reason" : "Reason shown to the user"}
            htmlFor="admin-action-reason"
            hint="Required and recorded in the administrative audit log. Do not include sensitive details."
          >
            <Textarea
              id="admin-action-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={4}
              maxLength={500}
              minLength={5}
              required
              autoFocus
            />
          </Field>
        </form>
      </Modal>
    </div>
  );
}

function Metric({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value?: string | number;
  detail?: string;
  icon?: ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2 text-xs font-semibold text-muted">
        {label}
        {icon}
      </div>
      <p className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink tabular-nums">
        {value ?? "—"}
      </p>
      {detail ? <p className="mt-1 text-[0.7rem] text-muted">{detail}</p> : null}
    </Card>
  );
}

function UsersTable({
  users,
  total,
  offset,
  pageEnd,
  currentUserId,
  onAction,
  onPrevious,
  onNext,
}: {
  users: AdminUser[];
  total: number;
  offset: number;
  pageEnd: number;
  currentUserId?: string;
  onAction: (user: AdminUser) => void;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <>
      {users.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted">No matching accounts.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-paper/70 text-xs text-muted">
              <tr>
                <th className="px-5 py-3 font-semibold">Account</th>
                <th className="px-4 py-3 font-semibold">Plan</th>
                <th className="px-4 py-3 font-semibold">Active items</th>
                <th className="px-4 py-3 font-semibold">Created</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {users.map((user) => (
                <tr key={user.userId} className="align-top">
                  <td className="px-5 py-4">
                    <p className="font-semibold text-ink">{user.displayName || user.email}</p>
                    {user.displayName ? <p className="mt-0.5 text-xs text-muted">{user.email}</p> : null}
                  </td>
                  <td className="px-4 py-4">
                    <Badge tone={user.plan === "plus" ? "brand" : "slate"}>
                      {user.planGrandfathered && user.plan === "plus" ? "Plus · legacy" : user.plan}
                    </Badge>
                    {user.planExpiresAt && user.plan === "plus" && !user.planGrandfathered ? (
                      <p className="mt-1 text-[0.7rem] text-muted">
                        Until {formatDate(user.planExpiresAt)}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-4 tabular-nums">{user.activeItems}</td>
                  <td className="px-4 py-4 whitespace-nowrap">{formatDate(user.createdAt)}</td>
                  <td className="px-4 py-4">
                    {user.suspendedAt ? (
                      <>
                        <Badge tone="danger">Suspended</Badge>
                        {user.suspensionReason ? (
                          <p className="mt-1 max-w-48 text-xs leading-relaxed text-muted">
                            {user.suspensionReason}
                          </p>
                        ) : null}
                      </>
                    ) : (
                      <Badge tone="brand">Active</Badge>
                    )}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <Button
                      size="sm"
                      variant={user.suspendedAt ? "secondary" : "danger"}
                      onClick={() => onAction(user)}
                      disabled={user.userId === currentUserId && !user.suspendedAt}
                    >
                      {user.userId === currentUserId
                        ? user.suspendedAt
                          ? "Reactivate"
                          : "Your account"
                        : user.suspendedAt
                          ? "Reactivate"
                          : "Suspend"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination
        total={total}
        offset={offset}
        pageEnd={pageEnd}
        onPrevious={onPrevious}
        onNext={onNext}
      />
    </>
  );
}

function BillingTable({
  transactions,
  total,
  offset,
  pageEnd,
  onPrevious,
  onNext,
}: {
  transactions: AdminBillingTransaction[];
  total: number;
  offset: number;
  pageEnd: number;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <>
      {transactions.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted">No matching payment records.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-left text-sm">
            <thead className="bg-paper/70 text-xs text-muted">
              <tr>
                <th className="px-5 py-3 font-semibold">Account / reference</th>
                <th className="px-4 py-3 font-semibold">Amount</th>
                <th className="px-4 py-3 font-semibold">Term</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {transactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td className="px-5 py-4">
                    <p className="font-semibold text-ink">{transaction.email ?? "Deleted account"}</p>
                    <p className="mt-0.5 font-mono text-xs text-muted">{transaction.reference}</p>
                  </td>
                  <td className="px-4 py-4 font-semibold tabular-nums">
                    {formatMoney(transaction.amountMinor, transaction.currency)}
                  </td>
                  <td className="px-4 py-4 capitalize">{transaction.interval}</td>
                  <td className="px-4 py-4">
                    <Badge
                      tone={
                        transaction.status === "paid"
                          ? "brand"
                          : transaction.status === "failed"
                            ? "danger"
                            : "amber"
                      }
                    >
                      {transaction.status}
                    </Badge>
                  </td>
                  <td className="px-5 py-4 whitespace-nowrap">
                    {formatDate(transaction.paidAt ?? transaction.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination
        total={total}
        offset={offset}
        pageEnd={pageEnd}
        onPrevious={onPrevious}
        onNext={onNext}
      />
    </>
  );
}

function Pagination({
  total,
  offset,
  pageEnd,
  onPrevious,
  onNext,
}: {
  total: number;
  offset: number;
  pageEnd: number;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex items-center justify-between border-t border-line/80 px-4 py-3 sm:px-5">
      <p className="text-xs text-muted">
        {total === 0 ? "0 records" : `${offset + 1}–${pageEnd} of ${total}`}
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={onPrevious}
          disabled={offset === 0}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          Previous
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={onNext}
          disabled={pageEnd >= total}
          aria-label="Next page"
        >
          Next
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

export function SuspendedAccountPage({
  email,
  reason,
}: {
  email: string;
  reason: string | null;
}) {
  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <Card className="w-full max-w-xl p-6 sm:p-8">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-danger-soft text-danger-strong">
          <ShieldAlert className="h-6 w-6" aria-hidden />
        </span>
        <div className="mt-5 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-danger-strong" aria-hidden />
          <p className="text-xs font-semibold uppercase tracking-wide text-danger-strong">
            Account access restricted
          </p>
        </div>
        <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink">
          Your DueRadar account is suspended
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Normal app features are unavailable for <span className="font-semibold text-ink">{email}</span>.
          You can still download your data or permanently delete your account.
        </p>
        {reason ? (
          <div className="mt-5 rounded-xl bg-paper-deep p-4">
            <p className="text-xs font-semibold text-ink">Reason</p>
            <p className="mt-1 text-sm leading-relaxed text-ink-soft">{reason}</p>
          </div>
        ) : null}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Link
            to="/settings/account"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-brand-800 px-5 text-sm font-semibold text-white hover:bg-brand-900"
          >
            Open export and deletion options
          </Link>
          <a
            href="mailto:support@dueradar.cloud"
            className="inline-flex h-11 items-center justify-center rounded-full border border-line-strong px-5 text-sm font-semibold text-ink-soft hover:bg-paper-deep"
          >
            Contact support
          </a>
        </div>
      </Card>
    </div>
  );
}

const PROVIDER_COPY: Record<
  CheckoutProviderId,
  { description: string; unavailable: string }
> = {
  paystack: {
    description:
      "Mobile money and card checkout for Ghana. Collects Plus upgrades and settles to your Paystack balance.",
    unavailable: "",
  },
  yebeck: {
    description:
      "Merchant portal with settlement tracking. Chosen for its settlement terms.",
    unavailable:
      "Not integrated yet — DueRadar has no Yebeck checkout adapter, so it cannot collect payments. Send the integration docs when they arrive and it becomes selectable.",
  },
};

function PaymentsPanel({
  payments,
  choice,
  onChoice,
  onSave,
  saving,
  error,
}: {
  payments: AdminPayments | undefined;
  choice: CheckoutProviderId;
  onChoice: (provider: CheckoutProviderId) => void;
  onSave: () => void;
  saving: boolean;
  error: string | null;
}) {
  if (!payments) {
    return <p className="px-5 py-10 text-center text-sm text-muted">Payment settings unavailable.</p>;
  }

  return (
    <div className="p-5">
      <div className="mb-4 flex items-start gap-3">
        <CreditCard className="mt-0.5 h-5 w-5 shrink-0 text-brand-700" aria-hidden />
        <div>
          <h3 className="text-sm font-bold text-ink">Checkout provider</h3>
          <p className="mt-1 max-w-prose text-xs leading-relaxed text-muted">
            Collects new Plus upgrades. Payments already in progress always settle with the
            provider that started them, so switching is safe at any time. Changes are recorded
            in the administrative audit log.
          </p>
        </div>
      </div>

      {error ? (
        <Note tone="error" className="mb-4">
          {error}
        </Note>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Checkout provider">
        {payments.providers.map((provider) => {
          const selected = provider.id === choice;
          const active = provider.id === payments.activeProvider;
          const copy = PROVIDER_COPY[provider.id];
          return (
            <label
              key={provider.id}
              className={`cursor-pointer rounded-2xl border p-4 transition ${
                selected
                  ? "border-brand-600 bg-brand-50/60 shadow-sm"
                  : "border-line hover:border-line-strong"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 text-sm font-bold text-ink">
                  <input
                    type="radio"
                    name="checkout-provider"
                    value={provider.id}
                    checked={selected}
                    onChange={() => onChoice(provider.id)}
                    disabled={!provider.available}
                    className="h-4 w-4 accent-brand-600"
                  />
                  {provider.name}
                </span>
                <Badge
                  tone={active ? "brand" : provider.available ? "slate" : "plain"}
                >
                  {active ? "Active" : provider.available ? "Ready" : "Not configured"}
                </Badge>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted">{copy.description}</p>
              {!provider.available && copy.unavailable ? (
                <p className="mt-2 text-xs leading-relaxed text-muted">{copy.unavailable}</p>
              ) : null}
            </label>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          onClick={onSave}
          disabled={saving || choice === payments.activeProvider}
        >
          {saving ? "Applying..." : "Apply"}
        </Button>
        <span className="text-xs text-muted">
          Applies to new checkouts immediately — no redeploy needed.
        </span>
      </div>
    </div>
  );
}
