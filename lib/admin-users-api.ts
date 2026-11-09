import { apiClient } from "@/lib/api-client";

/**
 * `GET /api/admin/roles` (authz contract, section 3): the roles the caller may
 * assign, as `{"roles": [...]}`. The API never lists a role the caller cannot
 * assign, and never the system administrator role, so the web shows what it is
 * given and keeps no list of its own (DIAAT-374).
 */
export interface AdminRolesResponse {
  roles: string[];
}

/** The roles the caller may assign. Throws with the API's reason if it refuses. */
export async function fetchAdminRoles(): Promise<string[]> {
  const response = await apiClient.request<AdminRolesResponse>("/admin/roles", {
    method: "GET",
    cache: "no-store",
  });
  if (response.error) throw new Error(response.error);
  const roles = response.data?.roles;
  if (!Array.isArray(roles) || !roles.every((r) => typeof r === "string")) {
    // The shape the API promised is not what came back: say so, rather than
    // letting `undefined` reach a component that maps over it.
    throw new Error("The role list from the API was not in the expected shape");
  }
  return roles;
}
