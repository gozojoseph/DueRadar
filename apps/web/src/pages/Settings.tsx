import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  BellRing,
  Check,
  CreditCard,
  Crown,
  Download,
  LogOut,
  Mail,
  Pencil,
  Plus,
  Settings2,
  Shield,
  Smartphone,
  Tag,
  Trash2,
  UserRound,
  Wallet,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Field,
  Input,
  LoadingBlock,
  Note,
  PageHeader,
  Select,
  cx,
  useToast,
} from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { useAuth } from "../lib/session";
import {
  useCategories,
  useBillingPlan,
  useConfig,
  useCreateCategory,
  useCreatePaymentMethod,
  useDeleteCategory,
  useDeletePaymentMethod,
  useDevices,
  useMarkNotificationsRead,
  useMe,
  usePaymentMethods,
  useRemoveDevice,
  useRegisterDevice,
  useTestEmail,
  useTestPush,
  useStartBillingCheckout,
  useUpdateProfile,
  useVerifyBillingCheckout,
} from "../lib/queries";
import { pushSupported, subscribeToPush, unsubscribeFromPush } from "../lib/push";

const TIMEZONES = [
  "Africa/Accra",
  "Africa/Abidjan",
  "Africa/Lagos",
  "Africa/Nairobi",
  "Africa/Johannesburg",
  "Europe/London",
  "Europe/Paris",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Asia/Dubai",
  "Asia/Kolkata",
  "UTC",
];

const CURRENCIES = ["GHS", "USD", "EUR", "GBP", "NGN", "ZAR", "KES", "XOF", "CAD"];

const METHOD_KINDS = [
  { value: "card", label: "Card" },
  { value: "momo", label: "Mobile money" },
  { value: "bank", label: "Bank account" },
  { value: "wallet", label: "Wallet" },
  { value: "cash", label: "Cash" },
  { value: "other", label: "Other" },
] as const;

const SECTION_LINKS = [
  { href: "#plan", label: "Plan" },
  { href: "#profile", label: "Profile" },
  { href: "#reminders", label: "Reminders" },
  { href: "#notifications", label: "Notifications" },
  { href: "#categories", label: "Categories" },
  { href: "#payment-methods", label: "Payment methods" },
  { href: "#data", label: "Data & privacy" },
];

function ReminderToggle({
  id,
  checked,
  onChange,
  label,
  description,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5">
      <div className="min-w-0">
        <p id={`${id}-label`} className="text-sm font-semibold text-ink">
          {label}
        </p>
        <p id={`${id}-description`} className="mt-0.5 text-xs leading-relaxed text-muted">
          {description}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        <span
          aria-hidden="true"
          className={cx(
            "w-7 text-right text-xs font-semibold",
            checked ? "text-brand-800" : "text-muted",
          )}
        >
          {checked ? "On" : "Off"}
        </span>
        <button
          id={id}
          type="button"
          role="switch"
          aria-checked={checked}
          aria-labelledby={`${id}-label`}
          aria-describedby={`${id}-description`}
          onClick={() => onChange(!checked)}
          className="relative h-11 w-14 shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-700/25"
        >
          <span
            aria-hidden="true"
            className={cx(
              "absolute left-1 top-1/2 h-7 w-12 -translate-y-1/2 rounded-full transition-colors motion-reduce:transition-none",
              checked ? "bg-brand-700" : "bg-line-strong",
            )}
          />
          <span
            aria-hidden="true"
            className={cx(
              "absolute left-2 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-white shadow-md ring-1 ring-black/10 transition-transform motion-reduce:transition-none",
              checked ? "translate-x-5" : "translate-x-0",
            )}
          />
        </button>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const me = useMe();
  const config = useConfig();
  const plan = useBillingPlan();
  const devices = useDevices();
  const categories = useCategories();
  const methods = usePaymentMethods();
  const updateProfile = useUpdateProfile();
  const createCategory = useCreateCategory();
  const deleteCategory = useDeleteCategory();
  const createMethod = useCreatePaymentMethod();
  const deleteMethod = useDeletePaymentMethod();
  const registerDevice = useRegisterDevice();
  const removeDevice = useRemoveDevice();
  const testEmail = useTestEmail();
  const testPush = useTestPush();
  const startBillingCheckout = useStartBillingCheckout();
  const verifyBillingCheckout = useVerifyBillingCheckout();
  const markNotifications = useMarkNotificationsRead();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();
  const billingReturnHandled = useRef(false);

  const [profileForm, setProfileForm] = useState({
    displayName: "",
    currency: "GHS",
    timezone: "Africa/Accra",
    weekStartsOn: 1,
  });
  const [reminderForm, setReminderForm] = useState({
    reminderTime: "09:00",
    quietHoursStart: "21:00",
    quietHoursEnd: "07:00",
    emailReminders: true,
    pushReminders: false,
    overdueReminders: true,
  });
  const [loaded, setLoaded] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [reminderError, setReminderError] = useState<string | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [categoryColor, setCategoryColor] = useState("#0f766e");
  const [methodForm, setMethodForm] = useState({
    label: "",
    kind: "card" as "card" | "momo" | "bank" | "wallet" | "cash" | "other",
    last4: "",
  });
  const [currentEndpoint, setCurrentEndpoint] = useState<string | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<
    | { type: "category"; id: string; name: string }
    | { type: "method"; id: string; name: string }
    | { type: "device"; id: string; name: string }
    | null
  >(null);
  const [exporting, setExporting] = useState(false);
  const [pendingPaymentReference, setPendingPaymentReference] = useState<string | null>(null);
  const billingReference = searchParams.get("reference");
  const billingReturn = searchParams.get("billing") === "return";

  useEffect(() => {
    if (!billingReturn || billingReturnHandled.current) return;
    billingReturnHandled.current = true;
    const clearPaymentParams = () => {
      const next = new URLSearchParams(searchParams);
      next.delete("billing");
      next.delete("reference");
      next.delete("trxref");
      setSearchParams(next, { replace: true });
    };
    if (!billingReference) {
      toast("The payment provider did not return a payment reference.", "error");
      clearPaymentParams();
      return;
    }

    void verifyBillingCheckout
      .mutateAsync(billingReference)
      .then((result) => {
        toast(
          result.status === "paid"
            ? "DueRadar Plus is active. Thank you!"
            : "Payment is not confirmed yet. Your plan will update after Paystack confirms it.",
          result.status === "paid" ? "success" : "info",
        );
        setPendingPaymentReference(result.status === "pending" ? billingReference : null);
      })
      .catch((caught) => {
        setPendingPaymentReference(billingReference);
        toast(errorMessage(caught), "error");
      })
      .finally(clearPaymentParams);
  }, [
    billingReference,
    billingReturn,
    searchParams,
    setSearchParams,
    toast,
    verifyBillingCheckout,
  ]);

  useEffect(() => {
    if (loaded || !me.data) return;
    const profile = me.data.profile;
    setProfileForm({
      displayName: profile.displayName ?? "",
      currency: profile.currency || "GHS",
      timezone: profile.timezone || "Africa/Accra",
      weekStartsOn: profile.weekStartsOn ?? 1,
    });
    setReminderForm({
      reminderTime: profile.reminderTime || "09:00",
      quietHoursStart: profile.quietHoursStart || "21:00",
      quietHoursEnd: profile.quietHoursEnd || "07:00",
      emailReminders: profile.emailReminders,
      pushReminders: profile.pushReminders,
      overdueReminders: profile.overdueReminders,
    });
    setLoaded(true);
  }, [me.data, loaded]);

  useEffect(() => {
    if (!pushSupported()) return;
    let cancelled = false;
    navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => {
        if (!cancelled) setCurrentEndpoint(subscription?.endpoint ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const currentDevice = useMemo(
    () => devices.data?.devices.find((device) => device.endpoint && device.endpoint === currentEndpoint),
    [devices.data, currentEndpoint],
  );

  const hasDefaults = useMemo(
    () => (methods.data?.paymentMethods ?? []).some((method) => method.isDefault),
    [methods.data],
  );

  async function saveProfile() {
    setProfileError(null);
    try {
      await updateProfile.mutateAsync({
        displayName: profileForm.displayName.trim() || null,
        currency: profileForm.currency,
        timezone: profileForm.timezone,
        weekStartsOn: Number(profileForm.weekStartsOn),
      });
      toast("Profile updated.");
    } catch (caught) {
      setProfileError(errorMessage(caught));
    }
  }

  async function beginCheckout(interval: "monthly" | "annual") {
    try {
      const result = await startBillingCheckout.mutateAsync(interval);
      window.location.assign(result.checkoutUrl);
    } catch (caught) {
      toast(errorMessage(caught), "error");
    }
  }

  async function checkPendingPayment() {
    if (!pendingPaymentReference) return;
    try {
      const result = await verifyBillingCheckout.mutateAsync(pendingPaymentReference);
      if (result.status === "paid") {
        setPendingPaymentReference(null);
        toast("DueRadar Plus is active. Thank you!");
      } else {
        toast("Paystack has not confirmed the payment yet.", "info");
      }
    } catch (caught) {
      toast(errorMessage(caught), "error");
    }
  }

  async function saveReminders() {
    setReminderError(null);
    try {
      await updateProfile.mutateAsync({
        reminderTime: reminderForm.reminderTime,
        quietHoursStart: reminderForm.quietHoursStart,
        quietHoursEnd: reminderForm.quietHoursEnd,
        emailReminders: reminderForm.emailReminders,
        pushReminders: reminderForm.pushReminders,
        overdueReminders: reminderForm.overdueReminders,
      });
      toast("Reminder settings saved. Future reminders were replanned.");
    } catch (caught) {
      setReminderError(errorMessage(caught));
    }
  }

  async function enablePush() {
    const key = config.data?.vapidPublicKey;
    if (!pushSupported() || !key) {
      toast("Push is not available on this browser or environment.", "error");
      return;
    }
    setPushBusy(true);
    try {
      const subscription = await subscribeToPush(key);
      await registerDevice.mutateAsync({
        endpoint: subscription.endpoint,
        keys: subscription.keys,
        platform: /iphone|ipad|ipod/i.test(navigator.userAgent)
          ? "ios"
          : /android/i.test(navigator.userAgent)
            ? "android"
            : "web",
      });
      setCurrentEndpoint(subscription.endpoint);
      await devices.refetch();
      toast("Notifications enabled on this device.");
    } catch (caught) {
      toast(errorMessage(caught), "error");
    } finally {
      setPushBusy(false);
    }
  }

  async function disableThisBrowser() {
    setPushBusy(true);
    try {
      const endpoint = await unsubscribeFromPush();
      if (currentDevice) await removeDevice.mutateAsync(currentDevice.id);
      setCurrentEndpoint(null);
      await devices.refetch();
      toast(endpoint ? "Notifications disabled on this browser." : "No browser subscription found.");
    } catch (caught) {
      toast(errorMessage(caught), "error");
    } finally {
      setPushBusy(false);
    }
  }

  async function sendTestEmail() {
    try {
      const result = await testEmail.mutateAsync();
      toast(result.message);
    } catch (caught) {
      toast(errorMessage(caught), "error");
    }
  }

  async function sendTestPush() {
    try {
      const result = await testPush.mutateAsync();
      if (result.sent === 0) {
        toast(
          result.failed > 0
            ? result.failures[0]?.reason ?? "Push failed for every registered device."
            : "No push-enabled devices yet.",
          "error",
        );
      } else if (result.failed > 0) {
        toast(
          `Test sent to ${result.sent} device${result.sent === 1 ? "" : "s"}; ${result.failed} failed: ${result.failures[0]?.reason ?? "delivery failed."}`,
          "info",
        );
      } else {
        toast(`Test sent to ${result.sent} ${result.sent === 1 ? "device" : "devices"}.`);
      }
    } catch (caught) {
      toast(errorMessage(caught), "error");
    }
  }

  async function addCategory() {
    if (categoryName.trim().length < 1) return;
    try {
      await createCategory.mutateAsync({ name: categoryName.trim(), color: categoryColor });
      setCategoryName("");
      toast("Category added.");
    } catch (caught) {
      toast(errorMessage(caught), "error");
    }
  }

  async function addMethod() {
    if (methodForm.label.trim().length < 1) return;
    if (methodForm.last4 && !/^\d{4}$/.test(methodForm.last4)) {
      toast("Use the last four digits only.", "error");
      return;
    }
    try {
      await createMethod.mutateAsync({
        label: methodForm.label.trim(),
        kind: methodForm.kind,
        last4: methodForm.last4 || null,
        isDefault: !hasDefaults,
      });
      setMethodForm({ label: "", kind: "card", last4: "" });
      toast("Payment method added.");
    } catch (caught) {
      toast(errorMessage(caught), "error");
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    try {
      if (pendingDelete.type === "category") await deleteCategory.mutateAsync(pendingDelete.id);
      else if (pendingDelete.type === "device") await removeDevice.mutateAsync(pendingDelete.id);
      else await deleteMethod.mutateAsync(pendingDelete.id);
      toast("Removed.");
      setPendingDelete(null);
    } catch (caught) {
      toast(errorMessage(caught), "error");
    }
  }

  async function exportData() {
    setExporting(true);
    try {
      const { blob, filename } = await api.download("/export");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast("Your export is downloading.");
    } catch (caught) {
      toast(errorMessage(caught), "error");
    } finally {
      setExporting(false);
    }
  }

  async function markEverythingRead() {
    try {
      await markNotifications.mutateAsync({ all: true });
      toast("Notifications marked read.");
    } catch (caught) {
      toast(errorMessage(caught), "error");
    }
  }

  async function logout() {
    await signOut();
    navigate("/", { replace: true });
  }

  if (me.isLoading) return <LoadingBlock label="Loading settings" />;

  const profile = me.data?.profile;

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow="Settings"
        title="Your account"
        description="Profile, reminder rhythm, devices and the data you have stored here."
        actions={
          <Button variant="secondary" onClick={() => void logout()}>
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        }
      />

      <nav className="no-scrollbar -mx-1 mb-5 flex gap-1.5 overflow-x-auto px-1 pb-1" aria-label="Settings sections">
        {SECTION_LINKS.map((link) => (
          <a
            key={link.href}
            href={link.href}
            className="shrink-0 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink-soft transition hover:border-brand-300 hover:text-ink"
          >
            {link.label}
          </a>
        ))}
      </nav>

      <div className="space-y-5">
        <section id="plan" className="scroll-mt-24">
          <Card className="p-5 sm:p-6">
            <SectionTitle
              icon={<Crown className="h-4 w-4" />}
              title="Your DueRadar plan"
              description="Plus unlocks unlimited active items and all import methods."
            />
            {plan.isLoading ? <LoadingBlock label="Loading your plan" /> : null}
            {plan.isError ? (
              <Note tone="error" className="mb-4">
                Could not load your plan. {errorMessage(plan.error)}
              </Note>
            ) : null}
            {plan.data ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={plan.data.tier === "plus" ? "brand" : "slate"}>
                    {plan.data.tier === "plus" ? "DueRadar Plus" : "Free plan"}
                  </Badge>
                  {plan.data.grandfathered ? (
                    <span className="text-xs text-muted">Lifetime access for existing members</span>
                  ) : plan.data.expiresAt ? (
                    <span className="text-xs text-muted">
                      {plan.data.tier === "plus" ? "Access until" : "Plus expired"}{" "}
                      {new Date(plan.data.expiresAt).toLocaleDateString()}
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-sm text-ink-soft">
                  {plan.data.activeItemLimit === null
                    ? `${plan.data.activeItems} active items · no limit`
                    : `${plan.data.activeItems} of ${plan.data.activeItemLimit} active items used`}
                </p>
                {!plan.data.grandfathered ? (
                  <>
                    {!plan.data.configured ? (
                      <Note tone="warn" className="mt-4">
                        Online payments are not configured yet. Your current plan remains available.
                      </Note>
                    ) : null}
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        disabled={!plan.data.configured || startBillingCheckout.isPending}
                        loading={startBillingCheckout.isPending}
                        onClick={() => void beginCheckout("monthly")}
                      >
                        {plan.data.tier === "plus" ? "Renew" : "Plus"} · GHS{" "}
                        {plan.data.prices.monthly.amount}/month
                      </Button>
                      <Button
                        disabled={!plan.data.configured || startBillingCheckout.isPending}
                        loading={startBillingCheckout.isPending}
                        onClick={() => void beginCheckout("annual")}
                      >
                        {plan.data.tier === "plus" ? "Renew" : "Plus"} · GHS{" "}
                        {plan.data.prices.annual.amount}/year
                      </Button>
                    </div>
                    <p className="mt-2 text-xs text-muted">
                      {plan.data.tier === "plus"
                        ? "One-time renewal extends your current term. No automatic charges."
                        : "One-time payment for the selected term. No automatic charges."}
                    </p>
                  </>
                ) : null}
                {pendingPaymentReference ? (
                  <Note tone="warn" className="mt-4">
                    Payment confirmation is still pending.
                    <Button
                      className="ml-2"
                      variant="ghost"
                      size="sm"
                      loading={verifyBillingCheckout.isPending}
                      onClick={() => void checkPendingPayment()}
                    >
                      Check payment
                    </Button>
                  </Note>
                ) : null}
              </>
            ) : null}
          </Card>
        </section>

        <section id="profile" className="scroll-mt-24">
          <Card className="p-5 sm:p-6">
            <SectionTitle
              icon={<UserRound className="h-4 w-4" />}
              title="Profile"
              description="How DueRadar addresses you and displays money and dates."
            />
            {profileError ? (
              <Note tone="error" className="mb-4">
                {profileError}
              </Note>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Display name" htmlFor="settings-name">
                <Input
                  id="settings-name"
                  value={profileForm.displayName}
                  onChange={(event) =>
                    setProfileForm((current) => ({ ...current, displayName: event.target.value }))
                  }
                  placeholder="Ama"
                />
              </Field>
              <Field label="Email" htmlFor="settings-email" hint="Used for sign-in and email reminders.">
                <Input id="settings-email" value={me.data?.user.email ?? ""} disabled readOnly />
              </Field>
              <Field label="Default currency" htmlFor="settings-currency">
                <Select
                  id="settings-currency"
                  value={profileForm.currency}
                  onChange={(event) =>
                    setProfileForm((current) => ({ ...current, currency: event.target.value }))
                  }
                >
                  {CURRENCIES.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Time zone"
                htmlFor="settings-timezone"
                hint="Existing records keep their original currency."
              >
                <Select
                  id="settings-timezone"
                  value={profileForm.timezone}
                  onChange={(event) =>
                    setProfileForm((current) => ({ ...current, timezone: event.target.value }))
                  }
                >
                  {TIMEZONES.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone.replaceAll("_", " ")}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Week starts on" htmlFor="settings-week">
                <Select
                  id="settings-week"
                  value={profileForm.weekStartsOn}
                  onChange={(event) =>
                    setProfileForm((current) => ({
                      ...current,
                      weekStartsOn: Number(event.target.value),
                    }))
                  }
                >
                  <option value={1}>Monday</option>
                  <option value={0}>Sunday</option>
                </Select>
              </Field>
            </div>
            <div className="mt-4 flex justify-end">
              <Button onClick={() => void saveProfile()} loading={updateProfile.isPending}>
                <Check className="h-4 w-4" />
                Save profile
              </Button>
            </div>
          </Card>
        </section>

        <section id="reminders" className="scroll-mt-24">
          <Card className="p-5 sm:p-6">
            <SectionTitle
              icon={<BellRing className="h-4 w-4" />}
              title="Reminder rhythm"
              description="The default time and channels. Each record can override its own plan."
            />
            {reminderError ? (
              <Note tone="error" className="mb-4">
                {reminderError}
              </Note>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Send at" htmlFor="settings-reminder-time">
                <Input
                  id="settings-reminder-time"
                  type="time"
                  value={reminderForm.reminderTime}
                  onChange={(event) =>
                    setReminderForm((current) => ({ ...current, reminderTime: event.target.value }))
                  }
                />
              </Field>
              <Field label="Quiet hours from" htmlFor="settings-quiet-start">
                <Input
                  id="settings-quiet-start"
                  type="time"
                  value={reminderForm.quietHoursStart}
                  onChange={(event) =>
                    setReminderForm((current) => ({
                      ...current,
                      quietHoursStart: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="Quiet hours until" htmlFor="settings-quiet-end">
                <Input
                  id="settings-quiet-end"
                  type="time"
                  value={reminderForm.quietHoursEnd}
                  onChange={(event) =>
                    setReminderForm((current) => ({ ...current, quietHoursEnd: event.target.value }))
                  }
                />
              </Field>
            </div>

            <div className="mt-3 divide-y divide-line/70 rounded-xl border border-line px-4">
              <ReminderToggle
                id="settings-email-reminders"
                checked={reminderForm.emailReminders}
                onChange={(next) =>
                  setReminderForm((current) => ({ ...current, emailReminders: next }))
                }
                label="Email reminders"
                description={
                  config.data && !config.data.emailConfigured
                    ? "Email is not configured on this environment yet; the preference is saved."
                    : `Sent to ${profile?.email ?? "your account email"}.`
                }
              />
              <ReminderToggle
                id="settings-push-reminders"
                checked={reminderForm.pushReminders}
                onChange={(next) =>
                  setReminderForm((current) => ({ ...current, pushReminders: next }))
                }
                label="Push reminders"
                description="Requires at least one registered device below."
              />
              <ReminderToggle
                id="settings-overdue-reminders"
                checked={reminderForm.overdueReminders}
                onChange={(next) =>
                  setReminderForm((current) => ({ ...current, overdueReminders: next }))
                }
                label="Overdue nudges"
                description="If something is still unpaid, nudge at +1, +3 and +7 days after the due date, then stop."
              />
            </div>

            <div className="mt-4 flex justify-end">
              <Button onClick={() => void saveReminders()} loading={updateProfile.isPending}>
                <Check className="h-4 w-4" />
                Save reminders
              </Button>
            </div>
          </Card>
        </section>

        <section id="notifications" className="scroll-mt-24">
          <Card className="p-5 sm:p-6">
            <SectionTitle
              icon={<Smartphone className="h-4 w-4" />}
              title="Devices and delivery"
              description="Test the channels and manage where push notifications arrive."
            />

            {!pushSupported() ? (
              <Note tone="info" className="mb-4">
                This browser does not support Web Push. On iPhone, add DueRadar to the Home Screen and
                open it there first.
              </Note>
            ) : config.data && !config.data.pushConfigured ? (
              <Note tone="warn" className="mb-4">
                Push is not configured on this environment yet. Add VAPID keys to the server to enable
                it.
              </Note>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {currentDevice ? (
                <Button variant="secondary" onClick={() => void disableThisBrowser()} loading={pushBusy}>
                  <Smartphone className="h-4 w-4" />
                  Turn off on this browser
                </Button>
              ) : (
                <Button
                  onClick={() => void enablePush()}
                  loading={pushBusy}
                  disabled={!config.data?.pushConfigured}
                >
                  <BellRing className="h-4 w-4" />
                  Enable on this browser
                </Button>
              )}
              <Button
                variant="secondary"
                onClick={() => void sendTestPush()}
                loading={testPush.isPending}
                disabled={!config.data?.pushConfigured}
              >
                Send test push
              </Button>
              <Button
                variant="secondary"
                onClick={() => void sendTestEmail()}
                loading={testEmail.isPending}
                disabled={!config.data?.emailConfigured}
              >
                <Mail className="h-4 w-4" />
                Send test email
              </Button>
              <Button variant="ghost" onClick={() => void markEverythingRead()}>
                Mark in-app alerts read
              </Button>
            </div>

            <div className="mt-5">
              <p className="mb-2 text-[0.7rem] font-bold uppercase tracking-[0.12em] text-muted">
                Registered devices
              </p>
              {devices.isLoading ? (
                <div className="skeleton h-16 rounded-xl" />
              ) : (devices.data?.devices.length ?? 0) === 0 ? (
                <div className="rounded-xl border border-dashed border-line-strong px-4 py-5 text-sm text-muted">
                  No devices yet. Enable notifications on the browser or phone you want us to reach.
                </div>
              ) : (
                <ul className="divide-y divide-line/70 rounded-xl border border-line">
                  {devices.data?.devices.map((device) => {
                    const isCurrent = currentDevice?.id === device.id;
                    return (
                      <li key={device.id} className="flex items-center gap-3 px-4 py-3">
                        <span className="grid h-8 w-8 place-items-center rounded-lg bg-paper-deep text-ink-soft">
                          <Smartphone className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-2 text-sm font-medium text-ink">
                            {device.platform === "ios"
                              ? "iPhone or iPad"
                              : device.platform === "android"
                                ? "Android device"
                                : "Browser"}
                            {isCurrent ? <Badge tone="brand">This browser</Badge> : null}
                          </p>
                          <p className="truncate text-[0.7rem] text-muted">
                            Last seen{" "}
                            {new Date(device.lastSeenAt).toLocaleDateString(undefined, {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}
                            {device.userAgent ? ` · ${device.userAgent.slice(0, 48)}` : ""}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setPendingDelete({
                              type: "device",
                              id: device.id,
                              name: isCurrent ? "this device" : "this registered device",
                            })
                          }
                        >
                          Remove
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Card>
        </section>

        <section id="categories" className="scroll-mt-24">
          <Card className="p-5 sm:p-6">
            <SectionTitle
              icon={<Tag className="h-4 w-4" />}
              title="Categories"
              description="Optional labels and colours for grouping your records."
            />
            {(categories.data?.categories.length ?? 0) === 0 ? (
              <p className="text-sm text-muted">No categories yet. Add one below.</p>
            ) : (
              <ul className="divide-y divide-line/70 rounded-xl border border-line">
                {categories.data?.categories.map((category) => (
                  <li key={category.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: category.color }}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                      {category.name}
                    </span>
                    {category.isDefault ? <Badge tone="slate">Default</Badge> : null}
                    <button
                      type="button"
                      aria-label={`Delete ${category.name}`}
                      onClick={() =>
                        setPendingDelete({ type: "category", id: category.id, name: category.name })
                      }
                      className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-danger-soft hover:text-danger-strong"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <form
              className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end"
              onSubmit={(event) => {
                event.preventDefault();
                void addCategory();
              }}
            >
              <Field label="New category" htmlFor="category-name" className="flex-1">
                <Input
                  id="category-name"
                  value={categoryName}
                  onChange={(event) => setCategoryName(event.target.value)}
                  placeholder="Utilities, family, work…"
                />
              </Field>
              <Field label="Colour" htmlFor="category-color">
                <input
                  id="category-color"
                  type="color"
                  value={categoryColor}
                  onChange={(event) => setCategoryColor(event.target.value)}
                  className="h-11 w-14 cursor-pointer rounded-xl border border-line-strong bg-white p-1"
                />
              </Field>
              <Button type="submit" variant="secondary" loading={createCategory.isPending}>
                <Plus className="h-4 w-4" />
                Add
              </Button>
            </form>
          </Card>
        </section>

        <section id="payment-methods" className="scroll-mt-24">
          <Card className="p-5 sm:p-6">
            <SectionTitle
              icon={<CreditCard className="h-4 w-4" />}
              title="Payment methods"
              description="Labels only. Never add a full card number, CVV, or mobile-money PIN."
            />
            {(methods.data?.paymentMethods.length ?? 0) === 0 ? (
              <p className="text-sm text-muted">No payment methods yet.</p>
            ) : (
              <ul className="divide-y divide-line/70 rounded-xl border border-line">
                {methods.data?.paymentMethods.map((method) => (
                  <li key={method.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="grid h-8 w-8 place-items-center rounded-lg bg-paper-deep text-ink-soft">
                      <Wallet className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">
                        {method.label}
                        {method.last4 ? ` ···· ${method.last4}` : ""}
                      </p>
                      <p className="text-[0.7rem] capitalize text-muted">{method.kind}</p>
                    </div>
                    {method.isDefault ? <Badge tone="brand">Default</Badge> : null}
                    <button
                      type="button"
                      aria-label={`Remove ${method.label}`}
                      onClick={() =>
                        setPendingDelete({ type: "method", id: method.id, name: method.label })
                      }
                      className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-danger-soft hover:text-danger-strong"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-4 grid gap-3 sm:grid-cols-[1.2fr_0.8fr_0.6fr_auto] sm:items-end">
              <Field label="Label" htmlFor="method-label">
                <Input
                  id="method-label"
                  value={methodForm.label}
                  onChange={(event) =>
                    setMethodForm((current) => ({ ...current, label: event.target.value }))
                  }
                  placeholder="MTN MoMo, visa ending 4242…"
                />
              </Field>
              <Field label="Kind" htmlFor="method-kind">
                <Select
                  id="method-kind"
                  value={methodForm.kind}
                  onChange={(event) =>
                    setMethodForm((current) => ({
                      ...current,
                      kind: event.target.value as typeof methodForm.kind,
                    }))
                  }
                >
                  {METHOD_KINDS.map((kind) => (
                    <option key={kind.value} value={kind.value}>
                      {kind.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Last four" htmlFor="method-last4" hint="optional">
                <Input
                  id="method-last4"
                  inputMode="numeric"
                  maxLength={4}
                  value={methodForm.last4}
                  onChange={(event) =>
                    setMethodForm((current) => ({
                      ...current,
                      last4: event.target.value.replace(/\D/g, "").slice(0, 4),
                    }))
                  }
                  placeholder="4242"
                />
              </Field>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void addMethod()}
                loading={createMethod.isPending}
              >
                <Plus className="h-4 w-4" />
                Add
              </Button>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              DueRadar never stores card numbers, CVVs or PINs. These labels only help you remember
              which account paid a bill.
            </p>
          </Card>
        </section>

        <section id="data" className="scroll-mt-24">
          <Card className="p-5 sm:p-6">
            <SectionTitle
              icon={<Shield className="h-4 w-4" />}
              title="Data and privacy"
              description="Export a copy, review the policies, or close your account."
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-line p-4">
                <p className="text-sm font-semibold text-ink">Export your data</p>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  A JSON file with your profile, records, occurrences, payments, categories and
                  notification history. Device secrets and raw imports are excluded.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-3"
                  onClick={() => void exportData()}
                  loading={exporting}
                >
                  <Download className="h-3.5 w-3.5" />
                  Download export
                </Button>
              </div>
              <div className="rounded-xl border border-danger-strong/20 bg-danger-soft/30 p-4">
                <p className="text-sm font-semibold text-ink">Delete your account</p>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  Removes your records, payments, reminders, devices and sign-in credentials
                  immediately. This cannot be undone.
                </p>
                <Link to="/settings/account">
                  <Button variant="secondary" size="sm" className="mt-3">
                    <Trash2 className="h-3.5 w-3.5" />
                    Review deletion
                  </Button>
                </Link>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs font-semibold text-brand-700">
              <Link to="/privacy" className="hover:underline">
                Privacy notice
              </Link>
              <Link to="/terms" className="hover:underline">
                Terms of use
              </Link>
              <Link to="/security" className="hover:underline">
                Security
              </Link>
              {config.data?.supportEmail ? (
                <a href={`mailto:${config.data.supportEmail}`} className="hover:underline">
                  {config.data.supportEmail}
                </a>
              ) : null}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line/70 pt-4 text-[0.7rem] text-muted">
              <Badge tone="plain">DueRadar 0.1.0</Badge>
              <span>Default: GHS · Africa/Accra</span>
              {config.data ? (
                <span className="ml-auto">Environment: {config.data.environment}</span>
              ) : null}
            </div>
          </Card>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface/60 px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-muted">
            <Settings2 className="h-3.5 w-3.5" />
            Signed in as {me.data?.user.email}
          </div>
          <Button variant="ghost" size="sm" onClick={() => void logout()}>
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
        title={
          pendingDelete?.type === "category"
            ? "Delete category?"
            : pendingDelete?.type === "device"
              ? "Remove this device?"
              : "Remove item?"
        }
        description={
          pendingDelete?.type === "category"
            ? `"${pendingDelete.name}" will be removed from your records. Records in it become uncategorised.`
            : pendingDelete?.type === "device"
              ? `"${pendingDelete.name}" will stop receiving push notifications. You can enable them again on that browser later.`
              : pendingDelete
                ? `"${pendingDelete.name}" will stop receiving reminders. Records that referenced it become unset.`
                : undefined
        }
        confirmLabel="Remove"
        cancelLabel="Keep it"
        loading={
          deleteCategory.isPending || deleteMethod.isPending || removeDevice.isPending
        }
      />
    </div>
  );
}

function SectionTitle({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
        {icon}
      </span>
      <div>
        <h2 className="text-[0.95rem] font-semibold text-ink">{title}</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">{description}</p>
      </div>
    </div>
  );
}
