import { apiClient } from "@/lib/api-client";
import {
  type DocumentContent,
  documentContentSchema,
  type JurisdictionSummary,
  jurisdictionSummarySchema,
} from "@/lib/editor-contracts";
import { z } from "zod";

// `jurisdiction` is the display name (or id) the form's jurisdiction field
// holds. Left out, the API answers for the default jurisdiction.
export async function fetchUserDocumentContent(
  jurisdiction?: string
): Promise<DocumentContent> {
  const query = jurisdiction
    ? `?jurisdiction=${encodeURIComponent(jurisdiction)}`
    : "";
  const response = await apiClient.request<unknown>(
    `/document-content${query}`,
    { cache: "no-store" }
  );

  if (response.error) {
    throw new Error(response.error);
  }

  return documentContentSchema.parse(response.data);
}

// Options for the form's jurisdiction select.
export async function fetchJurisdictions(): Promise<JurisdictionSummary[]> {
  const response = await apiClient.request<unknown>("/jurisdictions", {
    cache: "no-store",
  });

  if (response.error) {
    throw new Error(response.error);
  }

  return z.array(jurisdictionSummarySchema).parse(response.data);
}
