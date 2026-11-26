import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSetHearingDate, MockBackendApiError } = vi.hoisted(() => {
  class MockBackendApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = "BackendApiError";
      this.status = status;
    }
  }
  return { mockSetHearingDate: vi.fn(), MockBackendApiError };
});

vi.mock("@/lib/recording/api-client", () => ({
  setHearingDate: mockSetHearingDate,
  BackendApiError: MockBackendApiError,
}));

const context = { params: Promise.resolve({ jobId: "job-1" }) };

function patch(body: unknown) {
  return new NextRequest("http://localhost/api/jobs/job-1/hearing-date", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockSetHearingDate.mockReset();
});

describe("PATCH /api/jobs/[jobId]/hearing-date", () => {
  it("changes the day's date and answers the hearing", async () => {
    mockSetHearingDate.mockResolvedValue({ id: "h-1" });
    const { PATCH } = await import("@/app/api/jobs/[jobId]/hearing-date/route");

    const response = await PATCH(patch({ hearingDate: "2026-11-09" }), context);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ hearing: { id: "h-1" } });
    expect(mockSetHearingDate).toHaveBeenCalledWith("job-1", "2026-11-09", {
      bearerToken: null,
    });
  });

  it.each([
    [{}],
    [{ hearingDate: "9/11/2026" }],
    [{ hearingDate: "2026-02-30" }],
  ])("refuses %j without calling the API", async (body) => {
    const { PATCH } = await import("@/app/api/jobs/[jobId]/hearing-date/route");

    expect((await PATCH(patch(body), context)).status).toBe(400);
    expect(mockSetHearingDate).not.toHaveBeenCalled();
  });

  it.each([
    [404, 404],
    [403, 403],
    [500, 502],
  ])("answers the API's %i as %i", async (apiStatus, status) => {
    mockSetHearingDate.mockRejectedValue(
      new MockBackendApiError("x", apiStatus)
    );
    const { PATCH } = await import("@/app/api/jobs/[jobId]/hearing-date/route");

    expect(
      (await PATCH(patch({ hearingDate: "2026-11-09" }), context)).status
    ).toBe(status);
  });
});
