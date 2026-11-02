import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const { mockMergeSegmentWithNext, MockBackendApiError } = vi.hoisted(() => {
  class MockBackendApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = "BackendApiError";
      this.status = status;
    }
  }
  return { mockMergeSegmentWithNext: vi.fn(), MockBackendApiError };
});

vi.mock("@/lib/recording/api-client", () => ({
  mergeSegmentWithNext: mockMergeSegmentWithNext,
  BackendApiError: MockBackendApiError,
}));

function makeRequest() {
  return new NextRequest(
    "http://localhost/api/jobs/job-1/segments/2/merge-next",
    { method: "POST" }
  );
}

const context = (index: string) => ({
  params: Promise.resolve({ jobId: "job-1", index }),
});

describe("POST /api/jobs/[jobId]/segments/[index]/merge-next", () => {
  it("returns the updated job and forwards jobId, index and auth", async () => {
    mockMergeSegmentWithNext.mockResolvedValue({ id: "job-1" });
    const { POST } = await import(
      "@/app/api/jobs/[jobId]/segments/[index]/merge-next/route"
    );

    const response = await POST(makeRequest(), context("2"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ job: { id: "job-1" } });
    expect(mockMergeSegmentWithNext).toHaveBeenCalledWith("job-1", 2, {
      bearerToken: null,
    });
  });

  it("rejects a non-integer index with 422", async () => {
    mockMergeSegmentWithNext.mockClear();
    const { POST } = await import(
      "@/app/api/jobs/[jobId]/segments/[index]/merge-next/route"
    );

    const response = await POST(makeRequest(), context("abc"));

    expect(response.status).toBe(422);
    expect(mockMergeSegmentWithNext).not.toHaveBeenCalled();
  });

  it("passes a backend error status through", async () => {
    mockMergeSegmentWithNext.mockRejectedValue(
      new MockBackendApiError("no next segment", 422)
    );
    const { POST } = await import(
      "@/app/api/jobs/[jobId]/segments/[index]/merge-next/route"
    );

    const response = await POST(makeRequest(), context("2"));

    expect(response.status).toBe(422);
  });

  it("maps any other error to 502", async () => {
    mockMergeSegmentWithNext.mockRejectedValue(new Error("boom"));
    const { POST } = await import(
      "@/app/api/jobs/[jobId]/segments/[index]/merge-next/route"
    );

    const response = await POST(makeRequest(), context("2"));

    expect(response.status).toBe(502);
  });
});
