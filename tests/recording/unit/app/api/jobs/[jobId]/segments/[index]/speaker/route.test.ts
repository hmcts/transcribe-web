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
  return new NextRequest(`http://localhost/api/jobs/job-1/segments/${SEGMENT_ID}/speaker`, {
    method: "PATCH",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const SEGMENT_ID = "seg_00000000000000000000000000000002";

const context = (index = SEGMENT_ID) => ({
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
      SEGMENT_ID,
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

  it.each([
    ["malformed JSON", "{not json"],
    ["an empty body", ""],
    ["a JSON null body", "null"],
    ["a number body", "42"],
    ["a string body", '"Judge Smith"'],
    ["an array body", "[]"],
  ])(
    "rejects %s with 422, not 502, without calling the backend",
    async (_name, raw) => {
      const { PATCH } = await import(
        "@/app/api/jobs/[jobId]/segments/[index]/speaker/route"
      );

      const response = await PATCH(makeRequest(raw), context());

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: "speaker is required" });
      expect(mockRenameSpeaker).not.toHaveBeenCalled();
    }
  );

  it.each(["2", "-1", "seg_xyz"])("rejects segment %s, which is not an id, with 422", async (segment) => {
    const { PATCH } = await import(
      "@/app/api/jobs/[jobId]/segments/[index]/speaker/route"
    );

    const response = await PATCH(
      makeRequest({ speaker: "Judge Smith" }),
      context(segment)
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
