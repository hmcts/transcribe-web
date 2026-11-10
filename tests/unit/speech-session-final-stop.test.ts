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

/** One key per Speech session index, as the hook would give each session. */
const speechKeys = new Map<number, symbol>();
function speechKey(sessionIndex: number): symbol {
  let key = speechKeys.get(sessionIndex);
  if (!key) {
    key = Symbol(`speech-session-${sessionIndex}`);
    speechKeys.set(sessionIndex, key);
  }
  return key;
}

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
    key: speechKey(1),
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
    telemetry.speechSessionStopped({ key: speechKey(1), reason: "collapsed" });
    telemetry.speechSessionTornDown({ key: speechKey(1) });
    expect(named("speech.session_stopped")).toHaveLength(1);

    const paused = dictating(clock);
    paused.telemetry.recordingPaused();
    paused.telemetry.speechSessionStopped({
      key: speechKey(1),
      reason: "paused",
    });
    paused.telemetry.sessionEnded("submitted");
    paused.telemetry.speechSessionTornDown({ key: speechKey(1) });
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

  it("does not count the time again when a frozen page stays hidden after its end was sent", () => {
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
      setVisibility("hidden"); // stores a stop of 60 s with 2 segments
      clock.now += 10 * 60_000; // frozen
      const other = recorder();
      const stopOther = trackDictationPage(
        createDictationSessionTelemetry(other.relay, () => clock.now),
        other.relay,
        () => local,
        () => clock.now
      );
      expect(other.named("speech.session_stopped")[0]).toMatchObject({
        durationMs: 60_000,
        attributes: { "dictation.segments_captured": 2 },
      });

      vi.advanceTimersByTime(30_000); // wakes, still hidden: only a heartbeat
      clock.now += 30_000;
      page.telemetry.segmentCaptured();
      clock.now += 5_000;
      // The Speech session then collapses (or is paused) on this page.
      page.telemetry.speechSessionStopped({
        key: speechKey(1),
        reason: "collapsed",
      });
      const [stop] = page.named("speech.session_stopped");
      expect(stop.durationMs).toBe(35_000);
      expect(stop.attributes?.["dictation.segments_captured"]).toBe(1);
      expect(stop.journey?.id).not.toBe(
        other.named("speech.session_stopped")[0].journey?.id
      );
      stopOther();
      stopPage();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reconciles a woken page before a cancellation that comes before its next heartbeat", () => {
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
      setVisibility("hidden"); // stores a stop of 60 s
      clock.now += 10 * 60_000; // frozen
      const other = recorder();
      const stopOther = trackDictationPage(
        createDictationSessionTelemetry(other.relay, () => clock.now),
        other.relay,
        () => local,
        () => clock.now
      );
      const [sent] = other.named("speech.session_stopped");
      expect(sent.durationMs).toBe(60_000);

      // Wakes still hidden; the SDK reports a cancellation before any heartbeat.
      page.telemetry.speechCanceled({
        sessionIndex: 1,
        reason: "Error",
        collapsesInWindow: 1,
      });
      page.telemetry.speechSessionStopped({
        key: speechKey(1),
        reason: "collapsed",
      });
      const [canceled] = page.named("speech.canceled");
      const [stop] = page.named("speech.session_stopped");
      expect(stop.durationMs).toBe(0); // the earlier and the frozen time are not counted again
      expect(stop.journey?.id).not.toBe(sent.journey?.id);
      expect(canceled.journey?.id).toBe(stop.journey?.id);
      stopOther();
      stopPage();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not end a journey twice when a woken page submits before its next heartbeat", () => {
    const local = storage();
    const clock = { now: 1_000_000 };
    const page = dictating(clock);
    const stopPage = trackDictationPage(
      page.telemetry,
      page.relay,
      () => local,
      () => clock.now
    );
    setVisibility("hidden");
    clock.now += 10 * 60_000; // frozen
    const other = recorder();
    const stopOther = trackDictationPage(
      createDictationSessionTelemetry(other.relay, () => clock.now),
      other.relay,
      () => local,
      () => clock.now
    );
    const [sent] = other.named("dictation.session_ended");

    page.telemetry.sessionEnded("submitted"); // a submission completing while hidden
    const [ended] = page.named("dictation.session_ended");
    expect(ended.journey?.id).not.toBe(sent.journey?.id);
    expect(page.named("speech.session_stopped")[0].journey?.id).toBe(
      ended.journey?.id
    );
    stopOther();
    stopPage();
  });

  it("gives a woken page's submission the journey its outcome is reported under", () => {
    const local = storage();
    const clock = { now: 1_000_000 };
    const page = dictating(clock);
    const stopPage = trackDictationPage(
      page.telemetry,
      page.relay,
      () => local,
      () => clock.now
    );
    setVisibility("hidden");
    clock.now += 10 * 60_000; // frozen
    const other = recorder();
    const stopOther = trackDictationPage(
      createDictationSessionTelemetry(other.relay, () => clock.now),
      other.relay,
      () => local,
      () => clock.now
    );
    const [sent] = other.named("dictation.session_ended");

    // Wakes still hidden and submits before any heartbeat or event.
    const sessionId = page.telemetry.currentSessionId();
    page.telemetry.submissionFinished({ ok: true, mode: "mic", durationMs: 1 });
    expect(sessionId).not.toBe(sent.journey?.id);
    expect(page.named("dictation.submission_finished")[0].journey?.id).toBe(
      sessionId
    );
    stopOther();
    stopPage();
  });

  it("reports an in-flight submission's outcome under the journey its request carried", () => {
    const local = storage();
    const clock = { now: 1_000_000 };
    const page = dictating(clock);
    const stopPage = trackDictationPage(
      page.telemetry,
      page.relay,
      () => local,
      () => clock.now
    );
    const requestSessionId = page.telemetry.currentSessionId();
    setVisibility("hidden"); // frozen while the submission is in flight
    clock.now += 10 * 60_000;
    const other = recorder();
    const stopOther = trackDictationPage(
      createDictationSessionTelemetry(other.relay, () => clock.now),
      other.relay,
      () => local,
      () => clock.now
    );
    expect(other.named("dictation.session_ended")[0].journey?.id).toBe(
      requestSessionId
    );

    page.telemetry.submissionFinished({
      ok: true,
      mode: "mic",
      durationMs: 1,
      sessionId: requestSessionId,
    });
    expect(page.named("dictation.submission_finished")[0].journey?.id).toBe(
      requestSessionId
    );
    page.telemetry.sessionEnded("submitted");
    expect(page.named("dictation.session_ended")[0].journey?.id).not.toBe(
      requestSessionId
    );
    stopOther();
    stopPage();
  });

  it("ignores a stop from another hook, or a late stop after a reconnect", () => {
    const clock = { now: 1_000 };
    const { telemetry, named } = dictating(clock);
    clock.now += 10_000;
    // A remounted Dictation's hook numbers its sessions from 1 again.
    telemetry.speechSessionStopped({
      key: Symbol("another hook's session 1"),
      reason: "collapsed",
    });
    expect(named("speech.session_stopped")).toHaveLength(0);

    telemetry.sessionEnded("submitted");
    const next = Symbol("speech-session-2");
    telemetry.recordingRequested({ sessionIndex: 2, reconnectAttempt: 0 });
    telemetry.speechSessionStarted({
      key: next,
      sessionIndex: 2,
      reconnectAttempt: 0,
    });
    // Session 1's own stop arrives after session 2 started: not sent again.
    telemetry.speechSessionStopped({ key: speechKey(1), reason: "collapsed" });
    clock.now += 4_000;
    telemetry.speechSessionStopped({ key: next, reason: "paused" });
    expect(named("speech.session_stopped").map((e) => e.durationMs)).toEqual([
      10_000, 4_000,
    ]);
  });

  it("treats a start after the hook unmounted as a resume, without a pause", () => {
    const clock = { now: 1_000 };
    const { telemetry, named } = dictating(clock);
    clock.now += 10_000;
    telemetry.speechSessionTornDown({ key: speechKey(1) }); // Dictation remounted
    expect(named("speech.session_stopped")[0].attributes).toMatchObject({
      "speech.stop_reason": "teardown",
      "dictation.user_initiated": false,
    });
    telemetry.recordingRequested({ sessionIndex: 1, reconnectAttempt: 0 });
    clock.now += 2_000;
    telemetry.firstText({ sessionIndex: 1 });
    expect(named("dictation.paused")).toHaveLength(0);
    expect(named("dictation.resumed")).toHaveLength(1);
    expect(named("dictation.resume_first_result")[0].durationMs).toBe(2_000);
  });

  it("counts a segment captured by a woken page before its next heartbeat under the new journey", () => {
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
      setVisibility("hidden"); // stores a stop of 60 s with 2 segments
      clock.now += 10 * 60_000; // frozen
      const other = recorder();
      const stopOther = trackDictationPage(
        createDictationSessionTelemetry(other.relay, () => clock.now),
        other.relay,
        () => local,
        () => clock.now
      );
      expect(other.named("speech.session_stopped")[0].durationMs).toBe(60_000);

      // Wakes still hidden; a final transcript arrives before any heartbeat.
      page.telemetry.segmentCaptured();
      clock.now += 5_000;
      page.telemetry.speechSessionStopped({
        key: speechKey(1),
        reason: "collapsed",
      });
      const [stop] = page.named("speech.session_stopped");
      expect(stop.durationMs).toBe(5_000);
      expect(stop.attributes?.["dictation.segments_captured"]).toBe(1);
      stopOther();
      stopPage();
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
