import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// DIAAT-395: the browser reads a recording's audit history through this route;
// the API decides who may (recording.audit.read, the owner only).

const { mockGetJobHistory, MockBackendApiError } = vi.hoisted(() => {
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
  return { mockGetJobHistory: vi.fn(), MockBackendApiError };
});

vi.mock("@/lib/recording/api-client", () => ({
  getJobHistory: mockGetJobHistory,
  BackendApiError: MockBackendApiError,
}));

const context = { params: Promise.resolve({ jobId: "job-1" }) };
const get = (query = "", headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost/api/jobs/job-1/history${query}`, { headers });

beforeEach(() => {
  mockGetJobHistory.mockReset();
});

describe("GET /api/jobs/[jobId]/history", () => {
  it("passes the page on and returns the API's items as they came", async () => {
    const page = {
      items: [
        { id: "h-1", timestamp: "2026-11-05T10:00:00Z", action: "transcript.view", actor_label: "A Judge", actor_role: "Judge", outcome: "success" },
      ],
      total: 1,
    };
    mockGetJobHistory.mockResolvedValue(page);
    const { GET } = await import("@/app/api/jobs/[jobId]/history/route");

    const response = await GET(get("?page=2&page_size=20", { "X-Jurisdiction": "ET", "X-Role": "Judge" }), context);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(page);
    expect(mockGetJobHistory).toHaveBeenCalledWith(
      "job-1",
      { page: 2, pageSize: 20 },
      { bearerToken: null, jurisdiction: "ET", role: "Judge" }
    );
  });

  it("ignores a page that is not a positive whole number", async () => {
    mockGetJobHistory.mockResolvedValue({ items: [], total: 0 });
    const { GET } = await import("@/app/api/jobs/[jobId]/history/route");

    await GET(get("?page=-1&page_size=abc"), context);

    expect(mockGetJobHistory).toHaveBeenCalledWith("job-1", { page: undefined, pageSize: undefined }, expect.anything());
  });

  it.each([403, 404])("answers a backend %s as for a recording that is not there", async (status) => {
    mockGetJobHistory.mockRejectedValue(new MockBackendApiError("no", status));
    const { GET } = await import("@/app/api/jobs/[jobId]/history/route");

    const response = await GET(get(), context);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Job not found" });
  });

  it.each([
    [409, "context_changed"],
    [403, "context_required"],
    [403, "user_deactivated"],
  ])(
    "passes a %s %s refusal on with its status and code, so the stale-tab or account notice can show",
    async (status, code) => {
      mockGetJobHistory.mockRejectedValue(new MockBackendApiError("refused", status, code));
      const { GET } = await import("@/app/api/jobs/[jobId]/history/route");

      const response = await GET(get(), context);

      expect(response.status).toBe(status);
      expect((await response.json()).detail.code).toBe(code);
    }
  );

  it("still answers a recording-specific 403 (not the owner) as not found", async () => {
    mockGetJobHistory.mockRejectedValue(new MockBackendApiError("no", 403, "permission_denied"));
    const { GET } = await import("@/app/api/jobs/[jobId]/history/route");

    const response = await GET(get(), context);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Job not found" });
  });

  it("answers 502 when the API fails", async () => {
    mockGetJobHistory.mockRejectedValue(new Error("backend down"));
    const { GET } = await import("@/app/api/jobs/[jobId]/history/route");

    expect((await GET(get(), context)).status).toBe(502);
  });
});
