import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getUploadUrl: vi.fn(),
  },
}));

import {
  detectSupportedMimeType,
  fetchUploadUrl,
  getExtensionFromMimeType,
} from "@/components/audio/upload/upload-utils";
import { apiClient } from "@/lib/api-client";

// ─── getExtensionFromMimeType ─────────────────────────────────────────────────

describe("getExtensionFromMimeType", () => {
  it.each([
    ["audio/mp4", "mp4"],
    ["video/mp4", "mp4"],
    ["audio/mpeg", "mp3"],
    ["audio/mp3", "mp3"],
    ["audio/wav", "wav"],
    ["audio/x-wav", "wav"],
    ["audio/wave", "wav"],
    ["audio/webm", "webm"],
    ["video/webm", "webm"],
    ["audio/ogg", "ogg"],
    ["audio/x-m4a", "m4a"],
    ["audio/m4a", "m4a"],
    ["audio/aac", "aac"],
    ["video/quicktime", "mov"],
    ["video/mpeg", "mp4"],
  ])("maps %s → %s", (mime, expected) => {
    expect(getExtensionFromMimeType(mime)).toBe(expected);
  });

  it("is case-insensitive", () => {
    expect(getExtensionFromMimeType("AUDIO/MP4")).toBe("mp4");
  });

  it("returns 'webm' as a fallback for unknown types", () => {
    expect(getExtensionFromMimeType("application/unknown")).toBe("webm");
  });

  it("returns 'webm' for an empty string", () => {
    expect(getExtensionFromMimeType("")).toBe("webm");
  });
});

// ─── fetchUploadUrl ───────────────────────────────────────────────────────────

describe("fetchUploadUrl", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (MediaRecorder as any).isTypeSupported = vi.fn().mockReturnValue(false);
    vi.mocked(apiClient.getUploadUrl).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns success with data on the first attempt", async () => {
    const data = {
      upload_url: "https://example.com/upload",
      user_upload_s3_file_key: "key123",
    };
    vi.mocked(apiClient.getUploadUrl).mockResolvedValueOnce({ data });

    const result = await fetchUploadUrl();

    expect(result).toEqual({ success: true, data });
    expect(apiClient.getUploadUrl).toHaveBeenCalledTimes(1);
    expect(apiClient.getUploadUrl).toHaveBeenCalledWith("webm");
  });

  it("uses mp4 extension when a mp4 mime type is supported", async () => {
    (MediaRecorder as any).isTypeSupported = vi
      .fn()
      .mockImplementation((t: string) => t === "video/mp4");
    vi.mocked(apiClient.getUploadUrl).mockResolvedValueOnce({
      data: {
        upload_url: "https://example.com/upload",
        user_upload_s3_file_key: "key",
      },
    });

    await fetchUploadUrl();
    expect(apiClient.getUploadUrl).toHaveBeenCalledWith("mp4");
  });

  it("retries on API error and succeeds on second attempt", async () => {
    const data = {
      upload_url: "https://example.com/upload",
      user_upload_s3_file_key: "key",
    };
    vi.mocked(apiClient.getUploadUrl)
      .mockResolvedValueOnce({ error: "timeout" })
      .mockResolvedValueOnce({ data });

    const resultPromise = fetchUploadUrl();
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({ success: true, data });
    expect(apiClient.getUploadUrl).toHaveBeenCalledTimes(2);
  });

  it("returns failure after exhausting all retries with API errors", async () => {
    vi.mocked(apiClient.getUploadUrl).mockResolvedValue({ error: "timeout" });

    const resultPromise = fetchUploadUrl();
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({ success: false });
    expect(apiClient.getUploadUrl).toHaveBeenCalledTimes(3);
  });

  it("retries on thrown exception and succeeds on second attempt", async () => {
    const data = {
      upload_url: "https://example.com/upload",
      user_upload_s3_file_key: "key",
    };
    vi.mocked(apiClient.getUploadUrl)
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce({ data });

    const resultPromise = fetchUploadUrl();
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({ success: true, data });
    expect(apiClient.getUploadUrl).toHaveBeenCalledTimes(2);
  });

  it("returns failure after all attempts throw", async () => {
    vi.mocked(apiClient.getUploadUrl).mockRejectedValue(
      new Error("Network error")
    );

    const resultPromise = fetchUploadUrl();
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({ success: false });
    expect(apiClient.getUploadUrl).toHaveBeenCalledTimes(3);
  });
});

// ─── detectSupportedMimeType ──────────────────────────────────────────────────

describe("detectSupportedMimeType", () => {
  beforeEach(() => {
    (MediaRecorder as any).isTypeSupported = vi.fn().mockReturnValue(false);
  });

  it("falls back to 'audio/webm' when nothing is supported", () => {
    expect(detectSupportedMimeType()).toBe("audio/webm");
  });

  it("returns 'video/mp4' when it is the first supported type", () => {
    (MediaRecorder as any).isTypeSupported = vi.fn().mockReturnValue(true);
    expect(detectSupportedMimeType()).toBe("video/mp4");
  });

  it("skips unsupported types and returns the first supported one", () => {
    (MediaRecorder as any).isTypeSupported = vi
      .fn()
      .mockImplementation((type: string) => type === "audio/mp4");
    // video/mp4 is checked first, audio/mp4 second — should return audio/mp4
    expect(detectSupportedMimeType()).toBe("audio/mp4");
  });
});
