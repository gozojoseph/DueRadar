import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ArrowRight, Mail, UserRound } from "lucide-react";
import { AuthLayout } from "../../components/AuthLayout";
import { Button, Field, Input, Note } from "../../components/ui";
import { useAuth } from "../../lib/session";
import {
  authFailureMessage,
  hasSessionData,
  sendOtp,
  signUpWithEmail,
} from "../../lib/authFlows";

export function SignUpPage() {
  const navigate = useNavigate();
  const { status, refresh } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState(false);

  if (status === "authenticated") return <Navigate to="/" replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setExisting(false);

    if (name.trim().length < 2) {
      setError("Tell us your name.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      setError("Use at least 8 characters for your password.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    if (!accepted) {
      setError("Please accept the terms and privacy notice.");
      return;
    }

    setBusy(true);
    try {
      const result = await signUpWithEmail({
        name: name.trim(),
        email: email.trim(),
        password,
      });

      if (result.error) {
        const message = authFailureMessage(result.error);
        if (/already exists|already registered/i.test(message)) setExisting(true);
        setError(message);
        return;
      }

      if (hasSessionData(result.data)) {
        const session = await refresh();
        if (session) {
          navigate("/onboarding", { replace: true });
          return;
        }
      }

      const otpResult = await sendOtp(email.trim(), "email-verification");
      if (otpResult.error) {
        setError(
          `Account created, but the verification email could not be sent yet: ${authFailureMessage(
            otpResult.error,
          )}`,
        );
        return;
      }
      navigate(`/verify-email?email=${encodeURIComponent(email.trim())}`, { replace: true });
    } catch (caught) {
      setError(authFailureMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Create your DueRadar account"
      subtitle="See every bill, subscription and trial ending before it becomes a surprise."
      footer={
        <p>
          Already have an account?{" "}
          <Link to="/sign-in" className="font-semibold text-brand-700 hover:underline">
            Sign in
          </Link>
        </p>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error ? <Note tone="error">{error}</Note> : null}
        {existing ? (
          <Note tone="info">
            Try{" "}
            <Link to={`/sign-in?email=${encodeURIComponent(email.trim())}`} className="font-semibold underline">
              signing in
            </Link>{" "}
            instead, or reset your password.
          </Note>
        ) : null}
        <Note tone="info">
          New accounts need an active DueRadar Plus plan to use the app. There is no free plan or
          free trial for new accounts; choose monthly or annual after signing up. Existing Free-plan
          users keep their current access.
        </Note>

        <Field label="Your name" htmlFor="signup-name">
          <div className="relative">
            <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input
              id="signup-name"
              autoComplete="name"
              placeholder="Ama Mensah"
              className="pl-9"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </div>
        </Field>

        <Field label="Email" htmlFor="signup-email" hint="We send a six-digit code here to verify it.">
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input
              id="signup-email"
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder="you@example.com"
              className="pl-9"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Password" htmlFor="signup-password" hint="At least 8 characters.">
            <Input
              id="signup-password"
              type="password"
              autoComplete="new-password"
              placeholder="Choose a password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </Field>
          <Field label="Confirm password" htmlFor="signup-confirm">
            <Input
              id="signup-confirm"
              type="password"
              autoComplete="new-password"
              placeholder="Repeat it"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              required
            />
          </Field>
        </div>

        <label className="flex items-start gap-2.5 text-xs leading-relaxed text-muted">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(event) => setAccepted(event.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-line-strong accent-brand-700"
          />
          <span>
            I agree to the{" "}
            <Link to="/terms" className="font-semibold text-brand-700 hover:underline">
              terms
            </Link>{" "}
            and understand the{" "}
            <Link to="/privacy" className="font-semibold text-brand-700 hover:underline">
              privacy notice
            </Link>
            .
          </span>
        </label>

        <Button type="submit" fullWidth size="lg" loading={busy}>
          Create account
          <ArrowRight className="h-4 w-4" />
        </Button>
      </form>
    </AuthLayout>
  );
}
