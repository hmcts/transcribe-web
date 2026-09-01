import type { ZodType } from "zod";
import { apiClient } from "@/lib/api-client";
import {
  type AnonymityStatus,
  anonymityStatusSchema,
  type DocumentContent,
  documentContentSchema,
  type HearingType,
  hearingTypeSchema,
  type LegalFramework,
  legalFrameworkSchema,
} from "@/lib/editor-contracts";

// ---------------------------------------------------------------------------
// Types matching the backend Pydantic models
// ---------------------------------------------------------------------------
export type { AnonymityStatus, DocumentContent, HearingType, LegalFramework };

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
    throw new Error(response.error);
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

export async function fetchDocumentContent(): Promise<DocumentContent> {
  return requestAndParse("/admin/document-content", (value) =>
    parseOrThrow(
      documentContentSchema,
      value,
      "The server returned an invalid document content response"
    )
  );
}

export async function updateHearingType(
  id: string,
  data: HearingType
): Promise<HearingType> {
  const payload = parseOrThrow(
    hearingTypeSchema,
    data,
    "Please review the hearing type fields"
  );
  return requestAndParse(
    `/admin/document-content/hearing-types/${encodeURIComponent(id)}`,
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
  data: HearingType
): Promise<HearingType> {
  const payload = parseOrThrow(
    hearingTypeSchema,
    data,
    "Please review the hearing type fields"
  );
  return requestAndParse(
    "/admin/document-content/hearing-types",
    (value) =>
      parseOrThrow(
        hearingTypeSchema,
        value,
        "The server returned an invalid hearing type response"
      ),
    { method: "POST", body: JSON.stringify(payload) }
  );
}

export async function deleteHearingType(id: string): Promise<void> {
  const res = await apiClient.request<unknown>(
    `/admin/document-content/hearing-types/${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );
  if (res.error) throw new Error(res.error);
}

export async function updateLegalFramework(
  id: string,
  data: LegalFramework
): Promise<LegalFramework> {
  const payload = parseOrThrow(
    legalFrameworkSchema,
    data,
    "Please review the legal framework fields"
  );
  return requestAndParse(
    `/admin/document-content/legal-frameworks/${encodeURIComponent(id)}`,
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
  data: LegalFramework
): Promise<LegalFramework> {
  const payload = parseOrThrow(
    legalFrameworkSchema,
    data,
    "Please review the legal framework fields"
  );
  return requestAndParse(
    "/admin/document-content/legal-frameworks",
    (value) =>
      parseOrThrow(
        legalFrameworkSchema,
        value,
        "The server returned an invalid legal framework response"
      ),
    { method: "POST", body: JSON.stringify(payload) }
  );
}

export async function deleteLegalFramework(id: string): Promise<void> {
  const res = await apiClient.request<unknown>(
    `/admin/document-content/legal-frameworks/${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );
  if (res.error) throw new Error(res.error);
}

export async function updateAnonymityStatus(
  id: string,
  data: AnonymityStatus
): Promise<AnonymityStatus> {
  const payload = parseOrThrow(
    anonymityStatusSchema,
    data,
    "Please review the anonymity fields"
  );
  return requestAndParse(
    `/admin/document-content/anonymity-statuses/${encodeURIComponent(id)}`,
    (value) =>
      parseOrThrow(
        anonymityStatusSchema,
        value,
        "The server returned an invalid anonymity status response"
      ),
    { method: "PUT", body: JSON.stringify(payload) }
  );
}
