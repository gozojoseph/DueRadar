import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Clock3, CreditCard, ShieldAlert } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Badge, Button, Card, LoadingBlock, Modal, Note, useToast } from "../components/ui";
import { errorMessage } from "../lib/api";
import { useAuth } from "../lib/session";
import {
  useBillingPlan,
  useStartBillingCheckout,
  useVerifyBillingCheckout,
} from "../lib/queries";

export function PlanSelectionModal({ onLater }: { onLater: () => void }) {
  const plan = useBillingPlan();
  const checkout = useStartBillingCheckout();
  const [error, setError] = useState<string | null>(null);

  async function selectPlan(interval: "monthly" | "annual") {
    setError(null);
    try {
      const result = await checkout.mutateAsync(interval);
      window.location.assign(result.checkoutUrl);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <Modal
      open
      onClose={onLater}
      title="Choose a plan to continue"
      description="New accounts need an active DueRadar Plus plan to unlock the app. There is no free plan or trial for new accounts."
      size="lg"
      footer={
        <div className="flex w-full flex-col items-center gap-2 sm:flex-row sm:justify-between">
          <p className="text-center text-xs text-muted sm:text-left">
            Choose later keeps your account locked. Export and deletion remain available.
          </p>
          <Button variant="secondary" onClick={onLater}>
            Choose later
          </Button>
        </div>
      }
    >
      {plan.isLoading ? <LoadingBlock label="Loading plan options" /> : null}
      {plan.isError ? (
        <Note tone="error" className="mb-4">
          Could not load plan options. {errorMessage(plan.error)}
        </Note>
      ) : null}
      {error ? (
        <Note tone="error" className="mb-4">
          {error}
        </Note>
      ) : null}
      {plan.data && !plan.data.configured ? (
        <Note tone="warn" className="mb-4">
          Online payments are temporarily unavailable. Please choose later and try again.
        </Note>
      ) : null}
      {plan.data ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Card className="p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold text-ink">Plus monthly</h3>
              <Badge tone="slate">1 month</Badge>
            </div>
            <p className="mt-3 font-display text-2xl font-semibold text-ink">
              GHS {plan.data.prices.monthly.amount}
            </p>
            <p className="mt-1 text-xs text-muted">One-time payment. No automatic renewal.</p>
            <Button
              className="mt-4"
              fullWidth
              disabled={!plan.data.configured || checkout.isPending}
              loading={checkout.isPending}
              onClick={() => void selectPlan("monthly")}
            >
              Continue monthly
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          </Card>
          <Card className="border-brand-600/30 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold text-ink">Plus annual</h3>
              <Badge tone="brand">Best value</Badge>
            </div>
            <p className="mt-3 font-display text-2xl font-semibold text-ink">
              GHS {plan.data.prices.annual.amount}
            </p>
            <p className="mt-1 text-xs text-muted">One-time payment. No automatic renewal.</p>
            <Button
              className="mt-4"
              fullWidth
              disabled={!plan.data.configured || checkout.isPending}
              loading={checkout.isPending}
              onClick={() => void selectPlan("annual")}
            >
              Continue annually
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          </Card>
        </div>
      ) : null}
      <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-muted">
        <CreditCard className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        Payments are processed securely by Paystack. You’ll return to DueRadar after checkout.
      </p>
    </Modal>
  );
}

export function PlanRequiredPage({ email }: { email: string }) {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const [signOutError, setSignOutError] = useState<string | null>(null);

  async function leaveAccount() {
    setSignOutError(null);
    try {
      await signOut();
      navigate("/sign-in", { replace: true });
    } catch (caught) {
      setSignOutError(errorMessage(caught));
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <Card className="w-full max-w-xl p-6 sm:p-8">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-amber-soft text-amber-strong">
          <ShieldAlert className="h-6 w-6" aria-hidden />
        </span>
        <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-amber-strong">
          Plan required
        </p>
        <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink">
          Your account is waiting for a plan
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          New DueRadar accounts need an active Plus plan to use the app. There is no free plan or
          free trial for new accounts. You are signed in as{" "}
          <strong className="text-ink">{email}</strong>.
        </p>
        {signOutError ? (
          <Note tone="error" className="mt-4">
            {signOutError}
          </Note>
        ) : null}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Button onClick={() => navigate("/", { replace: true })}>
            Choose a plan
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
          <Link
            to="/settings/account"
            className="inline-flex h-11 items-center justify-center rounded-full border border-line-strong px-5 text-sm font-semibold text-ink-soft hover:bg-paper-deep"
          >
            Export or delete my account
          </Link>
        </div>
        <button
          type="button"
          onClick={() => void leaveAccount()}
          className="mt-4 text-xs font-semibold text-muted hover:text-ink"
        >
          Sign out
        </button>
      </Card>
    </div>
  );
}

export function BillingReturnPage() {
  const [searchParams] = useSearchParams();
  const reference = searchParams.get("reference") || searchParams.get("trxref");
  const verify = useVerifyBillingCheckout();
  const toast = useToast();
  const started = useRef(false);
  const [status, setStatus] = useState<"checking" | "paid" | "pending" | "error">("checking");
  const [error, setError] = useState<string | null>(null);

  const verifyPayment = useCallback(async () => {
    if (!reference) {
      setStatus("error");
      setError("The payment provider did not return a reference. Please choose a plan and try again.");
      return;
    }
    setStatus("checking");
    setError(null);
    try {
      const result = await verify.mutateAsync(reference);
      if (result.status === "paid") {
        setStatus("paid");
        toast("DueRadar Plus is active. Thank you!");
      } else {
        setStatus("pending");
      }
    } catch (caught) {
      setStatus("error");
      setError(errorMessage(caught));
    }
  }, [reference, toast, verify.mutateAsync]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void verifyPayment();
  }, [verifyPayment]);

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <Card className="w-full max-w-lg p-6 sm:p-8">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-brand-700">
          {status === "checking" ? (
            <CreditCard className="h-6 w-6" aria-hidden />
          ) : status === "paid" ? (
            <Check className="h-6 w-6" aria-hidden />
          ) : (
            <Clock3 className="h-6 w-6" aria-hidden />
          )}
        </span>
        <h1 className="mt-5 font-display text-2xl font-semibold tracking-tight text-ink">
          {status === "checking"
            ? "Confirming your payment"
            : status === "paid"
              ? "Your plan is active"
              : status === "pending"
                ? "Payment confirmation is pending"
                : "We could not confirm the payment"}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {status === "checking"
            ? "We are verifying the checkout with Paystack. Please keep this page open."
            : status === "paid"
              ? "DueRadar Plus is active. Continue to finish setting up your account."
              : status === "pending"
                ? "Paystack has not confirmed the payment yet. You can check again shortly."
                : "Your account remains locked until a payment is confirmed."}
        </p>
        {error ? (
          <Note tone="error" className="mt-4">
            {error}
          </Note>
        ) : null}
        {status === "checking" ? <LoadingBlock label="Verifying with Paystack" /> : null}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          {status === "paid" ? (
            <Link
              to="/"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-brand-800 px-5 text-sm font-semibold text-white hover:bg-brand-900"
            >
              Continue to DueRadar
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          ) : (
            <Button
              variant="secondary"
              disabled={status === "checking"}
              loading={verify.isPending}
              onClick={() => void verifyPayment()}
            >
              Check payment again
            </Button>
          )}
          {status !== "paid" ? (
            <Link
              to="/"
              className="inline-flex h-11 items-center justify-center rounded-full px-5 text-sm font-semibold text-muted hover:bg-paper-deep"
            >
              Back to plan options
            </Link>
          ) : null}
        </div>
        <Link
          to="/settings/account"
          className="mt-4 inline-block text-xs font-semibold text-muted hover:text-ink"
        >
          Export or delete my account
        </Link>
      </Card>
    </div>
  );
}
