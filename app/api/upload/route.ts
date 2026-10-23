import { type NextRequest, NextResponse } from "next/server";
import { uploadAndSubmit } from "@/lib/recording/api-client";
import { getBackendAuthContext } from "@/lib/recording/auth-utils";

// The recording page sends the audio as the raw request body, not as
// multipart/form-data: Front Door's WAF (Microsoft_DefaultRuleSet 2.1) fails
// to parse multipart audio bodies (rules 200002/200003/921110) and blocks
// them with a 403. Metadata comes in headers:
//
//   Content-Type              the file's type (application/octet-stream if unknown)
//   X-Upload-Filename         the file's name, URL-encoded (required)
//   X-Upload-Size             the file's size in bytes (required)
//   X-Audio-Duration-Seconds  duration read in the browser (optional)
//
// This handler builds the multipart request to the API itself
// (lib/recording/api-client.ts), inside the cluster where no WAF applies.

// Same cap as the API's POST /api/v1/uploads (_MAX_UPLOAD_BYTES).
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
const MAX_FILENAME_LENGTH = 255;
// Control characters and path separators have no place in a file's name.
// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting them is the point
const UNSAFE_FILENAME_CHARS = /[\u0000-\u001f\u007f/\\]/;

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

function tooLarge() {
  return NextResponse.json(
    { error: "Uploaded file is too large or the request body was malformed." },
    { status: 413 }
  );
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

// Number() (unlike parseFloat) rejects partially-numeric strings like
// "123abc" as NaN, so only a fully-numeric, positive value is accepted;
// anything else is dropped and the duration is simply omitted.
function parseDuration(raw: string | null): number | undefined {
  const parsed = raw !== null && raw.trim() !== "" ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

// Reads the body, which must be exactly `expected` bytes long. Stops as soon
// as it runs past that, so memory stays bounded by the declared size (itself
// capped). A short body means it was cut off on the way in: Next.js truncates
// request bodies beyond experimental.proxyClientMaxBodySize when the proxy
// runs, and a truncated raw body would otherwise be stored as a silently
// shortened recording. Returns null on any mismatch.
async function readExactly(
  body: ReadableStream<Uint8Array> | null,
  expected: number
): Promise<Uint8Array[] | null> {
  if (!body) return null;
  const chunks: Uint8Array[] = [];
  let received = 0;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > expected) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return received === expected ? chunks : null;
}

export async function POST(request: NextRequest) {
  const auth = await getBackendAuthContext(request);

  const filename = parseFilename(request.headers.get("x-upload-filename"));
  if (filename === null) {
    return badRequest("Missing or invalid X-Upload-Filename header");
  }

  const size = parseSize(request.headers.get("x-upload-size"));
  if (size === null) {
    return badRequest("Missing or invalid X-Upload-Size header");
  }
  if (size === 0) {
    return badRequest("No file provided");
  }
  if (size > MAX_UPLOAD_BYTES) {
    return tooLarge();
  }

  const chunks = await readExactly(request.body, size);
  if (chunks === null) {
    console.error(
      `Rejected upload body that does not match its declared size of ${size} bytes`
    );
    return tooLarge();
  }

  const contentType =
    request.headers.get("content-type") || "application/octet-stream";
  const file = new Blob(chunks as BlobPart[], { type: contentType });
  const audioDurationSeconds = parseDuration(
    request.headers.get("x-audio-duration-seconds")
  );

  try {
    const job = await uploadAndSubmit(
      file,
      filename,
      audioDurationSeconds,
      auth
    );
    return NextResponse.json({ job }, { status: 201 });
  } catch (err) {
    console.error("Failed to upload and submit job", err);
    return NextResponse.json(
      { error: "Failed to submit audio for transcription" },
      { status: 502 }
    );
  }
}
