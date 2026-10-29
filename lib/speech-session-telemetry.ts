/**
 * Speech session lifecycle telemetry.
 *
 * DIAAT-297: the 44-minute reconnect loop was only ever *inferred*, after the
 * fact, from the frequency of `GET /api/get-speech-token` in the backend logs.
 * The browser knew exactly what was happening â€” sessionStarted, canceled with a
 * reason and an error code, sessionStopped â€” and reported none of it.
 *
 * There is no browser-side App Insights SDK in this app, and the Caddy config
 * sends every `/api/*` path to the backend service, so a Next.js route handler
 * here is unreachable in production. The two client-side sinks that do exist are
 * PostHog (`lib/analytics`) and Sentry. Both are queryable, so both are used:
 * PostHog for the full lifecycle stream (funnel/frequency analysis of the loop)
 * and Sentry for the "this session is broken" signal that should page someone.
 *
 * OBS-4: every event also goes to Application Insights through the first-party
 * relay (`lib/dictation-session`), as one dictation-session journey with timings.
 * The relay carries no free text: the cancellation's `errorDetails` is not sent.
 */

import * as Sentry from "@sentry/nextjs";
import { track } from "@/lib/analytics";
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
  segmentCaptured(): void;
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
    track("speech_session_started", {
      session_index: sessionIndex,
      reconnect_attempt: reconnectAttempt,
    });
    dictationSessionTelemetry.speechSessionStarted({
      sessionId,
      sessionIndex,
      reconnectAttempt,
    });
  },

  firstText(input) {
    dictationSessionTelemetry.firstText(input);
  },

  segmentCaptured() {
    dictationSessionTelemetry.segmentCaptured();
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
    track("speech_session_stopped", {
      session_index: sessionIndex,
      duration_ms: durationMs,
      segments_captured: segmentsCaptured,
      user_initiated: userInitiated,
    });
    dictationSessionTelemetry.speechSessionStopped({
      sessionId,
      sessionIndex,
      durationMs,
      segmentsCaptured,
      userInitiated,
    });
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
    track("speech_session_canceled", {
      session_index: sessionIndex,
      reason: cancellation.reason,
      error_code: cancellation.errorCode ?? null,
      error_details: cancellation.errorDetails ?? null,
      collapses_in_window: collapsesInWindow,
    });
  },

  sessionUnhealthy({ collapsesInWindow, windowSeconds, cancellation }) {
    dictationSessionTelemetry.speechUnhealthy({
      collapsesInWindow,
      windowSeconds,
      reason: cancellation?.reason,
      errorCode: cancellation?.errorCode,
    });
    track("speech_session_unhealthy", {
      collapses_in_window: collapsesInWindow,
      window_seconds: windowSeconds,
      last_reason: cancellation?.reason ?? null,
      last_error_code: cancellation?.errorCode ?? null,
    });

    // Sentry, not just PostHog: a dictation session collapsing this often is a
    // data-loss incident in progress, not a usage statistic.
    Sentry.captureMessage(
      `Speech session collapsed ${collapsesInWindow} times in ${windowSeconds}s`,
      {
        level: "error",
        tags: {
          feature: "live-dictation",
          speech_cancellation_reason: cancellation?.reason ?? "unknown",
          speech_error_code: cancellation?.errorCode ?? "unknown",
        },
        extra: {
          collapsesInWindow,
          windowSeconds,
          errorDetails: cancellation?.errorDetails ?? null,
        },
      }
    );
  },

  noSpeechCaptured({ elapsedSeconds }) {
    dictationSessionTelemetry.noSpeechWarning({ elapsedSeconds });
    track("speech_no_content_warning_shown", {
      elapsed_seconds: elapsedSeconds,
    });

    Sentry.captureMessage(
      `Dictation ran ${elapsedSeconds}s with no captured speech`,
      {
        level: "warning",
        tags: { feature: "live-dictation" },
        extra: { elapsedSeconds },
      }
    );
  },
};
