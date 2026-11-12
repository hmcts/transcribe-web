/**
 * `MeResponse` fixtures shaped like the API's answers for each persona
 * (authz contract, sections 1 and 3), and a mock of the access provider.
 *
 * The role names and the role-to-permission map below are TEST DATA: they
 * copy the contract's table so a test can prove the UI follows the permissions
 * the API returns. Nothing in the app reads them.
 *
 *   vi.mock("@/providers/access", async () =>
 *     (await import("../access-helpers")).mockAccessModule(() => persona));
 */

import type React from "react";
import type {
  Assignment,
  MeResponse,
  Permission,
} from "@/lib/access/types";
import { accessValueFor } from "@/lib/access/permissions";
import type { AccessValue } from "@/providers/access";

export const ET_REF = { code: "ET", name: "Employment Tribunal" };
export const IAC_REF = { code: "IAC", name: "Immigration and Asylum Chamber" };

const BASIC: Permission[] = [
  "app.access",
  "context.switch",
  "access.request",
];

const JUDGE: Permission[] = [
  ...BASIC,
  "dictation.use",
  "recording.upload",
  "recording.own",
  "documents.export",
  "recording.audit.read",
  "document_content.read",
];
const LEGAL: Permission[] = [
  ...BASIC,
  "admin.access",
  "legal_text.manage",
  "templates.manage",
  "document_content.read",
  "document_content.write",
];
const JADMIN: Permission[] = [
  ...BASIC,
  "admin.access",
  "users.manage",
  "access.approve",
  "role_audit.read",
  "templates.manage",
  "jurisdictions.manage",
  "jurisdiction.wording.edit",
  "jurisdiction.features",
];
const JSUPER: Permission[] = [
  ...JADMIN,
  "jurisdiction.create",
  "jurisdiction_admin.assign",
];
const SYSADMIN: Permission[] = [
  "admin.access",
  "feature_flags.manage",
  "system.settings",
  "security.alert_test",
  "jurisdiction_super_admin.assign",
];

const USER = { id: "u-1", email: "someone@localhost.test", name: "Some One" };

function me(
  over: Partial<MeResponse> & Pick<MeResponse, "status" | "permissions">
): MeResponse {
  return {
    user: USER,
    assignments: [],
    active: null,
    pending_requests: [],
    ...over,
  };
}

const at = (jurisdiction: typeof ET_REF | null, role: string): Assignment => ({
  jurisdiction,
  role,
});

export const ME = {
  judge: me({
    status: "ready",
    assignments: [at(ET_REF, "Judge")],
    active: at(ET_REF, "Judge"),
    permissions: JUDGE,
  }),
  legalTextManager: me({
    status: "ready",
    assignments: [at(IAC_REF, "LegalTextManager")],
    active: at(IAC_REF, "LegalTextManager"),
    permissions: LEGAL,
  }),
  jurisdictionAdministrator: me({
    status: "ready",
    assignments: [at(IAC_REF, "JurisdictionAdministrator")],
    active: at(IAC_REF, "JurisdictionAdministrator"),
    permissions: JADMIN,
  }),
  /** DIAAT-403: JurisdictionAdministrator in two jurisdictions, one assignment each, acting in IAC. */
  jurisdictionAdministratorInTwo: me({
    status: "ready",
    assignments: [at(ET_REF, "JurisdictionAdministrator"), at(IAC_REF, "JurisdictionAdministrator")],
    active: at(IAC_REF, "JurisdictionAdministrator"),
    permissions: JADMIN,
  }),
  jurisdictionSuperAdministrator: me({
    status: "ready",
    assignments: [at(null, "JurisdictionSuperAdministrator")],
    active: at(null, "JurisdictionSuperAdministrator"),
    permissions: JSUPER,
  }),
  /** A system administrator with no assignments: their SystemAdministrator context only. */
  sysadminOnly: me({
    status: "ready",
    assignments: [at(null, "SystemAdministrator")],
    active: at(null, "SystemAdministrator"),
    permissions: SYSADMIN,
  }),
  /** DIAAT-403: Judge in ET, super administrator and system administrator, acting as Judge. */
  sysadminMultiAsJudge: me({
    status: "ready",
    assignments: [
      at(ET_REF, "Judge"),
      at(null, "JurisdictionSuperAdministrator"),
      at(null, "SystemAdministrator"),
    ],
    active: at(ET_REF, "Judge"),
    permissions: JUDGE,
  }),
  /** The same user acting as system administrator. */
  sysadminMultiAsSystem: me({
    status: "ready",
    assignments: [
      at(ET_REF, "Judge"),
      at(null, "JurisdictionSuperAdministrator"),
      at(null, "SystemAdministrator"),
    ],
    active: at(null, "SystemAdministrator"),
    permissions: SYSADMIN,
  }),
  /** Judge in ET and administrator in IAC, no choice made yet. */
  choose: me({
    status: "choose",
    assignments: [at(ET_REF, "Judge"), at(IAC_REF, "JurisdictionAdministrator")],
    permissions: BASIC,
  }),
  /** The same user once they have chosen the administrator pair. */
  multiAsAdministrator: me({
    status: "ready",
    assignments: [at(ET_REF, "Judge"), at(IAC_REF, "JurisdictionAdministrator")],
    active: at(IAC_REF, "JurisdictionAdministrator"),
    permissions: JADMIN,
  }),
  multiAsJudge: me({
    status: "ready",
    assignments: [at(ET_REF, "Judge"), at(IAC_REF, "JurisdictionAdministrator")],
    active: at(ET_REF, "Judge"),
    permissions: JUDGE,
  }),
  noAccess: me({
    status: "no_access",
    permissions: ["access.request"],
  }),
} satisfies Record<string, MeResponse>;

export type Persona = keyof typeof ME;

/** What `useAccess()` returns for `persona`, with no-op actions. */
export function accessValue(persona: MeResponse): AccessValue {
  return {
    ...accessValueFor(persona),
    status: persona.status,
    me: persona,
    stale: false,
    refresh: async () => persona,
    checkAgain: async () => persona,
    switchContext: async () => undefined,
    leaveJurisdiction: async () => undefined,
  };
}

/** For `vi.mock("@/providers/access", ...)`: a fixed (or per-test) persona. */
export function mockAccessModule(persona: MeResponse | (() => MeResponse)) {
  const current = typeof persona === "function" ? persona : () => persona;
  return {
    AccessProvider: ({ children }: { children: React.ReactNode }) => children,
    useAccess: () => accessValue(current()),
    usePermissions: () => ({ can: accessValueFor(current()).can }),
  };
}
