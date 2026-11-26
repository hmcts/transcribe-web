import { adminRequest, jsonRequest } from "@/lib/admin-request";
import type { AccessRequest } from "@/lib/access/types";

/** The approvals queue (authz contract, section 3; DIAAT-396; access.approve). */

export interface PendingAccessRequest extends AccessRequest {
  requester: { id: string; email: string; name: string | null };
}

/** `GET /api/admin/access-requests?status=pending`. The API scopes it to the
 * caller's jurisdictions. */
export async function fetchPendingRequests(): Promise<PendingAccessRequest[]> {
  const body = await adminRequest<PendingAccessRequest[]>(
    "/admin/access-requests?status=pending",
    { method: "GET", cache: "no-store" }
  );
  if (!Array.isArray(body)) {
    throw new Error("The requests from the API were not in the expected shape");
  }
  return body;
}

/** Approve or reject, with an optional reason the requester can read. */
export function decideRequest(
  id: string,
  decision: "approve" | "reject",
  reason: string
): Promise<AccessRequest> {
  return adminRequest<AccessRequest>(
    `/admin/access-requests/${encodeURIComponent(id)}/${decision}`,
    jsonRequest("POST", { reason: reason.trim() || null })
  );
}
