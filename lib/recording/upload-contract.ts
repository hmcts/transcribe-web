// The request contract for the two browser uploads (audio to /api/upload,
// a baseline transcript to /api/jobs/{id}/baseline), shared by the pages
// that send them and the route handlers that take them
// (lib/recording/raw-upload.ts). No "server-only": both sides import it.
//
// The file goes as the raw request body, never multipart/form-data, and
// always with exactly
//
//   Content-Type: application/octet-stream
//
// Front Door's WAF (Microsoft_DefaultRuleSet 2.1) blocks multipart bodies
// from the browser (200002/200003/921110), and raw ones too: 921110 on the
// body's first bytes, 920420 on a Content-Type such as audio/mpeg. A custom
// Allow rule exempts exactly POST /api/upload and POST
// /api/jobs/<uuid>/baseline (optional query string) with that Content-Type,
// as an exact value with no parameters. Any other value is blocked at Front
// Door, so the route handlers refuse it too (415): a mismatch shows up in
// local and test runs, not first in a deployed environment.
//
// So the Content-Type says nothing about the file. Its metadata comes in
// headers instead:
//
//   X-Upload-Filename      the file's name, URL-encoded (required)
//   X-Upload-Size          the file's size in bytes (required)
//   X-Upload-Content-Type  the type the browser gives the file (File.type),
//                          empty if it does not know it
//
// and the route handler checks the type against an allowlist on both the
// filename's extension and the declared type (lib/recording/raw-upload.ts),
// then forwards the real type to the API as the multipart part's type.

export const UPLOAD_BODY_CONTENT_TYPE = "application/octet-stream";

export const UPLOAD_HEADERS = {
  filename: "X-Upload-Filename",
  size: "X-Upload-Size",
  contentType: "X-Upload-Content-Type",
  audioDuration: "X-Audio-Duration-Seconds",
} as const;

/**
 * Accepted file types by extension (lower-case, with the dot): the type the
 * API is sent when the browser declares none first, then every other type a
 * browser may declare for such a file.
 */
export type UploadTypeAllowlist = Readonly<
  Record<string, readonly [string, ...string[]]>
>;

// The API's POST /api/v1/uploads accepts these extensions
// (_ALLOWED_AUDIO_EXTENSIONS in transcribe-api's routes_recording.py), and
// decodes every upload, rejecting one that is not really audio. The types
// are what browsers and operating systems report for each.
export const AUDIO_UPLOAD_TYPES: UploadTypeAllowlist = {
  ".mp3": ["audio/mpeg", "audio/mp3", "audio/mpeg3", "audio/x-mpeg-3"],
  ".wav": [
    "audio/wav",
    "audio/x-wav",
    "audio/wave",
    "audio/vnd.wave",
    "audio/x-pn-wav",
  ],
  ".mp4": ["audio/mp4", "video/mp4"],
  ".m4a": ["audio/mp4", "audio/x-m4a", "audio/m4a"],
  ".ogg": ["audio/ogg", "application/ogg", "audio/x-ogg"],
  ".flac": ["audio/flac", "audio/x-flac"],
};

// POST /api/v1/jobs/{id}/baseline accepts only .txt
// (_ALLOWED_BASELINE_EXTENSIONS), decoded as UTF-8.
export const BASELINE_UPLOAD_TYPES: UploadTypeAllowlist = {
  ".txt": ["text/plain"],
};

/**
 * The headers for sending `file` as a raw upload body. Pass them to fetch
 * with the File itself as the body: an explicit Content-Type stops fetch
 * setting its own from the Blob's type.
 */
export function rawUploadHeaders(
  file: File,
  extra: Record<string, string> = {}
): Record<string, string> {
  return {
    "Content-Type": UPLOAD_BODY_CONTENT_TYPE,
    [UPLOAD_HEADERS.contentType]: file.type,
    // URL-encoded because header values must be ASCII.
    [UPLOAD_HEADERS.filename]: encodeURIComponent(file.name),
    [UPLOAD_HEADERS.size]: String(file.size),
    ...extra,
  };
}

/** Lower-case, with the dot; "" for none (or a name like ".wav"). */
function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(dot).toLowerCase() : "";
}

export type UploadTypeCheck =
  | { ok: true; contentType: string }
  | { ok: false; error: string };

/**
 * Checks an upload's filename and declared type against `allowlist`, and
 * gives the type to send the API. The extension must be in the allowlist;
 * a declared type, if any, must be one the allowlist accepts for that
 * extension (compared without parameters, case-insensitively). An empty or
 * absent declared type, or application/octet-stream (which claims nothing),
 * leaves the extension to decide.
 */
export function checkUploadType(
  filename: string,
  declared: string | null,
  allowlist: UploadTypeAllowlist
): UploadTypeCheck {
  const allowed = Object.keys(allowlist)
    .sort((a, b) => a.localeCompare(b))
    .join(", ");
  const extension = extensionOf(filename);
  const types = Object.hasOwn(allowlist, extension)
    ? allowlist[extension]
    : undefined;
  if (!types) {
    return { ok: false, error: `Unsupported file type. Allowed: ${allowed}` };
  }

  const essence = (declared ?? "").split(";")[0].trim().toLowerCase();
  if (essence === "" || essence === UPLOAD_BODY_CONTENT_TYPE) {
    return { ok: true, contentType: types[0] };
  }
  if (!types.includes(essence)) {
    return {
      ok: false,
      error: `The file's type does not match its extension. Allowed: ${allowed}`,
    };
  }
  return { ok: true, contentType: essence };
}
