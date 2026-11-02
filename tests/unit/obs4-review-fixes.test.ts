/**
 * OBS-4 code review fixes: one regression test per finding.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createDictationSessionTelemetry,
  PENDING_END_STORAGE_KEY,
  trackDictationPage,
} from "@/lib/dictation-session";
import { type RelayEvent, TelemetryRelay } from "@/lib/telemetry-relay";

function response(status: number) {
  return { ok: status >= 200 && status < 300, status } as Response;
}

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

describe("finding 1: only recording starts a dictation session", () => {
  it("late speech events after a submission do not create a fake session", () => {
    const { relay, named } = recorder();
    const telemetry = createDictationSessionTelemetry(relay);
    telemetry.recordingRequested({ sessionIndex: 1, reconnectAttempt: 0 });
    telemetry.segmentCaptured();
    telemetry.sessionEnded("submitted");

    // The recognizer is still running and delivers more results.
    telemetry.firstText({ sessionIndex: 1 });
    telemetry.segmentCaptured();
    telemetry.speechSessionStarted({ sessionIndex: 2, reconnectAttempt: 1 });
    telemetry.speechUnhealthy({ collapsesInWindow: 3, windowSeconds: 120 });
    telemetry.sessionEnded("left_page"); // the page unmounts on navigation

    const ended = named("dictation.session_ended");
    expect(ended).toHaveLength(1);
    expect(ended[0].attributes?.["hmcts.outcome"]).toBe("success");
    expect(named("speech.first_result")).toHaveLength(0);
  });
});

describe("relay transport", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("finding 8: batches stay under the relay's 32 KiB body limit", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(202));
    const relay = new TelemetryRelay({
      fetchImpl,
    });
    const big = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [
        `attribute.number_${i}`,
        "x".repeat(40),
      ])
    );
    for (let i = 0; i < 49; i++)
      relay.emit({ name: "live_draft.save_failed", attributes: big });
    await relay.flush();
    await vi.advanceTimersByTimeAsync(0);
    await relay.flush();
    await vi.advanceTimersByTimeAsync(0);
    const sizes = fetchImpl.mock.calls.map(
      ([, init]) => String((init as RequestInit).body).length
    );
    expect(sizes.length).toBeGreaterThan(1);
    for (const size of sizes) expect(size).toBeLessThanOrEqual(30_000);
  });

  it("finding 9: new events do not shorten the back-off after a failure", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(503));
    const relay = new TelemetryRelay({
      fetchImpl,
      flushDelayMs: 1_000,
    });
    relay.emit({ name: "dictation.paused" });
    await vi.advanceTimersByTimeAsync(1_000); // first attempt fails: back-off 2 s
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    relay.emit({ name: "dictation.resumed" }); // would schedule a flush in 1 s
    await vi.advanceTimersByTimeAsync(1_500);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // still backing off
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("finding 5: a session whose page is killed while hidden still ends", () => {
  function setVisibility(state: "hidden" | "visible") {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => state,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }

  function storageWithKeys(): Storage {
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

  function pendingEnds(storage: Storage): number {
    let count = 0;
    for (let i = 0; i < storage.length; i++) {
      if (storage.key(i)?.startsWith(`${PENDING_END_STORAGE_KEY}:`)) count++;
    }
    return count;
  }

  /** A record page that has captured speech. */
  function recordingPage(local: Storage, clock: { now: number }) {
    const rec = recorder();
    const telemetry = createDictationSessionTelemetry(
      rec.relay,
      () => clock.now
    );
    const stop = trackDictationPage(
      telemetry,
      rec.relay,
      () => local,
      () => clock.now
    );
    telemetry.recordingRequested({ sessionIndex: 1, reconnectAttempt: 0 });
    telemetry.segmentCaptured();
    return { ...rec, telemetry, stop };
  }

  /** A page that just opens and recovers what it can. */
  function openPage(local: Storage, clock: { now: number }) {
    const rec = recorder();
    const stop = trackDictationPage(
      createDictationSessionTelemetry(rec.relay, () => clock.now),
      rec.relay,
      () => local,
      () => clock.now
    );
    return { ...rec, stop };
  }

  afterEach(() => setVisibility("visible"));

  it("stores the end on hidden, clears it when visible, and sends it once the page is gone", () => {
    const local = storageWithKeys();
    const clock = { now: 1_000_000 };
    const page = recordingPage(local, clock);

    setVisibility("hidden");
    expect(pendingEnds(local)).toBe(1);
    setVisibility("visible"); // a tab switch, not the end
    expect(pendingEnds(local)).toBe(0);
    setVisibility("hidden"); // ... then the page is killed: no pagehide, no heartbeat

    clock.now += 4 * 60_000;
    const next = openPage(local, clock);
    expect(next.named("dictation.session_ended")).toHaveLength(1);
    expect(pendingEnds(local)).toBe(0);
    next.stop();
    page.stop();
  });

  it("never ends a session whose page is alive, e.g. hidden or a duplicated tab", () => {
    const local = storageWithKeys();
    const clock = { now: 1_000_000 };
    const page = recordingPage(local, clock);
    setVisibility("hidden");

    clock.now += 60_000; // its heartbeat is still fresh
    const other = openPage(local, clock);
    expect(other.named("dictation.session_ended")).toHaveLength(0);

    setVisibility("visible");
    page.telemetry.sessionEnded("submitted");
    expect(page.named("dictation.session_ended")).toHaveLength(1);
    other.stop();
    page.stop();
  });

  it("continues under a new journey when a frozen page comes back after its end was sent", () => {
    const local = storageWithKeys();
    const clock = { now: 1_000_000 };
    const page = recordingPage(local, clock);
    const before = page.telemetry.currentSessionId();
    setVisibility("hidden");

    clock.now += 10 * 60_000; // frozen: no heartbeat
    const other = openPage(local, clock);
    const [sentElsewhere] = other.named("dictation.session_ended");
    expect(sentElsewhere.journey?.id).toBe(before);

    setVisibility("visible"); // it was alive after all, still recording
    const after = page.telemetry.currentSessionId();
    expect(after).not.toBeNull();
    expect(after).not.toBe(before); // that journey is closed: no second end for it
    page.telemetry.sessionEnded("submitted");
    const ends = page.named("dictation.session_ended");
    expect(ends).toHaveLength(1);
    expect(ends[0].journey?.id).toBe(after);
    expect(ends[0].attributes?.["hmcts.outcome"]).toBe("success"); // counts kept
    other.stop();
    page.stop();
  });

  it("does not end a session twice when its page closes while hidden after another page sent the end", () => {
    for (const close of ["pagehide", "unmount"] as const) {
      const local = storageWithKeys();
      const clock = { now: 1_000_000 };
      const page = recordingPage(local, clock);
      setVisibility("hidden");
      clock.now += 10 * 60_000; // frozen
      const other = openPage(local, clock);
      expect(other.named("dictation.session_ended")).toHaveLength(1);

      if (close === "pagehide") {
        window.dispatchEvent(
          new PageTransitionEvent("pagehide", { persisted: false })
        );
      }
      page.stop();
      expect(page.named("dictation.session_ended")).toHaveLength(0);
      other.stop();
      setVisibility("visible");
    }
  });

  it("forgets the stored end once the session has ended another way while hidden", () => {
    vi.useFakeTimers();
    try {
      const local = storageWithKeys();
      const clock = { now: 1_000_000 };
      const page = recordingPage(local, clock);
      setVisibility("hidden");
      page.telemetry.sessionEnded("submitted"); // the submission finishes in the background
      vi.advanceTimersByTime(30_000); // next heartbeat
      expect(pendingEnds(local)).toBe(0);

      clock.now += 10 * 60_000; // the page is killed before unmounting
      const next = openPage(local, clock);
      expect(next.named("dictation.session_ended")).toHaveLength(0);
      expect(page.named("dictation.session_ended")).toHaveLength(1);
      next.stop();
      page.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the stored end current while dictation continues in a hidden tab", () => {
    vi.useFakeTimers();
    try {
      const local = storageWithKeys();
      const clock = { now: 1_000_000 };
      const rec = recorder();
      const telemetry = createDictationSessionTelemetry(
        rec.relay,
        () => clock.now
      );
      const stop = trackDictationPage(
        telemetry,
        rec.relay,
        () => local,
        () => clock.now
      );
      telemetry.recordingRequested({ sessionIndex: 1, reconnectAttempt: 0 });
      setVisibility("hidden"); // early: nothing captured yet

      for (let i = 0; i < 3; i++) telemetry.segmentCaptured(); // dictating while hidden
      clock.now += 60 * 60_000;
      vi.advanceTimersByTime(30_000); // a heartbeat

      clock.now += 10 * 60_000; // then the tab is killed
      const next = openPage(local, clock);
      const [ended] = next.named("dictation.session_ended");
      expect(ended.attributes?.["dictation.segments_captured"]).toBe(3);
      // Captured speech but never submitted: its own outcome, not a success.
      expect(ended.attributes?.["hmcts.outcome"]).toBe("cancelled");
      expect(ended.attributes?.["hmcts.error.code"]).toBe(
        "dictation.not_submitted"
      );
      expect(ended.durationMs).toBeGreaterThanOrEqual(60 * 60_000);
      next.stop();
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not recreate a stored end that another page already sent", () => {
    vi.useFakeTimers();
    try {
      const local = storageWithKeys();
      const clock = { now: 1_000_000 };
      const page = recordingPage(local, clock);
      setVisibility("hidden");
      clock.now += 10 * 60_000; // frozen
      const other = openPage(local, clock); // sends and removes the stored end
      expect(other.named("dictation.session_ended")).toHaveLength(1);

      vi.advanceTimersByTime(30_000); // the frozen page wakes and beats while still hidden
      expect(pendingEnds(local)).toBe(0);
      other.stop();
      page.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("is not blocked by an unreadable entry", () => {
    const local = storageWithKeys();
    const clock = { now: 1_000_000 };
    local.setItem(`${PENDING_END_STORAGE_KEY}:broken`, "{not json");
    const page = recordingPage(local, clock);
    setVisibility("hidden");
    clock.now += 4 * 60_000;

    const next = openPage(local, clock);
    expect(next.named("dictation.session_ended")).toHaveLength(1);
    expect(local.getItem(`${PENDING_END_STORAGE_KEY}:broken`)).toBeNull();
    next.stop();
    page.stop();
  });
});

describe("finding 7: a successful submission excuses an autosave outage", () => {
  it("ends as success when autosave stalled but the hearing was submitted", () => {
    const { relay, named } = recorder();
    const telemetry = createDictationSessionTelemetry(relay);
    telemetry.recordingRequested({ sessionIndex: 1, reconnectAttempt: 0 });
    telemetry.segmentCaptured();
    telemetry.autosaveStalled({
      kind: "server",
      consecutiveFailures: 3,
      secondsSinceLastSave: 30,
    });
    telemetry.sessionEnded("submitted");
    expect(
      named("dictation.session_ended")[0].attributes?.["hmcts.outcome"]
    ).toBe("success");
  });
});

describe("latest review: session outcomes and empty results", () => {
  it("reports a session left without submitting as not submitted, not a success", () => {
    for (const reason of ["page_hidden", "left_page"] as const) {
      const { relay, named } = recorder();
      const telemetry = createDictationSessionTelemetry(relay);
      telemetry.recordingRequested({ sessionIndex: 1, reconnectAttempt: 0 });
      telemetry.segmentCaptured();
      telemetry.sessionEnded(reason);
      expect(named("dictation.session_ended")[0].attributes).toMatchObject({
        "hmcts.outcome": "cancelled",
        "hmcts.error.code": "dictation.not_submitted",
      });
    }
  });

  it("still reports a real problem first, and success only when submitted", () => {
    const { relay, named } = recorder();
    const telemetry = createDictationSessionTelemetry(relay);
    telemetry.recordingRequested({ sessionIndex: 1, reconnectAttempt: 0 });
    telemetry.segmentCaptured();
    telemetry.autosaveStalled({
      kind: "server",
      consecutiveFailures: 3,
      secondsSinceLastSave: 30,
    });
    telemetry.sessionEnded("left_page");
    expect(
      named("dictation.session_ended")[0].attributes?.["hmcts.error.code"]
    ).toBe("autosave.failed");
  });

  it("does not send an empty batch when every queued event was too large", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(202));
    const relay = new TelemetryRelay({
      fetchImpl,
    });
    relay.emit({ name: "x", attributes: { big: "y".repeat(40_000) } });
    await relay.flush();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(relay.pending).toBe(0);
  });

  describe("medium review fixes", () => {
    it("a restored draft submitted without new speech is not a no-transcript failure", () => {
      const { relay, named } = recorder();
      const telemetry = createDictationSessionTelemetry(relay);
      telemetry.restoreFinished({ ok: true });
      telemetry.recordingRequested({ sessionIndex: 1, reconnectAttempt: 0 });
      telemetry.sessionEnded("submitted");
      expect(
        named("dictation.session_ended")[0].attributes?.["hmcts.outcome"]
      ).toBe("success");

      // After the submission the draft is gone: a new empty session is a failure again.
      telemetry.recordingRequested({ sessionIndex: 2, reconnectAttempt: 0 });
      telemetry.sessionEnded("submitted");
      expect(
        named("dictation.session_ended")[1].attributes?.["hmcts.error.code"]
      ).toBe("dictation.no_transcript");
    });

    it("a submission that fails in the browser is not reported as a network outage", () => {
      const { relay, named } = recorder();
      const telemetry = createDictationSessionTelemetry(relay);
      telemetry.submissionFinished({ ok: false, mode: "mic", durationMs: 1 }); // e.g. validation threw
      telemetry.submissionFinished({
        ok: false,
        errorCode: "network",
        mode: "mic",
        durationMs: 1,
      });
      telemetry.submissionFinished({
        ok: false,
        status: 503,
        mode: "mic",
        durationMs: 1,
      });
      expect(
        named("dictation.submission_finished").map(
          (e) => e.attributes?.["hmcts.error.code"]
        )
      ).toEqual(["submission.client_error", "network", "http.503"]);
    });

    it("clears the restored flag when a restore is submitted, or the page left, without recording", () => {
      for (const reason of ["submitted", "left_page"] as const) {
        const { relay, named } = recorder();
        const telemetry = createDictationSessionTelemetry(relay);
        telemetry.restoreFinished({ ok: true });
        telemetry.sessionEnded(reason); // no session: nothing recorded
        telemetry.recordingRequested({ sessionIndex: 1, reconnectAttempt: 0 });
        telemetry.sessionEnded("submitted");
        expect(
          named("dictation.session_ended")[0].attributes?.["hmcts.error.code"]
        ).toBe("dictation.no_transcript");
      }
    });

    it("a 4xx speech token response is a failure, a 5xx or network failure an error", () => {
      const { relay, named } = recorder();
      const telemetry = createDictationSessionTelemetry(relay);
      telemetry.recordingRequested({ sessionIndex: 1, reconnectAttempt: 0 });
      telemetry.tokenFetched({ ok: false, status: 401, durationMs: 5 });
      telemetry.tokenFetched({ ok: false, status: 503, durationMs: 5 });
      telemetry.tokenFetched({ ok: false, durationMs: 5 });
      expect(
        named("speech.token_fetched").map(
          (e) => e.attributes?.["hmcts.outcome"]
        )
      ).toEqual(["failure", "error", "error"]);
    });
  });
});
