"use client";

import { getAuthToken } from "@/lib/auth-utils";

/**
 * Downloads a transcript document via the /api/download proxy.
 *
 * Passes only the transcription ID — the server looks up the blob path from
 * the database and generates a fresh SAS URL server-side. The signed URL is
 * never exposed to the client or the browser address bar (avoids WAF detection).
 *
 * Uses fetch + createObjectURL rather than window.open so that JavaScript
 * controls the request headers — plain browser navigation cannot carry custom headers.
 */
export async function downloadTranscriptDocument(
  transcriptionId: string
): Promise<void> {
  const authToken = await getAuthToken();

  const headers: Record<string, string> = {};
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  const response = await fetch(
    `/api/download?transcription_id=${encodeURIComponent(transcriptionId)}`,
    { headers }
  );

  if (!response.ok) {
    throw new Error(
      `Download failed: ${response.status} ${response.statusText}`
    );
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);

  const disposition = response.headers.get("Content-Disposition");
  const filenameMatch = disposition?.match(
    /filename\*?=(?:UTF-8'')?["']?([^"';\n]+)/i
  );
  const filename = filenameMatch?.[1]
    ? decodeURIComponent(filenameMatch[1])
    : "transcript.docx";

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
