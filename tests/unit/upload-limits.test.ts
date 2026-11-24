import { describe, expect, it } from "vitest";
import {
  audioTooLargeError,
  DEFAULT_MAX_UPLOAD_BYTES,
  formatBytes,
  maxUploadBytes,
} from "@/lib/recording/upload-limits";

// DIAAT-408: the upload size backstop is the MAX_UPLOAD_BYTES environment variable, and
// must equal the API's MAX_UPLOAD_BYTES setting.

describe("maxUploadBytes", () => {
  it("is 1 GiB when unset", () => {
    expect(maxUploadBytes({})).toBe(1024 ** 3);
    expect(DEFAULT_MAX_UPLOAD_BYTES).toBe(1024 ** 3);
  });

  it("reads a positive whole number", () => {
    expect(maxUploadBytes({ MAX_UPLOAD_BYTES: String(4 * 1024 ** 3) })).toBe(
      4 * 1024 ** 3
    );
    expect(maxUploadBytes({ MAX_UPLOAD_BYTES: " 2048 " })).toBe(2048);
  });

  it.each([
    "",
    "  ",
    "abc",
    "0",
    "-1",
    "1.5",
    "1e9",
    "10GB",
    "9".repeat(30),
  ])("falls back to 1 GiB for %j", (raw) => {
    expect(maxUploadBytes({ MAX_UPLOAD_BYTES: raw })).toBe(1024 ** 3);
  });
});

describe("the size limit in words", () => {
  it.each([
    [1024 ** 3, "1 GB"],
    [4 * 1024 ** 3, "4 GB"],
    [1536 * 1024 ** 2, "1.5 GB"],
    [512 * 1024 ** 2, "512 MB"],
  ])("%d bytes is %s", (size, text) => {
    expect(formatBytes(size)).toBe(text);
  });

  it("words the message as the API words its own 413", () => {
    expect(audioTooLargeError(1024 ** 3)).toBe(
      "The audio file is too large (the limit is 1 GB). Uncompressed audio such as WAV is much larger for the same length: save long recordings as MP3 or M4A."
    );
  });
});
