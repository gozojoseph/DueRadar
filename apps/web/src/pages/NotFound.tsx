import { Link } from "react-router-dom";
import { Compass, Home, LogIn } from "lucide-react";
import { AppShell } from "../components/AppShell";
import { Wordmark } from "../components/Logo";
import { Button } from "../components/ui";
import { useAuth } from "../lib/session";

export function NotFoundPage() {
  const { status } = useAuth();

  const body = (
    <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-16 text-center sm:py-24">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-700">
        <Compass className="h-7 w-7" aria-hidden />
      </span>
      <p className="mt-5 text-[0.7rem] font-bold uppercase tracking-[0.16em] text-brand-600">
        Error 404
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.03em] text-ink">
        This page is not on the radar.
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        The link may be old, or the page may have moved. Your records are safe.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Link to="/">
          <Button>
            <Home className="h-4 w-4" />
            Back to DueRadar
          </Button>
        </Link>
        {status === "anonymous" ? (
          <Link to="/sign-in">
            <Button variant="secondary">
              <LogIn className="h-4 w-4" />
              Sign in
            </Button>
          </Link>
        ) : null}
      </div>
    </div>
  );

  if (status === "authenticated") return <AppShell>{body}</AppShell>;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line/70 px-4 py-3.5 sm:px-6">
        <Link to="/" aria-label="DueRadar home">
          <Wordmark />
        </Link>
      </header>
      <main className="flex flex-1 items-center">{body}</main>
    </div>
  );
}
