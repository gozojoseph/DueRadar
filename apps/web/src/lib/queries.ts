import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
} from "@tanstack/react-query";
import { api } from "./api";
import type {
  CalendarData,
  AdminBillingTransaction,
  AdminOverview,
  AdminUser,
  BillingPlan,
  Category,
  Config,
  CsvImportResult,
  CsvMapping,
  CsvPreview,
  DashboardData,
  DetectionAcceptOverrides,
  DetectionStatus,
  DetectionSuggestion,
  DetectionSummary,
  Device,
  EmailAliasResponse,
  ImportHistoryItem,
  GmailConnectionStatus,
  GmailSyncResult,
  MeResponse,
  MessageImportResult,
  Notification,
  Occurrence,
  PaymentMethod,
  Profile,
  Subscription,
  SubscriptionDetail,
  SubscriptionInput,
} from "./types";

const ALL_KEYS = [
  ["dashboard"],
  ["subscriptions"],
  ["subscription"],
  ["occurrences"],
  ["calendar"],
  ["notifications"],
  ["devices"],
  ["profile"],
  ["detections"],
  ["detectionSummary"],
  ["imports"],
  ["importHistory"],
  ["emailAlias"],
  ["gmailConnection"],
  ["billing"],
] as const;

export function useRefreshAll() {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all(
      ALL_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );
  };
}

export function useMe(enabled = true) {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<MeResponse>("/me"),
    enabled,
    staleTime: 30_000,
    retry: 1,
  });
}

export function useAdminOverview() {
  return useQuery({
    queryKey: ["admin", "overview"],
    queryFn: () => api.get<AdminOverview>("/admin/overview"),
    staleTime: 30_000,
  });
}

export function useAdminUsers(
  filters: { search: string; limit: number; offset: number },
  enabled = true,
) {
  return useQuery({
    queryKey: ["admin", "users", filters],
    enabled,
    queryFn: () =>
      api.get<{ users: AdminUser[]; total: number; limit: number; offset: number }>(
        "/admin/users",
        filters,
      ),
    staleTime: 15_000,
  });
}

export function useAdminBilling(filters: {
  search: string;
  status: "all" | "pending" | "paid" | "failed";
  limit: number;
  offset: number;
}, enabled = true) {
  return useQuery({
    queryKey: ["admin", "billing", filters],
    enabled,
    queryFn: () =>
      api.get<{
        transactions: AdminBillingTransaction[];
        total: number;
        limit: number;
        offset: number;
      }>("/admin/billing", filters),
    staleTime: 15_000,
  });
}

export function useSetAccountSuspension() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { userId: string; suspended: boolean; reason: string }) =>
      api.patch<{ user: Pick<AdminUser, "userId" | "suspendedAt" | "suspensionReason"> }>(
        `/admin/users/${input.userId}/suspension`,
        { suspended: input.suspended, reason: input.reason },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
      await queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export function useConfig() {
  return useQuery({
    queryKey: ["config"],
    queryFn: () => api.get<Config>("/config"),
    staleTime: 60 * 60_000,
    retry: 1,
  });
}

export function useBillingPlan() {
  return useQuery({
    queryKey: ["billing"],
    queryFn: () => api.get<BillingPlan>("/billing"),
    staleTime: 30_000,
  });
}

export function useStartBillingCheckout() {
  return useMutation({
    mutationFn: (interval: "monthly" | "annual") =>
      api.post<{ checkoutUrl: string; reference: string }>("/billing/checkout", { interval }),
  });
}

export function useDeferPlanSelection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ deferred: boolean }>("/billing/skip"),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export function useVerifyBillingCheckout() {
  const refresh = useRefreshAll();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reference: string) =>
      api.post<{ status: "paid" | "pending"; activated?: boolean; accessUntil?: string | null }>(
        "/billing/verify",
        { reference },
      ),
    onSuccess: async () => {
      await refresh();
      await queryClient.invalidateQueries({ queryKey: ["billing"] });
      await queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export function useDashboard() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<DashboardData>("/dashboard"),
    staleTime: 15_000,
  });
}

export function useSubscriptions(filters: { status?: string; kind?: string; search?: string }) {
  return useQuery({
    queryKey: ["subscriptions", filters],
    queryFn: () =>
      api.get<{ subscriptions: Subscription[] }>("/subscriptions", {
        status: filters.status,
        kind: filters.kind,
        search: filters.search,
      }),
    staleTime: 15_000,
  });
}

export function useSubscription(id: string | undefined) {
  return useQuery({
    queryKey: ["subscription", id],
    queryFn: () => api.get<{ subscription: SubscriptionDetail }>(`/subscriptions/${id}`),
    enabled: Boolean(id),
    staleTime: 10_000,
  });
}

export function useOccurrences(filters: {
  from?: string;
  to?: string;
  status?: string;
  view?: string;
  kind?: string;
  subscriptionId?: string;
}) {
  return useQuery({
    queryKey: ["occurrences", filters],
    queryFn: () => api.get<{ occurrences: Occurrence[] }>("/occurrences", filters),
    staleTime: 15_000,
  });
}

export function useCalendar(year: number, month: number) {
  return useQuery({
    queryKey: ["calendar", year, month],
    queryFn: () => api.get<CalendarData>("/calendar", { year, month }),
    staleTime: 30_000,
  });
}

export function useNotifications() {
  return useQuery({
    queryKey: ["notifications"],
    queryFn: () =>
      api.get<{ notifications: Notification[]; unread: number }>("/notifications"),
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
}

export function useDevices() {
  return useQuery({
    queryKey: ["devices"],
    queryFn: () => api.get<{ devices: Device[]; pushConfigured: boolean }>("/devices"),
    staleTime: 30_000,
  });
}

export function useProfileData() {
  return useQuery({
    queryKey: ["profile"],
    queryFn: () =>
      api.get<{ profile: Profile; categories: Category[] }>("/profile"),
    staleTime: 30_000,
  });
}

export function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get<{ categories: Category[] }>("/categories"),
    staleTime: 60_000,
  });
}

export function usePaymentMethods() {
  return useQuery({
    queryKey: ["paymentMethods"],
    queryFn: () => api.get<{ paymentMethods: PaymentMethod[] }>("/payment-methods"),
    staleTime: 60_000,
  });
}

function useRoutineMutation<TData, TVariables>(
  options: UseMutationOptions<TData, unknown, TVariables>,
) {
  const refresh = useRefreshAll();
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    onSuccess: async (data, variables, onMutateResult, mutationContext) => {
      await refresh();
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      await queryClient.invalidateQueries({ queryKey: ["paymentMethods"] });
      await queryClient.invalidateQueries({ queryKey: ["categories"] });
      await options.onSuccess?.(data, variables, onMutateResult, mutationContext);
    },
  });
}

export function useCreateSubscription() {
  return useRoutineMutation({
    mutationFn: (input: SubscriptionInput) =>
      api.post<{ subscription: Subscription }>("/subscriptions", input),
  });
}

export function useUpdateSubscription(id: string) {
  return useRoutineMutation({
    mutationFn: (input: Partial<SubscriptionInput>) =>
      api.patch<{ subscription: Subscription }>(`/subscriptions/${id}`, input),
  });
}

export function useDeleteSubscription(id: string) {
  return useRoutineMutation({
    mutationFn: () => api.delete(`/subscriptions/${id}`),
  });
}

export function useSubscriptionAction(id: string) {
  return useRoutineMutation({
    mutationFn: (action: "pause" | "resume" | "cancel") =>
      api.post<{ subscription: Subscription }>(`/subscriptions/${id}/${action}`),
  });
}

export type OccurrenceAction = "pay" | "unpay" | "skip" | "unskip" | "unsnooze";

export function useOccurrenceAction() {
  return useRoutineMutation({
    mutationFn: (input: {
      id: string;
      action: OccurrenceAction;
      body?: unknown;
    }) =>
      api.post<{ occurrence: Occurrence }>(
        `/occurrences/${input.id}/${input.action}`,
        input.body ?? {},
      ),
  });
}

export function useSnoozeOccurrence() {
  return useRoutineMutation({
    mutationFn: (input: { id: string; until: string }) =>
      api.post<{ occurrence: Occurrence }>(`/occurrences/${input.id}/snooze`, {
        until: input.until,
      }),
  });
}

export function useUpdateProfile() {
  return useRoutineMutation({
    mutationFn: (input: Partial<Profile>) =>
      api.patch<{ profile: Profile }>("/profile", input),
  });
}

export function useCompleteOnboarding() {
  return useRoutineMutation({
    mutationFn: (input: {
      displayName?: string;
      timezone?: string;
      currency?: string;
      reminderTime?: string;
      quietHoursStart?: string;
      quietHoursEnd?: string;
      emailReminders?: boolean;
      pushReminders?: boolean;
      weekStartsOn?: number;
    }) => api.post<{ profile: Profile }>("/profile/onboarding", input),
  });
}

export function useCreateCategory() {
  return useRoutineMutation({
    mutationFn: (input: { name: string; color?: string }) =>
      api.post<{ category: Category }>("/categories", input),
  });
}

export function useUpdateCategory() {
  return useRoutineMutation({
    mutationFn: (input: { id: string; name?: string; color?: string }) =>
      api.patch<{ category: Category }>(`/categories/${input.id}`, {
        name: input.name,
        color: input.color,
      }),
  });
}

export function useDeleteCategory() {
  return useRoutineMutation({
    mutationFn: (id: string) => api.delete(`/categories/${id}`),
  });
}

export function useCreatePaymentMethod() {
  return useRoutineMutation({
    mutationFn: (input: {
      label: string;
      kind: PaymentMethod["kind"];
      brand?: string | null;
      last4?: string | null;
      expiryMonth?: number | null;
      expiryYear?: number | null;
      isDefault?: boolean;
    }) => api.post<{ paymentMethod: PaymentMethod }>("/payment-methods", input),
  });
}

export function useDeletePaymentMethod() {
  return useRoutineMutation({
    mutationFn: (id: string) => api.delete(`/payment-methods/${id}`),
  });
}

export function useMarkNotificationsRead() {
  return useRoutineMutation({
    mutationFn: (input: { all?: boolean; ids?: string[] }) =>
      api.post<{ ok: boolean }>("/notifications/read", input),
  });
}

export function useRegisterDevice() {
  return useMutation({
    mutationFn: (input: {
      endpoint: string;
      keys: { p256dh: string; auth: string };
      platform?: string;
    }) => api.post<{ device: { id: string } }>("/devices", input),
  });
}

export function useRemoveDevice() {
  return useMutation({
    mutationFn: (id: string) => api.delete(`/devices/${id}`),
  });
}

export function useTestDevicePush() {
  return useMutation({
    mutationFn: () =>
      api.post<{ sent: number; failed: number; message?: string }>("/devices/test"),
  });
}

export function usePreviewReminderPush() {
  return useMutation({
    mutationFn: () =>
      api.post<{ sent: number; failed: number; message?: string }>("/devices/test-reminder"),
  });
}

export function useDeleteAccount() {
  return useMutation({
    mutationFn: (reason?: string) =>
      api.post("/account/delete", { confirm: "DELETE", reason }),
  });
}

/* ------------------------------- Phase 2 ------------------------------- */

export function useDetectionSummary() {
  return useQuery({
    queryKey: ["detectionSummary"],
    queryFn: () => api.get<DetectionSummary>("/detections/summary"),
    staleTime: 20_000,
    refetchInterval: 90_000,
  });
}

export function useDetections(
  status: DetectionStatus | "all" = "pending",
  includeBlocked = true,
) {
  return useQuery({
    queryKey: ["detections", status, includeBlocked],
    queryFn: () =>
      api.get<{ suggestions: DetectionSuggestion[] }>("/detections", {
        status,
        includeBlocked: includeBlocked ? "true" : "false",
      }),
    staleTime: 15_000,
  });
}

export function useAcceptDetection() {
  return useRoutineMutation({
    mutationFn: (input: { id: string; overrides?: DetectionAcceptOverrides }) =>
      api.post<{
        suggestion: DetectionSuggestion;
        subscriptionId: string;
        recordedPayments: number;
      }>(`/detections/${input.id}/accept`, { overrides: input.overrides ?? {} }),
  });
}

export function useRejectDetection() {
  return useRoutineMutation({
    mutationFn: (input: { id: string; reason?: string | null }) =>
      api.post<{ suggestion: DetectionSuggestion }>(`/detections/${input.id}/reject`, {
        reason: input.reason ?? null,
      }),
  });
}

export function useUndoAutoTrackedDetection() {
  return useRoutineMutation({
    mutationFn: (id: string) =>
      api.post<{ suggestion: DetectionSuggestion }>(
        `/detections/${id}/undo-auto-track`,
      ),
  });
}

export function useRejectAllDetections() {
  return useRoutineMutation({
    mutationFn: (ids?: string[]) =>
      api.post<{ rejected: number }>("/detections/reject-all", { ids }),
  });
}

export function useImportMessage() {
  return useRoutineMutation({
    mutationFn: (input: {
      source?: "paste" | "ocr" | "upload";
      text: string;
      subject?: string | null;
      fromAddress?: string | null;
    }) => api.post<MessageImportResult>("/imports/message", input),
  });
}

export function useImportHistory(limit = 20) {
  return useQuery({
    queryKey: ["importHistory", limit],
    queryFn: () => api.get<{ imports: ImportHistoryItem[] }>("/imports", { limit }),
    staleTime: 30_000,
  });
}

export function useDeleteImport() {
  return useRoutineMutation({
    mutationFn: (id: string) => api.delete(`/imports/${id}`),
  });
}

export function useCsvPreview() {
  return useMutation({
    mutationFn: (input: { csv: string; mapping?: CsvMapping | null }) =>
      api.post<{ preview: CsvPreview }>("/imports/csv/preview", input),
  });
}

export function useCsvImport() {
  return useRoutineMutation({
    mutationFn: (input: { csv: string; mapping: CsvMapping; fileName?: string | null }) =>
      api.post<CsvImportResult>("/imports/csv", input),
  });
}

export function useEmailAlias() {
  return useQuery({
    queryKey: ["emailAlias"],
    queryFn: () => api.get<EmailAliasResponse>("/email-alias"),
    staleTime: 30_000,
  });
}

export function useGmailConnection() {
  return useQuery({
    queryKey: ["gmailConnection"],
    queryFn: () => api.get<GmailConnectionStatus>("/providers/gmail/status"),
    staleTime: 30_000,
  });
}

export function useStartGmailConnection() {
  return useMutation({
    mutationFn: () =>
      api.post<{ authorizationUrl: string }>("/providers/gmail/connect"),
  });
}

export function useCompleteGmailOAuth() {
  return useRoutineMutation({
    mutationFn: (input: { code: string; state: string }) =>
      api.post<{ connected: boolean; emailAddress: string }>(
        "/providers/gmail/callback",
        input,
      ),
  });
}

export function useSyncGmail() {
  return useRoutineMutation({
    mutationFn: () => api.post<GmailSyncResult>("/providers/gmail/sync"),
  });
}

export function useDisconnectGmail() {
  return useRoutineMutation({
    mutationFn: () =>
      api.delete<{ disconnected: boolean; revokeWarning: string | null }>(
        "/providers/gmail",
      ),
  });
}

export function useCreateEmailAlias() {
  return useRoutineMutation({
    mutationFn: (rotate?: boolean) =>
      api.post<EmailAliasResponse>("/email-alias", { rotate }),
  });
}

export function useRevokeEmailAlias() {
  return useRoutineMutation({
    mutationFn: () => api.delete<EmailAliasResponse>("/email-alias"),
  });
}
