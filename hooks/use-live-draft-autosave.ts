"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DictationFormValues } from "@/components/audio/dictation/formData";
import type { SectionedTranscript } from "@/components/audio/dictation/types";
import {
  type AutosaveState,
  getAutosaveRetryDelayMs,
  INITIAL_AUTOSAVE_STATE,
  isAutosaveFailing,
  recordAutosaveFailure,
  recordAutosaveSuccess,
} from "@/lib/autosave-state";
import { putLiveDraft } from "@/lib/live-draft-api";
import { LiveDraftError, liveDraftFailureKind } from "@/lib/live-draft-errors";
import {
  type AutosaveTrigger,
  liveDraftTelemetry,
} from "@/lib/live-draft-telemetry";

export interface LiveDraftPayload {
  transcript: SectionedTranscript;
  formData: Partial<DictationFormValues>;
}

export interface UseLiveDraftAutosaveOptions {
  /**
   * The current draft, or null when there is nothing worth saving.
   *
   * Returning null is how the caller keeps the existing content gating: the
   * page only writes when a transcript section is non-empty. That gating is
   * correct and deliberate, so it stays with the caller rather than being
   * re-decided here.
   */
  getPayload: () => LiveDraftPayload | null;
}

export interface UseLiveDraftAutosaveResult {
  state: AutosaveState;
  /** Write the current payload now. Safe to call while one is in flight. */
  saveNow: (trigger: AutosaveTrigger) => void;
}

/**
 * Owns live-draft writes: the attempt, the retry schedule, and the record of
 * whether saving is currently working.
 *
 * DIAAT-296: the three call sites in `app/record/page.tsx` each ended in
 * `.catch(err => console.warn(...))`, so when saving stopped the only trace was
 * a console line nobody was looking at, and the next attempt was whatever the
 * 3-second interval did next â€” independently, with no memory that the last one
 * had failed. A judge dictated for roughly fifty minutes into that.
 *
 * The retry is owned here so a failure is followed by a deliberate, backed-off
 * attempt rather than by luck, and so that one place knows how long saving has
 * been broken. The caller reads `state` and turns it into what the user sees;
 * see `lib/autosave-alerts.ts`.
 */
export function useLiveDraftAutosave({
  getPayload,
}: UseLiveDraftAutosaveOptions): UseLiveDraftAutosaveResult {
  const [state, setState] = useState<AutosaveState>(INITIAL_AUTOSAVE_STATE);

  // The authoritative copy. The retry runs from a timer and must not read a
  // React state value captured when the timer was scheduled.
  const stateRef = useRef<AutosaveState>(INITIAL_AUTOSAVE_STATE);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const isMountedRef = useRef(true);
  /**
   * Whether this failure run has already been escalated. Sentry should hear
   * "autosave has stopped" once per outage, not once per retry.
   */
  const escalatedRef = useRef(false);
  /**
   * The trigger of the most recent saveNow call that arrived while a PUT was
   * in-flight. The payload is always read fresh via getPayloadRef at attempt()
   * time, so only the trigger needs to be stored — not the data itself.
   */
  const pendingTriggerRef = useRef<AutosaveTrigger | null>(null);
  const getPayloadRef = useRef(getPayload);
  getPayloadRef.current = getPayload;

  const commit = useCallback((next: AutosaveState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const clearRetry = useCallback(() => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const attemptRef = useRef<((trigger: AutosaveTrigger) => void) | null>(null);

  const attempt = useCallback(
    (trigger: AutosaveTrigger) => {
      const payload = getPayloadRef.current();
      if (!payload) return;
      // A second concurrent PUT could land out of order and persist the older
      // transcript over the newer one. Queue the trigger so the latest payload
      // is written once the in-flight request settles.
      if (inFlightRef.current) {
        pendingTriggerRef.current = trigger;
        return;
      }

      clearRetry();
      // Any previously queued trigger is absorbed into this attempt's payload
      // (getPayloadRef.current() always returns the latest content).
      pendingTriggerRef.current = null;
      inFlightRef.current = true;

      void putLiveDraft(payload.transcript, payload.formData)
        .then(() => {
          inFlightRef.current = false;
          if (!isMountedRef.current) {
            pendingTriggerRef.current = null;
            return;
          }

          const previous = stateRef.current;
          if (previous.consecutiveFailures > 0) {
            liveDraftTelemetry.saveRecovered({
              consecutiveFailures: previous.consecutiveFailures,
              outageMs:
                previous.failingSince === null
                  ? 0
                  : Date.now() - previous.failingSince,
            });
          }
          escalatedRef.current = false;
          commit(recordAutosaveSuccess(Date.now()));

          // Flush any save that arrived while this PUT was in-flight.
          const pending = pendingTriggerRef.current;
          if (pending !== null) {
            pendingTriggerRef.current = null;
            attemptRef.current?.(pending);
          }
        })
        .catch((error: unknown) => {
          inFlightRef.current = false;
          if (!isMountedRef.current) return;

          const kind = liveDraftFailureKind(error);
          const now = Date.now();
          const next = recordAutosaveFailure(stateRef.current, kind, now);
          commit(next);

          liveDraftTelemetry.saveFailed({
            kind,
            status: error instanceof LiveDraftError ? error.status : undefined,
            consecutiveFailures: next.consecutiveFailures,
            msSinceLastSave:
              next.lastSavedAt === null ? null : now - next.lastSavedAt,
            trigger,
          });

          if (isAutosaveFailing(next) && !escalatedRef.current) {
            escalatedRef.current = true;
            liveDraftTelemetry.autosaveStalled({
              kind,
              consecutiveFailures: next.consecutiveFailures,
              msSinceLastSave:
                next.lastSavedAt === null ? null : now - next.lastSavedAt,
            });
          }

          // Keep trying. A judge mid-hearing needs saving to come back on its
          // own the moment the network does, not to have to notice and act.
          // Carry the queued trigger forward: if a 'late-finalisation' or 'pause'
          // was pending when this PUT failed, the retry reports that original
          // intent to telemetry rather than always appearing as 'retry'.
          clearRetry();
          const retryTrigger = pendingTriggerRef.current ?? "retry";
          pendingTriggerRef.current = null;
          retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null;
            attemptRef.current?.(retryTrigger);
          }, getAutosaveRetryDelayMs(next.consecutiveFailures));
        });
    },
    [clearRetry, commit]
  );

  attemptRef.current = attempt;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      // Best-effort: if saves have been failing (the retry timer we just
      // cancelled was our only recovery path) or a save was queued but never
      // flushed, fire one final PUT. The response cannot update React state
      // (the component is gone) but the browser completes the request in the
      // background — critical when a judge navigates away during an outage.
      if (!inFlightRef.current) {
        const shouldAttempt =
          stateRef.current.consecutiveFailures > 0 ||
          pendingTriggerRef.current !== null;
        if (shouldAttempt) {
          const payload = getPayloadRef.current();
          if (payload) {
            void putLiveDraft(payload.transcript, payload.formData).catch(
              () => {
                // Best-effort only — component is unmounted, nothing to update.
              }
            );
          }
        }
      }
    };
  }, []);

  const saveNow = useCallback(
    (trigger: AutosaveTrigger) => attemptRef.current?.(trigger),
    []
  );

  return { state, saveNow };
}
