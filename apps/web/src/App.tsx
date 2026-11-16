import { useEffect, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AlertTriangle, LogIn } from "lucide-react";
import { AppShell } from "./components/AppShell";
import { Logo } from "./components/Logo";
import { Button, Spinner } from "./components/ui";
import { useAuth } from "./lib/session";
import { useMe } from "./lib/queries";
import { DashboardPage } from "./pages/Dashboard";
import { LandingPage } from "./pages/Landing";
import { OnboardingPage } from "./pages/Onboarding";
import { SubscriptionsPage } from "./pages/Subscriptions";
import { SubscriptionFormPage } from "./pages/SubscriptionForm";
import { SubscriptionDetailPage } from "./pages/SubscriptionDetail";
import { OccurrencesPage } from "./pages/Occurrences";
import { CalendarPage } from "./pages/Calendar";
import { NotificationsPage } from "./pages/Notifications";
import { SettingsPage } from "./pages/Settings";
import { AccountPage } from "./pages/Account";
import { PrivacyPage, SecurityPage, TermsPage } from "./pages/Legal";
import { NotFoundPage } from "./pages/NotFound";
import { SignInPage } from "./pages/auth/SignIn";
import { SignUpPage } from "./pages/auth/SignUp";
import { VerifyEmailPage } from "./pages/auth/VerifyEmail";
import { ForgotPasswordPage } from "./pages/auth/ForgotPassword";
import { ResetPasswordPage } from "./pages/auth/ResetPassword";

function Splash({ label = "Loading DueRadar" }: { label?: string }) {
  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="flex flex-col items-center text-center" role="status">
        <Logo size={52} className="text-brand-900" />
        <p className="mt-4 text-sm font-medium text-muted">{label}</p>
        <Spinner className="mt-3 text-brand-600" />
      </div>
    </div>
  );
}

function SessionProblem() {
  const { signOut } = useAuth();
  const location = useLocation();

  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="card w-full max-w-md p-6 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-amber-soft text-amber-strong">
          <AlertTriangle className="h-6 w-6" aria-hidden />
        </span>
        <h1 className="mt-4 font-display text-xl font-semibold text-ink">
          We could not load your account
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Your session may have expired, or the server could not be reached. Sign in again to
          continue.
        </p>
        <Button
          className="mt-5"
          fullWidth
          onClick={async () => {
            await signOut();
          }}
        >
          <LogIn className="h-4 w-4" />
          Sign in again
        </Button>
        <p className="mt-3 text-xs text-muted">
          Trying to open <span className="font-medium text-ink-soft">{location.pathname}</span>
        </p>
      </div>
    </div>
  );
}

function ProfileGate({ children }: { children: ReactNode }) {
  const me = useMe();

  if (me.isLoading) return <Splash label="Loading your account" />;
  if (me.isError || !me.data) return <SessionProblem />;
  if (me.data.needsOnboarding) return <Navigate to="/onboarding" replace />;

  return <AppShell>{children}</AppShell>;
}

function Protected({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "loading") return <Splash label="Checking your session" />;
  if (status === "anonymous") {
    return <Navigate to="/sign-in" replace state={{ from: location }} />;
  }
  return <ProfileGate>{children}</ProfileGate>;
}

function OnboardingRoute() {
  const { status } = useAuth();

  if (status === "loading") return <Splash label="Checking your session" />;
  if (status === "anonymous") return <Navigate to="/sign-in" replace />;
  return <OnboardingPage />;
}

function HomeRoute() {
  const { status } = useAuth();

  if (status === "loading") return <Splash label="Checking your session" />;
  if (status === "anonymous") return <LandingPage />;
  return (
    <ProfileGate>
      <DashboardPage />
    </ProfileGate>
  );
}

function ScrollToTop() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (hash) {
      const id = hash.replace(/^#/, "");
      const frame = window.requestAnimationFrame(() => {
        document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      return () => window.cancelAnimationFrame(frame);
    }
    window.scrollTo(0, 0);
    return undefined;
  }, [pathname, hash]);

  return null;
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<HomeRoute />} />
        <Route
          path="/dashboard"
          element={
            <Protected>
              <DashboardPage />
            </Protected>
          }
        />

        <Route
          path="/subscriptions"
          element={
            <Protected>
              <SubscriptionsPage />
            </Protected>
          }
        />
        <Route
          path="/subscriptions/new"
          element={
            <Protected>
              <SubscriptionFormPage mode="create" />
            </Protected>
          }
        />
        <Route
          path="/subscriptions/:id"
          element={
            <Protected>
              <SubscriptionDetailPage />
            </Protected>
          }
        />
        <Route
          path="/subscriptions/:id/edit"
          element={
            <Protected>
              <SubscriptionFormPage mode="edit" />
            </Protected>
          }
        />

        <Route
          path="/occurrences"
          element={
            <Protected>
              <OccurrencesPage />
            </Protected>
          }
        />
        <Route
          path="/calendar"
          element={
            <Protected>
              <CalendarPage />
            </Protected>
          }
        />
        <Route
          path="/notifications"
          element={
            <Protected>
              <NotificationsPage />
            </Protected>
          }
        />
        <Route
          path="/settings"
          element={
            <Protected>
              <SettingsPage />
            </Protected>
          }
        />
        <Route
          path="/settings/account"
          element={
            <Protected>
              <AccountPage />
            </Protected>
          }
        />

        <Route path="/onboarding" element={<OnboardingRoute />} />

        <Route path="/sign-in" element={<SignInPage />} />
        <Route path="/sign-up" element={<SignUpPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />

        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/security" element={<SecurityPage />} />

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}
