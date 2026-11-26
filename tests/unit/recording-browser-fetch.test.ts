import { afterEach, describe, expect, it, vi } from "vitest";
import { setTabContext } from "@/lib/jurisdiction-session";
import {
  recordingFetch,
  withTabJurisdiction,
} from "@/lib/recording/browser-fetch";

// DIAAT-334: the browser's hearing recordings calls name the tab's jurisdiction.

describe("recording calls from the browser", () => {
  afterEach(() => {
    window.sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it("send the tab's jurisdiction with their own headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    setTabContext({ jurisdiction: "IAC", role: "Judge" });

    await recordingFetch("/api/jobs/j1", { method: "DELETE", headers: { "X-Test": "1" } });
    await recordingFetch("/api/jobs", { headers: new Headers({ "X-Test": "2" }) });

    expect(fetchMock.mock.calls[0][1].headers).toEqual({
      "X-Test": "1",
      "X-Jurisdiction": "IAC",
      "X-Role": "Judge",
    });
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
    const second = fetchMock.mock.calls[1][1].headers as Headers;
    expect([second.get("X-Test"), second.get("X-Jurisdiction")]).toEqual(["2", "IAC"]);
  });

  it("put it in an audio source's URL, which cannot carry a header", () => {
    expect(withTabJurisdiction("/api/audio/j1")).toBe("/api/audio/j1");
    setTabContext({ jurisdiction: "IAC", role: "Judge" });
    expect(withTabJurisdiction("/api/audio/j1")).toBe(
      "/api/audio/j1?jurisdiction=IAC&role=Judge"
    );
    expect(withTabJurisdiction("/api/audio/j1?x=1")).toBe(
      "/api/audio/j1?x=1&jurisdiction=IAC&role=Judge"
    );
    // A global role has no jurisdiction: `-`, as in the X-Jurisdiction header.
    setTabContext({ jurisdiction: null, role: "Global" });
    expect(withTabJurisdiction("/api/audio/j1")).toBe(
      "/api/audio/j1?jurisdiction=-&role=Global"
    );
  });
});

describe("an upload through the API (DIAAT-334)", () => {
  it("is told apart from a direct upload to storage", async () => {
    const { isApiProxyUpload } = await import("@/components/audio/upload/use-audio-upload");
    expect(isApiProxyUpload("http://localhost:8000/api/upload-audio?key=user-uploads/x/y.mp3")).toBe(true);
    expect(isApiProxyUpload("/api/upload-audio?key=k")).toBe(true);
    expect(isApiProxyUpload("https://account.blob.core.windows.net/c/user-uploads/x/y.mp3?sv=1&sig=s")).toBe(false);
  });
});
