import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetHearing, mockDeleteHearing, MockBackendApiError } = vi.hoisted(
  () => {
    class MockBackendApiError extends Error {
      status: number;
      code?: string;
      constructor(message: string, status: number, code?: string) {
        super(message);
        this.name = "BackendApiError";
        this.status = status;
        this.code = code;
      }
    }
    return {
      mockGetHearing: vi.fn(),
      mockDeleteHearing: vi.fn(),
      MockBackendApiError,
    };
  }
);

vi.mock("@/lib/recording/api-client", () => ({
  getHearing: mockGetHearing,
  deleteHearing: mockDeleteHearing,
  BackendApiError: MockBackendApiError,
}));

const context = { params: Promise.resolve({ hearingId: "h-1" }) };

function request(method = "GET") {
  return new NextRequest("http://localhost/api/hearings/h-1", { method });
}

beforeEach(() => {
  mockGetHearing.mockReset();
  mockDeleteHearing.mockReset();
});

describe("GET /api/hearings/[hearingId]", () => {
  it("answers the hearing", async () => {
    mockGetHearing.mockResolvedValue({ id: "h-1", days: [] });
    const { GET } = await import("@/app/api/hearings/[hearingId]/route");

    const response = await GET(request(), context);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ hearing: { id: "h-1", days: [] } });
    expect(mockGetHearing).toHaveBeenCalledWith("h-1", { bearerToken: null });
  });

  it("answers 404 for a hearing that is not there", async () => {
    mockGetHearing.mockResolvedValue(null);
    const { GET } = await import("@/app/api/hearings/[hearingId]/route");

    expect((await GET(request(), context)).status).toBe(404);
  });

  it("passes on a refusal about the user", async () => {
    mockGetHearing.mockRejectedValue(
      new MockBackendApiError("stale", 409, "context_changed")
    );
    const { GET } = await import("@/app/api/hearings/[hearingId]/route");

    const response = await GET(request(), context);

    expect(response.status).toBe(409);
    expect((await response.json()).detail.code).toBe("context_changed");
  });

  it("answers 502 for any other failure", async () => {
    mockGetHearing.mockRejectedValue(new Error("boom"));
    const { GET } = await import("@/app/api/hearings/[hearingId]/route");

    expect((await GET(request(), context)).status).toBe(502);
  });
});

describe("DELETE /api/hearings/[hearingId]", () => {
  it("answers 204 once the hearing is deleted", async () => {
    mockDeleteHearing.mockResolvedValue(undefined);
    const { DELETE } = await import("@/app/api/hearings/[hearingId]/route");

    const response = await DELETE(request("DELETE"), context);

    expect(response.status).toBe(204);
    expect(mockDeleteHearing).toHaveBeenCalledWith("h-1", {
      bearerToken: null,
    });
  });

  it("answers 404 for a hearing that is not there", async () => {
    mockDeleteHearing.mockRejectedValue(new MockBackendApiError("nope", 404));
    const { DELETE } = await import("@/app/api/hearings/[hearingId]/route");

    expect((await DELETE(request("DELETE"), context)).status).toBe(404);
  });

  it("answers 502, to try again, when a day had to be kept", async () => {
    mockDeleteHearing.mockRejectedValue(new MockBackendApiError("kept", 502));
    const { DELETE } = await import("@/app/api/hearings/[hearingId]/route");

    const response = await DELETE(request("DELETE"), context);

    expect(response.status).toBe(502);
    expect((await response.json()).error).toMatch(/try again/i);
  });
});
