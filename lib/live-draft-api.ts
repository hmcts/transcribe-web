import { getAuthToken } from "@/lib/auth-utils";
import {
  LiveDraftError,
  classifyLiveDraftStatus,
} from "@/lib/live-draft-errors";
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

/**
 * Run a live-draft request, turning every failure into a classified
 * `LiveDraftError`.
 *
 * DIAAT-296: callers used to see either a generic `Error` carrying a status in
 * a string or a bare `TypeError` from a rejected `fetch`, and had no way to
 * tell "you have been signed out" from "the network dropped". They need to,
 * because those two need different words and a different next action. The
 * original rejection is kept as `cause` so nothing is lost for debugging.
 */
async function liveDraftFetch(
  input: string,
  init: RequestInit,
  action: string
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    throw new LiveDraftError(
      "network",
      `Failed to ${action} live draft: network request did not complete`,
      undefined,
      { cause: error }
    );
  }
}

export async function getLiveDraft(): Promise<LiveDraftApiResponse | null> {
  const headers = await authHeaders();
  const res = await liveDraftFetch("/api/live-draft", { headers }, "fetch");
  // 404 is the one non-error miss: the user genuinely has no draft. Every
  // other failure must stay distinguishable from it (DIAAT-296) â€” reporting
  // "no draft found" for a 401 is how a judge loses a transcript that exists.
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new LiveDraftError(
      classifyLiveDraftStatus(res.status),
      `Failed to fetch live draft: ${res.status}`,
      res.status
    );
  }
  return res.json() as Promise<LiveDraftApiResponse>;
}

export async function putLiveDraft(
  transcript: SectionedTranscript,
  formData: Partial<DictationFormValues>,
): Promise<void> {
  const headers = await authHeaders();
  const res = await liveDraftFetch(
    "/api/live-draft",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ transcript, form_data: formData }),
    },
    "save"
  );
  if (!res.ok) {
    throw new LiveDraftError(
      classifyLiveDraftStatus(res.status),
      `Failed to save live draft: ${res.status}`,
      res.status
    );
  }
}

export async function deleteLiveDraft(): Promise<void> {
  const headers = await authHeaders();
  const res = await liveDraftFetch(
    "/api/live-draft",
    { method: "DELETE", headers },
    "delete"
  );
  if (!res.ok && res.status !== 404) {
    throw new LiveDraftError(
      classifyLiveDraftStatus(res.status),
      `Failed to delete live draft: ${res.status}`,
      res.status
    );
  }
}
