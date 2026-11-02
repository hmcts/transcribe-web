import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRenameSpeaker, MockBackendApiError } = vi.hoisted(() => {
  class MockBackendApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = "BackendApiError";
      this.status = status;
    }
  }
  return { mockRenameSpeaker: vi.fn(), MockBackendApiError };
});

vi.mock("@/lib/recording/api-client", () => ({
  renameSpeaker: mockRenameSpeaker,
  BackendApiError: MockBackendApiError,
}));

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/jobs/job-1/segments/2/speaker", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

const context = (index = "2") => ({
  params: Promise.resolve({ jobId: "job-1", index }),
});

describe("PATCH /api/jobs/[jobId]/segments/[index]/speaker", () => {
  beforeEach(() => {
    mockRenameSpeaker.mockReset();
  });

  it("forwards the new name and scope, and returns the updated job", async () => {
    mockRenameSpeaker.mockResolvedValue({ id: "job-1" });
    const { PATCH } = await import(
      "@/app/api/jobs/[jobId]/segments/[index]/speaker/route"
    );

    const response = await PATCH(
      makeRequest({ speaker: "Judge Smith", applyToAll: true }),
      context()
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ job: { id: "job-1" } });
    expect(mockRenameSpeaker).toHaveBeenCalledWith(
      "job-1",
      2,
      "Judge Smith",
      true,
      { bearerToken: null }
    );
  });

  it("treats a missing applyToAll as replace one", async () => {
    mockRenameSpeaker.mockResolvedValue({ id: "job-1" });
    const { PATCH } = await import(
      "@/app/api/jobs/[jobId]/segments/[index]/speaker/route"
    );

    await PATCH(makeRequest({ speaker: "Judge Smith" }), context());

    expect(mockRenameSpeaker.mock.calls[0][3]).toBe(false);
  });

  it.each([
    { speaker: "  " },
    { speaker: 3 },
    {},
  ])("rejects an invalid name %j with 422", async (body) => {
    const { PATCH } = await import(
      "@/app/api/jobs/[jobId]/segments/[index]/speaker/route"
    );

    const response = await PATCH(makeRequest(body), context());

    expect(response.status).toBe(422);
    expect(mockRenameSpeaker).not.toHaveBeenCalled();
  });

  it("rejects an invalid segment index with 422", async () => {
    const { PATCH } = await import(
      "@/app/api/jobs/[jobId]/segments/[index]/speaker/route"
    );

    const response = await PATCH(
      makeRequest({ speaker: "Judge Smith" }),
      context("-1")
    );

    expect(response.status).toBe(422);
  });

  it("passes a backend error status through", async () => {
    mockRenameSpeaker.mockRejectedValue(new MockBackendApiError("nope", 404));
    const { PATCH } = await import(
      "@/app/api/jobs/[jobId]/segments/[index]/speaker/route"
    );

    const response = await PATCH(
      makeRequest({ speaker: "Judge Smith" }),
      context()
    );

    expect(response.status).toBe(404);
  });

  it("maps any other failure to 502", async () => {
    mockRenameSpeaker.mockRejectedValue(new Error("boom"));
    const { PATCH } = await import(
      "@/app/api/jobs/[jobId]/segments/[index]/speaker/route"
    );

    const response = await PATCH(
      makeRequest({ speaker: "Judge Smith" }),
      context()
    );

    expect(response.status).toBe(502);
  });
});
