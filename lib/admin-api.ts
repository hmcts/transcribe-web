import { type ZodType, z } from "zod";
import { apiClient } from "@/lib/api-client";
import {
  type AdminJurisdiction,
  type AnonymityStatus,
  adminJurisdictionSchema,
  anonymityStatusSchema,
  type DocumentContent,
  documentContentSchema,
  type HearingType,
  hearingTypeSchema,
  type JurisdictionAdmin,
  type JurisdictionSummary,
  jurisdictionAdminSchema,
  jurisdictionSummarySchema,
  type LegalFramework,
  legalFrameworkSchema,
} from "@/lib/editor-contracts";

// ---------------------------------------------------------------------------
// Types matching the backend Pydantic models
// ---------------------------------------------------------------------------
export type {
  AdminJurisdiction,
  AnonymityStatus,
  DocumentContent,
  HearingType,
  JurisdictionAdmin,
  JurisdictionSummary,
  LegalFramework,
};

// The API answers 404 "Jurisdiction not found" both for a jurisdiction that does
// not exist and for one the admin may not use, so the UI treats them alike.
const JURISDICTION_NOT_FOUND = "Jurisdiction not found";

export class AdminApiError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
  }
}

export function isJurisdictionNotFound(error: unknown): boolean {
  return (
    error instanceof AdminApiError &&
    error.status === 404 &&
    error.message === JURISDICTION_NOT_FOUND
  );
}

// Every wording route is scoped to one jurisdiction, so an edit can only reach
// the jurisdiction the editor was opened on.
const wordingPath = (jurisdictionId: string, suffix = "") =>
  `/admin/jurisdictions/${encodeURIComponent(jurisdictionId)}/document-content${suffix}`;

// ---------------------------------------------------------------------------
// Admin API functions
// ---------------------------------------------------------------------------

async function requestAndParse<T>(
  endpoint: string,
  parser: (value: unknown) => T,
  options?: RequestInit
): Promise<T> {
  const response = await apiClient.request<unknown>(endpoint, options);
  if (response.error) {
    throw new AdminApiError(response.error, response.status);
  }
  return parser(response.data);
}

function parseOrThrow<T>(
  schema: ZodType<T>,
  value: unknown,
  fallbackMessage: string
): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  const issue = parsed.error.issues[0];
  const field = issue?.path.join(".") || "payload";
  throw new Error(`${fallbackMessage} (${field})`);
}

export async function fetchAdminJurisdictions(): Promise<AdminJurisdiction[]> {
  return requestAndParse(
    "/admin/jurisdictions",
    (value) =>
      parseOrThrow(
        z.array(adminJurisdictionSchema),
        value,
        "The server returned an invalid jurisdictions response"
      ),
    { method: "GET", cache: "no-store" }
  );
}

export async function fetchDocumentContent(
  jurisdictionId: string
): Promise<DocumentContent> {
  return requestAndParse(
    wordingPath(jurisdictionId),
    (value) =>
      parseOrThrow(
        documentContentSchema,
        value,
        "The server returned an invalid document content response"
      ),
    { method: "GET", cache: "no-store" }
  );
}

export async function updateHearingType(
  jurisdictionId: string,
  id: string,
  data: HearingType
): Promise<HearingType> {
  const payload = parseOrThrow(
    hearingTypeSchema,
    data,
    "Please review the hearing type fields"
  );
  return requestAndParse(
    wordingPath(jurisdictionId, `/hearing-types/${encodeURIComponent(id)}`),
    (value) =>
      parseOrThrow(
        hearingTypeSchema,
        value,
        "The server returned an invalid hearing type response"
      ),
    { method: "PUT", body: JSON.stringify(payload) }
  );
}

export async function createHearingType(
  jurisdictionId: string,
  data: HearingType
): Promise<HearingType> {
  const payload = parseOrThrow(
    hearingTypeSchema,
    data,
    "Please review the hearing type fields"
  );
  return requestAndParse(
    wordingPath(jurisdictionId, "/hearing-types"),
    (value) =>
      parseOrThrow(
        hearingTypeSchema,
        value,
        "The server returned an invalid hearing type response"
      ),
    { method: "POST", body: JSON.stringify(payload) }
  );
}

export async function deleteHearingType(
  jurisdictionId: string,
  id: string
): Promise<void> {
  const res = await apiClient.request<unknown>(
    wordingPath(jurisdictionId, `/hearing-types/${encodeURIComponent(id)}`),
    { method: "DELETE" }
  );
  if (res.error) throw new AdminApiError(res.error, res.status);
}

export async function updateLegalFramework(
  jurisdictionId: string,
  id: string,
  data: LegalFramework
): Promise<LegalFramework> {
  const payload = parseOrThrow(
    legalFrameworkSchema,
    data,
    "Please review the legal framework fields"
  );
  return requestAndParse(
    wordingPath(jurisdictionId, `/legal-frameworks/${encodeURIComponent(id)}`),
    (value) =>
      parseOrThrow(
        legalFrameworkSchema,
        value,
        "The server returned an invalid legal framework response"
      ),
    { method: "PUT", body: JSON.stringify(payload) }
  );
}

export async function createLegalFramework(
  jurisdictionId: string,
  data: LegalFramework
): Promise<LegalFramework> {
  const payload = parseOrThrow(
    legalFrameworkSchema,
    data,
    "Please review the legal framework fields"
  );
  return requestAndParse(
    wordingPath(jurisdictionId, "/legal-frameworks"),
    (value) =>
      parseOrThrow(
        legalFrameworkSchema,
        value,
        "The server returned an invalid legal framework response"
      ),
    { method: "POST", body: JSON.stringify(payload) }
  );
}

export async function deleteLegalFramework(
  jurisdictionId: string,
  id: string
): Promise<void> {
  const res = await apiClient.request<unknown>(
    wordingPath(jurisdictionId, `/legal-frameworks/${encodeURIComponent(id)}`),
    { method: "DELETE" }
  );
  if (res.error) throw new AdminApiError(res.error, res.status);
}

export async function updateAnonymityStatus(
  jurisdictionId: string,
  id: string,
  data: AnonymityStatus
): Promise<AnonymityStatus> {
  const payload = parseOrThrow(
    anonymityStatusSchema,
    data,
    "Please review the anonymity fields"
  );
  return requestAndParse(
    wordingPath(
      jurisdictionId,
      `/anonymity-statuses/${encodeURIComponent(id)}`
    ),
    (value) =>
      parseOrThrow(
        anonymityStatusSchema,
        value,
        "The server returned an invalid anonymity status response"
      ),
    { method: "PUT", body: JSON.stringify(payload) }
  );
}

// ---------------------------------------------------------------------------
// Jurisdictions and their admins (SystemAdministrator only)
// ---------------------------------------------------------------------------

export async function createJurisdiction(data: {
  id: string;
  name: string;
}): Promise<JurisdictionSummary> {
  return requestAndParse(
    "/admin/jurisdictions",
    (value) =>
      parseOrThrow(
        jurisdictionSummarySchema,
        value,
        "The server returned an invalid jurisdiction response"
      ),
    { method: "POST", body: JSON.stringify(data) }
  );
}

const adminsPath = (jurisdictionId: string, userId?: string) =>
  `/admin/jurisdictions/${encodeURIComponent(jurisdictionId)}/admins${
    userId ? `/${encodeURIComponent(userId)}` : ""
  }`;

export async function fetchJurisdictionAdmins(
  jurisdictionId: string
): Promise<JurisdictionAdmin[]> {
  return requestAndParse(
    adminsPath(jurisdictionId),
    (value) =>
      parseOrThrow(
        z.array(jurisdictionAdminSchema),
        value,
        "The server returned an invalid administrators response"
      ),
    { method: "GET", cache: "no-store" }
  );
}

export async function addJurisdictionAdmin(
  jurisdictionId: string,
  userId: string
): Promise<JurisdictionAdmin> {
  return requestAndParse(
    adminsPath(jurisdictionId, userId),
    (value) =>
      parseOrThrow(
        jurisdictionAdminSchema,
        value,
        "The server returned an invalid administrator response"
      ),
    { method: "PUT" }
  );
}

export async function removeJurisdictionAdmin(
  jurisdictionId: string,
  userId: string
): Promise<void> {
  const res = await apiClient.request<unknown>(
    adminsPath(jurisdictionId, userId),
    { method: "DELETE" }
  );
  if (res.error) throw new AdminApiError(res.error, res.status);
}
