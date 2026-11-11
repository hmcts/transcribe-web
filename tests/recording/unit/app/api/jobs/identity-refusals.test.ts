import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// DIAAT-373: after another tab switches context, or the account is deactivated, the API refuses with
// 409 `context_changed` or 403 `user_deactivated` / `context_required`. The browser's refusal watcher
// needs that status and code to show the stale-tab or account notice, so the recording route handlers
// pass such a refusal on as it came, and not as a 502 or a bare {error}. Any other refusal is unchanged.

const mocks = vi.hoisted(() => {
  class MockBackendApiError extends Error {
    constructor(
      message: string,
      public status: number,
      public requestId?: string,
      public code?: string
    ) {
      super(message);
      this.name = "BackendApiError";
    }
  }
  return {
    getJob: vi.fn(),
    deleteJob: vi.fn(),
    listJobs: vi.fn(),
    correctSegment: vi.fn(),
    MockBackendApiError,
  };
});

vi.mock("@/lib/recording/api-client", () => ({
  getJob: mocks.getJob,
  deleteJob: mocks.deleteJob,
  listJobs: mocks.listJobs,
  correctSegment: mocks.correctSegment,
  BackendApiError: mocks.MockBackendApiError,
}));

const SEGMENT_ID = `seg_${"a".repeat(32)}`;
const request = (method = "GET", body?: unknown) =>
  new NextRequest("http://localhost/api/jobs/job-1", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
const jobContext = { params: Promise.resolve({ jobId: "job-1" }) };
const segmentContext = {
  params: Promise.resolve({ jobId: "job-1", index: SEGMENT_ID }),
};

const handlers: [string, () => Promise<Response>, ReturnType<typeof vi.fn>][] = [
  [
    "GET /api/jobs/[jobId]",
    async () => (await import("@/app/api/jobs/[jobId]/route")).GET(request(), jobContext),
    mocks.getJob,
  ],
  [
    "DELETE /api/jobs/[jobId]",
    async () => (await import("@/app/api/jobs/[jobId]/route")).DELETE(request("DELETE"), jobContext),
    mocks.deleteJob,
  ],
  [
    "GET /api/jobs",
    async () => (await import("@/app/api/jobs/route")).GET(request()),
    mocks.listJobs,
  ],
  [
    "PATCH /api/jobs/[jobId]/segments/[index]",
    async () =>
      (await import("@/app/api/jobs/[jobId]/segments/[index]/route")).PATCH(
        request("PATCH", { correctedText: "x" }),
        segmentContext
      ),
    mocks.correctSegment,
  ],
];

beforeEach(() => {
  for (const [, , mock] of handlers) mock.mockReset();
});

describe.each(handlers)("%s", (_name, call, mock) => {
  it.each([
    [409, "context_changed"],
    [403, "context_required"],
    [403, "user_deactivated"],
  ])("passes a %s %s refusal on with its status and code", async (status, code) => {
    mock.mockRejectedValue(new mocks.MockBackendApiError("refused", status, undefined, code));

    const response = await call();

    expect(response.status).toBe(status);
    expect((await response.json()).detail.code).toBe(code);
  });

  it("passes a 401 on as a 401", async () => {
    mock.mockRejectedValue(new mocks.MockBackendApiError("no token", 401));
    expect((await call()).status).toBe(401);
  });

  it("does not turn an ordinary backend failure into an identity refusal", async () => {
    mock.mockRejectedValue(new Error("backend down"));
    const response = await call();
    expect(response.status).toBe(502);
    expect((await response.json()).detail).toBeUndefined();
  });
});
