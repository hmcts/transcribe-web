import { type NextRequest, NextResponse } from "next/server";
import {
  BackendApiError,
  uploadBaselineTranscript,
} from "@/lib/recording/api-client";
import { getBackendAuthContext } from "@/lib/recording/auth-utils";
import {
  readRawUpload,
  tooLarge,
  unauthenticated,
} from "@/lib/recording/raw-upload";

// The transcript page sends the baseline transcript as the raw request body
// (text/plain), with its name and size in headers, as the recording page
// does the audio (lib/recording/raw-upload.ts): Front Door's WAF blocks
// multipart bodies from the browser. This handler streams it on to the API
// as the multipart `file` part of POST /api/v1/jobs/{id}/baseline.

// The API's limits for a baseline (_MAX_BASELINE_BYTES and
// _ALLOWED_BASELINE_EXTENSIONS in transcribe-api's routes_recording.py).
const MAX_BASELINE_BYTES = 5 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [".txt"];

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
    defaultContentType: "text/plain",
    allowedExtensions: ALLOWED_EXTENSIONS,
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
    return NextResponse.json(
      { error: "Failed to upload baseline transcript" },
      { status: 502 }
    );
  }
}
