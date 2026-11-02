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
