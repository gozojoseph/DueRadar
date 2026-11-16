import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Receipt, Search, X } from "lucide-react";
import { Badge, Button, CardSkeleton, EmptyState, Input, PageHeader, Select, Segmented, cx } from "../components/ui";
import { SubscriptionCard } from "../components/records";
import { useSubscriptions } from "../lib/queries";
import { kindShort } from "../lib/format";
import type { RecordKind } from "../lib/types";

const STATUS_OPTIONS = [
  { value: "", label: "All" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "cancelled", label: "Cancelled" },
] as const;

const KIND_OPTIONS: Array<{ value: "" | RecordKind; label: string }> = [
  { value: "", label: "All types" },
  { value: "bill", label: "Bills" },
  { value: "subscription", label: "Subscriptions" },
  { value: "trial", label: "Free trials" },
  { value: "prepaid", label: "Prepaid" },
  { value: "installment", label: "Instalments" },
];

export function SubscriptionsPage() {
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState<"" | RecordKind>("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const filters = useMemo(() => ({ status, kind, search }), [status, kind, search]);
  const query = useSubscriptions(filters);
  const records = query.data?.subscriptions ?? [];
  const activeCount = records.filter((record) => record.status === "active").length;

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow="Tracked"
        title="Everything you track"
        description="Bills, subscriptions and trials, ordered by what is due next. Paused items keep their history here."
        actions={
          <Link to="/subscriptions/new">
            <Button>
              <Plus className="h-4 w-4" />
              Add
            </Button>
          </Link>
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search name or vendor"
            className="pl-9 pr-9"
            aria-label="Search tracked items"
          />
          {searchInput ? (
            <button
              type="button"
              onClick={() => setSearchInput("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-muted hover:bg-ink/5 hover:text-ink"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        <Select
          value={kind}
          onChange={(event) => setKind(event.target.value as "" | RecordKind)}
          className="sm:w-44"
          aria-label="Filter by type"
        >
          {KIND_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={status}
          onChange={setStatus}
          options={STATUS_OPTIONS.map((option) => ({ ...option }))}
        />
        <p className="text-xs text-muted">
          {query.isLoading
            ? "Loading…"
            : `${records.length} ${records.length === 1 ? "record" : "records"}${
                status === "active" || !status ? ` · ${activeCount} active` : ""
              }`}
        </p>
      </div>

      {query.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <CardSkeleton key={index} />
          ))}
        </div>
      ) : query.isError ? (
        <EmptyState
          icon={<Receipt className="h-5 w-5" />}
          title="Could not load your records"
          description="Check your connection and try again."
          action={<Button onClick={() => void query.refetch()}>Try again</Button>}
        />
      ) : records.length === 0 ? (
        <EmptyState
          icon={<Receipt className="h-5 w-5" />}
          title={
            search || status || kind
              ? "Nothing matches those filters"
              : "No records yet"
          }
          description={
            search || status || kind
              ? "Try a different search or clear the filters."
              : "Start with rent, electricity, internet, or the subscription you keep meaning to review."
          }
          action={
            search || status || kind ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setSearchInput("");
                  setSearch("");
                  setStatus("");
                  setKind("");
                }}
              >
                Clear filters
              </Button>
            ) : (
              <Link to="/subscriptions/new">
                <Button>
                  <Plus className="h-4 w-4" />
                  Add your first record
                </Button>
              </Link>
            )
          }
        />
      ) : (
        <ul className={cx("space-y-2.5", query.isFetching && "opacity-80")}>
          {records.map((record) => (
            <li key={record.id}>
              <SubscriptionCard subscription={record} />
            </li>
          ))}
        </ul>
      )}

      {records.length > 0 ? (
        <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-muted">
          <Badge tone="brand">{activeCount} active</Badge>
          {Object.entries(
            records.reduce<Record<string, number>>((counts, record) => {
              counts[record.kind] = (counts[record.kind] ?? 0) + 1;
              return counts;
            }, {}),
          ).map(([recordKind, count]) => (
            <Badge key={recordKind} tone="slate">
              {count} {kindShort(recordKind as RecordKind).toLowerCase()}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}
