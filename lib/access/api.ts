import { apiClient } from "@/lib/api-client";
import type {
  AccessRequest,
  JurisdictionRef,
  MeResponse,
  SessionContext,
} from "@/lib/access/types";
import type { Wording } from "@/lib/jurisdiction-wording";

/**
 * The browser's calls for who the user is and what they may do (DIAAT-373).
 *
 * Calls that return a BenchNotes token (choosing a context, leaving a
 * jurisdiction, minting again) never go to the API from the browser: they go to
 * this app's `/auth/*` routes, which keep the token in the server-side session
 * and return only the `me` object.
 */

/** A refusal: the HTTP status and, if the API sent one, its `detail.code`. */
export class AccessApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string
  ) {
    super(message);
  }
}

async function viaApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await apiClient.request<T>(endpoint, options);
  if (response.error || response.data === undefined) {
    throw new AccessApiError(
      response.error ?? "Request failed",
      response.status,
      response.code
    );
  }
  return response.data;
}

/** A call to this app's own /auth/* routes, answering with `me`. */
async function viaAuthRoute(path: string, init: RequestInit): Promise<MeResponse> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    throw new AccessApiError(
      error instanceof Error ? error.message : "Network error"
    );
  }
  if (!response.ok) {
    let message = `HTTP error! status: ${response.status}`;
    let code: string | undefined;
    try {
      const body = await response.json();
      const detail = body?.detail;
      code = typeof detail?.code === "string" ? detail.code : undefined;
      message = typeof detail?.message === "string" ? detail.message : message;
    } catch {
      // keep the generic message
    }
    throw new AccessApiError(message, response.status, code);
  }
  return (await response.json()) as MeResponse;
}

/** `GET /api/me/permissions`: who this is, in which context, with which permissions. */
export function fetchMe(): Promise<MeResponse> {
  return viaApi<MeResponse>("/me/permissions", {
    method: "GET",
    cache: "no-store",
  });
}

/** Choose the context to work as. Resolves with the new `me`. */
export function postContext(context: SessionContext): Promise<MeResponse> {
  return viaAuthRoute("/auth/context", {
    method: "POST",
    body: JSON.stringify(context),
  });
}

/** Leave a jurisdiction (drops the user's roles there). Resolves with the new `me`. */
export function postLeaveJurisdiction(code: string): Promise<MeResponse> {
  return viaAuthRoute(`/auth/jurisdictions/${encodeURIComponent(code)}`, {
    method: "DELETE",
  });
}

/** Mint a fresh token now (an approval may have changed the user's access). */
export function postRefreshSession(): Promise<MeResponse> {
  return viaAuthRoute("/auth/session", { method: "POST" });
}

/** The enabled jurisdictions, for the access request form. */
export function fetchPublicJurisdictions(): Promise<JurisdictionRef[]> {
  return viaApi<JurisdictionRef[]>("/jurisdictions/public", {
    method: "GET",
    cache: "no-store",
  });
}

export function createAccessRequest(body: {
  jurisdiction: string;
  roles: string[];
}): Promise<AccessRequest> {
  return viaApi<AccessRequest>("/access-requests", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function fetchMyAccessRequests(): Promise<AccessRequest[]> {
  return viaApi<AccessRequest[]>("/access-requests/mine", {
    method: "GET",
    cache: "no-store",
  });
}

export function withdrawAccessRequest(id: string): Promise<AccessRequest> {
  return viaApi<AccessRequest>(
    `/access-requests/${encodeURIComponent(id)}/withdraw`,
    { method: "POST" }
  );
}

/**
 * The material of the jurisdiction the user is working in: its template,
 * features and wording. The authz contract removed `GET /jurisdictions/me`
 * without a replacement for these, so this is the endpoint the web asks the API
 * for (contract amendment, 2026-11-09).
 */
export interface CurrentJurisdictionResponse {
  code: string;
  name: string;
  template: "iac_decision" | null;
  features: { hearing_recordings: boolean };
  wording: Wording;
}

export function fetchCurrentJurisdiction(): Promise<CurrentJurisdictionResponse> {
  return viaApi<CurrentJurisdictionResponse>("/jurisdictions/current", {
    method: "GET",
    cache: "no-store",
  });
}
