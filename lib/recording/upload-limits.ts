// How large an audio upload may be, and how a limit is worded (DIAAT-408).
//
// MAX_UPLOAD_BYTES is a backstop on the size of the file, not the limit on how
// long a recording may be: that is the API's (its effective recording limit,
// served at GET /api/flags as `max_recording_seconds`, see
// lib/flags/runtime-flags.ts). 1 GiB takes 4 hours of any usual MP3/M4A and of
// 16 kHz mono WAV, but not of CD-quality WAV.
//
// It is read from the MAX_UPLOAD_BYTES environment variable when the upload is
// handled, not at build time (CNP builds one image for every environment), and
// must equal the API's MAX_UPLOAD_BYTES setting: the web route refuses a
// declared size over it before any of the body is read, the API refuses one it
// is sent over its own. Unset, empty, or anything but a positive whole number
// means the default.

export const DEFAULT_MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;

export function maxUploadBytes(
  env: Record<string, string | undefined> = process.env
): number {
  const raw = env.MAX_UPLOAD_BYTES?.trim();
  if (!raw || !/^\d+$/.test(raw)) return DEFAULT_MAX_UPLOAD_BYTES;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0
    ? value
    : DEFAULT_MAX_UPLOAD_BYTES;
}

/** A size for a message to the user, worded as the API words its own 413: "1 GB", "1.5 GB", "512 MB". */
export function formatBytes(size: number): string {
  const gib = 1024 ** 3;
  const [value, unit] =
    size >= gib ? [size / gib, "GB"] : [size / 1024 ** 2, "MB"];
  return `${Number(value.toFixed(1))} ${unit}`;
}

/** The message for an audio upload over the size limit (the API's 413 has the same words). */
export function audioTooLargeError(maxBytes: number): string {
  return `The audio file is too large (the limit is ${formatBytes(maxBytes)}). Uncompressed audio such as WAV is much larger for the same length: save long recordings as MP3 or M4A.`;
}
