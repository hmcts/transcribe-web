import { describe, expect, it, vi } from "vitest";
import type { DictationSessionTelemetry } from "@/lib/dictation-session";
import { SUBMISSION_PATH, submitDictation } from "@/lib/dictation-submission";

const SESSION = "6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f";

function telemetry(sessionId: string | null = SESSION) {
  return {
    currentSessionId: vi.fn(() => sessionId),
    submissionFinished: vi.fn(),
    sessionEnded: vi.fn(),
  } as unknown as DictationSessionTelemetry & {
    submissionFinished: ReturnType<typeof vi.fn>;
    sessionEnded: ReturnType<typeof vi.fn>;
  };
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

const options = (t: DictationSessionTelemetry, fetchImpl: typeof fetch) => ({
  mode: "mic",
  telemetry: t,
  fetchImpl,
  getToken: async () => null,
});

describe("submitDictation (the speech demo's submission)", () => {
  it("sends the session ID, reports success and ends the session as submitted", async () => {
    const t = telemetry();
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { transcription_id: "x" }));
    await expect(
      submitDictation({ messages: [] }, options(t, fetchImpl))
    ).resolves.toEqual({ transcription_id: "x" });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(SUBMISSION_PATH);
    expect((init as RequestInit).headers).toMatchObject({
      "X-Dictation-Session-Id": SESSION,
    });
    expect(t.submissionFinished).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, mode: "mic" })
    );
    expect(t.sessionEnded).toHaveBeenCalledWith("submitted");
  });

  it("sends no session header without a session", async () => {
    const t = telemetry(null);
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    await submitDictation({}, options(t, fetchImpl));
    expect(
      (fetchImpl.mock.calls[0][1] as RequestInit).headers
    ).not.toHaveProperty("X-Dictation-Session-Id");
  });

  it.each([
    [
      "an HTTP error",
      () => Promise.resolve(jsonResponse(503, { detail: "down" })),
      { status: 503, errorCode: undefined },
    ],
    [
      "a network failure",
      () => Promise.reject(new TypeError("offline")),
      { status: undefined, errorCode: "network" },
    ],
    [
      "a 2xx that is not JSON",
      () => Promise.resolve(new Response("<html>", { status: 200 })),
      { status: undefined, errorCode: "submission.invalid_response" },
    ],
  ])("reports %s as a failed submission and does not end the session", async (_label, respond, expected) => {
    const t = telemetry();
    const fetchImpl = vi.fn(respond) as unknown as typeof fetch;
    await expect(submitDictation({}, options(t, fetchImpl))).rejects.toThrow();
    expect(t.submissionFinished).toHaveBeenCalledTimes(1);
    expect(t.submissionFinished).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, mode: "mic", ...expected })
    );
    expect(t.sessionEnded).not.toHaveBeenCalled();
  });
});
