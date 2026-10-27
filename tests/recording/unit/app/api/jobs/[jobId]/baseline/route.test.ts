import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bytesOf, consumeBody, sentMultipart } from "../../../../../multipart";

// Like the audio upload, the browser sends the baseline transcript as the raw
// request body, as exactly application/octet-stream, with its name, size and
// own type in headers: Front Door's WAF blocks multipart bodies from the
// browser (lib/recording/upload-contract.ts). This route builds the
// multipart request to the API (POST /api/v1/jobs/{id}/baseline, field
// `file`, a .txt of at most 5 MB). These tests assert on what reaches the API
// at the fetch boundary; the fetch mock reads a streamed body as fetch would.

const BACKEND = "http://localhost:8001";
const JOB_ID = "11111111-1111-1111-1111-111111111111";
const BASELINE_URL = `${BACKEND}/api/v1/jobs/${JOB_ID}/baseline`;
const MAX_BASELINE_BYTES = 5 * 1024 * 1024;

const BACKEND_JOB = {
  job_id: JOB_ID,
  status: "succeeded",
  created_at: "2026-10-23T09:00:00Z",
  updated_at: "2026-10-23T09:30:00Z",
  dialogue_entries: [
    { speaker: "Speaker 1", text: "Good morning.", start_time: 0, end_time: 2 },
  ],
  accuracy: {
    confidence_score: 92,
    words_transcribed: 2,
    low_confidence_count: 0,
    confidence_threshold: 85,
    has_corrections: false,
    word_error_rate: null,
    corrected_percent: null,
    has_baseline: true,
    baseline_word_error_rate: 12.5,
  },
  needs_review: null,
  error_message: null,
  metadata: { case_reference: "PA/05217/2025" },
  audio_duration_seconds: null,
  transcription_duration_seconds: null,
  model_identifier: null,
  model_display_name: null,
};

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

let fetchMock: ReturnType<typeof vi.fn>;
let sentBody: Uint8Array<ArrayBuffer> | undefined;

function backendResponds(body: unknown, status = 200) {
  sentBody = undefined;
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    sentBody = await consumeBody(init);
    if (url !== BASELINE_URL) throw new Error(`unexpected fetch ${url}`);
    return jsonResponse(body, status);
  });
  vi.stubGlobal("fetch", fetchMock);
}

const TEXT = new TextEncoder().encode(
  "﻿Judge: Good morning.\nCounsel: Good morning, Judge.\n"
);

function baselineRequest(
  body: Uint8Array<ArrayBuffer>,
  headers: Record<string, string | undefined> = {}
): NextRequest {
  const defaults: Record<string, string> = {
    "content-type": "application/octet-stream",
    "x-upload-content-type": "text/plain",
    "x-upload-filename": "reference.txt",
    "x-upload-size": String(body.length),
  };
  const merged = new Headers();
  for (const [k, v] of Object.entries({ ...defaults, ...headers })) {
    if (v !== undefined) merged.set(k, v);
  }
  return new Request(`http://localhost/api/jobs/${JOB_ID}/baseline`, {
    method: "POST",
    body,
    headers: merged,
  }) as unknown as NextRequest;
}

const context = { params: Promise.resolve({ jobId: JOB_ID }) };

async function post(request: NextRequest) {
  const { POST } = await import("@/app/api/jobs/[jobId]/baseline/route");
  return POST(request, context);
}

async function seedSession(id: string, idToken: string) {
  const { writeSession } = await import("@/lib/auth/session-store");
  await writeSession(id, {
    idToken,
    idTokenExpiresAt: Date.now() + 60 * 60 * 1000,
    user: {
      oid: "oid-1",
      name: "Clerk",
      email: "clerk@justice.gov.uk",
      roles: [],
    },
    createdAt: Date.now(),
  });
}

describe("POST /api/jobs/[jobId]/baseline", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    backendResponds(BACKEND_JOB);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("sends the raw body to the API as the multipart `file` part and returns the updated job", async () => {
    await seedSession("sess-bl", "clerk-id-token");

    const response = await post(
      baselineRequest(TEXT, { cookie: "transcribe_session=sess-bl" })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.job.id).toBe(JOB_ID);
    expect(body.job.accuracy.baselineWordErrorRate).toBe(12.5);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(BASELINE_URL);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer clerk-id-token"
    );
    const form = await sentMultipart(init, sentBody);
    expect([...form.keys()]).toEqual(["file"]);
    const part = form.get("file") as File;
    expect(part.name).toBe("reference.txt");
    expect(part.type).toBe("text/plain");
    expect(await bytesOf(part)).toEqual(Array.from(TEXT));
  });

  it("decodes a URL-encoded filename", async () => {
    const name = "R v Smith & O'Brien – day 2.TXT";

    const response = await post(
      baselineRequest(TEXT, { "x-upload-filename": encodeURIComponent(name) })
    );

    expect(response.status).toBe(200);
    const form = await sentMultipart(
      fetchMock.mock.calls[0][1] as RequestInit,
      sentBody
    );
    expect((form.get("file") as File).name).toBe(name);
  });

  it.each([
    ["no declared type", ""],
    ["no declared type header", undefined],
    ["a declared application/octet-stream", "application/octet-stream"],
    ["text/plain with a charset", "text/plain;charset=UTF-8"],
  ])("sends text/plain given %s", async (_label, declared) => {
    const response = await post(
      baselineRequest(TEXT, { "x-upload-content-type": declared })
    );

    expect(response.status).toBe(200);
    const form = await sentMultipart(
      fetchMock.mock.calls[0][1] as RequestInit,
      sentBody
    );
    expect((form.get("file") as File).type).toBe("text/plain");
  });

  describe("rejects any Content-Type but application/octet-stream with 415, without calling the API", () => {
    it.each([
      ["text/plain", "text/plain"],
      ["text/plain with a charset", "text/plain;charset=UTF-8"],
      ["multipart/form-data", "multipart/form-data; boundary=----x"],
      ["audio/mpeg", "audio/mpeg"],
      ["missing", undefined],
    ])("%s", async (_label, contentType) => {
      const response = await post(
        baselineRequest(TEXT, { "content-type": contentType })
      );

      expect(response.status).toBe(415);
      expect((await response.json()).error).toEqual(expect.any(String));
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("rejects bad metadata with 400 without calling the API", () => {
    it.each([
      ["missing filename", { "x-upload-filename": undefined }],
      [
        "malformed percent-encoding",
        { "x-upload-filename": "bad%E0%A4%A.txt" },
      ],
      ["a path separator", { "x-upload-filename": "..%2Fetc%2Fpasswd.txt" }],
      ["a file that is not .txt", { "x-upload-filename": "reference.docx" }],
      ["a file with no extension", { "x-upload-filename": "reference" }],
      [
        "an audio file",
        {
          "x-upload-filename": "hearing.mp3",
          "x-upload-content-type": "audio/mpeg",
        },
      ],
      [
        "a declared type other than text/plain",
        { "x-upload-content-type": "text/html" },
      ],
      ["a .txt declared as audio", { "x-upload-content-type": "audio/mpeg" }],
      ["missing size", { "x-upload-size": undefined }],
      ["non-numeric size", { "x-upload-size": "12abc" }],
    ])("%s", async (_label, headers) => {
      const response = await post(baselineRequest(TEXT, headers));

      expect(response.status).toBe(400);
      expect((await response.json()).error).toEqual(expect.any(String));
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("an empty body", async () => {
      const response = await post(baselineRequest(new Uint8Array(0)));

      expect(response.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("rejects oversized or truncated bodies with 413", () => {
    it("a declared size over the API's 5 MB limit, without calling the API", async () => {
      const response = await post(
        baselineRequest(TEXT, {
          "x-upload-size": String(MAX_BASELINE_BYTES + 1),
        })
      );

      expect(response.status).toBe(413);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
      ["longer", TEXT.length - 1],
      ["shorter", TEXT.length + 10],
    ])("a body %s than its declared size", async (_label, declared) => {
      const response = await post(
        baselineRequest(TEXT, { "x-upload-size": String(declared) })
      );

      expect(response.status).toBe(413);
      // The request to the API was aborted before its body completed.
      expect(sentBody).toBeUndefined();
    });
  });

  describe("with login enabled (AUTH_ENABLED=true)", () => {
    it("answers 401 without a session, without calling the API", async () => {
      vi.stubEnv("AUTH_ENABLED", "true");

      const response = await post(baselineRequest(TEXT));

      expect(response.status).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("maps API failures", () => {
    it("404 (no such job, or not the caller's) to 404", async () => {
      backendResponds({ detail: "Job not found" }, 404);

      const response = await post(baselineRequest(TEXT));

      expect(response.status).toBe(404);
    });

    // The browser gets a fixed message and the API's request_id, never the
    // API's own error detail.
    it.each([
      ["a rejected transcript (422)", 422],
      ["a bad request (400)", 400],
      ["forbidden (403)", 403],
    ])("%s to the same status", async (_label, status) => {
      backendResponds({ detail: "nope", request_id: "req-4xx" }, status);

      const response = await post(baselineRequest(TEXT));

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({
        error: "Failed to upload baseline transcript",
        request_id: "req-4xx",
      });
    });

    it("503 (unavailable) to 503, saying to try again", async () => {
      backendResponds(
        { detail: "Service Unavailable", request_id: "req-503" },
        503
      );

      const response = await post(baselineRequest(TEXT));

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error:
          "The transcription service is temporarily unavailable. Please try again.",
        request_id: "req-503",
      });
    });

    it.each([
      ["a server error (500)", 500],
      ["a gateway timeout (504)", 504],
    ])("%s to 502", async (_label, status) => {
      backendResponds(
        { detail: "Internal Server Error", request_id: "req-5xx" },
        status
      );

      const response = await post(baselineRequest(TEXT));

      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({
        error: "Failed to upload baseline transcript",
        request_id: "req-5xx",
      });
    });

    it("an unreachable API to 502", async () => {
      fetchMock.mockRejectedValue(new TypeError("fetch failed"));

      const response = await post(baselineRequest(TEXT));

      expect(response.status).toBe(502);
    });
  });
});
