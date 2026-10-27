import { type NextRequest, NextResponse } from "next/server";
import {
  BackendApiError,
  uploadBaselineTranscript,
} from "@/lib/recording/api-client";
import { getBackendAuthContext } from "@/lib/recording/auth-utils";
import {
  backendFailed,
  readRawUpload,
  tooLarge,
  unauthenticated,
} from "@/lib/recording/raw-upload";
import { BASELINE_UPLOAD_TYPES } from "@/lib/recording/upload-contract";

// The transcript page sends the baseline transcript as the raw request body,
// as exactly application/octet-stream, with its name, size and type in
// headers, as the recording page does the audio
// (lib/recording/upload-contract.ts): Front Door's WAF blocks multipart
// bodies from the browser. This handler streams it on to the API as the
// multipart `file` part (text/plain) of POST /api/v1/jobs/{id}/baseline.

// The API's size limit for a baseline (_MAX_BASELINE_BYTES in
// transcribe-api's routes_recording.py); BASELINE_UPLOAD_TYPES is its
// _ALLOWED_BASELINE_EXTENSIONS.
const MAX_BASELINE_BYTES = 5 * 1024 * 1024;

interface RouteContext {
  params: Promise<{ jobId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { jobId } = await params;
  const auth = await getBackendAuthContext(request);
  const denied = unauthenticated(auth);
  if (denied) return denied;

  const upload = readRawUpload(request, {
    maxBytes: MAX_BASELINE_BYTES,
    types: BASELINE_UPLOAD_TYPES,
  });
  if (!upload.ok) return upload.response;

  try {
    const job = await uploadBaselineTranscript(jobId, upload.file, auth);
    return NextResponse.json({ job });
  } catch (err) {
    if (upload.sizeMismatch()) {
      console.error(
        `Rejected baseline body that does not match its declared size of ${upload.file.size} bytes`
      );
      return tooLarge();
    }
    // As the other job routes do: no such job (or not the caller's).
    if (err instanceof BackendApiError && err.status === 404) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    console.error("Failed to upload baseline transcript", err);
    return backendFailed(err, "Failed to upload baseline transcript");
  }
}
