import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Download,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Field,
  Input,
  Note,
  PageHeader,
  Textarea,
  useToast,
} from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { useDeleteAccount, useMe } from "../lib/queries";
import { useAuth } from "../lib/session";

const REMOVED = [
  "Your profile, email preferences and reminder settings",
  "Every bill, subscription, trial and schedule you added",
  "Scheduled occurrences and your payment log",
  "Reminder jobs, delivery history and in-app notifications",
  "Registered devices and push notification endpoints",
  "Categories, payment-method labels and email aliases",
  "Your sign-in credentials, sessions and verification records",
];

export function AccountPage() {
  const me = useMe();
  const remove = useDeleteAccount();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const canDelete = confirmation.trim() === "DELETE" && !remove.isPending;

  async function exportData() {
    setExporting(true);
    setError(null);
    try {
      const { blob, filename } = await api.download("/export");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast("Your export is downloading.");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setExporting(false);
    }
  }

  async function deleteAccount() {
    setError(null);
    try {
      await remove.mutateAsync(reason.trim() || undefined);
      setConfirmOpen(false);
      toast("Your account was deleted.");
      await signOut();
      navigate("/sign-in?deleted=1", { replace: true });
    } catch (caught) {
      setConfirmOpen(false);
      setError(errorMessage(caught));
    }
  }

  return (
    <div className="animate-rise">
      <Link
        to="/settings"
        className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to settings
      </Link>

      <PageHeader
        eyebrow="Account"
        title="Export or delete your account"
        description="You stay in control of what DueRadar keeps. Take a copy any time, or remove everything immediately."
        actions={<Badge tone="plain">{me.data?.user.email}</Badge>}
      />

      {error ? (
        <Note tone="error" className="mb-5">
          {error}
        </Note>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-5">
          <Card className="p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
                <Download className="h-5 w-5" aria-hidden />
              </span>
              <div>
                <h2 className="text-[0.95rem] font-semibold text-ink">Take your data with you</h2>
                <p className="mt-1 text-sm leading-relaxed text-muted">
                  Download a JSON copy of your profile, records, scheduled dates, payment log,
                  categories and notification history. Device secrets, push keys and raw imports are
                  never included.
                </p>
              </div>
            </div>
            <Button
              variant="secondary"
              className="mt-4"
              onClick={() => void exportData()}
              loading={exporting}
            >
              <Download className="h-4 w-4" />
              Download my data
            </Button>
          </Card>

          <Card className="border-danger-strong/25 p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-danger-soft text-danger-strong">
                <ShieldAlert className="h-5 w-5" aria-hidden />
              </span>
              <div>
                <h2 className="text-[0.95rem] font-semibold text-ink">Delete your account</h2>
                <p className="mt-1 text-sm leading-relaxed text-muted">
                  This is immediate and permanent. Deletion removes your tracking data and your
                  sign-in credentials in one transaction. It cannot be undone, and the same email can
                  create a new, empty account afterwards.
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-4">
              <Field
                label="Why are you leaving?"
                htmlFor="delete-reason"
                hint="Optional. Helps us fix what is not working. Never required to delete."
              >
                <Textarea
                  id="delete-reason"
                  rows={2}
                  maxLength={500}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Too many reminders, missing a bill type, privacy concerns…"
                />
              </Field>

              <Field
                label="Type DELETE to confirm"
                htmlFor="delete-confirm"
                hint="Use capital letters. The button stays disabled until it matches."
              >
                <Input
                  id="delete-confirm"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  placeholder="DELETE"
                  autoComplete="off"
                  spellCheck={false}
                  className="font-semibold tracking-[0.12em]"
                />
              </Field>
            </div>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Link to="/settings">
                <Button variant="secondary" fullWidth className="sm:w-auto">
                  Keep my account
                </Button>
              </Link>
              <Button
                variant="danger"
                disabled={!canDelete}
                onClick={() => setConfirmOpen(true)}
              >
                <Trash2 className="h-4 w-4" />
                Delete my account
              </Button>
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card className="p-5">
            <h2 className="text-sm font-semibold text-ink">What gets deleted</h2>
            <ul className="mt-3 space-y-2.5">
              {REMOVED.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm leading-relaxed text-ink-soft">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
            <p className="mt-4 border-t border-line/70 pt-3 text-xs leading-relaxed text-muted">
              After deletion we keep one minimal audit record that confirms an account was deleted.
              It contains no user ID, email or tracking content, and expires with our audit logs.
            </p>
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-semibold text-ink">Before you go</h2>
            <ul className="mt-3 space-y-3 text-sm leading-relaxed text-ink-soft">
              <li className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-strong" aria-hidden />
                Active subscriptions and free trials will keep charging you unless you cancel them
                with the provider. DueRadar never cancels anything on its own.
              </li>
              <li className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-strong" aria-hidden />
                Export first if you need records for a dispute or tax filing. Deleted data cannot be
                restored by support.
              </li>
            </ul>
            <p className="mt-4 text-xs leading-relaxed text-muted">
              More detail is in the{" "}
              <Link to="/privacy" className="font-semibold text-brand-700 hover:underline">
                privacy notice
              </Link>
              .
            </p>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => void deleteAccount()}
        title="Delete your account permanently?"
        description="Your records, reminders, devices and sign-in credentials will be removed immediately. There is no undo and support cannot restore them."
        confirmLabel="Yes, delete everything"
        cancelLabel="Cancel"
        loading={remove.isPending}
      />
    </div>
  );
}
