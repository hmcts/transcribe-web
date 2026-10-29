/**
 * Speech session lifecycle telemetry.
 *
 * DIAAT-297: the 44-minute reconnect loop was only ever *inferred*, after the
 * fact, from the frequency of `GET /api/get-speech-token` in the backend logs.
 * The browser knew exactly what was happening â€” sessionStarted, canceled with a
 * reason and an error code, sessionStopped â€” and reported none of it.
 *
 * Every event goes to Application Insights through the first-party relay
 * (`lib/dictation-session`, OBS-4), as one dictation-session journey with
 * timings; the relay carries no free text (the cancellation's `errorDetails`
 * is not sent). The "this session is broken" alert is to be built on these
 * events in transcribe-shared-infrastructure (DIAAT-205, not yet in place).
 * Neither Sentry nor PostHog is used.
 */

import { dictationSessionTelemetry } from "@/lib/dictation-session";
import type { SpeechCancellationInfo } from "@/lib/speech-session-health";

export interface SpeechSessionTelemetry {
  /** A user start/resume (reconnectAttempt 0) or an automatic reconnect. */
  recordingRequested(input: {
    sessionIndex: number;
    reconnectAttempt: number;
  }): void;
  tokenFetched(input: {
    ok: boolean;
    status?: number;
    durationMs: number;
  }): void;
  sessionStarted(input: {
    /** Speech SDK session ID (`SessionEventArgs.sessionId`). */
    sessionId?: string;
    sessionIndex: number;
    reconnectAttempt: number;
  }): void;
  /** First transcript text of a speech session (call once per session). */
  firstText(input: { sessionId?: string; sessionIndex: number }): void;
  /** Final text captured; `stoppedSession` when it came from a recognizer that
   * is stopping (counted for the dictation, not the running Speech session). */
  segmentCaptured(input?: { stoppedSession?: boolean }): void;
  /** The user stopped recording, whether or not a session was connected. */
  paused(): void;
  sessionStopped(input: {
    sessionId?: string;
    sessionIndex: number;
    durationMs: number;
    segmentsCaptured: number;
    /** False when the session ended without the user asking it to. */
    userInitiated: boolean;
  }): void;
  /** The hook unmounted: stop the running Speech session, if any (not a pause). */
  tornDown(): void;
  sessionCanceled(input: {
    sessionId?: string;
    sessionIndex: number;
    cancellation: SpeechCancellationInfo;
    collapsesInWindow: number;
  }): void;
  sessionUnhealthy(input: {
    collapsesInWindow: number;
    windowSeconds: number;
    cancellation: SpeechCancellationInfo | null;
  }): void;
  noSpeechCaptured(input: { elapsedSeconds: number }): void;
}

export const speechSessionTelemetry: SpeechSessionTelemetry = {
  recordingRequested(input) {
    dictationSessionTelemetry.recordingRequested(input);
  },

  tokenFetched(input) {
    dictationSessionTelemetry.tokenFetched(input);
  },

  sessionStarted({ sessionId, sessionIndex, reconnectAttempt }) {
    dictationSessionTelemetry.speechSessionStarted({
      sessionId,
      sessionIndex,
      reconnectAttempt,
    });
  },

  firstText(input) {
    dictationSessionTelemetry.firstText(input);
  },

  segmentCaptured(input) {
    dictationSessionTelemetry.segmentCaptured(input);
  },

  paused() {
    dictationSessionTelemetry.recordingPaused();
  },

  sessionStopped({
    sessionId,
    sessionIndex,
    durationMs,
    segmentsCaptured,
    userInitiated,
  }) {
    dictationSessionTelemetry.speechSessionStopped({
      sessionId,
      sessionIndex,
      durationMs,
      segmentsCaptured,
      userInitiated,
    });
  },

  tornDown() {
    dictationSessionTelemetry.speechSessionTornDown();
  },

  sessionCanceled({
    sessionId,
    sessionIndex,
    cancellation,
    collapsesInWindow,
  }) {
    dictationSessionTelemetry.speechCanceled({
      sessionId,
      sessionIndex,
      reason: cancellation.reason,
      errorCode: cancellation.errorCode,
      collapsesInWindow,
    });
  },

  sessionUnhealthy({ collapsesInWindow, windowSeconds, cancellation }) {
    dictationSessionTelemetry.speechUnhealthy({
      collapsesInWindow,
      windowSeconds,
      reason: cancellation?.reason,
      errorCode: cancellation?.errorCode,
    });
  },

  noSpeechCaptured({ elapsedSeconds }) {
    dictationSessionTelemetry.noSpeechWarning({ elapsedSeconds });
  },
};
