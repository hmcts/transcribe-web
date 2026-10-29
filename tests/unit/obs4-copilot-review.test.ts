/**
 * PR review (Copilot) on the browser telemetry: one regression test per finding.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createDictationSessionTelemetry,
  PAGE_ALIVE_STORAGE_KEY,
  PENDING_END_STORAGE_KEY,
  recoverStaleEnds,
  trackDictationPage,
} from "@/lib/dictation-session";
import {
  type RelayEvent,
  TelemetryRelay,
  UNSENT_STORAGE_KEY,
} from "@/lib/telemetry-relay";

const SDK_SESSION = "0123456789abcdef0123456789abcdef";

function recorder() {
  const events: RelayEvent[] = [];
  const relay = {
    emit: (event: RelayEvent) => events.push(event),
    flush: async () => undefined,
    flushOnHide: () => undefined,
    restoreUnsent: () => undefined,
  } as unknown as TelemetryRelay;
  return { events, relay, names: () => events.map((e) => e.name) };
}

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
    clear: () => data.clear(),
    key: (i) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  };
}

function setVisibility(state: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

/** A stored end left by a page whose last heartbeat was at `lastBeat`. */
function storedEnd(local: Storage, pageId: string, lastBeat: number) {
  local.setItem(`${PAGE_ALIVE_STORAGE_KEY}:${pageId}`, String(lastBeat));
  local.setItem(
    `${PENDING_END_STORAGE_KEY}:${pageId}`,
    JSON.stringify({
      storedAt: lastBeat,
      event: {
        name: "dictation.session_ended",
        journey: { type: "dictation.session", id: pageId },
      },
    })
  );
}

afterEach(() => {
  setVisibility("visible");
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the speech demo owns its dictation journey", () => {
  it("tracks its page, so its session ends when the page is left", () => {
    const page = readFileSync(
      join(__dirname, "..", "..", "app/speech-demo/page.tsx"),
      "utf8"
    );
    expect(page).toContain("<DictationPageTracker />");
  });
});

describe("recovery of ends left by killed pages", () => {
  it("sends an end once the page's heartbeat is stale, not only at startup", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000_000);
    window.localStorage.clear();
    // Killed a minute ago: it still looks alive when this page starts.
    storedEnd(window.localStorage, "killed-page", Date.now() - 60_000);
    vi.resetModules(); // a fresh module: the recovery timer starts once per page
    const { startBrowserTelemetry } = await import("@/lib/dictation-session");
    const rec = recorder();
    startBrowserTelemetry(rec.relay);
    expect(rec.names()).toEqual([]);

    vi.advanceTimersByTime(3 * 60_000);
    expect(rec.names()).toEqual(["dictation.session_ended"]);
    expect(
      window.localStorage.getItem(`${PENDING_END_STORAGE_KEY}:killed-page`)
    ).toBeNull();
    window.localStorage.clear();
  });

  it("claims stored ends under a cross-tab lock, so two tabs cannot both send one", () => {
    const local = memoryStorage();
    storedEnd(local, "gone", 1);
    const held: (() => unknown)[] = [];
    const request = vi.fn((_name: string, callback: () => unknown) => {
      held.push(callback); // another tab holds the lock
      return Promise.resolve();
    });
    vi.stubGlobal("navigator", { ...navigator, locks: { request } });

    const rec = recorder();
    recoverStaleEnds(
      rec.relay,
      () => local,
      () => 10_000_000
    );
    expect(request).toHaveBeenCalledWith(
      "hmcts-dictation-recovery",
      expect.any(Function)
    );
    expect(rec.names()).toEqual([]); // nothing read or sent outside the lock

    for (const callback of held) callback();
    expect(rec.names()).toEqual(["dictation.session_ended"]);
  });
});

describe("a session that ends while hidden", () => {
  it("drops its stored page_hidden end at once, not at the next heartbeat", () => {
    const local = memoryStorage();
    const rec = recorder();
    const telemetry = createDictationSessionTelemetry(rec.relay);
    const stop = trackDictationPage(telemetry, rec.relay, () => local);
    telemetry.recordingRequested({ sessionIndex: 1, reconnectAttempt: 0 });
    telemetry.speechSessionStarted({
      sessionId: SDK_SESSION,
      sessionIndex: 1,
      reconnectAttempt: 0,
    });
    telemetry.segmentCaptured();
    setVisibility("hidden");
    const stored = () =>
      Array.from({ length: local.length }, (_, i) => local.key(i)).filter(
        (key) => key?.startsWith(`${PENDING_END_STORAGE_KEY}:`)
      );
    expect(stored()).toHaveLength(1);

    telemetry.sessionEnded("submitted"); // the submission completes while hidden
    expect(stored()).toEqual([]);

    // The tab is killed: a later page has nothing to send for it.
    const later = recorder();
    recoverStaleEnds(
      later.relay,
      () => local,
      () => Date.now() + 3_600_000
    );
    expect(later.names()).toEqual([]);
    expect(
      rec.events.filter((e) => e.name === "dictation.session_ended")
    ).toHaveLength(1);
    stop();
  });
});

describe("a batch whose flush fails while the page is hidden", () => {
  it("is kept in storage, not only in memory", async () => {
    const local = memoryStorage();
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("offline"));
    const relay = new TelemetryRelay({ fetchImpl, storage: () => local });
    relay.emit({ name: "dictation.paused" });
    const flushing = relay.flush(); // in flight, so not in the queue
    setVisibility("hidden");
    relay.flushOnHide(); // nothing queued to send
    await flushing; // the in-flight request fails while hidden
    const kept = JSON.parse(local.getItem(UNSENT_STORAGE_KEY) ?? "[]");
    expect(kept.map((e: { name: string }) => e.name)).toEqual([
      "dictation.paused",
    ]);
    expect(relay.pending).toBe(0);
  });
});
