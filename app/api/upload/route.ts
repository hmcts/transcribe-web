import { type NextRequest, NextResponse } from "next/server";
import {
  BackendApiError,
  type HearingDayOptions,
  uploadAndSubmit,
} from "@/lib/recording/api-client";
import { getBackendAuthContext } from "@/lib/recording/auth-utils";
import { isHearingDate } from "@/lib/recording/hearing-date";
import {
  backendFailed,
  badRequest,
  readRawUpload,
  tooLarge,
  unauthenticated,
} from "@/lib/recording/raw-upload";
import {
  audioTooLargeError,
  maxUploadBytes,
} from "@/lib/recording/upload-limits";
import {
  AUDIO_UPLOAD_TYPES,
  UPLOAD_HEADERS,
} from "@/lib/recording/upload-contract";

// The recording page sends the audio as the raw request body, as exactly
// application/octet-stream, with its metadata in headers
// (lib/recording/upload-contract.ts), because Front Door's WAF blocks
// multipart bodies from the browser. More headers here:
//
//   X-Audio-Duration-Seconds  duration read in the browser (optional)
//   X-Hearing-Id              the hearing to add the recording to (optional;
//                             without it, a new hearing)
//   X-Hearing-Date            the day's date, YYYY-MM-DD (optional; the API
//                             dates it today in London)
//
// A recording added to a hearing (DIAAT-428) comes here too, not to a path of
// its own: this is the one path the WAF lets an audio body through to.
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
// body, so a limit of 1 GiB should not change that, but it has not been
// measured at 1 GiB. So this route gates itself the way the proxy gates /api/*
// (401 without a session).

// A backstop on the size of the file, not the limit on how long a recording
// may be: that is the API's (its effective recording limit, DIAAT-408), checked
// once it has probed or decoded the upload, and its 422 reaches the browser
// below. The size comes from the MAX_UPLOAD_BYTES environment variable
// (1 GiB unless set; lib/recording/upload-limits.ts), read per request, and
// must equal the API's MAX_UPLOAD_BYTES setting.

// Number() (unlike parseFloat) rejects partially-numeric strings like
// "123abc" as NaN, so only a fully-numeric, positive value is accepted;
// anything else is dropped and the duration is simply omitted.
function parseDuration(raw: string | null): number | undefined {
  const parsed = raw !== null && raw.trim() !== "" ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

// The size limit, for the recording page to refuse a file that is too large
// before sending it: the browser keeps sending a body after this route has
// answered 413, so a file over the limit was refused only once it had all been
// uploaded (minutes for a gigabyte). The same exact path as POST, so Caddy's
// @next_api matcher already routes it here.
export async function GET(request: NextRequest) {
  const denied = unauthenticated(await getBackendAuthContext(request));
  if (denied) return denied;
  return NextResponse.json(
    { max_upload_bytes: maxUploadBytes() },
    { headers: { "Cache-Control": "no-store" } }
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseHearing(
  request: NextRequest
): { ok: true; hearing: HearingDayOptions } | { ok: false; error: string } {
  const hearingId = request.headers.get(UPLOAD_HEADERS.hearingId) ?? undefined;
  const hearingDate =
    request.headers.get(UPLOAD_HEADERS.hearingDate) ?? undefined;
  if (hearingId !== undefined && !UUID.test(hearingId)) {
    return { ok: false, error: `Invalid ${UPLOAD_HEADERS.hearingId} header` };
  }
  if (hearingDate !== undefined && !isHearingDate(hearingDate)) {
    return { ok: false, error: `Invalid ${UPLOAD_HEADERS.hearingDate} header` };
  }
  return { ok: true, hearing: { hearingId, hearingDate } };
}

const HEARING_GONE = "This hearing no longer exists. Reload the page.";
const ADDING_SWITCHED_OFF =
  "Recordings cannot be added to a hearing at the moment. Upload it as a new recording instead.";

// The API's refusal to add to the hearing: 404 for one that is gone (or never
// was the user's), 403 while multi_day_hearings is off. A 403 with a code is
// a refusal about the user (identityRefusalResponse), not about the hearing.
function hearingRefused(err: unknown): NextResponse | null {
  if (!(err instanceof BackendApiError) || err.code !== undefined) return null;
  const error =
    err.status === 404
      ? HEARING_GONE
      : err.status === 403
        ? ADDING_SWITCHED_OFF
        : null;
  if (error === null) return null;
  return NextResponse.json(
    { error, ...(err.requestId ? { request_id: err.requestId } : {}) },
    { status: err.status }
  );
}

export async function POST(request: NextRequest) {
  const auth = await getBackendAuthContext(request);
  const denied = unauthenticated(auth);
  if (denied) return denied;

  const parsedHearing = parseHearing(request);
  if (!parsedHearing.ok) return badRequest(parsedHearing.error);
  const { hearing } = parsedHearing;

  const maxBytes = maxUploadBytes();
  const upload = readRawUpload(request, {
    maxBytes,
    types: AUDIO_UPLOAD_TYPES,
    tooLargeError: audioTooLargeError(maxBytes),
  });
  if (!upload.ok) return upload.response;

  const audioDurationSeconds = parseDuration(
    request.headers.get(UPLOAD_HEADERS.audioDuration)
  );

  try {
    const job = await uploadAndSubmit(
      upload.file,
      audioDurationSeconds,
      auth,
      hearing
    );
    return NextResponse.json({ job }, { status: 201 });
  } catch (err) {
    if (upload.sizeMismatch()) {
      console.error(
        `Rejected upload body that does not match its declared size of ${upload.file.size} bytes`
      );
      return tooLarge();
    }
    console.error("Failed to upload and submit job", err);
    if (hearing.hearingId !== undefined) {
      const refused = hearingRefused(err);
      if (refused) return refused;
    }
    // The API's own 413 and 422 for the file (too big, too long, not
    // decodable) carry a message for the user, which backendFailed passes on.
    return backendFailed(err, "Failed to submit audio for transcription");
  }
}
