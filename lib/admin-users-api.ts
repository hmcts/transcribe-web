import { apiClient } from "@/lib/api-client";

export interface AdminUser {
  id: string;
  email: string;
  role: string;
  has_completed_onboarding: boolean;
  created_datetime: string;
}

export interface AdminUsersResponse {
  items: AdminUser[];
  total: number;
  page: number;
  page_size: number;
}

export const VALID_ROLES = [
  "Normal",
  "Judge",
  "LegalTextManager",
  "SystemAdministrator",
] as const;

export type AppRole = (typeof VALID_ROLES)[number];

export async function fetchAdminRoles(): Promise<string[]> {
  const data = await request<{ roles: string[] }>("/admin/roles", {
    method: "GET",
    cache: "no-store",
  });
  return data.roles;
}

async function request<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const response = await apiClient.request<T>(endpoint, options);
  if (response.error || response.data === undefined) {
    throw new Error(response.error ?? "Request failed");
  }
  return response.data;
}

export async function fetchAdminUsers(
  page = 1,
  pageSize = 50,
  searchEmail?: string
): Promise<AdminUsersResponse> {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  if (searchEmail?.trim()) {
    params.set("search_email", searchEmail.trim());
  }
  return request<AdminUsersResponse>(`/admin/users?${params}`, {
    method: "GET",
    cache: "no-store",
  });
}

export async function updateUserRole(
  userId: string,
  role: string
): Promise<AdminUser> {
  return request<AdminUser>(`/admin/users/${userId}/role`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
}

export async function deleteAdminUser(userId: string): Promise<void> {
  const response = await apiClient.request(`/admin/users/${userId}`, {
    method: "DELETE",
  });
  if (response.error) {
    throw new Error(response.error);
  }
}
