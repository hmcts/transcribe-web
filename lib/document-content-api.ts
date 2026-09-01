import { apiClient } from "@/lib/api-client";
import {
  type DocumentContent,
  documentContentSchema,
} from "@/lib/editor-contracts";

export async function fetchUserDocumentContent(): Promise<DocumentContent> {
  const response = await apiClient.request<unknown>("/document-content", {
    cache: "no-store",
  });

  if (response.error) {
    throw new Error(response.error);
  }

  return documentContentSchema.parse(response.data);
}
