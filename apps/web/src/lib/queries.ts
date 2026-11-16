import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
} from "@tanstack/react-query";
import { api } from "./api";
import type {
  CalendarData,
  Category,
  Config,
  DashboardData,
  Device,
  MeResponse,
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
] as const;

export function useRefreshAll() {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all(
      ALL_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );
  };
}

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<MeResponse>("/me"),
    staleTime: 30_000,
    retry: 1,
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

export function useTestEmail() {
  return useMutation({
    mutationFn: () => api.post<{ ok: boolean; message: string }>("/test/email", {}),
  });
}

export function useTestPush() {
  return useMutation({
    mutationFn: () => api.post<{ sent: number; failed: number }>("/test/push", { channel: "push" }),
  });
}

export function useDeleteAccount() {
  return useMutation({
    mutationFn: (reason?: string) =>
      api.post("/account/delete", { confirm: "DELETE", reason }),
  });
}
