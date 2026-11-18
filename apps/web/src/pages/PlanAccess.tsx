import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Clock3, CreditCard } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Badge, Button, Card, LoadingBlock, Modal, Note, useToast } from "../components/ui";
import { MomoPaymentModal } from "../components/MomoPaymentModal";
import { errorMessage } from "../lib/api";
import {
  useBillingPlan,
  useStartBillingCheckout,
  useVerifyBillingCheckout,
} from "../lib/queries";
import { isAndroidApp } from "../lib/android";
import type { MomoNetwork } from "../lib/types";

export function PlanSelectionModal({
  onLater,
}: {
  onLater: () => void | Promise<void>;
}) {
  const plan = useBillingPlan();
  const checkout = useStartBillingCheckout();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [laterPending, setLaterPending] = useState(false);
  const [momoPlan, setMomoPlan] = useState<"monthly" | "annual" | null>(null);
  const androidApp = isAndroidApp();

  async function deferPlanSelection() {
    if (laterPending || checkout.isPending) return;
    setError(null);
    setLaterPending(true);
    try {
      await onLater();
    } catch (caught) {
      setError(errorMessage(caught));
      setLaterPending(false);
    }
  }

  // The Play build must not offer external purchases (Google Play Payments
  // policy): show current plan status only - no prices, no checkout buttons,
  // no payment-provider mentions. "Continue" defers plan selection so free
  // users can keep using the app.
  if (androidApp) {
    return (
      <Modal
        open
        onClose={() => void deferPlanSelection()}
        title="Your plan"
        description="Browse and track your bills without a paid plan."
        size="lg"
        footer={
          <div className="flex w-full justify-center">
            <Button
              variant="secondary"
              loading={laterPending}
              onClick={() => void deferPlanSelection()}
            >
              Continue
            </Button>
          </div>
        }
      >
        {plan.isLoading ? <LoadingBlock label="Loading your plan" /> : null}
        {plan.isError ? (
          <Note tone="error" className="mb-4">
            Could not load your plan. {errorMessage(plan.error)}
          </Note>
        ) : null}
        {error ? (
          <Note tone="error" className="mb-4">
            {error}
          </Note>
        ) : null}
        {plan.data ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={plan.data.tier === "plus" ? "brand" : "slate"}>
              {plan.data.tier === "plus" ? "DueRadar Plus" : "Free plan"}
            </Badge>
            <p className="text-sm text-ink-soft">
              {plan.data.activeItemLimit === null
                ? `${plan.data.activeItems} active items · no limit`
                : `${plan.data.activeItems} of ${plan.data.activeItemLimit} active items used`}
            </p>
          </div>
        ) : null}
        <p className="mt-4 text-xs leading-relaxed text-muted">
          Paste, email, CSV, and screenshot imports are Plus features.
        </p>
      </Modal>
    );
  }

  async function selectPlan(interval: "monthly" | "annual") {
    setError(null);
    if (plan.data?.provider === "yebeck") {
      // Yebeck has no hosted checkout: collect the mobile money details first.
      setMomoPlan(interval);
      return;
    }
    try {
      const result = await checkout.mutateAsync({ interval });
      window.location.assign(result.checkoutUrl ?? "");
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function payWithMomo(details: { network: MomoNetwork; msisdn: string; name: string }) {
    if (!momoPlan) return;
    setError(null);
    try {
      const result = await checkout.mutateAsync({
        interval: momoPlan,
        network: details.network,
        msisdn: details.msisdn,
        name: details.name,
      });
      setMomoPlan(null);
      navigate(`/billing/return?reference=${encodeURIComponent(result.reference)}`);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <Modal
      open
      onClose={() => void deferPlanSelection()}
      title="Choose a plan or explore first"
      description="Plus unlocks imports. Choose later to browse and track manually without a free trial."
      size="lg"
      footer={
        <div className="flex w-full flex-col items-center gap-2 sm:flex-row sm:justify-between">
          <p className="text-center text-xs text-muted sm:text-left">
            Paste, email, CSV, and screenshot imports require Plus.
          </p>
          <Button
            variant="secondary"
            loading={laterPending}
            disabled={checkout.isPending}
            onClick={() => void deferPlanSelection()}
          >
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
        {plan.data?.provider === "yebeck"
          ? "Payments are collected by mobile money (MTN, Telecel, AT) via Yebeck. You approve the prompt on your phone."
          : "Payments are processed securely by Paystack. You’ll return to DueRadar after checkout."}
      </p>

      {momoPlan && plan.data ? (
        <MomoPaymentModal
          open
          planLabel={momoPlan === "annual" ? "Plus annual" : "Plus monthly"}
          amount={momoPlan === "annual" ? plan.data.prices.annual.amount : plan.data.prices.monthly.amount}
          busy={checkout.isPending}
          error={null}
          onClose={() => setMomoPlan(null)}
          onPay={payWithMomo}
        />
      ) : null}
    </Modal>
  );
}

export function BillingReturnPage() {
  const [searchParams] = useSearchParams();
  const reference = searchParams.get("reference") || searchParams.get("trxref");
  const verify = useVerifyBillingCheckout();
  const toast = useToast();
  const started = useRef(false);
  const [provider, setProvider] = useState<"paystack" | "yebeck" | null>(null);
  const [status, setStatus] = useState<"checking" | "paid" | "pending" | "error">("checking");
  const [error, setError] = useState<string | null>(null);

  const verifyPayment = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!reference) {
        setStatus("error");
        setError("The payment provider did not return a reference. Please choose a plan and try again.");
        return;
      }
      if (!options?.silent) {
        setStatus("checking");
        setError(null);
      }
      try {
        const result = await verify.mutateAsync(reference);
        setProvider(result.provider);
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
    },
    [reference, toast, verify.mutateAsync],
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void verifyPayment();
  }, [verifyPayment]);

  // Mobile-money payments stay pending until the user approves the prompt on
  // their phone, so keep re-checking quietly instead of making them click.
  useEffect(() => {
    if (status !== "pending") return;
    const timer = window.setInterval(() => {
      void verifyPayment({ silent: true });
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [status, verifyPayment]);

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
                ? provider === "yebeck"
                  ? "Approve the prompt on your phone"
                  : "Payment confirmation is pending"
                : "We could not confirm the payment"}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {status === "checking"
            ? "We are confirming your payment. Please keep this page open."
            : status === "paid"
              ? "DueRadar Plus is active. Continue to finish setting up your account."
              : status === "pending"
                ? provider === "yebeck"
                  ? "This page checks automatically. Approve the mobile money prompt on your phone if you have not yet — the plan activates the moment the payment is confirmed."
                  : "The payment has not been confirmed yet. You can check again shortly."
                : "Your account remains locked until a payment is confirmed."}
        </p>
        {error ? (
          <Note tone="error" className="mt-4">
            {error}
          </Note>
        ) : null}
        {status === "checking" ? <LoadingBlock label="Confirming payment" /> : null}
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
