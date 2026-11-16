import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  BellRing,
  CalendarCheck,
  Check,
  Mail,
  Moon,
  Smartphone,
  Wallet,
} from "lucide-react";
import { Badge, Button, Card, Field, Input, LoadingBlock, Note, Select, Switch, cx, useToast } from "../components/ui";
import { Wordmark } from "../components/Logo";
import { useCompleteOnboarding, useConfig, useMe, useRegisterDevice } from "../lib/queries";
import { subscribeToPush, pushSupported } from "../lib/push";
import { errorMessage } from "../lib/api";

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

function detectedTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Africa/Accra";
  } catch {
    return "Africa/Accra";
  }
}

export function OnboardingPage() {
  const navigate = useNavigate();
  const me = useMe();
  const config = useConfig();
  const complete = useCompleteOnboarding();
  const registerDevice = useRegisterDevice();
  const toast = useToast();

  const [step, setStep] = useState(0);
  const [displayName, setDisplayName] = useState("");
  const [currency, setCurrency] = useState("GHS");
  const [timezone, setTimezone] = useState("Africa/Accra");
  const [reminderTime, setReminderTime] = useState("09:00");
  const [quietStart, setQuietStart] = useState("21:00");
  const [quietEnd, setQuietEnd] = useState("07:00");
  const [weekStartsOn, setWeekStartsOn] = useState(1);
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushState, setPushState] = useState<"idle" | "working" | "ready" | "unsupported">("idle");
  const [error, setError] = useState<string | null>(null);
  const [initialised, setInitialised] = useState(false);

  const zones = useMemo(() => {
    const detected = detectedTimeZone();
    return TIMEZONES.includes(detected) ? TIMEZONES : [detected, ...TIMEZONES];
  }, []);

  useEffect(() => {
    if (initialised || !me.data) return;
    const profile = me.data.profile;
    setDisplayName(profile.displayName ?? me.data.user.name ?? "");
    setCurrency(profile.currency || "GHS");
    setTimezone(profile.timezone || "Africa/Accra");
    setReminderTime(profile.reminderTime || "09:00");
    setQuietStart(profile.quietHoursStart || "21:00");
    setQuietEnd(profile.quietHoursEnd || "07:00");
    setWeekStartsOn(profile.weekStartsOn ?? 1);
    setEmailEnabled(profile.emailReminders);
    setPushEnabled(profile.pushReminders);
    setInitialised(true);
  }, [me.data, initialised]);

  if (me.isLoading) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <LoadingBlock label="Getting your account ready" />
      </div>
    );
  }

  if (me.data && !me.data.needsOnboarding) return <Navigate to="/" replace />;

  const totalSteps = 3;
  const canContinue =
    step === 0 ? displayName.trim().length > 1 : step === 1 ? Boolean(reminderTime) : true;

  async function enablePushOnThisDevice() {
    const key = config.data?.vapidPublicKey;
    if (!pushSupported() || !key) {
      setPushState("unsupported");
      return;
    }
    setPushState("working");
    setError(null);
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
      setPushState("ready");
      setPushEnabled(true);
      toast("Notifications are enabled on this device.");
    } catch (caught) {
      setPushState("idle");
      setError(errorMessage(caught));
    }
  }

  async function finish() {
    setError(null);
    try {
      await complete.mutateAsync({
        displayName: displayName.trim(),
        currency,
        timezone,
        reminderTime,
        quietHoursStart: quietStart,
        quietHoursEnd: quietEnd,
        weekStartsOn,
        emailReminders: emailEnabled,
        pushReminders: pushEnabled,
      });
      navigate("/", { replace: true });
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line/70 bg-paper/85 px-4 py-3.5 backdrop-blur sm:px-6">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between">
          <Wordmark />
          <Badge tone="brand">Step {step + 1} of {totalSteps}</Badge>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-6 h-1.5 overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-brand-600 transition-[width] duration-300"
            style={{ width: `${((step + 1) / totalSteps) * 100}%` }}
          />
        </div>

        {error ? (
          <Note tone="error" className="mb-5">
            {error}
          </Note>
        ) : null}

        {step === 0 ? (
          <section className="animate-rise">
            <p className="text-[0.7rem] font-bold uppercase tracking-[0.16em] text-brand-600">
              Your basics
            </p>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.03em] text-ink text-balance">
              Let us set up your view of the month.
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
              This only changes how DueRadar displays things. You can change any of it later in
              Settings.
            </p>

            <Card className="mt-7 space-y-5 p-5 sm:p-6">
              <Field label="What should we call you?" htmlFor="onboarding-name">
                <Input
                  id="onboarding-name"
                  autoComplete="name"
                  placeholder="Ama"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Default currency"
                  htmlFor="onboarding-currency"
                  hint="Each record keeps the currency you choose for it."
                >
                  <Select
                    id="onboarding-currency"
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
                <Field label="Time zone" htmlFor="onboarding-timezone" hint="Used for today and reminder timing.">
                  <Select
                    id="onboarding-timezone"
                    value={timezone}
                    onChange={(event) => setTimezone(event.target.value)}
                  >
                    {zones.map((zone) => (
                      <option key={zone} value={zone}>
                        {zone.replaceAll("_", " ")}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            </Card>
          </section>
        ) : null}

        {step === 1 ? (
          <section className="animate-rise">
            <p className="text-[0.7rem] font-bold uppercase tracking-[0.16em] text-brand-600">
              Reminder rhythm
            </p>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.03em] text-ink text-balance">
              When should we nudge you?
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
              Reminders normally go out at 09:00 local time, 7 and 1 days before a bill. Trials use 3
              and 1 days. You can override this per item.
            </p>

            <Card className="mt-7 space-y-5 p-5 sm:p-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Reminder time" htmlFor="onboarding-reminder-time">
                  <Input
                    id="onboarding-reminder-time"
                    type="time"
                    value={reminderTime}
                    onChange={(event) => setReminderTime(event.target.value)}
                  />
                </Field>
                <Field label="Week starts on" htmlFor="onboarding-week-start">
                  <Select
                    id="onboarding-week-start"
                    value={weekStartsOn}
                    onChange={(event) => setWeekStartsOn(Number(event.target.value))}
                  >
                    <option value={1}>Monday</option>
                    <option value={0}>Sunday</option>
                  </Select>
                </Field>
              </div>

              <div className="rounded-xl border border-line bg-paper-deep/40 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <Moon className="h-4 w-4 text-brand-700" aria-hidden />
                  Quiet hours
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  No reminders inside this window. If a nudge lands here, it moves to the end of quiet
                  hours.
                </p>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <Field label="From" htmlFor="quiet-start">
                    <Input
                      id="quiet-start"
                      type="time"
                      value={quietStart}
                      onChange={(event) => setQuietStart(event.target.value)}
                    />
                  </Field>
                  <Field label="Until" htmlFor="quiet-end">
                    <Input
                      id="quiet-end"
                      type="time"
                      value={quietEnd}
                      onChange={(event) => setQuietEnd(event.target.value)}
                    />
                  </Field>
                </div>
              </div>
            </Card>
          </section>
        ) : null}

        {step === 2 ? (
          <section className="animate-rise">
            <p className="text-[0.7rem] font-bold uppercase tracking-[0.16em] text-brand-600">
              How to reach you
            </p>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.03em] text-ink text-balance">
              Pick the nudges you actually want.
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
              In-app alerts are always on. Email and push are optional, and you can turn either off per
              item.
            </p>

            <Card className="mt-7 divide-y divide-line/80 p-5 sm:p-6">
              <div className="pb-1">
                <div className="flex items-start gap-3 py-2">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
                    <Mail className="h-4.5 w-4.5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <Switch
                      checked={emailEnabled}
                      onChange={setEmailEnabled}
                      label="Email reminders"
                      description="Sent to the address on your account."
                    />
                    {config.data && !config.data.emailConfigured ? (
                      <p className="pb-2 text-xs text-amber-strong">
                        Email delivery is not configured on this environment yet. Your preference is
                        saved for when it is.
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="pt-1">
                <div className="flex items-start gap-3 py-2">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
                    <Smartphone className="h-4.5 w-4.5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <Switch
                      checked={pushEnabled}
                      onChange={(next) => {
                        setPushEnabled(next);
                        if (!next) setPushState("idle");
                      }}
                      label="Push notifications"
                      description="Best on the installed app. iPhone needs DueRadar added to the Home Screen first."
                    />
                    {pushEnabled ? (
                      <div className="pb-2">
                        {pushState === "ready" ? (
                          <p className="flex items-center gap-1.5 text-xs font-semibold text-brand-700">
                            <Check className="h-3.5 w-3.5" /> This device is registered.
                          </p>
                        ) : pushState === "unsupported" ? (
                          <p className="text-xs text-amber-strong">
                            Push is unavailable here. You can enable it later in Settings on a supported
                            device.
                          </p>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            loading={pushState === "working" || registerDevice.isPending}
                            onClick={() => void enablePushOnThisDevice()}
                          >
                            <BellRing className="h-3.5 w-3.5" />
                            Allow notifications on this device
                          </Button>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="pt-4">
                <div className="flex items-start gap-3 rounded-xl bg-brand-50/60 p-3.5 text-xs leading-relaxed text-brand-900">
                  <CalendarCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  First we will show you a few common Ghana bills you can add in one tap, or you can
                  start from a blank list.
                </div>
              </div>
            </Card>
          </section>
        ) : null}

        <div className="mt-7 flex items-center justify-between gap-3">
          <Button
            variant="ghost"
            onClick={() => setStep((value) => Math.max(0, value - 1))}
            disabled={step === 0 || complete.isPending}
            className={cx(step === 0 && "invisible")}
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          {step < totalSteps - 1 ? (
            <Button
              onClick={() => setStep((value) => value + 1)}
              disabled={!canContinue}
              size="lg"
            >
              Continue
              <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={() => void finish()} loading={complete.isPending} size="lg">
              <Wallet className="h-4 w-4" />
              Finish setup
            </Button>
          )}
        </div>
      </main>
    </div>
  );
}
