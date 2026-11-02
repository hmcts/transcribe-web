import { describe, expect, it } from "vitest";

import {
  createDictationSessionTelemetry,
  JOURNEY_DICTATION_SESSION,
} from "@/lib/dictation-session";
import type { RelayEvent, TelemetryRelay } from "@/lib/telemetry-relay";

const SDK_SESSION = "0123456789abcdef0123456789abcdef";

function setup() {
  const events: RelayEvent[] = [];
  const relay = {
    emit: (event: RelayEvent) => events.push(event),
  } as unknown as TelemetryRelay;
  let clock = 1_000;
  let ids = 0;
  const telemetry = createDictationSessionTelemetry(
    relay,
    () => clock,
    () => `00000000-0000-4000-8000-00000000000${++ids}`
  );
  return {
    telemetry,
    events,
    advance: (ms: number) => {
      clock += ms;
    },
    named: (name: string) => events.filter((e) => e.name === name),
  };
}

describe("dictation session telemetry", () => {
  it("is one journey with start-to-ready and start-to-first-text timings", () => {
    const { telemetry, events, advance, named } = setup();
    telemetry.recordingRequested({ sessionIndex: 1, reconnectAttempt: 0 });
    advance(800);
    telemetry.speechSessionStarted({
      sessionId: SDK_SESSION,
      sessionIndex: 1,
      reconnectAttempt: 0,
    });
    advance(1200);
    telemetry.firstText({ sessionId: SDK_SESSION, sessionIndex: 1 });
    telemetry.firstText({ sessionId: SDK_SESSION, sessionIndex: 1 }); // once per session

    expect(new Set(events.map((e) => e.journey?.id)).size).toBe(1);
    expect(events[0].journey?.type).toBe(JOURNEY_DICTATION_SESSION);
    expect(named("speech.session_started")[0].durationMs).toBe(800);
    expect(
      named("speech.session_started")[0].attributes?.["speech.session_id"]
    ).toBe(SDK_SESSION);
    expect(named("speech.first_result")).toHaveLength(1);
    expect(named("speech.first_result")[0].durationMs).toBe(2000);
  });

  it("times resume to the next text and distinguishes pause from a collapse", () => {
    const { telemetry, advance, named } = setup();
    telemetry.recordingRequested({ sessionIndex: 1, reconnectAttempt: 0 });
    telemetry.speechSessionStopped({
      sessionIndex: 1,
      durationMs: 5000,
      segmentsCaptured: 2,
      userInitiated: false, // a collapse: not a pause
    });
    expect(named("dictation.paused")).toHaveLength(0);

    telemetry.recordingPaused();
    advance(60_000);
    telemetry.recordingRequested({ sessionIndex: 3, reconnectAttempt: 0 });
    advance(3_000);
    telemetry.firstText({ sessionIndex: 3 });

    expect(named("dictation.paused")).toHaveLength(1);
    expect(named("dictation.resumed")).toHaveLength(1);
    expect(named("dictation.resume_first_result")[0].durationMs).toBe(3_000);
  });

  it("ends a session that captured nothing as a distinct no-transcript failure", () => {
    const { telemetry, named } = setup();
    telemetry.recordingRequested({ sessionIndex: 1, reconnectAttempt: 0 });
    telemetry.sessionEnded("page_hidden");
    telemetry.sessionEnded("left_page"); // only once
    const ended = named("dictation.session_ended");
    expect(ended).toHaveLength(1);
    expect(ended[0].attributes).toMatchObject({
      "hmcts.outcome": "failure",
      "hmcts.error.code": "dictation.no_transcript",
      "dictation.end_reason": "page_hidden",
    });
  });

  it("ends with autosave.failed when autosave stalled and never recovered", () => {
    const { telemetry, named } = setup();
    telemetry.recordingRequested({ sessionIndex: 1, reconnectAttempt: 0 });
    telemetry.segmentCaptured();
    telemetry.autosaveFailed({
      kind: "server",
      status: 503,
      consecutiveFailures: 3,
      secondsSinceLastSave: 30,
      trigger: "interval",
    });
    telemetry.autosaveStalled({
      kind: "server",
      consecutiveFailures: 3,
      secondsSinceLastSave: 30,
    });
    telemetry.sessionEnded("page_hidden");
    expect(named("dictation.session_ended")[0].attributes).toMatchObject({
      "hmcts.outcome": "error",
      "hmcts.error.code": "autosave.failed",
      "dictation.autosave_failures": 1,
    });
  });

  it("ends a submitted session as a success and starts a new journey afterwards", () => {
    const { telemetry, named } = setup();
    telemetry.recordingRequested({ sessionIndex: 1, reconnectAttempt: 0 });
    telemetry.segmentCaptured();
    telemetry.submissionFinished({
      ok: true,
      mode: "mic",
      durationMs: 900,
    });
    telemetry.sessionEnded("submitted");
    telemetry.recordingRequested({ sessionIndex: 2, reconnectAttempt: 0 });

    const [ended] = named("dictation.session_ended");
    expect(ended.attributes?.["hmcts.outcome"]).toBe("success");
    const requested = named("dictation.session_requested");
    expect(requested[0].journey?.id).not.toBe(requested[1].journey?.id);
  });

  it("drops a malformed SDK session ID rather than sending it", () => {
    const { telemetry, named } = setup();
    telemetry.speechSessionStarted({
      sessionId: "not-a-session",
      sessionIndex: 1,
      reconnectAttempt: 0,
    });
    expect(
      named("speech.session_started")[0].attributes?.["speech.session_id"]
    ).toBeUndefined();
  });

  it("does not treat a restored or typed-only submission as a dictation session", () => {
    const { telemetry, named } = setup();
    telemetry.restoreFinished({ ok: true });
    telemetry.autosaveFailed({
      kind: "network",
      consecutiveFailures: 1,
      secondsSinceLastSave: null,
      trigger: "interval",
    });
    telemetry.submissionFinished({ ok: true, mode: "mic", durationMs: 500 });
    telemetry.sessionEnded("submitted");
    expect(named("dictation.session_ended")).toHaveLength(0);
    expect(named("live_draft.restore_finished")[0].journey).toBeUndefined();
  });

  it("does not start a dictation for a reconnect after a submission, only for the user", () => {
    const { telemetry, named } = setup();
    telemetry.recordingRequested({ sessionIndex: 1, reconnectAttempt: 0 });
    telemetry.segmentCaptured();
    telemetry.sessionEnded("submitted");
    // The recognizer collapses and reconnects before the page navigates away.
    telemetry.recordingRequested({ sessionIndex: 2, reconnectAttempt: 1 });
    telemetry.sessionEnded("left_page");
    expect(named("dictation.session_requested")).toHaveLength(1);
    expect(named("dictation.session_ended")).toHaveLength(1);

    telemetry.recordingRequested({ sessionIndex: 3, reconnectAttempt: 0 });
    expect(named("dictation.session_requested")).toHaveLength(2);
  });

  it("counts a stopping recognizer's late final for the dictation, not the running Speech session", () => {
    const { telemetry, named } = setup();
    telemetry.recordingRequested({ sessionIndex: 1, reconnectAttempt: 0 });
    telemetry.speechSessionStarted({
      sessionId: SDK_SESSION,
      sessionIndex: 1,
      reconnectAttempt: 0,
    });
    telemetry.segmentCaptured();
    telemetry.segmentCaptured({ stoppedSession: true });
    telemetry.sessionEnded("submitted");
    expect(
      named("speech.session_stopped")[0].attributes?.[
        "dictation.segments_captured"
      ]
    ).toBe(1);
    expect(
      named("dictation.session_ended")[0].attributes?.[
        "dictation.segments_captured"
      ]
    ).toBe(2);
  });
});
