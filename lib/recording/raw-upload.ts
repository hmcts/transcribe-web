import "server-only";
import { NextResponse } from "next/server";
import { getAuthConfig } from "@/lib/auth/config";
import type { BackendAuthContext } from "./auth-utils";
import type { UploadFile } from "./multipart";

// Reading a file the browser sent as a raw request body, for the route
// handlers that forward uploads to the API (app/api/upload and
// app/api/jobs/[jobId]/baseline).
//
// The browser does not send multipart/form-data: Front Door's WAF
// (Microsoft_DefaultRuleSet 2.1) fails to parse multipart bodies (rules
// 200002/200003/921110) and blocks them with a 403. Instead the body is the
// file itself and its metadata comes in headers:
//
//   Content-Type       the file's type
//   X-Upload-Filename  the file's name, URL-encoded (required)
//   X-Upload-Size      the file's size in bytes (required)
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

export function tooLarge() {
  return NextResponse.json(
    { error: "Uploaded file is too large or the request body was malformed." },
    { status: 413 }
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
 * Validates a raw upload's metadata headers (400 if missing or malformed,
 * 413 if the declared size is over `maxBytes`) and returns the file with
 * its body as a stream, unread. Nothing is buffered: the caller pipes it on.
 */
export function readRawUpload(
  request: Request,
  {
    maxBytes,
    defaultContentType,
  }: {
    maxBytes: number;
    defaultContentType: string;
  }
): RawUpload {
  const filename = parseFilename(request.headers.get("x-upload-filename"));
  if (filename === null) {
    return {
      ok: false,
      response: badRequest("Missing or invalid X-Upload-Filename header"),
    };
  }

  const size = parseSize(request.headers.get("x-upload-size"));
  if (size === null) {
    return {
      ok: false,
      response: badRequest("Missing or invalid X-Upload-Size header"),
    };
  }
  if (size === 0) {
    return { ok: false, response: badRequest("No file provided") };
  }
  if (size > maxBytes) {
    return { ok: false, response: tooLarge() };
  }

  const { content, mismatched } = exactly(request.body, size);
  return {
    ok: true,
    file: {
      content,
      size,
      filename,
      contentType: request.headers.get("content-type") || defaultContentType,
    },
    sizeMismatch: mismatched,
  };
}
