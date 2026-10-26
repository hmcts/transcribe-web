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
 * See the ticket write-up for the App Insights follow-up options.
 */

import * as Sentry from "@sentry/nextjs";
import { track } from "@/lib/analytics";
import type { SpeechCancellationInfo } from "@/lib/speech-session-health";

export interface SpeechSessionTelemetry {
  sessionStarted(input: {
    sessionIndex: number;
    reconnectAttempt: number;
  }): void;
  sessionStopped(input: {
    sessionIndex: number;
    durationMs: number;
    segmentsCaptured: number;
    /** False when the session ended without the user asking it to. */
    userInitiated: boolean;
  }): void;
  sessionCanceled(input: {
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
  sessionStarted({ sessionIndex, reconnectAttempt }) {
    track("speech_session_started", {
      session_index: sessionIndex,
      reconnect_attempt: reconnectAttempt,
    });
  },

  sessionStopped({
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
  },

  sessionCanceled({ sessionIndex, cancellation, collapsesInWindow }) {
    track("speech_session_canceled", {
      session_index: sessionIndex,
      reason: cancellation.reason,
      error_code: cancellation.errorCode ?? null,
      error_details: cancellation.errorDetails ?? null,
      collapses_in_window: collapsesInWindow,
    });
  },

  sessionUnhealthy({ collapsesInWindow, windowSeconds, cancellation }) {
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
