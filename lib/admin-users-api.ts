import {
  adminRequest,
  jsonRequest,
  queryString,
} from "@/lib/admin-request";
import { describeRefusal } from "@/lib/access/refusal-messages";
import type { JurisdictionRef } from "@/lib/access/types";

/**
 * The Admin Users, role-history and assignment endpoints (authz contract,
 * section 3; DIAAT-383, DIAAT-385, DIAAT-374). The API decides what the caller
 * may see and change; the web shows what it is given and sends back what the
 * person chose, with no role list of its own.
 */

/** `GET /api/admin/roles`: the roles the caller may assign, as `{"roles": [...]}`. */
export interface AdminRolesResponse {
  roles: string[];
}

/** The roles the caller may assign. Throws with the API's reason if it refuses. */
export async function fetchAdminRoles(): Promise<string[]> {
  const body = await adminRequest<AdminRolesResponse>("/admin/roles", {
    method: "GET",
    cache: "no-store",
  });
  const roles = body?.roles;
  if (!Array.isArray(roles) || !roles.every((r) => typeof r === "string")) {
    // The shape the API promised is not what came back: say so, rather than
    // letting `undefined` reach a component that maps over it.
    throw new Error("The role list from the API was not in the expected shape");
  }
  return roles;
}

export interface AdminAssignment {
  id: string;
  /** null for a global role. */
  jurisdiction: JurisdictionRef | null;
  role: string;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  is_active: boolean;
  assignments: AdminAssignment[];
  /** Added by email; joins when they first sign in. */
  pending: boolean;
}

export interface AdminUserPage {
  items: AdminUser[];
  total: number;
  page: number;
  page_size: number;
}

export interface UserQuery {
  search?: string;
  jurisdiction?: string | null;
  /** Narrows the list to users holding this role, where the API supports it. The
   * caller still filters what comes back (see usersHolding). */
  role?: string;
  page?: number;
  pageSize?: number;
}

function asUserPage(body: AdminUserPage): AdminUserPage {
  if (!body || !Array.isArray(body.items)) {
    throw new Error("The user list from the API was not in the expected shape");
  }
  return {
    items: body.items.map((user) => ({
      ...user,
      assignments: Array.isArray(user.assignments) ? user.assignments : [],
    })),
    total: typeof body.total === "number" ? body.total : body.items.length,
    page: body.page ?? 1,
    page_size: body.page_size ?? body.items.length,
  };
}

/** `GET /api/admin/users`: paged and searchable by email. */
export async function fetchAdminUsers(
  query: UserQuery = {}
): Promise<AdminUserPage> {
  const body = await adminRequest<AdminUserPage>(
    `/admin/users${queryString({
      search: query.search?.trim(),
      jurisdiction: query.jurisdiction,
      role: query.role,
      page: query.page ?? 1,
      page_size: query.pageSize ?? 25,
    })}`,
    { method: "GET", cache: "no-store" }
  );
  return asUserPage(body);
}

const HOLDERS_PAGE_SIZE = 100;
const HOLDERS_MAX_PAGES = 20;

/**
 * The users who hold `role` (in `jurisdiction`, or with none for a global role).
 * The list endpoint has no role filter in the contract, so this asks for the
 * role anyway (an API that supports it returns only those users), reads the
 * pages until the total is reached, and keeps the assignments that match. The
 * number of pages is capped; `truncated` says the list may be incomplete.
 */
export async function fetchUsersHolding(
  role: string,
  jurisdiction: string | null
): Promise<{ holders: AdminUser[]; truncated: boolean }> {
  const holders: AdminUser[] = [];
  let seen = 0;
  let page = 1;
  for (; page <= HOLDERS_MAX_PAGES; page += 1) {
    const result = await fetchAdminUsers({
      jurisdiction,
      role,
      page,
      pageSize: HOLDERS_PAGE_SIZE,
    });
    for (const user of result.items) {
      const held = user.assignments.filter(
        (a) => a.role === role && (a.jurisdiction?.code ?? null) === jurisdiction
      );
      if (held.length > 0) holders.push({ ...user, assignments: held });
    }
    seen += result.items.length;
    if (result.items.length === 0 || seen >= result.total) {
      return { holders, truncated: false };
    }
  }
  return { holders, truncated: true };
}

/** Who gets the role: a user who has signed in, or an email (pending until they do). */
export type AssignmentTarget = { user_id: string } | { email: string };

/** `POST /api/admin/assignments` (201). */
export function createAssignment(
  target: AssignmentTarget,
  jurisdiction: string | null,
  role: string
): Promise<AdminAssignment> {
  const who =
    "user_id" in target
      ? { user_id: target.user_id, email: null }
      : { user_id: null, email: target.email };
  return adminRequest<AdminAssignment>(
    "/admin/assignments",
    jsonRequest("POST", { ...who, jurisdiction, role })
  );
}

/** `DELETE /api/admin/assignments/{id}` (204). */
export async function deleteAssignment(id: string): Promise<void> {
  await adminRequest<void>(`/admin/assignments/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

/** Give a person several roles in one go; says which roles the API refused.
 * `self`: the person is the caller (a refusal then says why). */
export async function assignRoles(
  target: AssignmentTarget,
  jurisdiction: string | null,
  roles: string[]
): Promise<{ added: string[]; failed: { role: string; message: string }[] }> {
  const added: string[] = [];
  const failed: { role: string; message: string }[] = [];
  for (const role of roles) {
    try {
      await createAssignment(target, jurisdiction, role);
      added.push(role);
    } catch (error) {
      failed.push({
        role,
        message: describeRefusal(error, {}, "Not added"),
      });
    }
  }
  return { added, failed };
}

/** `POST /api/admin/users/{id}/deactivate` (204). */
export async function deactivateUser(id: string): Promise<void> {
  await adminRequest<void>(
    `/admin/users/${encodeURIComponent(id)}/deactivate`,
    { method: "POST" }
  );
}

/** `POST /api/admin/users/{id}/reactivate` (204). */
export async function reactivateUser(id: string): Promise<void> {
  await adminRequest<void>(
    `/admin/users/${encodeURIComponent(id)}/reactivate`,
    { method: "POST" }
  );
}

export type RoleChange =
  | "assignment.added"
  | "assignment.removed"
  | "user.deactivated"
  | "user.reactivated"
  | "membership.leave"
  | "access_request.approved"
  | "access_request.rejected";

export interface RoleHistoryEntry {
  id: string;
  timestamp: string;
  /** `id` is null when a system administrator made the change: the API then
   * sends `email: "system administrator"` (not an address). */
  actor: { id: string | null; email: string };
  actor_context: { jurisdiction: string | null; role: string } | null;
  target: { id: string | null; email: string };
  /** One of RoleChange; a value this release does not know is shown as it came. */
  change: RoleChange | string;
  jurisdiction: string | null;
  role: string | null;
}

export interface RoleHistoryPage {
  items: RoleHistoryEntry[];
  total: number;
}

/** `GET /api/admin/role-history` (role_audit.read). */
export async function fetchRoleHistory(
  query: {
    jurisdiction?: string | null;
    /** Only the changes made to this user (DIAAT-406). */
    user?: string;
    page?: number;
    pageSize?: number;
  } = {}
): Promise<RoleHistoryPage> {
  const body = await adminRequest<RoleHistoryPage>(
    `/admin/role-history${queryString({
      jurisdiction: query.jurisdiction,
      user: query.user,
      page: query.page ?? 1,
      page_size: query.pageSize ?? 50,
    })}`,
    { method: "GET", cache: "no-store" }
  );
  if (!body || !Array.isArray(body.items)) {
    throw new Error("The history from the API was not in the expected shape");
  }
  return { items: body.items, total: body.total ?? body.items.length };
}

export const SYSTEM_ADMINISTRATOR_LABEL = "System administrator";

/**
 * Who a history row says did it. `actor.id` is null for a change made through the
 * system administrator's own permissions (the API names no person then), and the
 * row can in principle lack an actor: neither may break the list.
 */
export function actorLabel(entry: Pick<RoleHistoryEntry, "actor">): string {
  const actor = entry.actor as RoleHistoryEntry["actor"] | null | undefined;
  const email = typeof actor?.email === "string" ? actor.email.trim() : "";
  if (actor?.id) return email || "Unknown user";
  // No person: a real address is still shown, anything else is the system.
  return email.includes("@") ? email : SYSTEM_ADMINISTRATOR_LABEL;
}

/** What a history `change` reads as. Unknown values are shown as the API sent them. */
export function describeRoleChange(change: string): string {
  switch (change) {
    case "assignment.added":
      return "Role given";
    case "assignment.removed":
      return "Role removed";
    case "user.deactivated":
      return "Deactivated";
    case "user.reactivated":
      return "Reactivated";
    case "membership.leave":
      return "Left the jurisdiction";
    case "access_request.approved":
      return "Request approved";
    case "access_request.rejected":
      return "Request rejected";
    default:
      return change;
  }
}
