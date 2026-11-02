/**
 * Live-draft autosave telemetry.
 *
 * DIAAT-296: the incident was only reconstructible by *inference* â€” 254
 * successful `PUT /api/live-draft` calls in the backend logs, then a gap, and
 * nothing else from that session. The browser knew exactly what had happened
 * and reported none of it, because a failure that never reaches the server is
 * completely invisible.
 *
 * Every event goes to Application Insights through the first-party relay
 * (`lib/dictation-session`, OBS-4), in the dictation session's journey. The
 * "data-loss incident in progress" alert is to be built on the stalled event
 * in transcribe-shared-infrastructure (DIAAT-205, not yet in place). Neither
 * Sentry nor PostHog is used.
 */

import { dictationSessionTelemetry } from "@/lib/dictation-session";
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
  restoreSucceeded(): void;
  restoreFailed(input: { kind: LiveDraftFailureKind; status?: number }): void;
}

export const liveDraftTelemetry: LiveDraftTelemetry = {
  saveFailed({ kind, status, consecutiveFailures, msSinceLastSave, trigger }) {
    dictationSessionTelemetry.autosaveFailed({
      kind,
      status,
      consecutiveFailures,
      secondsSinceLastSave: toSeconds(msSinceLastSave),
      trigger,
    });
  },

  autosaveStalled({ kind, consecutiveFailures, msSinceLastSave }) {
    dictationSessionTelemetry.autosaveStalled({
      kind,
      consecutiveFailures,
      secondsSinceLastSave: toSeconds(msSinceLastSave),
    });
  },

  saveRecovered({ consecutiveFailures, outageMs }) {
    dictationSessionTelemetry.autosaveRecovered({
      consecutiveFailures,
      outageSeconds: Math.round(outageMs / 1000),
    });
  },

  restoreSucceeded() {
    dictationSessionTelemetry.restoreFinished({ ok: true });
  },

  restoreFailed({ kind, status }) {
    dictationSessionTelemetry.restoreFinished({ ok: false, kind, status });
  },
};
