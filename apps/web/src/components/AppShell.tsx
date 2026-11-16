import { useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Bell,
  CalendarDays,
  Download,
  Home,
  Inbox,
  Plus,
  Receipt,
  Settings,
  Upload,
  WifiOff,
  X,
} from "lucide-react";
import { Wordmark } from "./Logo";
import { Badge, Button, Modal, cx } from "./ui";
import { useDetectionSummary, useNotifications } from "../lib/queries";
import { useInstallPrompt, useOnline } from "../lib/usePwa";

const NAV_ITEMS = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/subscriptions", label: "Tracked", icon: Receipt },
  { to: "/occurrences", label: "Due", icon: CalendarDays },
  { to: "/import", label: "Import", icon: Upload },
  { to: "/detections", label: "Review", icon: Inbox },
  { to: "/notifications", label: "Alerts", icon: Bell },
] as const;

const MOBILE_NAV_ITEMS = NAV_ITEMS.slice(0, 5);

function NavItem({
  to,
  label,
  icon: Icon,
  end,
  unread,
  mobile = false,
}: {
  to: string;
  label: string;
  icon: typeof Home;
  end?: boolean;
  unread?: number;
  mobile?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cx(
          "relative flex items-center rounded-full transition-colors",
          mobile
            ? "flex-1 flex-col gap-0.5 px-1 py-1.5 text-[0.625rem] font-semibold"
            : "gap-2 px-3.5 py-2 text-[0.8125rem] font-semibold",
          isActive
            ? mobile
              ? "text-brand-700"
              : "bg-brand-50 text-brand-800"
            : "text-muted hover:text-ink",
        )
      }
    >
      <Icon className={mobile ? "h-5 w-5" : "h-4 w-4"} strokeWidth={2.1} aria-hidden />
      <span>{label}</span>
      {unread && unread > 0 ? (
        <span
          className={cx(
            "absolute grid place-items-center rounded-full bg-danger-strong font-bold text-white",
            mobile
              ? "right-[calc(50%-18px)] top-0.5 h-4 min-w-4 px-1 text-[0.5625rem]"
              : "ml-0.5 h-4 min-w-4 px-1 text-[0.625rem]",
          )}
        >
          {unread > 9 ? "9+" : unread}
        </span>
      ) : null}
    </NavLink>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const online = useOnline();
  const location = useLocation();
  const notifications = useNotifications();
  const detections = useDetectionSummary();
  const { canInstall, canPrompt, isIos, installed, dismissed, install, dismiss } = useInstallPrompt();
  const [iosHelp, setIosHelp] = useState(false);
  const showInstall = canInstall && !installed && !dismissed;

  function badgeFor(path: string): number | undefined {
    if (path === "/notifications") return notifications.data?.unread;
    if (path === "/detections") return detections.data?.pending;
    return undefined;
  }

  async function startInstall() {
    if (canPrompt) {
      await install();
      return;
    }
    if (isIos) setIosHelp(true);
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-line/80 bg-paper/85 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <NavLink to="/" aria-label="DueRadar home" className="shrink-0">
            <Wordmark />
          </NavLink>

          <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="Primary">
            {NAV_ITEMS.map((item) => (
              <NavItem key={item.to} {...item} unread={badgeFor(item.to)} />
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1.5">
            <NavLink
              to="/subscriptions/new"
              aria-label="Add something to track"
              className="hidden h-10 w-10 place-items-center rounded-full bg-brand-800 text-white transition hover:bg-brand-900 sm:grid"
            >
              <Plus className="h-5 w-5" />
            </NavLink>
            <NavLink
              to="/notifications"
              aria-label="Notifications"
              className="relative grid h-10 w-10 place-items-center rounded-full text-ink-soft transition hover:bg-ink/5 hover:text-ink"
            >
              <Bell className="h-5 w-5" strokeWidth={2} />
              {notifications.data?.unread ? (
                <span className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-danger-strong px-1 text-[0.5625rem] font-bold text-white">
                  {notifications.data.unread > 9 ? "9+" : notifications.data.unread}
                </span>
              ) : null}
            </NavLink>
            <NavLink
              to="/settings"
              aria-label="Settings"
              className="grid h-10 w-10 place-items-center rounded-full bg-brand-900 text-xs font-bold text-white"
            >
              <Settings className="h-4.5 w-4.5" strokeWidth={2} />
            </NavLink>
          </div>
        </div>

        {showInstall ? (
          <div className="border-t border-line/70 bg-brand-50/60">
            <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-2 sm:px-6">
              <Download className="h-4 w-4 shrink-0 text-brand-700" aria-hidden />
              <p className="min-w-0 flex-1 truncate text-xs font-medium text-brand-900">
                Install DueRadar for faster access and reminders.
              </p>
              <button
                type="button"
                onClick={() => void startInstall()}
                className="shrink-0 rounded-full bg-brand-800 px-3 py-1.5 text-xs font-semibold text-white"
              >
                Install
              </button>
              <button
                type="button"
                onClick={dismiss}
                aria-label="Dismiss install prompt"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-brand-800/70 hover:bg-brand-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ) : null}

        {!online ? (
          <div className="flex items-center justify-center gap-2 bg-amber-soft px-4 py-1.5 text-xs font-semibold text-amber-strong">
            <WifiOff className="h-3.5 w-3.5" aria-hidden />
            You are offline. Saved pages still open; changes will need a connection.
          </div>
        ) : null}
      </header>

      <main
        key={location.pathname}
        className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-5 sm:px-6 sm:pb-12 sm:pt-8"
      >
        {children}
      </main>

      <nav
        className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper/95 px-2 pt-1.5 backdrop-blur-md md:hidden"
        aria-label="Primary"
      >
        <div className="mx-auto flex max-w-md items-stretch">
          {MOBILE_NAV_ITEMS.map((item) => (
            <NavItem key={item.to} {...item} mobile unread={badgeFor(item.to)} />
          ))}
        </div>
      </nav>

      <footer className="hidden border-t border-line/70 py-6 text-center text-xs text-muted md:block">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-4 gap-y-2 px-6">
          <span>DueRadar · Accra, Ghana</span>
          <NavLink to="/privacy" className="hover:text-ink">
            Privacy
          </NavLink>
          <NavLink to="/terms" className="hover:text-ink">
            Terms
          </NavLink>
          <NavLink to="/security" className="hover:text-ink">
            Security
          </NavLink>
          <Badge tone="plain">GHS · Africa/Accra</Badge>
        </div>
      </footer>

      <Modal
        open={iosHelp}
        onClose={() => setIosHelp(false)}
        title="Add DueRadar to your Home Screen"
        description="On iPhone and iPad, install through Safari so reminders and push notifications work."
        footer={
          <Button variant="secondary" onClick={() => setIosHelp(false)}>
            Got it
          </Button>
        }
      >
        <ol className="space-y-3 text-sm leading-relaxed text-ink-soft">
          <li className="flex gap-3">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-bold text-brand-800">
              1
            </span>
            Open DueRadar in Safari, then tap the Share button.
          </li>
          <li className="flex gap-3">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-bold text-brand-800">
              2
            </span>
            Scroll down and choose <strong className="font-semibold">Add to Home Screen</strong>.
          </li>
          <li className="flex gap-3">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-bold text-brand-800">
              3
            </span>
            Open DueRadar from the Home Screen, then enable reminders in Settings.
          </li>
        </ol>
      </Modal>
    </div>
  );
}
