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
