import { AdminApiError } from "@/lib/admin-api";
import { apiClient } from "@/lib/api-client";

/**
 * One call to an admin endpoint. A refusal throws an AdminApiError carrying the
 * API's own message, HTTP status and `detail.code`, so a screen can show what the
 * API said (for example `assignment_not_allowed`) rather than a generic failure.
 */
export async function adminRequest<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const response = await apiClient.request<T>(endpoint, options);
  if (response.error) {
    throw new AdminApiError(response.error, response.status, response.code);
  }
  return response.data as T;
}

export function jsonRequest(method: string, body: unknown): RequestInit {
  return { method, body: JSON.stringify(body) };
}

/** `?a=1&b=2` from the defined values, or "" when there are none. */
export function queryString(
  values: Record<string, string | number | null | undefined>
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Something went wrong";
}
