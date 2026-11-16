import { clearAuthToken, getAuthToken } from "./auth";
import type { ApiErrorPayload } from "./types";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type QueryValue = string | number | boolean | null | undefined;

export function qs(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const result = search.toString();
  return result ? `?${result}` : "";
}

async function toApiError(response: Response): Promise<ApiError> {
  let payload: ApiErrorPayload | null = null;
  try {
    payload = (await response.json()) as ApiErrorPayload;
  } catch {
    payload = null;
  }
  const code = payload?.error?.code ?? "request_failed";
  const message =
    payload?.error?.message ??
    (response.status === 401
      ? "Please sign in again."
      : response.status >= 500
        ? "The server had a problem. Try again."
        : "That request could not be completed.");
  return new ApiError(response.status, code, message, payload?.error?.details);
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<T> {
  const token = await getAuthToken().catch(() => null);
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  headers.set("accept", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);

  const response = await fetch(`/api/v1${path}`, {
    credentials: "include",
    ...init,
    headers,
  });

  if (response.status === 401 && retry) {
    clearAuthToken();
    const refreshed = await getAuthToken(true).catch(() => null);
    if (refreshed) return request<T>(path, init, false);
  }

  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  get<T>(path: string, params?: Record<string, QueryValue>): Promise<T> {
    return request<T>(`${path}${params ? qs(params) : ""}`);
  },
  post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  },
  patch<T>(path: string, body: unknown): Promise<T> {
    return request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
  },
  delete<T = void>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, {
      method: "DELETE",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  },
  async download(path: string): Promise<{ blob: Blob; filename: string }> {
    const token = await getAuthToken().catch(() => null);
    const headers: Record<string, string> = {};
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await fetch(`/api/v1${path}`, { credentials: "include", headers });
    if (!response.ok) throw await toApiError(response);
    const disposition = response.headers.get("content-disposition") ?? "";
    const match = /filename="?([^";]+)"?/.exec(disposition);
    return {
      blob: await response.blob(),
      filename: match?.[1] ?? "dueradar-export.json",
    };
  },
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong. Try again.";
}
