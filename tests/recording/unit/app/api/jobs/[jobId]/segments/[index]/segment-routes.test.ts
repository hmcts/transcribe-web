import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockBackendApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return {
    correctSegment: vi.fn(),
    correctWordRange: vi.fn(),
    acceptSegment: vi.fn(),
    rollbackSegment: vi.fn(),
    rollbackToHistoryEntry: vi.fn(),
    MockBackendApiError,
  };
});

vi.mock("@/lib/recording/api-client", () => ({
  correctSegment: mocks.correctSegment,
  correctWordRange: mocks.correctWordRange,
  acceptSegment: mocks.acceptSegment,
  rollbackSegment: mocks.rollbackSegment,
  rollbackToHistoryEntry: mocks.rollbackToHistoryEntry,
  BackendApiError: mocks.MockBackendApiError,
}));

const SEGMENT_ID = `seg_${"a".repeat(32)}`;
const AUTH = { bearerToken: null };

type Handler = (
  request: NextRequest,
  context: { params: Promise<Record<string, string>> }
) => Promise<Response>;

const cases: {
  name: string;
  load: () => Promise<Handler>;
  mock: ReturnType<typeof vi.fn>;
  body?: unknown;
  params?: Record<string, string>;
  expectedArgs: unknown[];
}[] = [
  {
    name: "PATCH segment text",
    load: async () =>
      (await import("@/app/api/jobs/[jobId]/segments/[index]/route"))
        .PATCH as unknown as Handler,
    mock: mocks.correctSegment,
    body: { correctedText: "Good evening." },
    expectedArgs: ["job-1", SEGMENT_ID, "Good evening.", AUTH],
  },
  {
    name: "PATCH segment words",
    load: async () =>
      (await import("@/app/api/jobs/[jobId]/segments/[index]/words/route"))
        .PATCH as unknown as Handler,
    mock: mocks.correctWordRange,
    body: { startWordIndex: 0, endWordIndex: 1, correctedText: "Good" },
    expectedArgs: ["job-1", SEGMENT_ID, 0, 1, "Good", AUTH],
  },
  {
    name: "POST accept",
    load: async () =>
      (await import("@/app/api/jobs/[jobId]/segments/[index]/accept/route"))
        .POST as unknown as Handler,
    mock: mocks.acceptSegment,
    expectedArgs: ["job-1", SEGMENT_ID, AUTH],
  },
  {
    name: "POST rollback",
    load: async () =>
      (await import("@/app/api/jobs/[jobId]/segments/[index]/rollback/route"))
        .POST as unknown as Handler,
    mock: mocks.rollbackSegment,
    expectedArgs: ["job-1", SEGMENT_ID, AUTH],
  },
  {
    name: "POST history rollback",
    load: async () =>
      (
        await import(
          "@/app/api/jobs/[jobId]/segments/[index]/history/[historyIndex]/rollback/route"
        )
      ).POST as unknown as Handler,
    mock: mocks.rollbackToHistoryEntry,
    params: { historyIndex: "1" },
    expectedArgs: ["job-1", SEGMENT_ID, 1, AUTH],
  },
];

function request(body?: unknown) {
  return new NextRequest(`http://localhost/api/jobs/job-1/segments/x`, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const context = (index: string, extra: Record<string, string> = {}) => ({
  params: Promise.resolve({ jobId: "job-1", index, ...extra }),
});

describe.each(cases)("$name", ({ load, mock, body, params, expectedArgs }) => {
  beforeEach(() => mock.mockReset());

  it("forwards the segment id and returns the updated job", async () => {
    mock.mockResolvedValue({ id: "job-1" });
    const handler = await load();

    const response = await handler(request(body), context(SEGMENT_ID, params));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ job: { id: "job-1" } });
    expect(mock).toHaveBeenCalledWith(...expectedArgs);
  });

  it.each(["0", "-1", "seg_xyz"])(
    "rejects %s, which is not a segment id, with 422",
    async (segment) => {
      const handler = await load();
      const response = await handler(request(body), context(segment, params));
      expect(response.status).toBe(422);
      expect(mock).not.toHaveBeenCalled();
    }
  );

});

describe.each([
  {
    name: "PATCH segment text",
    load: cases[0].load,
    mock: mocks.correctSegment,
    error: "correctedText is required",
    valid: { correctedText: "Good evening." },
  },
  {
    name: "PATCH segment words",
    load: cases[1].load,
    mock: mocks.correctWordRange,
    error: "startWordIndex, endWordIndex and correctedText are required",
    valid: { startWordIndex: 0, endWordIndex: 1, correctedText: "Good" },
  },
])("$name request body handling", ({ load, mock, error, valid }) => {
  beforeEach(() => {
    mock.mockReset();
  });

  const rawRequest = (raw: string) =>
    new NextRequest("http://localhost/api/jobs/job-1/segments/x", {
      method: "PATCH",
      body: raw,
    });

  it.each([
    ["malformed JSON", "{not json"],
    ["an empty body", ""],
    ["a JSON null body", "null"],
    ["a number body", "42"],
    ["a string body", '"text"'],
    ["an array body", "[]"],
  ])("rejects %s with 422, not 502, without calling the backend", async (_n, raw) => {
    const handler = await load();

    const response = await handler(rawRequest(raw), context(SEGMENT_ID));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error });
    expect(mock).not.toHaveBeenCalled();
  });

  it("still proxies a valid body", async () => {
    mock.mockResolvedValue({ id: "job-1" });
    const handler = await load();

    const response = await handler(
      rawRequest(JSON.stringify(valid)),
      context(SEGMENT_ID)
    );

    expect(response.status).toBe(200);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("passes a backend error status through", async () => {
    mock.mockRejectedValue(new mocks.MockBackendApiError("nope", 404));
    const handler = await load();
    const response = await handler(
      rawRequest(JSON.stringify(valid)),
      context(SEGMENT_ID)
    );

    expect(response.status).toBe(404);
  });

  it("maps an upstream failure to 502", async () => {
    mock.mockRejectedValue(new Error("boom"));
    const handler = await load();

    const response = await handler(
      rawRequest(JSON.stringify(valid)),
      context(SEGMENT_ID)
    );

    expect(response.status).toBe(502);
  });
});
