import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, KeyRound } from "lucide-react";
import { AuthLayout } from "../../components/AuthLayout";
import { Button, Field, Input, Note } from "../../components/ui";
import { useAuth } from "../../lib/session";
import { authFailureMessage, requestPasswordReset } from "../../lib/authFlows";

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { status } = useAuth();
  const [email, setEmail] = useState(params.get("email") ?? "");
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
    setBusy(true);
    try {
      const result = await requestPasswordReset(email.trim());
      if (result.error) {
        setError(authFailureMessage(result.error));
        return;
      }
      navigate(`/reset-password?email=${encodeURIComponent(email.trim())}`, { replace: true });
    } catch (caught) {
      setError(authFailureMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="We will email a six-digit code. You choose the new password."
      footer={
        <p>
          Remembered it?{" "}
          <Link to="/sign-in" className="font-semibold text-brand-700 hover:underline">
            Back to sign in
          </Link>
        </p>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="mb-2 grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-brand-700">
          <KeyRound className="h-6 w-6" aria-hidden />
        </div>
        {error ? <Note tone="error">{error}</Note> : null}
        <Field label="Email" htmlFor="forgot-email">
          <Input
            id="forgot-email"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </Field>
        <Button type="submit" fullWidth size="lg" loading={busy}>
          Send reset code
          <ArrowRight className="h-4 w-4" />
        </Button>
      </form>
    </AuthLayout>
  );
}
