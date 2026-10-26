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
});
