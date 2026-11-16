import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { AuthLayout } from "../../components/AuthLayout";
import { Button, Field, Input, Note } from "../../components/ui";
import { useAuth } from "../../lib/session";
import { authFailureMessage, resetPassword } from "../../lib/authFlows";

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { status } = useAuth();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === "authenticated") return <Navigate to="/" replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Enter the email on your account.");
      return;
    }
    if (otp.length !== 6) {
      setError("Enter the six-digit code from the email.");
      return;
    }
    if (password.length < 8) {
      setError("Use at least 8 characters for the new password.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const result = await resetPassword({ email: email.trim(), otp, password });
      if (result.error) {
        setError(authFailureMessage(result.error));
        return;
      }
      navigate(`/sign-in?email=${encodeURIComponent(email.trim())}&reset=1`, { replace: true });
    } catch (caught) {
      setError(authFailureMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Choose a new password"
      subtitle="Enter the code from your email, then set a password you have not used here before."
      footer={
        <p>
          Need a new code?{" "}
          <Link
            to={`/forgot-password?email=${encodeURIComponent(email)}`}
            className="font-semibold text-brand-700 hover:underline"
          >
            Request another
          </Link>
        </p>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="mb-2 grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-brand-700">
          <ShieldCheck className="h-6 w-6" aria-hidden />
        </div>
        {error ? <Note tone="error">{error}</Note> : null}
        <Field label="Email" htmlFor="reset-email">
          <Input
            id="reset-email"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </Field>
        <Field label="Six-digit code" htmlFor="reset-otp">
          <Input
            id="reset-otp"
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
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="New password" htmlFor="reset-password" hint="At least 8 characters.">
            <Input
              id="reset-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </Field>
          <Field label="Confirm password" htmlFor="reset-confirm">
            <Input
              id="reset-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              required
            />
          </Field>
        </div>
        <Button type="submit" fullWidth size="lg" loading={busy}>
          Update password
          <ArrowRight className="h-4 w-4" />
        </Button>
      </form>
    </AuthLayout>
  );
}
