import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockListJobs } = vi.hoisted(() => ({ mockListJobs: vi.fn() }));

vi.mock("@/lib/recording/api-client", () => ({
  listJobs: mockListJobs,
}));

async function seedSession(id: string, idToken: string) {
  const { writeSession } = await import("@/lib/auth/session-store");
  await writeSession(id, {
    idToken,
    idTokenExpiresAt: Date.now() + 60 * 60 * 1000,
    user: {
      oid: "oid-1",
      name: "Judge",
      email: "judge@justice.gov.uk",
      roles: [],
    },
    createdAt: Date.now(),
  });
}

function makeRequest(url = "http://localhost/api/jobs") {
  return new NextRequest(url);
}

describe("GET /api/jobs", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  it("returns jobs from the backend", async () => {
    mockListJobs.mockResolvedValue({
      jobs: [{ id: "job-1" }],
      total: 1,
      limit: 20,
      offset: 0,
    });
    const { GET } = await import("@/app/api/jobs/route");

    const response = await GET(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.jobs).toEqual([{ id: "job-1" }]);
    expect(body.total).toBe(1);
  });

  it("returns a 502 when the backend call fails", async () => {
    mockListJobs.mockRejectedValue(new Error("backend down"));
    const { GET } = await import("@/app/api/jobs/route");

    const response = await GET(makeRequest());

    expect(response.status).toBe(502);
  });

  it("sends the session's token to listJobs", async () => {
    await seedSession("sess-1", "user-id-token");
    mockListJobs.mockResolvedValue({
      jobs: [],
      total: 0,
      limit: 20,
      offset: 0,
    });
    const { GET } = await import("@/app/api/jobs/route");

    await GET(
      new NextRequest("http://localhost/api/jobs", {
        headers: { cookie: "transcribe_session=sess-1" },
      })
    );

    expect(mockListJobs).toHaveBeenCalledWith(undefined, {
      bearerToken: "user-id-token",
    });
  });

  it("passes no token without a session, even with forged Easy Auth headers", async () => {
    mockListJobs.mockResolvedValue({
      jobs: [],
      total: 0,
      limit: 20,
      offset: 0,
    });
    const { GET } = await import("@/app/api/jobs/route");

    await GET(
      new NextRequest("http://localhost/api/jobs", {
        headers: {
          "x-ms-token-aad-access-token": "attacker-token",
          "x-ms-client-principal": "base64principal",
        },
      })
    );

    expect(mockListJobs).toHaveBeenCalledWith(undefined, { bearerToken: null });
  });
});
