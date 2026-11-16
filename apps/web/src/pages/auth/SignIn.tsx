import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, KeyRound, Mail } from "lucide-react";
import { AuthLayout } from "../../components/AuthLayout";
import { Button, Field, Input, Note, Segmented } from "../../components/ui";
import { useAuth } from "../../lib/session";
import {
  authFailureMessage,
  isVerificationError,
  sendOtp,
  signInWithOtp,
  signInWithPassword,
} from "../../lib/authFlows";

export function SignInPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const { status, refresh } = useAuth();

  const [mode, setMode] = useState<"password" | "code">("password");
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsVerify, setNeedsVerify] = useState(false);
  const verified = params.get("verified") === "1";
  const reset = params.get("reset") === "1";
  const deleted = params.get("deleted") === "1";

  if (status === "authenticated") return <Navigate to="/" replace />;

  const from =
    (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? "/";

  async function finish() {
    const session = await refresh();
    if (session) {
      navigate(from === "/sign-in" ? "/" : from, { replace: true });
    } else {
      setError("Signed in, but the session could not be loaded. Refresh and try again.");
    }
  }

  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNeedsVerify(false);
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    try {
      const result = await signInWithPassword({ email: email.trim(), password });
      if (result.error) {
        if (isVerificationError(result.error)) setNeedsVerify(true);
        setError(authFailureMessage(result.error));
        return;
      }
      await finish();
    } catch (caught) {
      setError(authFailureMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function sendSignInCode() {
    setError(null);
    if (!email.trim()) {
      setError("Enter your email first.");
      return;
    }
    setBusy(true);
    try {
      const result = await sendOtp(email.trim(), "sign-in");
      if (result.error) {
        setError(authFailureMessage(result.error));
        return;
      }
      setCodeSent(true);
    } catch (caught) {
      setError(authFailureMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (otp.trim().length < 6) {
      setError("Enter the six-digit code from your email.");
      return;
    }
    setBusy(true);
    try {
      const result = await signInWithOtp(email.trim(), otp.trim());
      if (result.error) {
        setError(authFailureMessage(result.error));
        return;
      }
      await finish();
    } catch (caught) {
      setError(authFailureMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to see what is due next."
      footer={
        <p>
          New to DueRadar?{" "}
          <Link to="/sign-up" className="font-semibold text-brand-700 hover:underline">
            Create an account
          </Link>
        </p>
      }
    >
      <div className="space-y-4">
        {verified ? <Note tone="success">Email verified. Sign in to continue.</Note> : null}
        {reset ? <Note tone="success">Password updated. Sign in with your new password.</Note> : null}
        {deleted ? (
          <Note tone="success">
            Your account and its tracking data were deleted. You can create a new account whenever
            you need one.
          </Note>
        ) : null}

        <Segmented
          value={mode}
          onChange={(next) => {
            setMode(next);
            setError(null);
          }}
          options={[
            { value: "password", label: "Password" },
            { value: "code", label: "Email code" },
          ]}
          className="w-full"
        />

        {error ? <Note tone="error">{error}</Note> : null}
        {needsVerify ? (
          <Note tone="warn">
            This account still needs email verification.{" "}
            <Link
              to={`/verify-email?email=${encodeURIComponent(email)}`}
              className="font-semibold underline"
            >
              Enter your code
            </Link>
            .
          </Note>
        ) : null}

        {mode === "password" ? (
          <form onSubmit={submitPassword} className="space-y-4" noValidate>
            <Field label="Email" htmlFor="signin-email">
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <Input
                  id="signin-email"
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
            <Field label="Password" htmlFor="signin-password">
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <Input
                  id="signin-password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Your password"
                  className="pl-9"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </div>
            </Field>
            <div className="flex justify-end">
              <Link
                to={`/forgot-password${email ? `?email=${encodeURIComponent(email)}` : ""}`}
                className="text-xs font-semibold text-brand-700 hover:underline"
              >
                Forgot your password?
              </Link>
            </div>
            <Button type="submit" fullWidth size="lg" loading={busy}>
              Sign in
              <ArrowRight className="h-4 w-4" />
            </Button>
          </form>
        ) : codeSent ? (
          <form onSubmit={submitCode} className="space-y-4" noValidate>
            <Note tone="info">
              We sent a six-digit sign-in code to <strong>{email}</strong>. It expires shortly.
            </Note>
            <Field label="Six-digit code" htmlFor="signin-otp">
              <Input
                id="signin-otp"
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
              Sign in
              <ArrowRight className="h-4 w-4" />
            </Button>
            <div className="flex items-center justify-between text-xs">
              <button
                type="button"
                className="font-semibold text-brand-700 hover:underline"
                onClick={() => {
                  setCodeSent(false);
                  setOtp("");
                }}
              >
                Change email
              </button>
              <button
                type="button"
                className="font-semibold text-brand-700 hover:underline disabled:opacity-50"
                disabled={busy}
                onClick={() => void sendSignInCode()}
              >
                Resend code
              </button>
            </div>
          </form>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void sendSignInCode();
            }}
            className="space-y-4"
            noValidate
          >
            <Field
              label="Email"
              htmlFor="signin-code-email"
              hint="We will email you a one-time code. No password needed."
            >
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <Input
                  id="signin-code-email"
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
            <Button type="submit" fullWidth size="lg" loading={busy}>
              Email me a code
              <ArrowRight className="h-4 w-4" />
            </Button>
          </form>
        )}
      </div>
    </AuthLayout>
  );
}
