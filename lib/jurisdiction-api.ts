import { apiClient } from "@/lib/api-client";
import type { Wording } from "@/lib/jurisdiction-wording";

/** GET /api/jurisdictions/me (transcribe-api routes_jurisdictions.py). */

export interface JurisdictionSummary {
  code: string;
  name: string;
  role: "judge" | "admin";
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
