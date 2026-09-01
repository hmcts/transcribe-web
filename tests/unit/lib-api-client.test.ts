/**
 * Tests for ApiClient (accessed through the exported apiClient singleton).
 *
 * In the test environment, process.env.NEXT_PUBLIC_API_URL is "http://localhost:8000"
 * which means isLocalDevelopment() returns true. This means:
 *   - getAuthToken() always returns null (no Authorization header)
 *   - 401 responses throw immediately (no production retry/redirect logic)
 *   - credentials are "omit", mode is "cors"
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Treat the test environment as "local development" so that getAuthToken()
// returns null immediately and doesn't try to call /.auth/me via fetch,
// which would otherwise consume mock responses set up for the real API calls.
vi.mock("@/lib/environment", () => ({
  isLocalDevelopment: () => true,
  isLocalhostRuntime: () => true,
  shouldPrepopulateLocalDemoData: () => false,
}));

import { apiClient } from "@/lib/api-client";

const BASE = "http://localhost:8000";
const mockFetch = vi.fn();

beforeEach(() => {
  global.fetch = mockFetch;
});

afterEach(() => {
  mockFetch.mockReset();
});

/** Build a minimal successful fetch response */
function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { get: vi.fn().mockReturnValue(null) },
    json: vi.fn().mockResolvedValue(body),
  };
}

// ─── request – success ────────────────────────────────────────────────────────

describe("apiClient.request — success", () => {
  it("returns the parsed JSON data for a 200 response", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ status: "ok" }));

    const result = await apiClient.request<{ status: string }>("/health");

    expect(result.data).toEqual({ status: "ok" });
    expect(result.error).toBeUndefined();
  });

  it("constructs the correct URL from base + endpoint", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}));

    await apiClient.request("/health");

    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE}/api/health`,
      expect.any(Object)
    );
  });

  it("sets Content-Type: application/json for non-FormData bodies", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}));

    await apiClient.request("/items", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers["Content-Type"]).toBe("application/json");
  });

  it("omits Content-Type when body is FormData", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}));
    const form = new FormData();

    await apiClient.request("/upload", { method: "POST", body: form });

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers).not.toHaveProperty("Content-Type");
  });

  it("uses cors mode and omit credentials in local dev", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}));

    await apiClient.request("/health");

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.mode).toBe("cors");
    expect(opts.credentials).toBe("omit");
  });
});

// ─── request – error responses ────────────────────────────────────────────────

describe("apiClient.request — HTTP errors", () => {
  it("returns an error object for a 401 response in local dev mode", async () => {
    // In local dev mode, 401 throws immediately without retrying.
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      headers: { get: vi.fn().mockReturnValue(null) },
      json: vi.fn().mockResolvedValue({}),
    });

    const result = await apiClient.request("/protected");

    expect(result.error).toContain("Authentication failed");
  });

  it("returns an error object for a 405 response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 405,
      statusText: "Method Not Allowed",
      headers: { get: vi.fn().mockReturnValue(null) },
      json: vi.fn().mockResolvedValue({}),
    });

    const result = await apiClient.request("/items", { method: "DELETE" });

    expect(result.error).toContain("not allowed");
  });

  it("uses the detail field from the response body as the error message", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      statusText: "Unprocessable Entity",
      headers: { get: vi.fn().mockReturnValue(null) },
      json: vi.fn().mockResolvedValue({ detail: "Validation failed" }),
    });

    const result = await apiClient.request("/items");

    expect(result.error).toBe("Validation failed");
  });

  it("uses the message field when there is no detail field", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      headers: { get: vi.fn().mockReturnValue(null) },
      json: vi.fn().mockResolvedValue({ message: "Something broke" }),
    });

    const result = await apiClient.request("/items");

    expect(result.error).toBe("Something broke");
  });

  it("falls back to generic HTTP error when body cannot be parsed as JSON", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      headers: { get: vi.fn().mockReturnValue(null) },
      json: vi.fn().mockRejectedValue(new SyntaxError("Unexpected token")),
    });

    const result = await apiClient.request("/items");

    expect(result.error).toContain("503");
  });

  it("returns an error object when fetch throws (network failure)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network unreachable"));

    const result = await apiClient.request("/items");

    expect(result.error).toBe("Network unreachable");
  });
});

// ─── high-level convenience methods ──────────────────────────────────────────

describe("apiClient convenience methods", () => {
  beforeEach(() => {
    mockFetch.mockResolvedValue(jsonResponse({}));
  });

  it("getHealth calls GET /health", async () => {
    await apiClient.getHealth();
    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE}/api/health`,
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });

  it("getSpeechToken calls GET /get-speech-token", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ token: "tok", endpoint: "ep" })
    );
    await apiClient.getSpeechToken();
    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE}/api/get-speech-token`,
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });

  it("getUploadUrl posts to /get-upload-url with file_extension", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ upload_url: "https://blob", user_upload_s3_file_key: "k" })
    );
    await apiClient.getUploadUrl("mp4");
    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE}/api/get-upload-url`,
      expect.objectContaining({
        body: JSON.stringify({ file_extension: "mp4" }),
      })
    );
  });

  it("startTranscriptionJob posts the file key", async () => {
    await apiClient.startTranscriptionJob("key/123.webm");
    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE}/api/start-transcription-job`,
      expect.objectContaining({
        body: JSON.stringify({ user_upload_s3_file_key: "key/123.webm" }),
      })
    );
  });

  it("generateOrEditMinutes posts data to the correct endpoint", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ minute_version_id: "mv1" }));
    await apiClient.generateOrEditMinutes({ transcription_id: "t1" });
    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE}/api/generate-or-edit-minutes`,
      expect.objectContaining({
        body: JSON.stringify({ transcription_id: "t1" }),
      })
    );
  });

  it("getAudioPlaybackUrl calls the correct path", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ playback_url: "https://audio" })
    );
    await apiClient.getAudioPlaybackUrl("t1", "j1");
    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE}/api/transcriptions/t1/jobs/j1/audio-url`,
      expect.any(Object)
    );
  });
});
