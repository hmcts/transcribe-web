import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// DIAAT-334: an <audio> source cannot send the tab's jurisdiction as a header, so
// the audio route alone also takes it from the URL; a header wins.

const { mockGetJobAudio } = vi.hoisted(() => ({ mockGetJobAudio: vi.fn() }));

vi.mock("@/lib/recording/api-client", () => ({ getJobAudio: mockGetJobAudio }));

async function get(url: string, headers: Record<string, string> = {}) {
  const { GET } = await import("@/app/api/audio/[jobId]/route");
  return GET(new NextRequest(url, { headers }), {
    params: Promise.resolve({ jobId: "j1" }),
  });
}

describe("GET /api/audio/[jobId] (DIAAT-334)", () => {
  beforeEach(() => {
    mockGetJobAudio.mockReset().mockResolvedValue(
      new Response("audio", { status: 200, headers: { "Content-Type": "audio/wav" } })
    );
  });

  it("asks for the audio in the jurisdiction its URL names", async () => {
    await get("http://localhost/api/audio/j1?jurisdiction=IAC");
    expect(mockGetJobAudio.mock.calls[0][2].jurisdiction).toBe("IAC");
  });

  it("prefers the tab's header", async () => {
    await get("http://localhost/api/audio/j1?jurisdiction=SSCS", { "X-Jurisdiction": "IAC" });
    expect(mockGetJobAudio.mock.calls[0][2].jurisdiction).toBe("IAC");
  });

  it("names none when neither does", async () => {
    await get("http://localhost/api/audio/j1");
    expect(mockGetJobAudio.mock.calls[0][2].jurisdiction).toBeUndefined();
  });
});
