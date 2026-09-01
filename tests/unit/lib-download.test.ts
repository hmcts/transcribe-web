import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth-utils", () => ({
  getAuthToken: vi.fn(),
}));

import { getAuthToken } from "@/lib/auth-utils";
import { downloadTranscriptDocument } from "@/lib/download";

const mockFetch = vi.fn();

function makeResponse(
  overrides: Partial<{
    ok: boolean;
    status: number;
    statusText: string;
    blob: Blob;
    contentDisposition: string | null;
  }> = {}
) {
  const blob =
    overrides.blob ??
    new Blob(["file-content"], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
  return {
    ok: overrides.ok ?? true,
    status: overrides.status ?? 200,
    statusText: overrides.statusText ?? "OK",
    blob: vi.fn().mockResolvedValue(blob),
    headers: {
      get: vi.fn().mockReturnValue(overrides.contentDisposition ?? null),
    },
  };
}

describe("downloadTranscriptDocument", () => {
  let anchorEl: {
    href: string;
    download: string;
    click: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    global.fetch = mockFetch;
    vi.mocked(getAuthToken).mockResolvedValue(null);

    // Stub anchor element creation
    anchorEl = { href: "", download: "", click: vi.fn() };
    vi.spyOn(document, "createElement").mockReturnValue(anchorEl as any);
  });

  afterEach(() => {
    mockFetch.mockReset();
    vi.restoreAllMocks();
  });

  it("calls the correct download endpoint with the transcription ID", async () => {
    mockFetch.mockResolvedValue(makeResponse());

    await downloadTranscriptDocument("trans-abc");

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/download?transcription_id=trans-abc",
      expect.any(Object)
    );
  });

  it("URL-encodes the transcription ID", async () => {
    mockFetch.mockResolvedValue(makeResponse());

    await downloadTranscriptDocument("trans abc/123");

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/download?transcription_id=trans%20abc%2F123",
      expect.any(Object)
    );
  });

  it("omits Authorization header when getAuthToken returns null", async () => {
    mockFetch.mockResolvedValue(makeResponse());

    await downloadTranscriptDocument("t1");

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers).not.toHaveProperty("Authorization");
  });

  it("adds Authorization header when a token is present", async () => {
    vi.mocked(getAuthToken).mockResolvedValue("bearer-token-xyz");
    mockFetch.mockResolvedValue(makeResponse());

    await downloadTranscriptDocument("t1");

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers).toEqual({
      Authorization: "Bearer bearer-token-xyz",
    });
  });

  it("extracts filename from a plain Content-Disposition header", async () => {
    mockFetch.mockResolvedValue(
      makeResponse({
        contentDisposition: 'attachment; filename="my-transcript.docx"',
      })
    );

    await downloadTranscriptDocument("t1");

    expect(anchorEl.download).toBe("my-transcript.docx");
  });

  it("extracts filename from a RFC 5987 Content-Disposition header", async () => {
    mockFetch.mockResolvedValue(
      makeResponse({
        contentDisposition: "attachment; filename*=UTF-8''report%20final.docx",
      })
    );

    await downloadTranscriptDocument("t1");

    expect(anchorEl.download).toBe("report final.docx");
  });

  it("falls back to 'transcript.docx' when Content-Disposition is absent", async () => {
    mockFetch.mockResolvedValue(makeResponse({ contentDisposition: null }));

    await downloadTranscriptDocument("t1");

    expect(anchorEl.download).toBe("transcript.docx");
  });

  it("sets the anchor href to the blob URL and clicks it", async () => {
    mockFetch.mockResolvedValue(makeResponse());

    await downloadTranscriptDocument("t1");

    expect(anchorEl.href).toBe("blob:mock-url");
    expect(anchorEl.click).toHaveBeenCalledOnce();
  });

  it("revokes the object URL after clicking", async () => {
    mockFetch.mockResolvedValue(makeResponse());

    await downloadTranscriptDocument("t1");

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });

  it("throws when the response is not ok", async () => {
    mockFetch.mockResolvedValue(
      makeResponse({ ok: false, status: 404, statusText: "Not Found" })
    );

    await expect(downloadTranscriptDocument("missing")).rejects.toThrow(
      "Download failed: 404 Not Found"
    );
  });

  it("does not create an anchor when the request fails", async () => {
    mockFetch.mockResolvedValue(
      makeResponse({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      })
    );

    await expect(downloadTranscriptDocument("t1")).rejects.toThrow();
    expect(anchorEl.click).not.toHaveBeenCalled();
  });
});
