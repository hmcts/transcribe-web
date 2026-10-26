/**
 * Live-draft autosave telemetry.
 *
 * DIAAT-296: the incident was only reconstructible by *inference* â€” 254
 * successful `PUT /api/live-draft` calls in the backend logs, then a gap, and
 * nothing else from that session. The browser knew exactly what had happened
 * and reported none of it, because a failure that never reaches the server is
 * completely invisible.
 *
 * The ticket asks for client-side telemetry and notes there is no browser App
 * Insights SDK. There is not, and there is no easy way to add one here:
 * `@azure/monitor-opentelemetry` is server-side only, and the `Caddyfile` routes
 * every `/api/*` path to the backend service, so a Next.js route handler under
 * `app/api/*` is unreachable in production and cannot be used as an ingest
 * endpoint. The two client-side sinks that do exist are PostHog
 * (`lib/analytics`) and Sentry, and both are queryable, so this follows the
 * pattern DIAAT-297 established in `lib/speech-session-telemetry.ts`: PostHog
 * for the full event stream, Sentry for the "this is a data-loss incident in
 * progress" escalation that should page someone.
 */

import * as Sentry from "@sentry/nextjs";
import { track } from "@/lib/analytics";
import type { LiveDraftFailureKind } from "@/lib/live-draft-errors";

/** Which autosave call site produced the write. */
export type AutosaveTrigger =
  | "interval"
  | "pause"
  | "late-finalisation"
  | "retry";

function toSeconds(ms: number | null): number | null {
  return ms === null ? null : Math.round(ms / 1000);
}

export interface LiveDraftTelemetry {
  saveFailed(input: {
    kind: LiveDraftFailureKind;
    status?: number;
    consecutiveFailures: number;
    /** Null when no save has ever succeeded in this session. */
    msSinceLastSave: number | null;
    trigger: AutosaveTrigger;
  }): void;
  autosaveStalled(input: {
    kind: LiveDraftFailureKind;
    consecutiveFailures: number;
    msSinceLastSave: number | null;
  }): void;
  saveRecovered(input: { consecutiveFailures: number; outageMs: number }): void;
  restoreFailed(input: { kind: LiveDraftFailureKind; status?: number }): void;
}

export const liveDraftTelemetry: LiveDraftTelemetry = {
  saveFailed({ kind, status, consecutiveFailures, msSinceLastSave, trigger }) {
    track("live_draft_save_failed", {
      failure_kind: kind,
      status: status ?? null,
      consecutive_failures: consecutiveFailures,
      seconds_since_last_save: toSeconds(msSinceLastSave),
      trigger,
    });
  },

  autosaveStalled({ kind, consecutiveFailures, msSinceLastSave }) {
    track("live_draft_autosave_stalled", {
      failure_kind: kind,
      consecutive_failures: consecutiveFailures,
      seconds_since_last_save: toSeconds(msSinceLastSave),
    });

    // Sentry, not just PostHog. Autosave having stopped while someone is
    // dictating is a data-loss incident in progress, not a usage statistic â€”
    // this is the signal that was missing when a judge lost fifty minutes.
    Sentry.captureMessage(
      `Live-draft autosave stalled after ${consecutiveFailures} consecutive ${kind} failures`,
      {
        level: "error",
        tags: {
          feature: "live-dictation",
          live_draft_failure_kind: kind,
        },
        extra: {
          consecutiveFailures,
          secondsSinceLastSave: toSeconds(msSinceLastSave),
        },
      }
    );
  },

  saveRecovered({ consecutiveFailures, outageMs }) {
    track("live_draft_save_recovered", {
      failures_before_recovery: consecutiveFailures,
      outage_seconds: Math.round(outageMs / 1000),
    });
  },

  restoreFailed({ kind, status }) {
    track("live_draft_restore_failed", {
      failure_kind: kind,
      status: status ?? null,
    });
  },
};
