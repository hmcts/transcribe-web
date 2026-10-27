import { beforeEach, describe, expect, it, vi } from "vitest";
import { getLiveDraft, putLiveDraft } from "@/lib/live-draft-api";
import { LiveDraftError } from "@/lib/live-draft-errors";

vi.mock("@/lib/auth-utils", () => ({
  getAuthToken: vi.fn().mockResolvedValue("token-123"),
}));

const mockFetch = vi.fn();

const TRANSCRIPT = { background: [], evidence: [], facts: [] };

beforeEach(() => {
  mockFetch.mockReset();
  global.fetch = mockFetch;
});

describe("getLiveDraft", () => {
  it("returns null for a 404, which genuinely means no draft exists", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 });
    await expect(getLiveDraft()).resolves.toBeNull();
  });

  it("throws an auth failure for a 401 rather than reporting no draft", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401 });
    await expect(getLiveDraft()).rejects.toMatchObject({
      name: "LiveDraftError",
      kind: "auth",
      status: 401,
    });
  });

  it("throws a server failure for a 500", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    await expect(getLiveDraft()).rejects.toMatchObject({ kind: "server" });
  });

  it("throws a network failure when fetch rejects before a response exists", async () => {
    mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(getLiveDraft()).rejects.toMatchObject({
      name: "LiveDraftError",
      kind: "network",
    });
  });

  it("returns the draft body on success", async () => {
    const body = { transcript: TRANSCRIPT, form_data: {}, saved_at: "x" };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(body),
    });
    await expect(getLiveDraft()).resolves.toEqual(body);
  });
});

describe("putLiveDraft", () => {
  it("resolves on a 204", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 204 });
    await expect(putLiveDraft(TRANSCRIPT, {})).resolves.toBeUndefined();
  });

  it("throws an auth failure for a 401", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401 });
    await expect(putLiveDraft(TRANSCRIPT, {})).rejects.toMatchObject({
      kind: "auth",
      status: 401,
    });
  });

  it("throws a network failure when fetch rejects", async () => {
    mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    const error = await putLiveDraft(TRANSCRIPT, {}).catch((e) => e);
    expect(error).toBeInstanceOf(LiveDraftError);
    expect(error.kind).toBe("network");
  });

  it("keeps the original rejection as the cause so it is still debuggable", async () => {
    const underlying = new TypeError("Failed to fetch");
    mockFetch.mockRejectedValue(underlying);
    const error = await putLiveDraft(TRANSCRIPT, {}).catch((e) => e);
    expect(error.cause).toBe(underlying);
  });

  describe("deadline (PR #14 review)", () => {
    /** A fetch that never answers until its signal aborts, like a stalled connection. */
    function stallingFetch() {
      mockFetch.mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError"))
            );
          })
      );
    }

    it("abandons a stalled save as a network failure after the deadline", async () => {
      vi.useFakeTimers();
      try {
        stallingFetch();
        const result = putLiveDraft(TRANSCRIPT, {}, 1_000).catch((e) => e);
        await vi.advanceTimersByTimeAsync(1_000);
        const error = await result;
        expect(error).toBeInstanceOf(LiveDraftError);
        expect(error.kind).toBe("network");
        expect(error.message).toMatch(/no response in time/);
        expect(mockFetch.mock.calls[0][1].signal.aborted).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it("also ends when the token lookup stalls", async () => {
      vi.useFakeTimers();
      try {
        const { getAuthToken } = await import("@/lib/auth-utils");
        vi.mocked(getAuthToken).mockReturnValueOnce(
          new Promise<never>(() => undefined)
        );
        const result = putLiveDraft(TRANSCRIPT, {}, 1_000).catch((e) => e);
        await vi.advanceTimersByTimeAsync(1_000);
        expect((await result).kind).toBe("network");
        expect(mockFetch).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
