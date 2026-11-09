import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  jurisdictionHeaders,
  setTabContext,
} from "@/lib/jurisdiction-session";
import {
  inSentence,
  WORDING_DEFAULTS,
  wordingFor,
} from "@/lib/jurisdiction-wording";
import { IAC } from "../jurisdiction-helpers";

// DIAAT-322: every request for material names the tab's jurisdiction, and the
// wording falls back to neutral text, never another jurisdiction's.

describe("the tab's jurisdiction header", () => {
  beforeEach(() => window.sessionStorage.clear());
  afterEach(() => {
    window.sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it("is sent once the tab's jurisdiction is known", () => {
    expect(jurisdictionHeaders()).toEqual({});
    setTabContext({ jurisdiction: "ET", role: "Judge" });
    expect(jurisdictionHeaders()).toEqual({
      "X-Jurisdiction": "ET",
      "X-Role": "Judge",
    });
    setTabContext(null);
    expect(jurisdictionHeaders()).toEqual({});
  });

  it("is added by the API client", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    setTabContext({ jurisdiction: "ET", role: "Judge" });
    const { apiClient } = await import("@/lib/api-client");

    await apiClient.request("/transcriptions-metadata");

    expect(fetchMock.mock.calls[0][1].headers["X-Jurisdiction"]).toBe("ET");
    expect(fetchMock.mock.calls[0][1].headers["X-Role"]).toBe("Judge");
  });

  it("is added to live-draft requests: each jurisdiction has its own draft", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    setTabContext({ jurisdiction: "ET", role: "Judge" });
    const { getLiveDraft } = await import("@/lib/live-draft-api");

    expect(await getLiveDraft()).toBeNull();

    expect(fetchMock.mock.calls[0][1].headers["X-Jurisdiction"]).toBe("ET");
    expect(fetchMock.mock.calls[0][1].headers["X-Role"]).toBe("Judge");
  });

  it("is added to document downloads", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("not found", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    setTabContext({ jurisdiction: "IAC", role: "Judge" });
    const { downloadTranscriptDocument } = await import("@/lib/download");

    await expect(downloadTranscriptDocument("t-1")).rejects.toThrow(
      "Download failed"
    );

    expect(fetchMock.mock.calls[0][1].headers["X-Jurisdiction"]).toBe("IAC");
    expect(fetchMock.mock.calls[0][1].headers["X-Role"]).toBe("Judge");
  });
});

describe("the tab's jurisdiction without session storage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("is kept in memory when storage is blocked", async () => {
    vi.resetModules();
    const session = await import("@/lib/jurisdiction-session");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    session.setTabContext({ jurisdiction: "ET", role: "Judge" });

    expect(session.jurisdictionHeaders()).toEqual({
      "X-Jurisdiction": "ET",
      "X-Role": "Judge",
    });
  });

  it("is kept in memory when writes fail but reads still work", async () => {
    vi.resetModules();
    window.sessionStorage.clear();
    window.sessionStorage.setItem(
      "benchnotes-context",
      JSON.stringify({ jurisdiction: "IAC", role: "Judge" })
    );
    const session = await import("@/lib/jurisdiction-session");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    session.setTabContext({ jurisdiction: "ET", role: "Judge" });

    // Not the stale IAC still readable from storage.
    expect(session.getTabJurisdiction()).toBe("ET");
    window.sessionStorage.clear();
  });
});

describe("jurisdiction wording", () => {
  it("is the jurisdiction's own where it sets it", () => {
    expect(wordingFor(IAC.wording, "records.column_title")).toBe("Hearing");
  });

  it("falls back to the neutral default for a key it does not set, or sets blank", () => {
    expect(wordingFor({}, "records.column_title")).toBe("Title");
    expect(
      wordingFor({ "records.column_title": "  " }, "records.column_title")
    ).toBe("Title");
    expect(wordingFor(undefined, "nav.recordings")).toBe("Recordings");
  });

  it("has neutral defaults that mention no jurisdiction", () => {
    for (const text of Object.values(WORDING_DEFAULTS)) {
      expect(text).not.toMatch(
        /hearing|immigration|asylum|tribunal|appeal|employment/i
      );
    }
  });

  it("covers every key the IAC sets, and the IAC sets every key", () => {
    expect(Object.keys(IAC.wording).sort()).toEqual(
      Object.keys(WORDING_DEFAULTS).sort()
    );
  });
});

describe("a label used mid-sentence", () => {
  it("loses only a capital that starts a word", () => {
    expect(inSentence("Hearing recordings")).toBe("hearing recordings");
    expect(inSentence("CVP recordings")).toBe("CVP recordings");
    expect(inSentence("recordings")).toBe("recordings");
  });
});
