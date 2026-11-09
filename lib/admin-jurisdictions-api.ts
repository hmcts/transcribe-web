import { apiClient } from "@/lib/api-client";
import type { JurisdictionStage } from "@/lib/jurisdiction-api";

/** /api/admin/jurisdictions (transcribe-api, DIAAT-356): behind `jurisdictions.manage` (and `jurisdiction.create` to add one). */

export interface JurisdictionSettingsData {
  wording?: Record<string, string>;
  template?: "iac_decision" | null;
  features?: { hearing_recordings?: boolean };
}

export interface AdminJurisdiction {
  code: string;
  name: string;
  /** What users see, e.g. "Employment Tribunals (ET)"; null: the name (DIAAT-345). */
  display_name?: string | null;
  /** The service it is for, where that applies. */
  service?: string | null;
  stage?: JurisdictionStage;
  /** What stops it being switched on (out of draft), in plain words. */
  problems?: string[];
  enabled: boolean;
  auto_enrol: boolean;
  settings: JurisdictionSettingsData;
  member_count: number;
  /** Sent back with a save: a change made meanwhile is refused (409), not undone. */
  version: string;
}

export interface AdminJurisdictionMember {
  email: string;
  role: "judge" | "admin";
  /** In the test group: sees the jurisdiction while it is in test (DIAAT-345). */
  tester?: boolean;
  /** Added by email; joins when they first sign in. */
  pending: boolean;
}

export const STAGES: { value: JurisdictionStage; label: string }[] = [
  { value: "draft", label: "Draft: only its admins see it" },
  { value: "test", label: "Test: its admins and testers see it" },
  { value: "live", label: "Live: every member sees it" },
];

export const MEMBER_ROLES = ["judge", "admin"] as const;

/** apiClient returns a refusal as `error` (the API's reason); throw it, for the
 * panel to show as it is. */
async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await apiClient.request<T>(endpoint, options);
  if (response.error) throw new Error(response.error);
  return response.data as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export function fetchAdminJurisdictions(): Promise<AdminJurisdiction[]> {
  return request("/admin/jurisdictions", { cache: "no-store" });
}

/** The screen text a jurisdiction can set, with what each is for. */
export async function fetchWordingKeys(): Promise<Record<string, string>> {
  return (await request<{ keys: Record<string, string> }>("/admin/jurisdictions/wording-keys")).keys;
}

/** Create or update; flags left undefined are unchanged. `version`: the one edited,
 * "" for a new jurisdiction (refused if the code exists). Moving it out of draft is
 * refused, with what is missing, until it is ready. */
export function saveJurisdiction(
  code: string,
  body: {
    name: string;
    display_name?: string;
    service?: string;
    settings: JurisdictionSettingsData;
    enabled?: boolean;
    auto_enrol?: boolean;
    stage?: JurisdictionStage;
    version: string;
  }
): Promise<AdminJurisdiction> {
  return request(`/admin/jurisdictions/${encodeURIComponent(code)}`, json("PUT", body));
}

export function fetchJurisdictionMembers(code: string): Promise<AdminJurisdictionMember[]> {
  return request(`/admin/jurisdictions/${encodeURIComponent(code)}/members`, { cache: "no-store" });
}

/** Add someone, or change their role or whether they test it (`tester` undefined:
 * unchanged). */
export function addJurisdictionMember(
  code: string,
  email: string,
  role: AdminJurisdictionMember["role"],
  tester?: boolean
): Promise<AdminJurisdictionMember> {
  return request(
    `/admin/jurisdictions/${encodeURIComponent(code)}/members`,
    json("POST", { email, role, tester })
  );
}

export async function removeJurisdictionMember(code: string, email: string): Promise<void> {
  const params = new URLSearchParams({ email });
  await request(`/admin/jurisdictions/${encodeURIComponent(code)}/members?${params}`, { method: "DELETE" });
}
