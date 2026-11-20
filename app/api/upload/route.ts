import { type NextRequest, NextResponse } from "next/server";
import { uploadAndSubmit } from "@/lib/recording/api-client";
import { getBackendAuthContext } from "@/lib/recording/auth-utils";
import {
  AUDIO_TOO_LARGE_ERROR,
  backendFailed,
  readRawUpload,
  tooLarge,
  unauthenticated,
} from "@/lib/recording/raw-upload";
import {
  AUDIO_UPLOAD_TYPES,
  UPLOAD_HEADERS,
} from "@/lib/recording/upload-contract";

// The recording page sends the audio as the raw request body, as exactly
// application/octet-stream, with its metadata in headers
// (lib/recording/upload-contract.ts), because Front Door's WAF blocks
// multipart bodies from the browser. One more header here:
//
//   X-Audio-Duration-Seconds  duration read in the browser (optional)
//
// The body is streamed on to the API as the multipart `file` part, never
// held in memory whole (lib/recording/multipart.ts, and redirect: "error" in
// lib/recording/api-client.ts). That is also why this route is outside the
// proxy (the matcher in proxy.ts): when the proxy runs, Next.js buffers the
// entire request body before the route handler sees any of it, and cuts it
// off at experimental.proxyClientMaxBodySize (10 MB by default). Measured on
// the standalone server in a 512 MiB container with 200 MB bodies (the limit
// then): one upload through the proxy (with that limit raised) peaked at
// ~840 MB RSS; outside it, streamed, three concurrent uploads peaked at
// ~160 MB, against ~65 MB idle. Streaming keeps memory off the size of the
// body, so the 1 GiB limit below should not change that, but it has not been
// measured at 1 GiB. So this route gates itself the way the proxy gates /api/*
// (401 without a session).

// A backstop on the size of the file, not the limit on how long a recording
// may be: that is the API's (MAX_AUDIO_DURATION_SECONDS, 4 hours, DIAAT-408),
// checked once it has decoded the upload, and its 422 reaches the browser
// below. 1 GiB takes 4 hours of any usual MP3/M4A, but not of CD-quality WAV.
// Keep in step with the API's POST /api/v1/uploads (_MAX_UPLOAD_BYTES).
const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;

// Number() (unlike parseFloat) rejects partially-numeric strings like
// "123abc" as NaN, so only a fully-numeric, positive value is accepted;
// anything else is dropped and the duration is simply omitted.
function parseDuration(raw: string | null): number | undefined {
  const parsed = raw !== null && raw.trim() !== "" ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export async function POST(request: NextRequest) {
  const auth = await getBackendAuthContext(request);
  const denied = unauthenticated(auth);
  if (denied) return denied;

  const upload = readRawUpload(request, {
    maxBytes: MAX_UPLOAD_BYTES,
    types: AUDIO_UPLOAD_TYPES,
    tooLargeError: AUDIO_TOO_LARGE_ERROR,
  });
  if (!upload.ok) return upload.response;

  const audioDurationSeconds = parseDuration(
    request.headers.get(UPLOAD_HEADERS.audioDuration)
  );

  try {
    const job = await uploadAndSubmit(upload.file, audioDurationSeconds, auth);
    return NextResponse.json({ job }, { status: 201 });
  } catch (err) {
    if (upload.sizeMismatch()) {
      console.error(
        `Rejected upload body that does not match its declared size of ${upload.file.size} bytes`
      );
      return tooLarge();
    }
    console.error("Failed to upload and submit job", err);
    // The API's own 413 and 422 for the file (too big, too long, not
    // decodable) carry a message for the user, which backendFailed passes on.
    return backendFailed(err, "Failed to submit audio for transcription");
  }
}
