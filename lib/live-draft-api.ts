import { getAuthToken } from "@/lib/auth-utils";
import type { DictationFormValues } from "@/components/audio/dictation/formData";
import type { SectionedTranscript } from "@/components/audio/dictation/types";

export interface LiveDraftApiResponse {
  transcript: SectionedTranscript;
  form_data: Partial<DictationFormValues>;
  saved_at: string; // ISO datetime from backend
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function getLiveDraft(): Promise<LiveDraftApiResponse | null> {
  const headers = await authHeaders();
  const res = await fetch("/api/live-draft", { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to fetch live draft: ${res.status}`);
  return res.json() as Promise<LiveDraftApiResponse>;
}

export async function putLiveDraft(
  transcript: SectionedTranscript,
  formData: Partial<DictationFormValues>,
): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch("/api/live-draft", {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ transcript, form_data: formData }),
  });
  if (!res.ok) throw new Error(`Failed to save live draft: ${res.status}`);
}

export async function deleteLiveDraft(): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch("/api/live-draft", {
    method: "DELETE",
    headers,
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to delete live draft: ${res.status}`);
  }
}
