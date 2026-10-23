import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bytesOf, consumeBody, sentMultipart } from "../../../multipart";

// The browser sends the audio as the raw request body, with its metadata in
// headers: Front Door's WAF (DRS 2.1) blocks multipart/form-data from the
// browser, and raw audio too unless it is sent as exactly
// application/octet-stream (lib/recording/upload-contract.ts). This route builds the multipart request to the API itself, inside
// the cluster, streaming the body through. These tests drive it with a real
// Request and assert on what reaches the backend at the fetch boundary; the
// fetch mock reads a streamed body as a real fetch would.

const BACKEND = "http://localhost:8001";
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

const BACKEND_JOB = {
  job_id: "11111111-1111-1111-1111-111111111111",
  status: "pending",
  created_at: "2026-10-23T09:00:00Z",
  updated_at: null,
  dialogue_entries: null,
  accuracy: null,
  needs_review: null,
  error_message: null,
  metadata: {
    case_reference: "PA/05217/2025",
    audio_file_name: "PA_05217_2025.wav",
  },
  audio_duration_seconds: 9360.5,
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
// What each streamed request body turned out to be, by URL.
let sent: Map<string, Uint8Array<ArrayBuffer>>;

function backendOk() {
  sent = new Map();
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const body = await consumeBody(init);
    if (body) sent.set(url, body);
    if (url === `${BACKEND}/api/v1/uploads`) {
      return Promise.resolve(
        jsonResponse(
          {
            audio_url: "https://storage.example.com/uploads/u/x.wav",
            blob_name: "uploads/u/x.wav",
          },
          201
        )
      );
    }
    if (url === `${BACKEND}/api/v1/jobs`) {
      return Promise.resolve(jsonResponse(BACKEND_JOB, 201));
    }
    return Promise.reject(new Error(`unexpected fetch ${url}`));
  });
  vi.stubGlobal("fetch", fetchMock);
}

function uploadsCall() {
  return fetchMock.mock.calls.find(
    ([url]) => url === `${BACKEND}/api/v1/uploads`
  ) as [string, RequestInit] | undefined;
}

// The multipart body sent to POST /api/v1/uploads, parsed.
async function sentUpload(): Promise<FormData> {
  const call = uploadsCall();
  expect(call).toBeDefined();
  const [url, init] = call as [string, RequestInit];
  return sentMultipart(init, sent.get(url));
}

function jobsCall() {
  return fetchMock.mock.calls.find(
    ([url]) => url === `${BACKEND}/api/v1/jobs`
  ) as [string, RequestInit] | undefined;
}

const AUDIO = new TextEncoder().encode("RIFF....WAVEfmt fake audio bytes");

function uploadRequest(
  body: Uint8Array<ArrayBuffer>,
  headers: Record<string, string | undefined> = {}
): NextRequest {
  const defaults: Record<string, string> = {
    "content-type": "application/octet-stream",
    "x-upload-content-type": "audio/wav",
    "x-upload-filename": "PA_05217_2025.wav",
    "x-upload-size": String(body.length),
  };
  const merged = new Headers();
  for (const [k, v] of Object.entries({ ...defaults, ...headers })) {
    if (v !== undefined) merged.set(k, v);
  }
  return new Request("http://localhost/api/upload", {
    method: "POST",
    body,
    headers: merged,
  }) as unknown as NextRequest;
}

async function seedSession(id: string, idToken: string) {
  const { writeSession } = await import("@/lib/auth/session-store");
  await writeSession(id, {
    idToken,
    idTokenExpiresAt: Date.now() + 60 * 60 * 1000,
    user: {
      oid: "oid-1",
      name: "Judge",
      email: "judge@justice.gov.uk",
      roles: [],
    },
    createdAt: Date.now(),
  });
}

describe("POST /api/upload", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    backendOk();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("sends the raw body to the API as the multipart `file` part, then submits the job", async () => {
    await seedSession("sess-up", "user-id-token");
    const { POST } = await import("@/app/api/upload/route");

    const response = await POST(
      uploadRequest(AUDIO, {
        cookie: "transcribe_session=sess-up",
        "x-audio-duration-seconds": "9360.5",
      })
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.job.id).toBe(BACKEND_JOB.job_id);
    expect(body.job.caseReference).toBe("PA/05217/2025");

    const upload = uploadsCall();
    expect(upload).toBeDefined();
    const [, uploadInit] = upload as [string, RequestInit];
    expect(uploadInit.method).toBe("POST");
    expect((uploadInit.headers as Record<string, string>).Authorization).toBe(
      "Bearer user-id-token"
    );
    const form = await sentUpload();
    expect([...form.keys()]).toEqual(["file"]);
    const part = form.get("file") as File;
    expect(part.name).toBe("PA_05217_2025.wav");
    expect(part.type).toBe("audio/wav");
    expect(await bytesOf(part)).toEqual(Array.from(AUDIO));

    const jobs = jobsCall();
    expect(jobs).toBeDefined();
    const [, jobsInit] = jobs as [string, RequestInit];
    expect((jobsInit.headers as Record<string, string>).Authorization).toBe(
      "Bearer user-id-token"
    );
    expect(JSON.parse(jobsInit.body as string)).toEqual({
      audio_url: "https://storage.example.com/uploads/u/x.wav",
      blob_name: "uploads/u/x.wav",
      audio_duration_seconds: 9360.5,
      metadata: {
        case_reference: "PA/05217/2025",
        tribunal: "First-tier Tribunal — Immigration and Asylum Chamber",
        audio_file_name: "PA_05217_2025.wav",
      },
    });
  });

  it("decodes a URL-encoded filename", async () => {
    const { POST } = await import("@/app/api/upload/route");
    const name = "R v Smith & O'Brien – day 2.m4a";

    const response = await POST(
      uploadRequest(AUDIO, {
        "x-upload-content-type": "audio/mp4",
        "x-upload-filename": encodeURIComponent(name),
      })
    );

    expect(response.status).toBe(201);
    const form = await sentUpload();
    const part = form.get("file") as File;
    expect(part.name).toBe(name);
    expect(part.type).toBe("audio/mp4");
  });

  // The API accepts .mp3 .wav .mp4 .m4a .ogg .flac (_ALLOWED_AUDIO_EXTENSIONS
  // in transcribe-api's routes_recording.py).
  it.each([
    ["hearing.mp3", "audio/mpeg"],
    ["hearing.wav", "audio/wav"],
    ["hearing.mp4", "audio/mp4"],
    ["hearing.m4a", "audio/mp4"],
    ["hearing.ogg", "audio/ogg"],
    ["HEARING.FLAC", "audio/flac"],
  ])("forwards %s as %s when the browser declares no type", async (filename, type) => {
    const { POST } = await import("@/app/api/upload/route");

    const response = await POST(
      uploadRequest(AUDIO, {
        "x-upload-filename": filename,
        "x-upload-content-type": "",
      })
    );

    expect(response.status).toBe(201);
    const part = (await sentUpload()).get("file") as File;
    expect(part.name).toBe(filename);
    expect(part.type).toBe(type);
  });

  it("treats a declared application/octet-stream as no declared type", async () => {
    const { POST } = await import("@/app/api/upload/route");

    const response = await POST(
      uploadRequest(AUDIO, {
        "x-upload-content-type": "application/octet-stream",
      })
    );

    expect(response.status).toBe(201);
    const part = (await sentUpload()).get("file") as File;
    expect(part.type).toBe("audio/wav");
  });

  it("relies on the extension when the declared type header is absent", async () => {
    const { POST } = await import("@/app/api/upload/route");

    const response = await POST(
      uploadRequest(AUDIO, { "x-upload-content-type": undefined })
    );

    expect(response.status).toBe(201);
    const part = (await sentUpload()).get("file") as File;
    expect(part.type).toBe("audio/wav");
  });

  // What browsers and operating systems really report for these files.
  it.each([
    ["hearing.mp3", "audio/mp3", "audio/mp3"],
    ["hearing.wav", "audio/x-wav", "audio/x-wav"],
    ["hearing.wav", "audio/wave", "audio/wave"],
    ["hearing.mp4", "video/mp4", "video/mp4"],
    ["hearing.m4a", "audio/x-m4a", "audio/x-m4a"],
    ["hearing.ogg", "audio/ogg; codecs=opus", "audio/ogg"],
    ["hearing.flac", "audio/x-flac", "audio/x-flac"],
    ["hearing.wav", "Audio/WAV", "audio/wav"],
  ])("accepts %s declared as %s, forwarding %s", async (filename, declared, forwarded) => {
    const { POST } = await import("@/app/api/upload/route");

    const response = await POST(
      uploadRequest(AUDIO, {
        "x-upload-filename": filename,
        "x-upload-content-type": declared,
      })
    );

    expect(response.status).toBe(201);
    const part = (await sentUpload()).get("file") as File;
    expect(part.type).toBe(forwarded);
  });

  // Front Door's WAF lets a raw upload body through only with exactly this
  // Content-Type; anything else would be blocked there, so is refused here
  // too, and the browser's Content-Type is never taken as the file's type.
  describe("rejects any Content-Type but application/octet-stream with 415, without calling the API", () => {
    it.each([
      ["audio/mpeg", "audio/mpeg"],
      ["audio/wav", "audio/wav"],
      ["multipart/form-data", "multipart/form-data; boundary=----x"],
      ["text/plain", "text/plain"],
      ["with parameters", "application/octet-stream; charset=binary"],
      ["missing", undefined],
    ])("%s", async (_label, contentType) => {
      const { POST } = await import("@/app/api/upload/route");

      const response = await POST(
        uploadRequest(AUDIO, { "content-type": contentType })
      );

      expect(response.status).toBe(415);
      expect((await response.json()).error).toEqual(expect.any(String));
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("rejects a file type the API does not take with 400, without calling the API", () => {
    it.each([
      ["a disallowed extension", "hearing.exe", ""],
      ["a text file", "notes.txt", "text/plain"],
      ["no extension", "hearing", "audio/wav"],
      ["a dotfile name", ".wav", "audio/wav"],
      ["a disallowed declared type", "hearing.wav", "text/html"],
      ["a declared type of another audio format", "hearing.wav", "audio/mpeg"],
      ["an unsupported audio format", "hearing.aac", "audio/aac"],
      ["a malformed declared type", "hearing.wav", "audio/wav, text/html"],
    ])("%s", async (_label, filename, declared) => {
      const { POST } = await import("@/app/api/upload/route");

      const response = await POST(
        uploadRequest(AUDIO, {
          "x-upload-filename": filename,
          "x-upload-content-type": declared,
        })
      );

      expect(response.status).toBe(400);
      expect((await response.json()).error).toEqual(expect.any(String));
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("forwards a body over Next's 10 MB proxy limit intact", async () => {
    // The proxy, which would cut it off, does not run on this route
    // (tests/recording/unit/upload-body-limit.test.ts); this is the
    // handler's half: a large body reaches the API byte for byte.
    const big = new Uint8Array(12 * 1024 * 1024);
    for (let i = 0; i < big.length; i++) big[i] = i % 251;
    const { POST } = await import("@/app/api/upload/route");

    const response = await POST(uploadRequest(big));

    expect(response.status).toBe(201);
    const form = await sentUpload();
    const part = form.get("file") as File;
    expect(part.size).toBe(big.length);
    const sent = new Uint8Array(await part.arrayBuffer());
    expect(sent.every((b, i) => b === i % 251)).toBe(true);
  });

  it.each([
    ["not a number", "not-a-number"],
    ["partially numeric", "123abc"],
    ["negative", "-5"],
    ["zero", "0"],
    ["empty", ""],
  ])("omits a %s duration rather than rejecting the upload", async (_l, v) => {
    const { POST } = await import("@/app/api/upload/route");

    const response = await POST(
      uploadRequest(AUDIO, { "x-audio-duration-seconds": v })
    );

    expect(response.status).toBe(201);
    const sent = JSON.parse(jobsCall()?.[1].body as string);
    expect(sent).not.toHaveProperty("audio_duration_seconds");
  });

  it("sends no Authorization header without a session, ignoring forged Easy Auth headers", async () => {
    const { POST } = await import("@/app/api/upload/route");

    await POST(
      uploadRequest(AUDIO, {
        authorization: "Bearer attacker-token",
        "x-ms-token-aad-access-token": "attacker-token",
        "x-ms-client-principal": "base64principal",
      })
    );

    const headers = uploadsCall()?.[1].headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers.authorization).toBeUndefined();
  });

  describe("rejects bad metadata with 400 without calling the API", () => {
    it.each([
      ["missing filename", { "x-upload-filename": undefined }],
      ["blank filename", { "x-upload-filename": "%20%20" }],
      [
        "malformed percent-encoding",
        { "x-upload-filename": "bad%E0%A4%A.wav" },
      ],
      ["a path separator", { "x-upload-filename": "..%2Fetc%2Fpasswd.wav" }],
      ["a backslash", { "x-upload-filename": "C%3A%5Ca.wav" }],
      ["a control character", { "x-upload-filename": "a%0Ab.wav" }],
      [
        "an over-long filename",
        { "x-upload-filename": `${"a".repeat(252)}.wav` },
      ],
      ["missing size", { "x-upload-size": undefined }],
      ["non-integer size", { "x-upload-size": "12.5" }],
      ["non-numeric size", { "x-upload-size": "12abc" }],
    ])("%s", async (_label, headers) => {
      const { POST } = await import("@/app/api/upload/route");

      const response = await POST(uploadRequest(AUDIO, headers));

      expect(response.status).toBe(400);
      expect((await response.json()).error).toEqual(expect.any(String));
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("an empty body", async () => {
      const { POST } = await import("@/app/api/upload/route");

      const response = await POST(uploadRequest(new Uint8Array(0)));

      expect(response.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("rejects oversized or truncated bodies with 413", () => {
    it("a declared size over the limit, without calling the API", async () => {
      const { POST } = await import("@/app/api/upload/route");

      const response = await POST(
        uploadRequest(AUDIO, { "x-upload-size": String(MAX_UPLOAD_BYTES + 1) })
      );

      expect(response.status).toBe(413);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    // The body is streamed to the API as it arrives, so a size mismatch is
    // only found while it is being sent. The upload is then aborted (its
    // body stream errors, so fetch fails) and no job is submitted.
    it("a body longer than its declared size", async () => {
      const { POST } = await import("@/app/api/upload/route");

      const response = await POST(
        uploadRequest(AUDIO, { "x-upload-size": String(AUDIO.length - 1) })
      );

      expect(response.status).toBe(413);
      expect(sent.has(`${BACKEND}/api/v1/uploads`)).toBe(false);
      expect(jobsCall()).toBeUndefined();
    });

    it("a body shorter than its declared size (cut off on the way in)", async () => {
      // A truncated raw body would otherwise be stored as a silently
      // shortened recording.
      const { POST } = await import("@/app/api/upload/route");

      const response = await POST(
        uploadRequest(AUDIO, { "x-upload-size": String(AUDIO.length + 100) })
      );

      expect(response.status).toBe(413);
      expect(sent.has(`${BACKEND}/api/v1/uploads`)).toBe(false);
      expect(jobsCall()).toBeUndefined();
    });
  });

  describe("with login enabled (AUTH_ENABLED=true)", () => {
    // The proxy does not run on this route (proxy.ts), so the route gives
    // the 401 the proxy gives other /api/* requests without a session.
    it("answers 401 without a session, without calling the API", async () => {
      vi.stubEnv("AUTH_ENABLED", "true");
      const { POST } = await import("@/app/api/upload/route");

      const response = await POST(uploadRequest(AUDIO));

      expect(response.status).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("answers 401 for a session cookie with no session behind it", async () => {
      vi.stubEnv("AUTH_ENABLED", "true");
      const { POST } = await import("@/app/api/upload/route");

      const response = await POST(
        uploadRequest(AUDIO, { cookie: "transcribe_session=unknown" })
      );

      expect(response.status).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("uploads with a session", async () => {
      vi.stubEnv("AUTH_ENABLED", "true");
      await seedSession("sess-auth", "user-id-token");
      const { POST } = await import("@/app/api/upload/route");

      const response = await POST(
        uploadRequest(AUDIO, { cookie: "transcribe_session=sess-auth" })
      );

      expect(response.status).toBe(201);
      const headers = uploadsCall()?.[1].headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer user-id-token");
    });
  });

  describe("maps upstream failures to 502", () => {
    it("when the upload is rejected", async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(jsonResponse({ detail: "boom" }, 500))
      );
      const { POST } = await import("@/app/api/upload/route");

      const response = await POST(uploadRequest(AUDIO));

      expect(response.status).toBe(502);
      expect(jobsCall()).toBeUndefined();
    });

    it("when the job submission is rejected", async () => {
      fetchMock.mockImplementation((url: string) =>
        Promise.resolve(
          url === `${BACKEND}/api/v1/uploads`
            ? jsonResponse({ audio_url: "u", blob_name: "b" }, 201)
            : jsonResponse({ detail: "boom" }, 503)
        )
      );
      const { POST } = await import("@/app/api/upload/route");

      const response = await POST(uploadRequest(AUDIO));

      expect(response.status).toBe(502);
    });

    it("when the API is unreachable", async () => {
      fetchMock.mockRejectedValue(new TypeError("fetch failed"));
      const { POST } = await import("@/app/api/upload/route");

      const response = await POST(uploadRequest(AUDIO));

      expect(response.status).toBe(502);
    });
  });
});
