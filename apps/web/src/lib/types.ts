export type RecordKind = "subscription" | "bill" | "trial" | "prepaid" | "installment";
export type RecordStatus = "active" | "paused" | "cancelled";
export type BillingCycle =
  | "weekly"
  | "monthly"
  | "quarterly"
  | "semiannual"
  | "annual"
  | "custom_days";
export type OccurrenceStatus = "pending" | "paid" | "skipped" | "canceled";
export type ReminderChannel = "email" | "push" | "in_app";
export type OccurrenceView = "overdue" | "due" | "upcoming" | "paid" | "skipped" | "canceled";

export interface Profile {
  userId: string;
  email: string;
  displayName: string | null;
  timezone: string;
  currency: string;
  locale: string;
  weekStartsOn: number;
  reminderTime: string;
  quietHoursStart: string;
  quietHoursEnd: string;
  emailReminders: boolean;
  pushReminders: boolean;
  planTier: "free" | "plus";
  planExpiresAt: string | null;
  planGrandfathered: boolean;
  paidAccessRequired: boolean;
  suspendedAt: string | null;
  suspensionReason: string | null;
  onboardedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  userId: string;
  name: string;
  color: string;
  icon: string;
  isDefault: boolean;
  createdAt: string;
}

export interface PaymentMethod {
  id: string;
  userId: string;
  label: string;
  kind: "card" | "momo" | "bank" | "wallet" | "cash" | "other";
  brand: string | null;
  last4: string | null;
  expiryMonth: number | null;
  expiryYear: number | null;
  isDefault: boolean;
  archivedAt: string | null;
  createdAt: string;
}

export interface Subscription {
  id: string;
  userId: string;
  name: string;
  vendor: string | null;
  kind: RecordKind;
  status: RecordStatus;
  amountMinor: number;
  currency: string;
  cycle: BillingCycle;
  customIntervalDays: number | null;
  anchorDate: string;
  endOfMonthMode: boolean;
  trialEndsAt: string | null;
  nextDueDate: string | null;
  categoryId: string | null;
  paymentMethodId: string | null;
  url: string | null;
  notes: string | null;
  reminderOffsets: number[] | null;
  reminderChannels: ReminderChannel[] | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  categoryName?: string | null;
  categoryColor?: string | null;
  paymentMethodLabel?: string | null;
}

export interface SubscriptionDetail extends Subscription {
  occurrences: Occurrence[];
}

export interface Occurrence {
  id: string;
  subscriptionId: string;
  userId?: string;
  dueDate: string;
  periodStart: string;
  periodEnd: string;
  amountMinor: number;
  currency: string;
  status: OccurrenceStatus;
  paidAt: string | null;
  paymentId: string | null;
  snoozedUntil: string | null;
  name: string;
  vendor: string | null;
  kind: RecordKind;
  cycle: BillingCycle;
  subscriptionStatus?: RecordStatus;
  categoryName: string | null;
  categoryColor: string | null;
  view: OccurrenceView;
  daysUntil: number;
}

export interface Payment {
  id: string;
  userId: string;
  subscriptionId: string | null;
  occurrenceId: string | null;
  amountMinor: number;
  currency: string;
  paidAt: string;
  method: string | null;
  reference: string | null;
  source: "manual" | "import" | "detection";
  notes: string | null;
  description: string | null;
  createdAt: string;
}

export interface MoneyTotal {
  currency: string;
  amountMinor: number;
}

export interface DashboardData {
  today: string;
  timezone: string;
  currency: string;
  counts: {
    active: number;
    dueSoon: number;
    overdue: number;
    trials: number;
    upcoming: number;
  };
  next: Occurrence[];
  overdue: Occurrence[];
  trials: Occurrence[];
  totals: {
    overdue: MoneyTotal[];
    dueThisMonth: MoneyTotal[];
    next30: MoneyTotal[];
    paidThisMonth: MoneyTotal[];
  };
  recentPayments: Payment[];
  formatted: {
    overdue: string[];
    dueThisMonth: string[];
    monthLabel: string;
  };
}

export interface Notification {
  id: string;
  userId: string;
  kind: string;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface Device {
  id: string;
  endpoint?: string;
  platform: string | null;
  userAgent: string | null;
  lastSeenAt: string;
  createdAt: string;
}

export interface Config {
  appName: string;
  environment: string;
  supportEmail: string;
  vapidPublicKey: string | null;
  pushConfigured: boolean;
  emailConfigured: boolean;
  defaults: {
    timezone: string;
    currency: string;
    locale: string;
    reminderTime: string;
    quietHoursStart: string;
    quietHoursEnd: string;
    weekStartsOn: number;
  };
}

export interface MeResponse {
  user: { id: string; email: string; name: string | null };
  profile: Profile;
  needsOnboarding: boolean;
  requiresPaidPlan: boolean;
  isAdmin: boolean;
}

export interface AdminOverview {
  totalUsers: number;
  activeItems: number;
  plusMembers: number;
  paidTransactions: number;
  pendingPayments: number;
  grossPaidMinor: string;
}

export interface AdminUser {
  userId: string;
  email: string;
  displayName: string | null;
  plan: "free" | "plus";
  planExpiresAt: string | null;
  planGrandfathered: boolean;
  suspendedAt: string | null;
  suspensionReason: string | null;
  createdAt: string;
  activeItems: number;
}

export interface AdminBillingTransaction {
  id: string;
  userId: string;
  email: string | null;
  reference: string;
  interval: "monthly" | "annual";
  amountMinor: number;
  currency: string;
  status: "pending" | "paid" | "failed";
  paidAt: string | null;
  accessUntil: string | null;
  createdAt: string;
}

export interface CalendarData {
  year: number;
  month: number;
  first: string;
  last: string;
  today: string;
  occurrences: Occurrence[];
}

export interface SubscriptionInput {
  name: string;
  vendor?: string | null;
  kind: RecordKind;
  amountMinor: number;
  currency: string;
  cycle: BillingCycle;
  customIntervalDays?: number | null;
  anchorDate: string;
  endOfMonthMode?: boolean;
  trialEndsAt?: string | null;
  categoryId?: string | null;
  paymentMethodId?: string | null;
  url?: string | null;
  notes?: string | null;
  reminderOffsets?: number[] | null;
  reminderChannels?: ReminderChannel[] | null;
  status?: RecordStatus;
}

export interface ApiErrorPayload {
  error: { code: string; message: string; details?: unknown };
}

/* ------------------------------- Phase 2 -------------------------------- */

export type DetectionKind = "subscription" | "bill" | "trial" | "payment";
export type DetectionTransactionType =
  | "payment"
  | "card_check"
  | "refund"
  | "declined"
  | "transfer"
  | "incoming"
  | "unknown";
export type DetectionStatus = "pending" | "accepted" | "rejected";

export interface DetectionEvidence {
  field: string;
  text: string;
  origin: "provider" | "user" | "estimate";
}

export interface DetectionWarning {
  code: string;
  message: string;
}

export interface DetectionTransaction {
  merchant: string;
  amountMinor: number;
  currency: string;
  occurredAt: string;
  type: DetectionTransactionType;
  reference?: string | null;
}

export interface DetectionDraft {
  kind: DetectionKind;
  merchant: string | null;
  vendor: string | null;
  amountMinor: number | null;
  currency: string;
  occurredAt: string | null;
  trialEndsAt: string | null;
  firstChargeAt: string | null;
  renewalDate: string | null;
  cycle: BillingCycle | null;
  customIntervalDays: number | null;
  transactionType: DetectionTransactionType;
  paymentRail: "momo" | "card" | "bank" | "wallet" | "unknown";
  reference: string | null;
  parser: "momo" | "card" | "trial" | "subscription" | "generic";
  confidence: number;
  eligible: boolean;
  warnings: DetectionWarning[];
  evidence: DetectionEvidence[];
  dedupeKey: string;
  transactions?: DetectionTransaction[];
}

export interface DetectionSource {
  id: string;
  source: string;
  subject: string | null;
  fromAddress: string | null;
  createdAt: string;
}

export interface DetectionSuggestion {
  id: string;
  importId: string | null;
  kind: string | null;
  status: DetectionStatus;
  confidence: number;
  dedupeKey: string;
  acceptedSubscriptionId: string | null;
  createdAt: string;
  resolvedAt: string | null;
  draft: DetectionDraft;
  autoTracked: boolean;
  autoTrackIgnored: boolean;
  actionable: boolean;
  eligible: boolean;
  needsDetails: boolean;
  blockedReason: string | null;
  source: DetectionSource | null;
}

export interface DetectionSummary {
  pending: number;
  ready: number;
  needsDetails: number;
  blocked: number;
  latest: DetectionSuggestion[];
}

export interface ImportRecord {
  id: string;
  source: string;
  status: string;
  subject: string | null;
  fromAddress: string | null;
  messageId: string | null;
  processedAt: string | null;
  error: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  rawRetentionUntil: string | null;
  rawTextExpired: boolean;
}

export interface ImportHistoryItem extends ImportRecord {
  suggestionCount: number;
  pendingCount: number;
}

export interface ImportSummary {
  parser: string;
  detected: number;
  actionable: number;
  blocked: number;
  message: string;
}

export interface MessageImportResult {
  import: ImportRecord;
  suggestions: DetectionSuggestion[];
  summary: ImportSummary;
}

export interface CsvMapping {
  date: string;
  merchant: string;
  amount?: string | null;
  debit?: string | null;
  credit?: string | null;
  currency?: string | null;
  type?: string | null;
  reference?: string | null;
  dateFormat: "auto" | "dmy" | "mdy" | "ymd";
  defaultCurrency: string;
}

export interface CsvRowError {
  row: number;
  message: string;
}

export interface CsvPreview {
  headers: string[];
  delimiter: string;
  truncated: boolean;
  suggestedMapping: CsvMapping;
  mapping: CsvMapping;
  sampleRows: string[][];
  transactions: Array<{
    merchant: string;
    amountMinor: number;
    currency: string;
    occurredAt: string;
    type: DetectionTransactionType;
    reference?: string | null;
    duplicate: boolean;
  }>;
  totals: {
    rows: number;
    transactions: number;
    duplicates: number;
    errors: number;
  };
  errors: CsvRowError[];
}

export interface CsvImportResult {
  import: ImportRecord;
  suggestions: DetectionSuggestion[];
  summary: {
    rows: number;
    transactions: number;
    duplicates: number;
    errors: CsvRowError[];
    candidates: number;
    skippedExisting: number;
    autoTracked: number;
    message: string;
  };
}

export interface EmailAlias {
  id: string;
  address: string;
  createdAt: string;
  lastReceivedAt: string | null;
  revokedAt: string | null;
}

export interface EmailAliasResponse {
  alias: EmailAlias | null;
  configured: boolean;
  domain: string | null;
}

export interface GmailConnectionStatus {
  configured: boolean;
  connected: boolean;
  status: "active" | "revoked" | "error" | null;
  emailAddress: string | null;
  lastSyncedAt: string | null;
  hasMore: boolean;
}

export interface GmailSyncResult {
  imported: number;
  skippedDuplicates: number;
  detected: number;
  hasMore: boolean;
  message: string;
}

export interface BillingPlan {
  tier: "free" | "plus";
  grandfathered: boolean;
  expiresAt: string | null;
  activeItems: number;
  activeItemLimit: number | null;
  canUseEmailImport: boolean;
  configured: boolean;
  prices: {
    monthly: { currency: "GHS"; amount: string };
    annual: { currency: "GHS"; amount: string };
  };
}

export interface DetectionAcceptOverrides {
  name?: string;
  vendor?: string | null;
  kind?: "subscription" | "bill" | "trial";
  amountMinor?: number;
  currency?: string;
  cycle?: BillingCycle;
  customIntervalDays?: number | null;
  anchorDate?: string;
  trialEndsAt?: string | null;
  categoryId?: string | null;
  paymentMethodId?: string | null;
  url?: string | null;
  notes?: string | null;
}

