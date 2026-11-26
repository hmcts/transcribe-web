import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetHearingHistory, MockBackendApiError } = vi.hoisted(() => {
  class MockBackendApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = "BackendApiError";
      this.status = status;
    }
  }
  return { mockGetHearingHistory: vi.fn(), MockBackendApiError };
});

vi.mock("@/lib/recording/api-client", () => ({
  getHearingHistory: mockGetHearingHistory,
  BackendApiError: MockBackendApiError,
}));

const context = { params: Promise.resolve({ hearingId: "h-1" }) };

beforeEach(() => {
  mockGetHearingHistory.mockReset();
});

describe("GET /api/hearings/[hearingId]/history", () => {
  it("passes the page on", async () => {
    mockGetHearingHistory.mockResolvedValue({ items: [], total: 0 });
    const { GET } = await import(
      "@/app/api/hearings/[hearingId]/history/route"
    );

    const response = await GET(
      new NextRequest(
        "http://localhost/api/hearings/h-1/history?page=2&page_size=20"
      ),
      context
    );

    expect(response.status).toBe(200);
    expect(mockGetHearingHistory).toHaveBeenCalledWith(
      "h-1",
      { page: 2, pageSize: 20 },
      { bearerToken: null }
    );
  });

  it.each([
    403, 404,
  ])("answers a %i as a hearing that is not there", async (status) => {
    mockGetHearingHistory.mockRejectedValue(
      new MockBackendApiError("x", status)
    );
    const { GET } = await import(
      "@/app/api/hearings/[hearingId]/history/route"
    );

    const response = await GET(
      new NextRequest("http://localhost/api/hearings/h-1/history"),
      context
    );

    expect(response.status).toBe(404);
  });
});
