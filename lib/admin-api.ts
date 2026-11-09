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

/** A refusal from the API: its message, HTTP status and ``detail.code``. */
export class AdminApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

function failure(response: {
  error: string;
  status?: number;
  code?: string;
}): AdminApiError {
  return new AdminApiError(response.error, response.status, response.code);
}

// What the API says when the jurisdiction has no decision template, so no legal
// wording (a 404 with no code).
const NO_TEMPLATE_DETAIL = "Not available in this jurisdiction";

/**
 * A refusal of the legal wording routes (DIAAT-342) in words the admin can act
 * on, never the raw status. `jurisdiction` names the one being edited, when known.
 */
export function describeLegalWordingError(
  error: unknown,
  jurisdiction = "this jurisdiction",
  fallback = "Something went wrong"
): string {
  if (!(error instanceof AdminApiError)) {
    return error instanceof Error ? error.message : fallback;
  }
  if (error.code === "jurisdiction_not_available") {
    return `You do not belong to ${jurisdiction}, or it is not available to you. Switch to a jurisdiction you work in.`;
  }
  // The API's one refusal for a missing permission (contract amendment A2; it
  // replaced `jurisdiction_admin_required`). Legal wording needs `legal_text.manage`.
  if (error.code === "permission_denied") {
    return `Your role cannot change the legal wording of ${jurisdiction}. Switch to a role that can, or ask a legal text manager.`;
  }
  if (error.code === "jurisdiction_not_in_scope") {
    return `${jurisdiction} is not the jurisdiction you are working in. Switch to it first.`;
  }
  if (error.code === "no_jurisdiction") {
    return "The role you are working as is not tied to one jurisdiction, so there is no legal wording for you to edit here. Switch to a role in a jurisdiction.";
  }
  if (error.code === "context_required") {
    return "Choose where and as what you are working, from the top of the page, before editing legal wording.";
  }
  if (error.status === 404 && error.message === NO_TEMPLATE_DETAIL) {
    return `${jurisdiction} does not use the decision document, so it has no legal wording to edit.`;
  }
  return error.message || fallback;
}

/** Whether trying again could help: not for a refusal about who or where you are. */
export function isLegalWordingRefusal(error: unknown): boolean {
  return (
    error instanceof AdminApiError &&
    (error.status === 403 ||
      error.status === 409 ||
      (error.status === 404 && error.message === NO_TEMPLATE_DETAIL))
  );
}

async function requestAndParse<T>(
  endpoint: string,
  parser: (value: unknown) => T,
  options?: RequestInit
): Promise<T> {
  const response = await apiClient.request<unknown>(endpoint, options);
  if (response.error) {
    throw failure({ ...response, error: response.error });
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
  if (res.error) throw failure({ ...res, error: res.error });
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
  if (res.error) throw failure({ ...res, error: res.error });
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
