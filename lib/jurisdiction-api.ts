import { apiClient } from "@/lib/api-client";
import type { Wording } from "@/lib/jurisdiction-wording";

/** DIAAT-345: draft (only its admins see it), test (its test group too) or live
 * (every member). Absent from an API before stages: live. */
export type JurisdictionStage = "draft" | "test" | "live";

/** Said beside a jurisdiction not yet live for everyone, so its admins and testers
 * know; null for a live one. */
export function stageNote(stage: JurisdictionStage | undefined): string | null {
  if (stage === "draft") return "Draft";
  if (stage === "test") return "Test";
  return null;
}

/**
 * The material of the jurisdiction the user is working in (see
 * lib/access/api.ts, fetchCurrentJurisdiction). Who the user is, and in which
 * jurisdiction, comes from `GET /api/me/permissions` (DIAAT-373).
 */
export interface CurrentJurisdiction {
  code: string;
  name: string;
  /** "iac_decision": the IAC hearing form and decision; null: general section only. */
  template: "iac_decision" | null;
  features: { hearing_recordings: boolean };
  wording: Wording;
}

/** /api/jurisdictions/wording (DIAAT-356): the tab's jurisdiction, for whoever holds `jurisdiction.wording.edit`. */
export interface JurisdictionWording {
  code: string;
  name: string;
  /** Each key the jurisdiction can set, with what it is for. */
  keys: Record<string, string>;
  wording: Wording;
  /** Sent back with a save: a change made meanwhile is refused (409), not undone. */
  version: string;
}

async function wordingRequest(options?: RequestInit): Promise<JurisdictionWording> {
  const response = await apiClient.request<JurisdictionWording>("/jurisdictions/wording", options);
  if (response.error || !response.data) {
    throw new Error(response.error ?? "No wording response");
  }
  return response.data;
}

export function fetchJurisdictionWording(): Promise<JurisdictionWording> {
  return wordingRequest({ cache: "no-store" });
}

/** Replace the wording loaded at `version`; blank text means the default. Throws
 * with the API's reason. */
export function saveJurisdictionWording(
  wording: Wording,
  version: string
): Promise<JurisdictionWording> {
  return wordingRequest({ method: "PUT", body: JSON.stringify({ wording, version }) });
}
