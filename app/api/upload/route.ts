import { type NextRequest, NextResponse } from "next/server";
import { uploadAndSubmit } from "@/lib/recording/api-client";
import { getBackendAuthContext } from "@/lib/recording/auth-utils";
import {
  readRawUpload,
  tooLarge,
  unauthenticated,
} from "@/lib/recording/raw-upload";

// The recording page sends the audio as the raw request body, with its
// metadata in headers (lib/recording/raw-upload.ts), because Front Door's
// WAF blocks multipart bodies from the browser. One more header here:
//
//   X-Audio-Duration-Seconds  duration read in the browser (optional)
//
// The body is streamed on to the API as the multipart `file` part, never
// held in memory whole (lib/recording/multipart.ts, and redirect: "error" in
// lib/recording/api-client.ts). That is also why this route is outside the
// proxy (the matcher in proxy.ts): when the proxy runs, Next.js buffers the
// entire request body before the route handler sees any of it, and cuts it
// off at experimental.proxyClientMaxBodySize (10 MB by default). Measured on
// the standalone server in a 512 MiB container: one 200 MB upload through
// the proxy (with that limit raised) peaked at ~840 MB RSS; outside it,
// streamed, three concurrent 200 MB uploads peaked at ~160 MB, against ~65 MB
// idle. So this route gates itself the way the proxy gates /api/* (401
// without a session).

// Same cap as the API's POST /api/v1/uploads (_MAX_UPLOAD_BYTES).
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

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
    defaultContentType: "application/octet-stream",
  });
  if (!upload.ok) return upload.response;

  const audioDurationSeconds = parseDuration(
    request.headers.get("x-audio-duration-seconds")
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
    return NextResponse.json(
      { error: "Failed to submit audio for transcription" },
      { status: 502 }
    );
  }
}
