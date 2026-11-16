import { Link, Navigate, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BellRing,
  CalendarDays,
  CheckCircle2,
  CreditCard,
  LockKeyhole,
  Moon,
  Smartphone,
  Sparkles,
  Wallet,
} from "lucide-react";
import { Wordmark } from "../components/Logo";
import { Badge, Button, Card } from "../components/ui";
import { useAuth } from "../lib/session";

const FEATURES = [
  {
    icon: CalendarDays,
    title: "One timeline for everything",
    body: "Rent, ECG, internet, Netflix, that free trial you forgot. Sorted by what is due next, not by app.",
  },
  {
    icon: BellRing,
    title: "Reminders that reach you",
    body: "Email and push before the date, with quiet hours so nothing buzzes at 2am. Snooze one reminder without moving the bill.",
  },
  {
    icon: Wallet,
    title: "Money in the right currency",
    body: "GHS by default. If a service charges you in dollars, DueRadar keeps dollars and never invents an exchange rate.",
  },
];

const STEPS = [
  {
    title: "Add what you already pay",
    body: "A name, an amount, and the next date. Weekly, monthly, yearly, or every N days.",
  },
  {
    title: "Choose your nudge",
    body: "Bills get 7 and 1 day reminders. Trials get 3 and 1. Change it per item.",
  },
  {
    title: "Mark it paid and move on",
    body: "The next date rolls forward automatically. Your history stays for exports and review.",
  },
];

export function LandingPage() {
  const { status } = useAuth();
  if (status === "authenticated") return <Navigate to="/dashboard" replace />;

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line/70 bg-paper/85 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-4 px-4 py-3.5 sm:px-6">
          <Wordmark />
          <nav className="ml-auto hidden items-center gap-5 text-sm font-medium text-muted sm:flex">
            <a href="#features" className="hover:text-ink">
              Features
            </a>
            <a href="#how" className="hover:text-ink">
              How it works
            </a>
            <Link to="/security" className="hover:text-ink">
              Security
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-2 sm:ml-0">
            <Link
              to="/sign-in"
              className="hidden rounded-full px-3.5 py-2 text-sm font-semibold text-ink-soft hover:bg-ink/5 sm:block"
            >
              Sign in
            </Link>
            <Link to="/sign-up">
              <Button size="sm">
                Create account
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 -top-40 mx-auto h-[520px] max-w-4xl rounded-full bg-brand-200/35 blur-3xl"
          />
          <div className="relative mx-auto grid w-full max-w-6xl gap-12 px-4 pb-16 pt-14 sm:px-6 sm:pt-20 lg:grid-cols-[1.02fr_0.98fr] lg:items-center lg:gap-16 lg:pb-24">
            <div className="animate-rise">
              <Badge tone="brand" className="mb-5">
                <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
                Made for Ghana · GHS & Africa/Accra
              </Badge>
              <h1 className="font-display text-[2.75rem] leading-[1.02] font-semibold tracking-[-0.035em] text-ink text-balance sm:text-[3.6rem]">
                Know what is due before it bites.
              </h1>
              <p className="mt-5 max-w-xl text-[1.02rem] leading-relaxed text-ink-soft text-pretty">
                DueRadar keeps bills, subscriptions and free-trial endings in one calm list. See the
                month ahead, get a reminder before the date, and stop paying for things you meant to
                cancel.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link to="/sign-up">
                  <Button size="lg">
                    Create your account
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
                <Link to="/sign-in">
                  <Button variant="secondary" size="lg">
                    I already have one
                  </Button>
                </Link>
              </div>
              <p className="mt-4 flex items-center gap-1.5 text-xs text-muted">
                <LockKeyhole className="h-3.5 w-3.5" aria-hidden />
                Track manually on Free; Plus unlocks Paste, Email, CSV, and Screenshot imports.
              </p>
            </div>

            <div className="relative animate-rise lg:pl-4">
              <div
                aria-hidden
                className="absolute -right-6 top-8 h-40 w-40 rounded-full bg-amber-soft blur-2xl"
              />
              <Card className="relative overflow-hidden p-5 shadow-lift sm:p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[0.68rem] font-bold uppercase tracking-[0.16em] text-muted">
                      October
                    </p>
                    <p className="mt-1 font-display text-3xl font-semibold tracking-[-0.03em] text-ink tabular-nums">
                      GH₵1,286.50
                    </p>
                    <p className="mt-0.5 text-xs text-muted">Due this month · 6 items</p>
                  </div>
                  <span className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-50 text-brand-700">
                    <CalendarDays className="h-5 w-5" />
                  </span>
                </div>

                <div className="mt-5 space-y-2.5">
                  {[
                    { name: "MTN Fibre", when: "Due tomorrow", amount: "GH₵299.00", tone: "amber" as const },
                    { name: "Netflix", when: "In 4 days", amount: "GH₵105.00", tone: "slate" as const },
                    { name: "Spotify trial ends", when: "In 6 days", amount: "GH₵34.90", tone: "amber" as const },
                    { name: "ECG prepaid", when: "In 9 days", amount: "GH₵200.00", tone: "slate" as const },
                  ].map((row) => (
                    <div
                      key={row.name}
                      className="flex items-center gap-3 rounded-xl border border-line/80 px-3 py-2.5"
                    >
                      <span className="grid h-8 w-8 place-items-center rounded-lg bg-paper-deep text-ink-soft">
                        <CreditCard className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-ink">{row.name}</p>
                        <p className="text-[0.7rem] text-muted">{row.when}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold tabular-nums text-ink">{row.amount}</p>
                        <Badge tone={row.tone} className="mt-0.5 text-[0.6rem]">
                          {row.tone === "amber" ? "Soon" : "Upcoming"}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex items-center gap-2 rounded-xl bg-brand-50/70 px-3 py-2.5 text-xs font-medium text-brand-800">
                  <BellRing className="h-4 w-4 shrink-0" aria-hidden />
                  Reminder goes out 1 day before, at 09:00 Accra time.
                </div>
              </Card>
            </div>
          </div>
        </section>

        <section id="features" className="border-y border-line bg-surface/55">
          <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
            <div className="max-w-2xl">
              <p className="text-[0.7rem] font-bold uppercase tracking-[0.16em] text-brand-600">
                Why DueRadar
              </p>
              <h2 className="mt-2 font-display text-3xl font-semibold tracking-[-0.03em] text-ink text-balance sm:text-4xl">
                Less guessing, fewer surprise charges.
              </h2>
            </div>
            <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((feature) => (
                <Card key={feature.title} className="p-6">
                  <span className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-50 text-brand-700">
                    <feature.icon className="h-5 w-5" aria-hidden />
                  </span>
                  <h3 className="mt-4 text-base font-semibold text-ink">{feature.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">{feature.body}</p>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section id="how" className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
            <div>
              <p className="text-[0.7rem] font-bold uppercase tracking-[0.16em] text-brand-600">
                How it works
              </p>
              <h2 className="mt-2 font-display text-3xl font-semibold tracking-[-0.03em] text-ink text-balance sm:text-4xl">
                Three minutes to set up. Then it runs quietly.
              </h2>
              <p className="mt-4 text-[0.95rem] leading-relaxed text-muted">
                DueRadar is a tracker, not a payment app. It never asks for a card number, a MoMo PIN, or
                a bank password. You tell it the dates; it tells you when they are close.
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                <Badge tone="brand">
                  <Wallet className="h-3 w-3" /> GHS first
                </Badge>
                <Badge tone="slate">
                  <Smartphone className="h-3 w-3" /> Installs as an app
                </Badge>
                <Badge tone="slate">
                  <Moon className="h-3 w-3" /> Quiet hours
                </Badge>
              </div>
            </div>
            <ol className="space-y-3">
              {STEPS.map((step, index) => (
                <li key={step.title}>
                  <Card className="flex gap-4 p-5">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-900 font-display text-sm font-semibold text-white">
                      {index + 1}
                    </span>
                    <div>
                      <h3 className="text-[0.95rem] font-semibold text-ink">{step.title}</h3>
                      <p className="mt-1 text-sm leading-relaxed text-muted">{step.body}</p>
                    </div>
                  </Card>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="border-t border-line bg-brand-900 text-white">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-6 px-4 py-14 sm:px-6 sm:py-16 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-xl">
              <h2 className="font-display text-3xl font-semibold tracking-[-0.03em] text-balance">
                The next due date is already on its way.
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-brand-100/80">
                Set it up once. Get one clear reminder instead of a late fee.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link to="/sign-up">
                <Button size="lg" className="bg-white text-brand-900 hover:bg-brand-50">
                  Get started
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link to="/sign-in">
                <Button
                  size="lg"
                  variant="ghost"
                  className="text-white hover:bg-white/10"
                >
                  Sign in
                </Button>
              </Link>
            </div>
          </div>
        </section>

        <footer className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-8 text-xs text-muted sm:px-6">
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-brand-600" />
            DueRadar · Accra, Ghana
          </span>
          <Link to="/privacy" className="hover:text-ink">
            Privacy
          </Link>
          <Link to="/terms" className="hover:text-ink">
            Terms
          </Link>
          <Link to="/security" className="hover:text-ink">
            Security
          </Link>
          <span className="ml-auto inline-flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5" />
            Prices stay in the currency you were charged
          </span>
        </footer>
      </main>
    </div>
  );
}
