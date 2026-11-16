import { Link } from "react-router-dom";
import { Bell, BellRing, Check, CheckCheck } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  LoadingBlock,
  PageHeader,
  cx,
  useToast,
} from "../components/ui";
import { useMarkNotificationsRead, useNotifications } from "../lib/queries";
import { timeAgo } from "../lib/format";
import { errorMessage } from "../lib/api";

export function NotificationsPage() {
  const query = useNotifications();
  const markRead = useMarkNotificationsRead();
  const toast = useToast();

  const items = query.data?.notifications ?? [];
  const unread = query.data?.unread ?? 0;

  async function markAll() {
    try {
      await markRead.mutateAsync({ all: true });
      toast("All notifications marked read.");
    } catch (caught) {
      toast(errorMessage(caught), "error");
    }
  }

  async function markOne(id: string) {
    try {
      await markRead.mutateAsync({ ids: [id] });
    } catch {
      /* a failed read receipt should not interrupt reading */
    }
  }

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow="Alerts"
        title="Notifications"
        description="Reminders delivered inside DueRadar. Email and push copies are controlled in Settings."
        actions={
          unread > 0 ? (
            <Button variant="secondary" onClick={() => void markAll()} loading={markRead.isPending}>
              <CheckCheck className="h-4 w-4" />
              Mark all read
            </Button>
          ) : undefined
        }
      />

      {query.isLoading ? (
        <LoadingBlock label="Loading notifications" />
      ) : query.isError ? (
        <EmptyState
          icon={<Bell className="h-5 w-5" />}
          title="Could not load notifications"
          description="Check your connection and try again."
          action={<Button onClick={() => void query.refetch()}>Try again</Button>}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Bell className="h-5 w-5" />}
          title="No notifications yet"
          description="When a bill is due or a trial is ending, the in-app alert lands here. Reminder timing comes from your profile settings."
          action={
            <Link to="/settings">
              <Button variant="secondary" size="sm">
                Review reminder settings
              </Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <Card
              key={item.id}
              className={cx(
                "flex items-start gap-3 p-4 transition",
                !item.readAt && "border-brand-300/60 bg-brand-50/25",
              )}
            >
              <span
                className={cx(
                  "mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl",
                  item.readAt ? "bg-paper-deep text-muted" : "bg-brand-50 text-brand-700",
                )}
              >
                {item.readAt ? <Bell className="h-4 w-4" /> : <BellRing className="h-4 w-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-ink">{item.title}</p>
                  {!item.readAt ? <Badge tone="brand">New</Badge> : null}
                </div>
                <p className="mt-0.5 text-sm leading-relaxed text-ink-soft">{item.body}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[0.7rem] text-muted">
                  <span>{timeAgo(item.createdAt)}</span>
                  {item.entityType === "occurrence" ? (
                    <Link to="/occurrences" className="font-semibold text-brand-700 hover:underline">
                      Open due list
                    </Link>
                  ) : null}
                  {!item.readAt ? (
                    <button
                      type="button"
                      onClick={() => void markOne(item.id)}
                      className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline"
                    >
                      <Check className="h-3 w-3" />
                      Mark read
                    </button>
                  ) : null}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <div className="mt-6 rounded-2xl border border-line bg-surface/60 px-4 py-3 text-xs leading-relaxed text-muted">
        In-app alerts are always stored here. To stop email or push, turn off those channels in{" "}
        <Link to="/settings" className="font-semibold text-brand-700 hover:underline">
          Settings
        </Link>
        . Individual records can also override their reminder plan.
      </div>
    </div>
  );
}
