import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockListHearings } = vi.hoisted(() => ({ mockListHearings: vi.fn() }));

vi.mock("@/lib/recording/api-client", () => ({
  listHearings: mockListHearings,
}));

beforeEach(() => {
  mockListHearings.mockReset();
});

describe("GET /api/hearings", () => {
  it("lists the user's hearings", async () => {
    const result = { hearings: [{ id: "h1" }], total: 1, limit: 20, offset: 0 };
    mockListHearings.mockResolvedValue(result);
    const { GET } = await import("@/app/api/hearings/route");

    const response = await GET(
      new NextRequest("http://localhost/api/hearings")
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(mockListHearings).toHaveBeenCalledWith(undefined, {
      bearerToken: null,
    });
  });

  it("answers 502 when the API fails", async () => {
    mockListHearings.mockRejectedValue(new Error("boom"));
    const { GET } = await import("@/app/api/hearings/route");

    const response = await GET(
      new NextRequest("http://localhost/api/hearings")
    );

    expect(response.status).toBe(502);
  });
});
