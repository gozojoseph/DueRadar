import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { BellRing, CalendarCheck, ShieldCheck } from "lucide-react";
import { Wordmark } from "./Logo";

const POINTS = [
  {
    icon: CalendarCheck,
    title: "Every due date in one place",
    body: "Bills, subscriptions and free-trial endings, ordered by what needs you next.",
  },
  {
    icon: BellRing,
    title: "A reminder before it bites",
    body: "Email, push and in-app nudges on your schedule, quiet hours respected.",
  },
  {
    icon: ShieldCheck,
    title: "Built for Ghana",
    body: "GHS by default, Africa/Accra time, and prices kept in the currency you were charged.",
  },
];

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_0.95fr]">
      <aside className="relative hidden overflow-hidden bg-brand-900 px-12 py-14 text-white lg:flex lg:flex-col">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-40 -top-32 h-[520px] w-[520px] rounded-full border border-white/10"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-16 h-[360px] w-[360px] rounded-full border border-white/10"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute right-10 top-20 h-[180px] w-[180px] rounded-full bg-brand-500/20 blur-2xl"
        />

        <Link to="/" className="relative inline-flex items-center gap-3 text-white">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/10">
            <svg viewBox="0 0 40 40" width="28" height="28" fill="none" aria-hidden>
              <circle cx="20" cy="20" r="11.5" stroke="white" strokeOpacity="0.35" />
              <circle cx="20" cy="20" r="7" stroke="white" strokeOpacity="0.6" />
              <path d="M20 20 L28.2 11.8" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
              <circle cx="20" cy="20" r="2.5" fill="white" />
            </svg>
          </span>
          <span className="font-display text-xl font-semibold tracking-[-0.02em]">
            Due<span className="text-brand-200">Radar</span>
          </span>
        </Link>

        <div className="relative mt-auto max-w-md pb-10">
          <h1 className="font-display text-[2.6rem] leading-[1.08] font-semibold tracking-[-0.03em] text-balance">
            Know what is due before it bites.
          </h1>
          <p className="mt-4 text-[0.95rem] leading-relaxed text-brand-100/85">
            A calm, private tracker for bills, subscriptions and free trials. Built for the way we pay
            in Ghana.
          </p>

          <ul className="mt-9 space-y-5">
            {POINTS.map((point) => (
              <li key={point.title} className="flex gap-3.5">
                <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/10 text-brand-100">
                  <point.icon className="h-4.5 w-4.5" aria-hidden />
                </span>
                <div>
                  <p className="text-sm font-semibold text-white">{point.title}</p>
                  <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-brand-100/70">
                    {point.body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-brand-200/60">
          No card details. No bank connection. Just the dates you tell us about.
        </p>
      </aside>

      <main className="flex flex-col px-5 py-8 sm:px-8">
        <div className="lg:hidden">
          <Link to="/" aria-label="DueRadar home">
            <Wordmark />
          </Link>
        </div>

        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">
          <div className="animate-rise">
            <h2 className="font-display text-[1.9rem] leading-tight font-semibold tracking-[-0.025em] text-ink">
              {title}
            </h2>
            {subtitle ? (
              <p className="mt-2 text-[0.925rem] leading-relaxed text-muted">{subtitle}</p>
            ) : null}
            <div className="mt-7">{children}</div>
            {footer ? <div className="mt-6 text-sm text-muted">{footer}</div> : null}
          </div>
        </div>

        <div className="mx-auto flex w-full max-w-md flex-wrap items-center gap-x-4 gap-y-1 pb-2 text-xs text-muted">
          <Link to="/privacy" className="hover:text-ink">
            Privacy
          </Link>
          <Link to="/terms" className="hover:text-ink">
            Terms
          </Link>
          <Link to="/security" className="hover:text-ink">
            Security
          </Link>
          <span className="ml-auto">DueRadar · Accra</span>
        </div>
      </main>
    </div>
  );
}
