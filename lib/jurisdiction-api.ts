import { apiClient } from "@/lib/api-client";
import type { Wording } from "@/lib/jurisdiction-wording";

/** GET /api/jurisdictions/me (transcribe-api routes_jurisdictions.py). */

/** DIAAT-345: draft (only its admins see it), test (its test group too) or live
 * (every member). Absent from an API before stages: live. */
export type JurisdictionStage = "draft" | "test" | "live";

export interface JurisdictionSummary {
  code: string;
  /** What users see: its display name, else its name. */
  name: string;
  role: "judge" | "admin";
  stage?: JurisdictionStage;
}

/** Said beside a jurisdiction not yet live for everyone, so its admins and testers
 * know; null for a live one. */
export function stageNote(stage: JurisdictionStage | undefined): string | null {
  if (stage === "draft") return "Draft";
  if (stage === "test") return "Test";
  return null;
}

export interface CurrentJurisdiction extends JurisdictionSummary {
  /** "iac_decision": the IAC hearing form and decision; null: general section only. */
  template: "iac_decision" | null;
  features: { hearing_recordings: boolean };
  wording: Wording;
}

export interface MyJurisdictions {
  status: "ready" | "no_jurisdiction" | "choose";
  current: CurrentJurisdiction | null;
  jurisdictions: JurisdictionSummary[];
}

/** Work in `code` from now on: remembered for requests without a tab's jurisdiction. */
export async function chooseJurisdiction(code: string): Promise<MyJurisdictions> {
  const response = await apiClient.request<MyJurisdictions>("/jurisdictions/active", {
    method: "PUT",
    body: JSON.stringify({ code }),
  });
  if (!response.data) {
    throw new Error("No jurisdictions response");
  }
  return response.data;
}

export async function fetchMyJurisdictions(): Promise<MyJurisdictions> {
  const response =
    await apiClient.request<MyJurisdictions>("/jurisdictions/me");
  if (!response.data) {
    throw new Error("No jurisdictions response");
  }
  return response.data;
}

/** /api/jurisdictions/wording (DIAAT-356): the tab's jurisdiction, for its admins only. */
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
