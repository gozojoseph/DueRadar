import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Camera,
  Check,
  ClipboardPaste,
  Copy,
  FileSpreadsheet,
  FileText,
  Inbox,
  Mail,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  LoadingBlock,
  Note,
  PageHeader,
  Segmented,
  Select,
  Textarea,
  useToast,
} from "../components/ui";
import {
  useCreateEmailAlias,
  useCsvImport,
  useCsvPreview,
  useDeleteImport,
  useEmailAlias,
  useImportHistory,
  useImportMessage,
  useRevokeEmailAlias,
} from "../lib/queries";
import { errorMessage } from "../lib/api";
import { money, shortDate, timeAgo } from "../lib/format";
import type {
  CsvImportResult,
  CsvMapping,
  CsvPreview,
  ImportHistoryItem,
  MessageImportResult,
} from "../lib/types";
import { kindTone } from "./Detections";

type Tab = "paste" | "email" | "csv" | "screenshot";
type ImportResult = MessageImportResult | CsvImportResult;

const DATE_FORMATS: Array<{ value: CsvMapping["dateFormat"]; label: string }> = [
  { value: "auto", label: "Detect automatically" },
  { value: "dmy", label: "Day / month / year" },
  { value: "mdy", label: "Month / day / year" },
  { value: "ymd", label: "Year / month / day" },
];

const CURRENCIES = ["GHS", "USD", "EUR", "GBP", "NGN", "ZAR", "KES", "XOF", "CAD"];

const SOURCE_LABELS: Record<string, string> = {
  paste: "Pasted text",
  email: "Forwarded email",
  csv: "CSV import",
  ocr: "Screenshot text",
  upload: "Uploaded text",
  api: "API import",
};

export function ImportPage() {
  const [tab, setTab] = useState<Tab>("paste");
  const [result, setResult] = useState<ImportResult | null>(null);

  function showResult(next: ImportResult) {
    setResult(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow="Import"
        title="Bring in what you already paid"
        description="Paste a receipt, forward a confirmation email, import a statement, or read a screenshot on this device. DueRadar suggests what it found; you decide what to track."
        actions={
          <Link to="/detections">
            <Button variant="secondary">
              <Inbox className="h-4 w-4" />
              Review inbox
            </Button>
          </Link>
        }
      />

      <Segmented
        value={tab}
        onChange={(value) => {
          setTab(value);
          setResult(null);
        }}
        options={[
          { value: "paste", label: "Paste" },
          { value: "email", label: "Email" },
          { value: "csv", label: "CSV" },
          { value: "screenshot", label: "Screenshot" },
        ]}
        className="mb-5"
      />

      {result ? <ImportResultCard result={result} onDismiss={() => setResult(null)} /> : null}

      {tab === "paste" ? <PasteTab onResult={showResult} /> : null}
      {tab === "email" ? <EmailTab /> : null}
      {tab === "csv" ? <CsvTab onResult={showResult} /> : null}
      {tab === "screenshot" ? <ScreenshotTab onResult={showResult} /> : null}

      <HistorySection />
    </div>
  );
}

/* --------------------------------- results -------------------------------- */

function isCsvResult(result: ImportResult): result is CsvImportResult {
  return "rows" in result.summary;
}

function ImportResultCard({
  result,
  onDismiss,
}: {
  result: ImportResult;
  onDismiss: () => void;
}) {
  const suggestions = result.suggestions;
  return (
    <Card className="mb-5 overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-brand-50/60 px-4 py-3 sm:px-5">
        <div className="flex items-start gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-brand-700">
            <Check className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-ink">{result.summary.message}</p>
            <p className="mt-0.5 text-xs text-muted">
              {isCsvResult(result)
                ? `${result.summary.transactions} rows read · ${result.summary.duplicates} duplicates · ${result.summary.errors.length} row errors`
                : `${result.summary.detected} found · ${result.summary.actionable} to review · ${result.summary.blocked} not a charge`}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss result"
          className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-white/70 hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {suggestions.length > 0 ? (
        <ul className="divide-y divide-line">
          {suggestions.map((suggestion) => (
            <li key={suggestion.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={kindTone(suggestion.draft.kind)}>{suggestion.draft.kind}</Badge>
                  {suggestion.needsDetails ? <Badge tone="amber">Needs a date</Badge> : null}
                  {!suggestion.actionable ? <Badge tone="slate">Not a charge</Badge> : null}
                </div>
                <p className="mt-1 truncate text-sm font-semibold text-ink">
                  {suggestion.draft.merchant ?? "Unknown merchant"}
                  {suggestion.draft.amountMinor !== null
                    ? ` · ${money(suggestion.draft.amountMinor, suggestion.draft.currency)}`
                    : ""}
                </p>
                <p className="text-xs text-muted">
                  {suggestion.blockedReason ??
                    (suggestion.needsDetails
                      ? "Open the review inbox to add the missing date."
                      : "Ready for your confirmation.")}
                </p>
              </div>
              {suggestion.actionable ? (
                <Link
                  to="/detections"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"
                >
                  Review
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <div className="px-4 py-4 text-sm text-muted sm:px-5">
          Nothing was created automatically. You can still add a record by hand.
        </div>
      )}
    </Card>
  );
}

/* ---------------------------------- paste --------------------------------- */

function PasteTab({ onResult }: { onResult: (result: MessageImportResult) => void }) {
  const importMessage = useImportMessage();
  const toast = useToast();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (text.trim().length < 5) {
      setError("Paste the message or receipt text first.");
      return;
    }
    try {
      const result = await importMessage.mutateAsync({ source: "paste", text });
      onResult(result);
      toast(result.summary.message, result.summary.actionable > 0 ? "success" : "info");
      setText("");
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <Card className="p-5 sm:p-6">
      <div className="mb-4 flex items-start gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
          <ClipboardPaste className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-ink">Paste a message</h2>
          <p className="text-xs leading-relaxed text-muted">
            MoMo alerts, card notifications, renewal emails, trial confirmations, or a receipt.
            Screenshots belong in the Screenshot tab.
          </p>
        </div>
      </div>

      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field
          label="Message text"
          htmlFor="paste-text"
          error={error ?? undefined}
          hint="Sensitive values such as card numbers are redacted before storage. Raw text is erased after 72 hours."
        >
          <Textarea
            id="paste-text"
            rows={8}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={
              "Example:\nMTN Mobile Money: You have been charged GHS 65.00 for your Netflix subscription on 01/11/2026. Reference: 123456."
            }
          />
        </Field>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted">
            We look for a single clearest charge. You can import again for another message.
          </p>
          <Button type="submit" loading={importMessage.isPending}>
            <ScanLine className="h-4 w-4" />
            Find charges
          </Button>
        </div>
      </form>
    </Card>
  );
}

/* ---------------------------------- email --------------------------------- */

function EmailTab() {
  const alias = useEmailAlias();
  const create = useCreateEmailAlias();
  const revoke = useRevokeEmailAlias();
  const toast = useToast();
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copyAddress() {
    const address = alias.data?.alias?.address;
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast("Copy failed. Select the address and copy it manually.", "error");
    }
  }

  async function createAlias(rotate: boolean) {
    try {
      const result = await create.mutateAsync(rotate);
      setConfirmRotate(false);
      setCopied(false);
      if (result.alias) {
        toast(rotate ? "New address created. The old one stops working now." : "Forwarding address created.");
      }
    } catch (caught) {
      toast(errorMessage(caught), "error");
    }
  }

  async function revokeAlias() {
    try {
      await revoke.mutateAsync();
      setConfirmRevoke(false);
      toast("Forwarding address revoked. New mail will be ignored.");
    } catch (caught) {
      toast(errorMessage(caught), "error");
    }
  }

  if (alias.isLoading) return <LoadingBlock label="Loading your forwarding address" />;

  if (alias.isError) {
    return <Note tone="error">Could not load the forwarding address. {errorMessage(alias.error)}</Note>;
  }

  const data = alias.data;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <Card className="p-5 sm:p-6">
        <div className="mb-4 flex items-start gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
            <Mail className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-ink">Forward receipts by email</h2>
            <p className="text-xs leading-relaxed text-muted">
              Forward a billing email to your private address. We read the message, suggest a
              record, and erase the raw text after 72 hours.
            </p>
          </div>
        </div>

        {!data.configured ? (
          <Note tone="warn">
            Email forwarding is not switched on for this environment yet. Paste a message or import
            a CSV meanwhile. If this is unexpected, contact {data.domain ?? "support"}.
          </Note>
        ) : null}

        {data.alias ? (
          <>
            <div className="rounded-2xl border border-brand-600/25 bg-brand-50/60 p-4">
              <p className="text-[0.65rem] font-bold uppercase tracking-[0.14em] text-brand-700">
                Your forwarding address
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 select-all break-all rounded-xl border border-line bg-white px-3 py-2.5 font-mono text-[0.8125rem] text-ink">
                  {data.alias.address}
                </code>
                <Button variant="secondary" size="sm" onClick={() => void copyAddress()}>
                  <Copy className="h-3.5 w-3.5" />
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <p className="mt-2 text-xs text-muted">
                {data.alias.lastReceivedAt
                  ? `Last message received ${timeAgo(data.alias.lastReceivedAt)}.`
                  : "No messages received yet."}{" "}
                Created {shortDate(data.alias.createdAt.slice(0, 10))}.
              </p>
            </div>

            <ol className="mt-4 space-y-2.5 text-sm leading-relaxed text-ink-soft">
              <li className="flex gap-2.5">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-50 text-[0.65rem] font-bold text-brand-800">
                  1
                </span>
                Open the receipt in your mail app and choose Forward.
              </li>
              <li className="flex gap-2.5">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-50 text-[0.65rem] font-bold text-brand-800">
                  2
                </span>
                Send it to the address above. Keep the original sender and subject if you can.
              </li>
              <li className="flex gap-2.5">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-50 text-[0.65rem] font-bold text-brand-800">
                  3
                </span>
                The find appears in your review inbox. Nothing is tracked until you save it.
              </li>
            </ol>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => setConfirmRotate(true)}>
                <RefreshCw className="h-3.5 w-3.5" />
                Replace address
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmRevoke(true)}>
                <Trash2 className="h-3.5 w-3.5" />
                Revoke
              </Button>
            </div>
          </>
        ) : (
          <div>
            <p className="text-sm leading-relaxed text-muted">
              Create one private address for DueRadar. Each account gets its own; plus-tagged
              variants such as <code className="font-mono">+netflix</code> also work, which makes it
              easy to see which service shared your address.
            </p>
            <Button
              className="mt-4"
              loading={create.isPending}
              disabled={!data.configured}
              onClick={() => void createAlias(false)}
            >
              <Mail className="h-4 w-4" />
              Create my forwarding address
            </Button>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <div className="flex items-start gap-2.5">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" aria-hidden />
          <div className="text-xs leading-relaxed text-muted">
            <p className="font-semibold text-ink">What we do with forwarded mail</p>
            <p className="mt-1">
              We fetch the body once, strip tracking links, redact card and account numbers, and
              store only the suggested fields. Attachments and remote images are never loaded.
              Revoking the address stops matching immediately, even if a provider keeps delivering.
            </p>
          </div>
        </div>
      </Card>

      <ConfirmDialog
        open={confirmRotate}
        onClose={() => setConfirmRotate(false)}
        onConfirm={() => void createAlias(true)}
        title="Replace your forwarding address?"
        description="The current address stops working immediately. Mail already forwarded is unaffected."
        confirmLabel="Replace address"
        tone="primary"
        loading={create.isPending}
      />
      <ConfirmDialog
        open={confirmRevoke}
        onClose={() => setConfirmRevoke(false)}
        onConfirm={() => void revokeAlias()}
        title="Revoke your forwarding address?"
        description="Forwarded mail to this address will be ignored. You can create a new address later."
        confirmLabel="Revoke address"
        loading={revoke.isPending}
      />
    </div>
  );
}

/* ----------------------------------- csv ---------------------------------- */

function CsvTab({ onResult }: { onResult: (result: CsvImportResult) => void }) {
  const preview = useCsvPreview();
  const importer = useCsvImport();
  const toast = useToast();
  const [fileName, setFileName] = useState<string | null>(null);
  const [csv, setCsv] = useState("");
  const [previewData, setPreviewData] = useState<CsvPreview | null>(null);
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  async function readFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setPreviewData(null);
    setMapping(null);
    setStale(false);
    setFileName(file.name);
    const text = await file.text().catch(() => null);
    if (text === null) {
      setError("Could not read that file. Choose a UTF-8 CSV.");
      return;
    }
    setCsv(text);
    await runPreview(text, null);
  }

  async function runPreview(text: string, nextMapping: CsvMapping | null) {
    try {
      const result = await preview.mutateAsync({ csv: text, mapping: nextMapping });
      setPreviewData(result.preview);
      setMapping(result.preview.mapping);
      setStale(false);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  function updateMapping(patch: Partial<CsvMapping>) {
    if (!mapping) return;
    setMapping({ ...mapping, ...patch });
    setStale(true);
  }

  async function submit() {
    if (!mapping) return;
    setError(null);
    try {
      const result = await importer.mutateAsync({ csv, mapping, fileName });
      onResult(result);
      toast(result.summary.message, result.suggestions.length > 0 ? "success" : "info");
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  const columns = previewData?.headers ?? [];
  const mappedCount = previewData?.totals.transactions ?? 0;

  return (
    <div className="space-y-4">
      <Card className="p-5 sm:p-6">
        <div className="mb-4 flex items-start gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
            <FileSpreadsheet className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-ink">Import a bank or MoMo statement</h2>
            <p className="text-xs leading-relaxed text-muted">
              CSV only, up to 2 MB and 5,000 rows. We look for three or more matching charges before
              suggesting a subscription. The file itself is never stored.
            </p>
          </div>
        </div>

        <Field label="CSV file" htmlFor="csv-file" hint="Export from your bank or mobile money app.">
          <input
            id="csv-file"
            type="file"
            accept=".csv,text/csv,text/plain"
            className="field cursor-pointer py-2 text-sm file:mr-3 file:rounded-full file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-brand-800"
            onChange={(event) => void readFile(event.target.files?.[0])}
          />
        </Field>
        {fileName ? <p className="mt-2 text-xs text-muted">Selected: {fileName}</p> : null}
        {error ? (
          <Note tone="error" className="mt-3">
            {error}
          </Note>
        ) : null}
        {preview.isPending ? <LoadingBlock label="Reading the file" /> : null}
      </Card>

      {previewData && mapping ? (
        <>
          <Card className="p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-ink">Match the columns</h3>
                <p className="text-xs text-muted">
                  We guessed from the headers. Change anything that looks wrong.
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Badge tone="slate">{previewData.totals.rows} rows</Badge>
                <Badge tone="brand">{mappedCount} charges</Badge>
                <Badge tone="amber">{previewData.totals.errors} errors</Badge>
              </div>
            </div>
            {previewData.truncated ? (
              <Note tone="warn" className="mt-3">
                Only the first 5,000 rows were read.
              </Note>
            ) : null}

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <ColumnSelect
                label="Date column"
                value={mapping.date}
                columns={columns}
                onChange={(value) => updateMapping({ date: value })}
              />
              <ColumnSelect
                label="Merchant or description"
                value={mapping.merchant}
                columns={columns}
                onChange={(value) => updateMapping({ merchant: value })}
              />
              <ColumnSelect
                label="Amount column"
                value={mapping.amount ?? ""}
                columns={columns}
                optional
                onChange={(value) => updateMapping({ amount: value || null })}
              />
              <ColumnSelect
                label="Debit column"
                value={mapping.debit ?? ""}
                columns={columns}
                optional
                onChange={(value) => updateMapping({ debit: value || null })}
              />
              <ColumnSelect
                label="Credit column"
                value={mapping.credit ?? ""}
                columns={columns}
                optional
                onChange={(value) => updateMapping({ credit: value || null })}
              />
              <ColumnSelect
                label="Currency column"
                value={mapping.currency ?? ""}
                columns={columns}
                optional
                onChange={(value) => updateMapping({ currency: value || null })}
              />
              <ColumnSelect
                label="Type column"
                value={mapping.type ?? ""}
                columns={columns}
                optional
                onChange={(value) => updateMapping({ type: value || null })}
              />
              <ColumnSelect
                label="Reference column"
                value={mapping.reference ?? ""}
                columns={columns}
                optional
                onChange={(value) => updateMapping({ reference: value || null })}
              />
              <Field label="Date format" htmlFor="csv-date-format">
                <Select
                  id="csv-date-format"
                  value={mapping.dateFormat}
                  onChange={(event) =>
                    updateMapping({ dateFormat: event.target.value as CsvMapping["dateFormat"] })
                  }
                >
                  {DATE_FORMATS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Default currency" htmlFor="csv-currency">
                <Select
                  id="csv-currency"
                  value={mapping.defaultCurrency}
                  onChange={(event) => updateMapping({ defaultCurrency: event.target.value })}
                >
                  {CURRENCIES.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                loading={preview.isPending}
                onClick={() => void runPreview(csv, mapping)}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh preview
              </Button>
              {stale ? <Badge tone="amber">Mapping changed</Badge> : null}
              <Button
                size="sm"
                loading={importer.isPending}
                disabled={mappedCount === 0}
                onClick={() => void submit()}
              >
                <Upload className="h-3.5 w-3.5" />
                Import statement
              </Button>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="border-b border-line px-4 py-3">
              <h3 className="text-sm font-semibold text-ink">First rows after mapping</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-left text-xs">
                <thead className="bg-paper-deep/60 text-[0.65rem] uppercase tracking-[0.1em] text-muted">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Date</th>
                    <th className="px-3 py-2 font-semibold">Description</th>
                    <th className="px-3 py-2 text-right font-semibold">Amount</th>
                    <th className="px-3 py-2 font-semibold">Type</th>
                    <th className="px-3 py-2 font-semibold">Duplicate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {previewData.transactions.map((row, index) => (
                    <tr key={`${row.occurredAt}-${row.merchant}-${index}`}>
                      <td className="whitespace-nowrap px-3 py-2 text-muted">{row.occurredAt}</td>
                      <td className="max-w-[16rem] truncate px-3 py-2 text-ink-soft">{row.merchant}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-ink">
                        {money(row.amountMinor, row.currency)}
                      </td>
                      <td className="px-3 py-2 text-muted">{row.type}</td>
                      <td className="px-3 py-2 text-muted">{row.duplicate ? "Yes" : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {previewData.transactions.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted">
                No rows could be read. Check that a date and merchant column are selected.
              </p>
            ) : null}
            {previewData.errors.length > 0 ? (
              <div className="border-t border-line px-4 py-3">
                <p className="text-xs font-semibold text-amber-strong">Rows with problems</p>
                <ul className="mt-1.5 space-y-1 text-xs text-muted">
                  {previewData.errors.slice(0, 8).map((row) => (
                    <li key={`${row.row}-${row.message}`}>
                      Row {row.row}: {row.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>
        </>
      ) : null}
    </div>
  );
}

function ColumnSelect({
  label,
  value,
  columns,
  optional,
  onChange,
}: {
  label: string;
  value: string;
  columns: string[];
  optional?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label} hint={optional ? "Optional" : undefined}>
      <Select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{optional ? "Not used" : "Choose a column"}</option>
        {columns.map((column) => (
          <option key={column} value={column}>
            {column}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/* -------------------------------- screenshot ------------------------------- */

function ScreenshotTab({ onResult }: { onResult: (result: MessageImportResult) => void }) {
  const importMessage = useImportMessage();
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const objectUrl = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, []);

  async function chooseFile(next: File | undefined) {
    if (!next) return;
    setError(null);
    setText("");
    setFile(next);
    setProgress(0);
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    const url = URL.createObjectURL(next);
    objectUrl.current = url;
    setPreviewUrl(url);

    try {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng", 1, {
        logger: (message) => {
          if (typeof message.progress === "number") setProgress(message.progress);
        },
      });
      try {
        const result = await worker.recognize(next);
        setText(result.data.text.trim());
      } finally {
        await worker.terminate();
      }
    } catch {
      setError(
        "On-device reading failed. The image was not uploaded. You can type the text in the Paste tab instead.",
      );
    } finally {
      setProgress(null);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (text.trim().length < 5) {
      setError("Read or type the receipt text first.");
      return;
    }
    try {
      const result = await importMessage.mutateAsync({ source: "ocr", text });
      onResult(result);
      toast(result.summary.message, result.summary.actionable > 0 ? "success" : "info");
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <Card className="p-5 sm:p-6">
      <div className="mb-4 flex items-start gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
          <Camera className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-ink">Read a screenshot</h2>
          <p className="text-xs leading-relaxed text-muted">
            Text recognition runs in this browser. The image never leaves your device; only the
            extracted text is sent when you choose to find charges.
          </p>
        </div>
      </div>

      <Field label="Screenshot" htmlFor="ocr-file" hint="PNG, JPEG or WebP. Crop to the receipt if you can.">
        <input
          id="ocr-file"
          type="file"
          accept="image/*"
          className="field cursor-pointer py-2 text-sm file:mr-3 file:rounded-full file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-brand-800"
          onChange={(event) => void chooseFile(event.target.files?.[0])}
        />
      </Field>

      {previewUrl ? (
        <img
          src={previewUrl}
          alt="Screenshot selected for on-device text recognition"
          className="mt-3 max-h-56 w-auto rounded-xl border border-line"
        />
      ) : null}

      {progress !== null ? (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-muted">
            <span>Reading on this device…</span>
            <span>{Math.round(progress * 100)}%</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-paper-deep">
            <div
              className="h-full rounded-full bg-brand-600 transition-[width] duration-300"
              style={{ width: `${Math.max(4, Math.round(progress * 100))}%` }}
            />
          </div>
        </div>
      ) : null}

      {text ? (
        <form onSubmit={submit} className="mt-4 space-y-3" noValidate>
          <Field
            label="Extracted text"
            htmlFor="ocr-text"
            hint="Check names, amounts and dates before continuing. OCR can misread them."
            error={error ?? undefined}
          >
            <Textarea
              id="ocr-text"
              rows={7}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </Field>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted">
              {file?.name ? `From ${file.name}. ` : ""}Only this text is uploaded.
            </p>
            <Button type="submit" loading={importMessage.isPending}>
              <ScanLine className="h-4 w-4" />
              Find charges
            </Button>
          </div>
        </form>
      ) : null}

      {!text && error ? (
        <Note tone="error" className="mt-3">
          {error}
        </Note>
      ) : null}

      {!file ? (
        <div className="mt-4 flex items-start gap-2 rounded-xl bg-paper-deep/50 px-3.5 py-3 text-xs leading-relaxed text-muted">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            The first read downloads a small English recognition model. After that, the browser may
            reuse it. Nothing about the image is sent to DueRadar.
          </span>
        </div>
      ) : null}
    </Card>
  );
}

/* --------------------------------- history -------------------------------- */

function HistorySection() {
  const history = useImportHistory(20);
  const remove = useDeleteImport();
  const toast = useToast();
  const [deleting, setDeleting] = useState<ImportHistoryItem | null>(null);

  const rows = useMemo(() => history.data?.imports ?? [], [history.data]);

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await remove.mutateAsync(deleting.id);
      toast("Import deleted.");
      setDeleting(null);
    } catch (caught) {
      toast(errorMessage(caught), "error");
    }
  }

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-[-0.02em] text-ink">
            Recent imports
          </h2>
          <p className="text-xs text-muted">
            Raw message text is erased after 72 hours. Counts and review decisions remain.
          </p>
        </div>
        {history.data && history.data.imports.length > 0 ? (
          <Link
            to="/detections"
            className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"
          >
            Review inbox
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        ) : null}
      </div>

      {history.isLoading ? <LoadingBlock label="Loading recent imports" /> : null}
      {history.isError ? (
        <Note tone="error">Could not load import history. {errorMessage(history.error)}</Note>
      ) : null}

      {history.data && rows.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-5 w-5" />}
          title="No imports yet"
          description="Paste a receipt, forward an email, or bring in a statement. Each import is listed here with what it found."
        />
      ) : null}

      <ul className="space-y-2">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-paper-deep text-muted">
              {row.source === "email" ? (
                <Mail className="h-4 w-4" />
              ) : row.source === "csv" ? (
                <FileSpreadsheet className="h-4 w-4" />
              ) : row.source === "ocr" ? (
                <ScanLine className="h-4 w-4" />
              ) : (
                <ClipboardPaste className="h-4 w-4" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="truncate text-sm font-semibold text-ink">
                  {row.subject || SOURCE_LABELS[row.source] || "Import"}
                </p>
                <Badge
                  tone={
                    row.status === "failed"
                      ? "danger"
                      : row.status === "expired"
                        ? "slate"
                        : "brand"
                  }
                >
                  {row.status === "processed"
                    ? "Read"
                    : row.status === "failed"
                      ? "Needs attention"
                      : row.status === "expired"
                        ? "Text erased"
                        : row.status}
                </Badge>
              </div>
              <p className="mt-0.5 text-xs text-muted">
                {timeAgo(row.createdAt)} · {row.suggestionCount} found
                {row.pendingCount > 0 ? ` · ${row.pendingCount} awaiting review` : ""}
                {row.error ? ` · ${row.error}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              {row.pendingCount > 0 ? (
                <Link
                  to="/detections"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"
                >
                  Review
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              ) : null}
              <button
                type="button"
                aria-label="Delete import"
                onClick={() => setDeleting(row)}
                className="grid h-8 w-8 place-items-center rounded-full text-muted transition hover:bg-danger-soft hover:text-danger-strong"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
        title="Delete this import?"
        description="The import and its suggestions are removed. Records you already saved stay in your account."
        confirmLabel="Delete"
        loading={remove.isPending}
      />
    </section>
  );
}
