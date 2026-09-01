import { apiClient } from "@/lib/api-client";
import { isLocalhostRuntime } from "@/lib/environment";

export type AdminAccessStatus =
  | "authorised"
  | "forbidden"
  | "unauthenticated"
  | "error";

export type AdminRole = "SystemAdministrator" | "LegalTextManager" | null;

interface AdminMeResponse {
  is_admin: boolean;
  role: string;
}

interface GetAdminAccessStatusOptions {
  allowLocalhostFallback?: boolean;
}

export async function getAdminAccessStatus(
  options: GetAdminAccessStatusOptions = {}
): Promise<AdminAccessStatus> {
  const shouldAllowLocalhostFallback =
    options.allowLocalhostFallback === true && isLocalhostRuntime();

  const response = await apiClient.request<AdminMeResponse>("/admin/me", {
    method: "GET",
    cache: "no-store",
  });

  if (response.data?.is_admin === true) {
    return "authorised";
  }

  // Localhost UX fallback: keep admin nav visible in local runs even if
  // Easy Auth/admin check is unavailable. Backend remains the source of truth.
  if (shouldAllowLocalhostFallback) {
    return "authorised";
  }

  if (response.status === 401) {
    return "unauthenticated";
  }

  if (response.status === 403) {
    return "forbidden";
  }

  if (response.error) {
    return "error";
  }

  return "forbidden";
}

/**
 * Fetch the current admin user's role from /admin/me.
 * Returns null when the user is not an admin or the request fails.
 */
export async function getAdminRole(): Promise<AdminRole> {
  const response = await apiClient.request<AdminMeResponse>("/admin/me", {
    method: "GET",
    cache: "no-store",
  });

  if (response.data?.is_admin === true) {
    const role = response.data.role;
    if (role === "SystemAdministrator" || role === "LegalTextManager") {
      return role;
    }
  }

  return null;
}
