import "server-only";
import { NextResponse } from "next/server";
import { getAuthConfig } from "@/lib/auth/config";
import { BackendApiError, UploadRefusedError } from "./api-client";
import type { BackendAuthContext } from "./auth-utils";
import type { UploadFile } from "./multipart";
import {
  checkUploadType,
  SERVICE_UNAVAILABLE_ERROR,
  UPLOAD_BODY_CONTENT_TYPE,
  UPLOAD_HEADERS,
  type UploadTypeAllowlist,
} from "./upload-contract";
import { identityRefusalResponse } from "@/lib/recording/identity-refusal";

// Reading a file the browser sent as a raw request body, for the route
// handlers that forward uploads to the API (app/api/upload and
// app/api/jobs/[jobId]/baseline).
//
// The browser does not send multipart/form-data, which Front Door's WAF
// blocks: the body is the file itself, sent as exactly
// application/octet-stream, and its metadata comes in headers. The contract,
// and why, is in lib/recording/upload-contract.ts.
//
// The route handler then builds the multipart request to the API inside the
// cluster, where no WAF applies (lib/recording/multipart.ts).

const MAX_FILENAME_LENGTH = 255;
// Control characters and path separators have no place in a file's name.
// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting them is the point
const UNSAFE_FILENAME_CHARS = /[\u0000-\u001f\u007f/\\]/;

export function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

export function unsupportedMediaType() {
  return NextResponse.json(
    {
      error: `Uploads must be sent with Content-Type: ${UPLOAD_BODY_CONTENT_TYPE}`,
    },
    { status: 415 }
  );
}

const TOO_LARGE_ERROR =
  "Uploaded file is too large or the request body was malformed.";

// The message for an audio upload over the size limit. The limit is the API's
// (_MAX_UPLOAD_BYTES, which words its own 413 the same way); the upload route
// (app/api/upload) keeps the figure in step with it.
export const AUDIO_TOO_LARGE_ERROR =
  "The audio file is too large (the limit is 1 GB). Uncompressed audio such as WAV is much larger for the same length: save long recordings as MP3 or M4A.";

/**
 * The 413 for an upload over the size limit, or whose body did not match its
 * declared size. `error` is the message for the user; the default fits any
 * upload, a route whose files have a limit worth stating passes its own
 * (AUDIO_TOO_LARGE_ERROR).
 */
export function tooLarge(error: string = TOO_LARGE_ERROR) {
  return NextResponse.json({ error }, { status: 413 });
}

/**
 * The response for an upload the API failed, by the API's status: a 4xx (it
 * refused the request) or a 503 (it, or a service behind it, is unavailable
 * for now) passes through; any other 5xx, or no answer at all, is a 502.
 * The browser gets only `error`, a fixed message, and the API's request_id to
 * find the failure in its logs by: never the API's own error detail, except
 * for an UploadRefusedError (the API's refusal of the audio file itself,
 * whose detail is written for the user, DIAAT-408).
 */
export function backendFailed(err: unknown, error: string): NextResponse {
  // The one exception: the API refused the audio file itself (too big, too
  // long, not decodable), and its message says what to do about it.
  if (err instanceof UploadRefusedError) {
    return NextResponse.json(
      {
        error: err.detail,
        ...(err.requestId ? { request_id: err.requestId } : {}),
      },
      { status: err.status }
    );
  }
  // A refusal about who the user is (another tab switched context, the account was deactivated)
  // goes on with its status and code, so the browser shows the stale-tab or account notice.
  const refusal = identityRefusalResponse(err);
  if (refusal) return refusal;
  if (!(err instanceof BackendApiError)) {
    return NextResponse.json({ error }, { status: 502 });
  }
  const { status, requestId } = err;
  const passThrough = (status >= 400 && status < 500) || status === 503;
  return NextResponse.json(
    {
      error: status === 503 ? SERVICE_UNAVAILABLE_ERROR : error,
      ...(requestId ? { request_id: requestId } : {}),
    },
    { status: passThrough ? status : 502 }
  );
}

/**
 * The 401 the proxy (proxy.ts) gives an /api/* request without a session,
 * for a route the proxy does not run on. Also refuses a session that no
 * longer yields a token, before any of the body is read.
 */
export function unauthenticated(auth: BackendAuthContext): NextResponse | null {
  if (getAuthConfig().enabled && !auth.bearerToken) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  return null;
}

function parseFilename(raw: string | null): string | null {
  if (raw === null) return null;
  let name: string;
  try {
    name = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (
    name.trim() === "" ||
    name.length > MAX_FILENAME_LENGTH ||
    UNSAFE_FILENAME_CHARS.test(name)
  ) {
    return null;
  }
  return name;
}

function parseSize(raw: string | null): number | null {
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const size = Number(raw);
  return Number.isSafeInteger(size) ? size : null;
}

// Passes `body` through, erroring if it turns out not to be exactly
// `expected` bytes long. A short body means it was cut off on the way in,
// and would otherwise be stored as a silently shortened file; a long one
// means the declared size (on which the size limit was checked) was false.
// The error aborts the request to the API that the body is feeding.
function exactly(
  body: ReadableStream<Uint8Array> | null,
  expected: number
): { content: ReadableStream<Uint8Array>; mismatched: () => boolean } {
  let mismatch = false;
  let received = 0;
  const reader = body?.getReader();
  const content = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = reader
        ? await reader.read()
        : { done: true as const, value: undefined };
      if (done) {
        if (received === expected) {
          controller.close();
        } else {
          mismatch = true;
          controller.error(
            new Error(
              `Upload body was ${received} bytes, not the declared ${expected}`
            )
          );
        }
        return;
      }
      received += value.byteLength;
      if (received > expected) {
        mismatch = true;
        await reader?.cancel();
        controller.error(
          new Error(`Upload body is longer than the declared ${expected} bytes`)
        );
        return;
      }
      controller.enqueue(value);
    },
    cancel(reason) {
      return reader?.cancel(reason);
    },
  });
  return { content, mismatched: () => mismatch };
}

export type RawUpload =
  | {
      ok: true;
      file: UploadFile;
      /**
       * Whether the body turned out not to match its declared size. Known
       * only once the body has been read: check it when forwarding fails.
       */
      sizeMismatch: () => boolean;
    }
  | { ok: false; response: NextResponse };

/**
 * Validates a raw upload's request headers (415 unless the Content-Type is
 * exactly application/octet-stream; 400 if the metadata is missing or
 * malformed, or the file's type is not in `types`; 413 if the declared size
 * is over `maxBytes`) and returns the file with its body as a stream,
 * unread, and its type as `types` allows it. Nothing is buffered: the caller
 * pipes it on.
 */
export function readRawUpload(
  request: Request,
  {
    maxBytes,
    types,
    tooLargeError,
  }: {
    maxBytes: number;
    types: UploadTypeAllowlist;
    /** The 413's message for a declared size over `maxBytes` (see tooLarge). */
    tooLargeError?: string;
  }
): RawUpload {
  // Exactly, as Front Door's WAF rule matches it (lib/recording/upload-contract.ts).
  if (request.headers.get("content-type") !== UPLOAD_BODY_CONTENT_TYPE) {
    return { ok: false, response: unsupportedMediaType() };
  }

  const filename = parseFilename(request.headers.get(UPLOAD_HEADERS.filename));
  if (filename === null) {
    return {
      ok: false,
      response: badRequest(
        `Missing or invalid ${UPLOAD_HEADERS.filename} header`
      ),
    };
  }

  const type = checkUploadType(
    filename,
    request.headers.get(UPLOAD_HEADERS.contentType),
    types
  );
  if (!type.ok) {
    return { ok: false, response: badRequest(type.error) };
  }

  const size = parseSize(request.headers.get(UPLOAD_HEADERS.size));
  if (size === null) {
    return {
      ok: false,
      response: badRequest(`Missing or invalid ${UPLOAD_HEADERS.size} header`),
    };
  }
  if (size === 0) {
    return { ok: false, response: badRequest("No file provided") };
  }
  if (size > maxBytes) {
    return { ok: false, response: tooLarge(tooLargeError) };
  }

  const { content, mismatched } = exactly(request.body, size);
  return {
    ok: true,
    file: {
      content,
      size,
      filename,
      contentType: type.contentType,
    },
    sizeMismatch: mismatched,
  };
}
