/**
 * The authorisation contract with transcribe-api (DIAAT-373): what
 * `GET /api/me/permissions`, `PUT /api/me/context` and `POST /api/auth/session`
 * return. The web decides nothing from role names: it shows or hides UI from
 * `permissions` alone. Role values are only ever displayed or sent back to the
 * API as they came.
 *
 * No server-only imports here: browser and server code both use these.
 */

import type { JurisdictionStage } from "@/lib/jurisdiction-api";

/** Every permission string the API can return (authz contract, section 1). */
export const PERMISSIONS = [
  "app.access",
  "context.switch",
  "access.request",
  "access.approve",
  "dictation.use",
  "recording.upload",
  "recording.own",
  "documents.export",
  "recording.audit.read",
  "recording.any.read",
  "recording.any.edit",
  "recording.any.delete",
  "dictation.any.read",
  "admin.access",
  "legal_text.manage",
  "templates.manage",
  "document_content.read",
  "document_content.write",
  "users.manage",
  "jurisdiction_admin.assign",
  "jurisdiction_super_admin.assign",
  "role_audit.read",
  "jurisdiction.create",
  "jurisdictions.manage",
  "jurisdiction.wording.edit",
  "jurisdiction.features",
  "accounts.manage",
  "feature_flags.manage",
  "system.settings",
  "security.alert_test",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export interface JurisdictionRef {
  code: string;
  name: string;
  /** DIAAT-345: where it is not yet live for everyone. Absent: live. */
  stage?: JurisdictionStage;
}

/** A (jurisdiction, role) pair. `jurisdiction` is null for a global role. */
export interface Assignment {
  jurisdiction: JurisdictionRef | null;
  role: string;
}

export type AccessRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "withdrawn";

export interface AccessRequest {
  id: string;
  jurisdiction: JurisdictionRef;
  roles: string[];
  status: AccessRequestStatus;
  created_at: string;
  decided_at: string | null;
  reason: string | null;
}

export type MeStatus = "ready" | "choose" | "no_access";

export interface MeResponse {
  user: { id: string; email: string; name: string };
  status: MeStatus;
  assignments: Assignment[];
  active: Assignment | null;
  permissions: string[];
  pending_requests: AccessRequest[];
}

/** What the web remembers of the chosen context, in the server-side session. */
export interface SessionContext {
  jurisdiction: string | null;
  role: string;
}

export function contextOf(active: Assignment | null): SessionContext | null {
  return active
    ? { jurisdiction: active.jurisdiction?.code ?? null, role: active.role }
    : null;
}

export function sameContext(
  a: SessionContext | null | undefined,
  b: SessionContext | null | undefined
): boolean {
  if (!a || !b) return !a && !b;
  return a.jurisdiction === b.jurisdiction && a.role === b.role;
}

/** The pair as a stable key (for React keys and comparisons). */
export function assignmentKey(a: Assignment): string {
  return `${a.jurisdiction?.code ?? "-"}:${a.role}`;
}

/**
 * A readable label for a role value the API returned, without naming any
 * role: "SomeRoleName" becomes "Some role name".
 */
export function roleLabel(role: string): string {
  const words = role.replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim();
  if (!words) return role;
  const lower = words.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** The distinct jurisdictions among the assignments (global roles have none). */
export function jurisdictionsOf(assignments: Assignment[]): JurisdictionRef[] {
  const seen = new Map<string, JurisdictionRef>();
  for (const a of assignments) {
    if (a.jurisdiction && !seen.has(a.jurisdiction.code)) {
      seen.set(a.jurisdiction.code, a.jurisdiction);
    }
  }
  return [...seen.values()];
}

/** Wire shape of the header naming a context: `<jurisdiction|->:<role>`. */
export function contextHeaderValue(context: SessionContext): string {
  return `${context.jurisdiction ?? "-"}:${context.role}`;
}

/** What the mint and context endpoints return. Server side only. */
export interface TokenResponse {
  token: string;
  expires_at: string;
  me: MeResponse;
}
