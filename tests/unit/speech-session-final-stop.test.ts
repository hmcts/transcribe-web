/**
 * OBS-5: the Speech session running when a dictation session ends is stopped
 * exactly once, with its length (realtime audio usage is the sum of
 * `speech.session_stopped` durations), including when the page is killed while
 * hidden and its stored end is sent by a later page.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth-utils", () => ({
  getAuthToken: vi.fn().mockResolvedValue(null),
  setAuthTokenListener: vi.fn(),
}));

import {
  createDictationSessionTelemetry,
  trackDictationPage,
} from "@/lib/dictation-session";
import type { RelayEvent, TelemetryRelay } from "@/lib/telemetry-relay";

const SDK_SESSION = "0123456789abcdef0123456789abcdef";

function recorder() {
  const events: RelayEvent[] = [];
  const relay = {
    emit: (event: RelayEvent) => events.push(event),
    flush: async () => undefined,
    flushOnHide: () => undefined,
    restoreUnsent: () => undefined,
  } as unknown as TelemetryRelay;
  return {
    events,
    relay,
    named: (n: string) => events.filter((e) => e.name === n),
  };
}

function storage(): Storage {
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

/** A dictation with a Speech session up since `clock.now`. */
function dictating(clock: { now: number }) {
  const rec = recorder();
  const telemetry = createDictationSessionTelemetry(rec.relay, () => clock.now);
  telemetry.recordingRequested({ sessionIndex: 1, reconnectAttempt: 0 });
  telemetry.speechSessionStarted({
    sessionId: SDK_SESSION,
    sessionIndex: 1,
    reconnectAttempt: 0,
  });
  telemetry.segmentCaptured();
  telemetry.segmentCaptured();
  return { ...rec, telemetry };
}

afterEach(() => setVisibility("visible"));

describe("the final Speech session stop", () => {
  it("is sent before the end with the session's length and segments", () => {
    const clock = { now: 1_000 };
    const { telemetry, events } = dictating(clock);
    clock.now += 90_000;
    telemetry.sessionEnded("submitted");

    expect(events.slice(-2).map((e) => e.name)).toEqual([
      "speech.session_stopped",
      "dictation.session_ended",
    ]);
    expect(events.at(-2)).toMatchObject({
      durationMs: 90_000,
      attributes: {
        "dictation.segments_captured": 2,
        "speech.stop_reason": "submitted",
      },
    });
    expect(events.map((e) => e.name)).not.toContain("dictation.paused");
  });

  it("is not sent again by a late stop from the hook, or after a pause", () => {
    const clock = { now: 1_000 };
    const { telemetry, named } = dictating(clock);
    clock.now += 10_000;
    telemetry.sessionEnded("submitted");
    // The recognizer is still up until the page navigates: a late collapse.
    telemetry.speechSessionStopped({
      sessionId: SDK_SESSION,
      sessionIndex: 1,
      durationMs: 12_000,
      segmentsCaptured: 2,
      userInitiated: false,
    });
    telemetry.speechSessionTornDown();
    expect(named("speech.session_stopped")).toHaveLength(1);

    const paused = dictating(clock);
    paused.telemetry.recordingPaused();
    paused.telemetry.speechSessionStopped({
      sessionId: SDK_SESSION,
      sessionIndex: 1,
      durationMs: 5_000,
      segmentsCaptured: 2,
      userInitiated: true,
    });
    paused.telemetry.sessionEnded("submitted");
    paused.telemetry.speechSessionTornDown();
    expect(paused.named("speech.session_stopped")).toHaveLength(1);
    expect(
      paused.named("speech.session_stopped")[0].attributes?.[
        "speech.stop_reason"
      ]
    ).toBe("paused");
  });

  it("is sent once by a later page when the page was killed while hidden", () => {
    vi.useFakeTimers();
    try {
      const local = storage();
      const clock = { now: 1_000_000 };
      const page = dictating(clock);
      const stopPage = trackDictationPage(
        page.telemetry,
        page.relay,
        () => local,
        () => clock.now
      );
      clock.now += 60_000;
      setVisibility("hidden");
      clock.now += 30_000;
      vi.advanceTimersByTime(30_000); // a heartbeat while dictating hidden
      clock.now += 10 * 60_000; // then the tab is killed

      const next = recorder();
      const stopNext = trackDictationPage(
        createDictationSessionTelemetry(next.relay, () => clock.now),
        next.relay,
        () => local,
        () => clock.now
      );
      expect(next.events.map((e) => e.name)).toEqual([
        "speech.session_stopped",
        "dictation.session_ended",
      ]);
      const [stop, end] = next.events;
      expect(stop.durationMs).toBe(90_000); // up to the last heartbeat
      expect(stop.attributes?.["speech.stop_reason"]).toBe("page_exit");
      expect(stop.journey).toEqual(end.journey);
      expect(page.named("speech.session_stopped")).toHaveLength(0);
      stopNext();
      stopPage(); // its end was sent elsewhere: nothing more
      expect(page.named("speech.session_stopped")).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts only the time after a frozen page's end was sent elsewhere", () => {
    const local = storage();
    const clock = { now: 1_000_000 };
    const page = dictating(clock);
    const stopPage = trackDictationPage(
      page.telemetry,
      page.relay,
      () => local,
      () => clock.now
    );
    clock.now += 60_000;
    setVisibility("hidden");
    clock.now += 10 * 60_000; // frozen
    const other = recorder();
    const stopOther = trackDictationPage(
      createDictationSessionTelemetry(other.relay, () => clock.now),
      other.relay,
      () => local,
      () => clock.now
    );
    expect(other.named("speech.session_stopped")[0].durationMs).toBe(60_000);

    setVisibility("visible"); // alive after all, still dictating
    clock.now += 5_000;
    page.telemetry.sessionEnded("submitted");
    const [stop] = page.named("speech.session_stopped");
    expect(stop.durationMs).toBe(5_000);
    expect(stop.journey?.id).toBe(
      page.named("dictation.session_ended")[0].journey?.id
    );
    stopOther();
    stopPage();
  });
});
