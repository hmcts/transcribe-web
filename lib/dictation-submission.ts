/**
 * A dictation submission (`POST /api/live-transcription/submission`) with its
 * telemetry (OBS-4): the request carries the dictation session
 * (`X-Dictation-Session-Id`, which transcribe-api records on the submission), and
 * its outcome is reported as `dictation.submission_finished`; a success ends the
 * session as submitted. For pages without the record page's own submission flow
 * (the speech demo).
 */

import { getAuthToken } from "@/lib/auth-utils";
import {
  type DictationSessionTelemetry,
  dictationSessionTelemetry,
} from "@/lib/dictation-session";

export const SUBMISSION_PATH = "/api/live-transcription/submission";

export interface SubmitDictationOptions {
  mode: string;
  fetchImpl?: typeof fetch;
  telemetry?: DictationSessionTelemetry;
  getToken?: () => Promise<string | null>;
  now?: () => number;
}

/** Submit, report the outcome, and return the response body (a JSON object, typed
 * by the caller as before); throws on failure. */
export async function submitDictation<T = unknown>(
  payload: unknown,
  {
    mode,
    fetchImpl = (...args) => fetch(...args),
    telemetry = dictationSessionTelemetry,
    getToken = getAuthToken,
    now = Date.now,
  }: SubmitDictationOptions
): Promise<T> {
  const submittedAt = now();
  let failedStatus: number | undefined;
  let failureCode: string | undefined;
  try {
    const authToken = await getToken();
    const sessionId = telemetry.currentSessionId();
    let response: Response;
    try {
      response = await fetchImpl(SUBMISSION_PATH, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken && { Authorization: `Bearer ${authToken}` }),
          // Relates this dictation session to the submission, server-side.
          ...(sessionId && { "X-Dictation-Session-Id": sessionId }),
        },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      failureCode = "network"; // the request itself failed
      throw error;
    }

    if (!response.ok) {
      failedStatus = response.status;
      const errorBody = await response.json().catch(() => null);
      const message =
        (errorBody && (errorBody.detail || errorBody.error)) ||
        "Failed to save submission.";
      throw new Error(message);
    }

    // A 2xx that is not a JSON object (e.g. a sign-in page from a proxy) is an
    // invalid response, not a browser error.
    const data: unknown = await response.json().catch(() => undefined);
    if (data === null || typeof data !== "object") {
      failureCode = "submission.invalid_response";
      throw new Error("Submission succeeded but returned an invalid response.");
    }
    telemetry.submissionFinished({
      ok: true,
      mode,
      durationMs: now() - submittedAt,
    });
    telemetry.sessionEnded("submitted");
    return data as T;
  } catch (error) {
    telemetry.submissionFinished({
      ok: false,
      status: failedStatus,
      errorCode: failureCode,
      mode,
      durationMs: now() - submittedAt,
    });
    throw error;
  }
}
