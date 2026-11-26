import { readAudioDurationSeconds } from "@/lib/recording/audio-duration";
import { apiPath } from "@/lib/recording/base-path";
import { recordingFetch } from "@/lib/recording/browser-fetch";
import type { TranscriptionJob } from "@/lib/recording/types";
import {
  rawUploadHeaders,
  SERVICE_UNAVAILABLE_ERROR,
  UPLOAD_HEADERS,
} from "@/lib/recording/upload-contract";

/**
 * DIAAT-428: the hearing to add the recording to (none: a new hearing) and
 * the date of the day it is a recording of (none: today, as the API says).
 */
export interface UploadHearing {
  hearingId?: string;
  hearingDate?: string;
}

/**
 * Sends a recording to /api/upload and answers the job it became. Throws an
 * Error whose message is for the user when the upload is refused or fails.
 */
export async function uploadRecording(
  file: File,
  { hearingId, hearingDate }: UploadHearing = {}
): Promise<TranscriptionJob> {
  // Read duration in the browser before upload — the backend can't
  // determine it until Azure finishes, but the progress UI needs it up
  // front to show "Transcribing 2h 36m of audio" and estimate remaining
  // time. For a valid file this resolves near-instantly; it's bounded by
  // a short internal timeout so a file whose metadata won't load can't
  // meaningfully delay the upload. Best-effort: undefined simply omits
  // those extras.
  const durationSeconds = await readAudioDurationSeconds(file);
  const extra: Record<string, string> = {};
  if (durationSeconds !== undefined) {
    extra[UPLOAD_HEADERS.audioDuration] = String(durationSeconds);
  }
  if (hearingId !== undefined) extra[UPLOAD_HEADERS.hearingId] = hearingId;
  if (hearingDate !== undefined)
    extra[UPLOAD_HEADERS.hearingDate] = hearingDate;
  // The file goes as the raw request body, as exactly
  // application/octet-stream, never multipart/form-data: the only
  // shape Front Door's WAF lets through to this path
  // (lib/recording/upload-contract.ts). The route handler builds the
  // multipart request to the API inside the cluster.
  const response = await recordingFetch(apiPath("/api/upload"), {
    method: "POST",
    headers: rawUploadHeaders(file, extra),
    body: file,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      body.error ??
        (response.status === 503
          ? SERVICE_UNAVAILABLE_ERROR
          : `Upload failed: ${response.status}`)
    );
  }
  const body = await response.json().catch(() => ({}));
  return body.job as TranscriptionJob;
}
