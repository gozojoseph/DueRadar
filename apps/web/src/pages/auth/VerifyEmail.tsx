import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, MailCheck } from "lucide-react";
import { AuthLayout } from "../../components/AuthLayout";
import { Button, Field, Input, Note } from "../../components/ui";
import { useAuth } from "../../lib/session";
import {
  authFailureMessage,
  hasSessionData,
  sendOtp,
  verifyEmailOtp,
} from "../../lib/authFlows";

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { status, refresh } = useAuth();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(
    params.get("email") ? "Enter the six-digit code we emailed you." : null,
  );
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  if (status === "authenticated") return <Navigate to="/" replace />;

  async function verify(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Enter the email address you signed up with.");
      return;
    }
    if (otp.length !== 6) {
      setError("Enter the six-digit code.");
      return;
    }
    setBusy(true);
    try {
      const result = await verifyEmailOtp(email.trim(), otp);
      if (result.error) {
        setError(authFailureMessage(result.error));
        return;
      }
      if (hasSessionData(result.data)) {
        const session = await refresh();
        if (session) {
          navigate("/onboarding", { replace: true });
          return;
        }
      }
      navigate(`/sign-in?email=${encodeURIComponent(email.trim())}&verified=1`, { replace: true });
    } catch (caught) {
      setError(authFailureMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    setNotice(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Enter your email first.");
      return;
    }
    setBusy(true);
    try {
      const result = await sendOtp(email.trim(), "email-verification");
      if (result.error) {
        setError(authFailureMessage(result.error));
        return;
      }
      setNotice("A fresh code is on its way. Check your inbox and spam folder.");
      setCooldown(60);
    } catch (caught) {
      setError(authFailureMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Check your email"
      subtitle="We verify every account so reminders only ever go to the right person."
      footer={
        <p>
          Wrong email?{" "}
          <Link to="/sign-up" className="font-semibold text-brand-700 hover:underline">
            Start again
          </Link>
        </p>
      }
    >
      <form onSubmit={verify} className="space-y-4" noValidate>
        <div className="mb-2 grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-brand-700">
          <MailCheck className="h-6 w-6" aria-hidden />
        </div>

        {error ? <Note tone="error">{error}</Note> : null}
        {notice ? <Note tone="info">{notice}</Note> : null}

        <Field label="Email" htmlFor="verify-email">
          <Input
            id="verify-email"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </Field>

        <Field
          label="Six-digit code"
          htmlFor="verify-otp"
          hint="Codes are single-use and expire. Check your spam folder if it has not arrived in a minute."
        >
          <Input
            id="verify-otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            maxLength={6}
            className="text-center text-xl tracking-[0.4em] tabular-nums"
            value={otp}
            onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
            required
          />
        </Field>

        <Button type="submit" fullWidth size="lg" loading={busy}>
          Verify email
          <ArrowRight className="h-4 w-4" />
        </Button>

        <div className="flex items-center justify-between text-xs">
          <button
            type="button"
            onClick={() => void resend()}
            disabled={busy || cooldown > 0}
            className="font-semibold text-brand-700 hover:underline disabled:opacity-50"
          >
            {cooldown > 0 ? `Resend in ${cooldown}s` : "Send a new code"}
          </button>
          <Link to={`/sign-in?email=${encodeURIComponent(email)}`} className="font-semibold text-muted hover:text-ink">
            Back to sign in
          </Link>
        </div>
      </form>
    </AuthLayout>
  );
}
