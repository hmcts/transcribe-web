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
  /**
   * Run `operation` (deleting the draft) with no write in flight or starting:
   * waits for the write in flight, holds every save that arrives meanwhile
   * (including retries and the flush on unmount), then writes the latest
   * content once `operation` has finished. A write can therefore never land
   * before or alongside the delete, bringing deleted content back or deleting
   * newer content.
   */
  runExclusive: <T>(operation: () => Promise<T>) => Promise<T>;
  /**
   * Stop saving for good: drop queued saves and retries, wait for the write in
   * flight, and never write again, not even on unmount. Call before a
   * submission deletes the draft.
   */
  stop: () => Promise<void>;
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
  /** The write in flight, settled once its handlers have run. */
  const inFlightPromiseRef = useRef<Promise<void> | null>(null);
  const stoppedRef = useRef(false);
  /** Operations in progress under runExclusive; writes wait while non-zero. */
  const exclusiveRef = useRef(0);
  /** The flush on unmount was due while writes were held. */
  const flushHeldRef = useRef(false);
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

  /**
   * One last write after unmount: no React updates and no retries. The browser
   * completes the request in the background, which matters when a judge
   * navigates away during an outage.
   */
  const flushAfterUnmount = useCallback(() => {
    if (stoppedRef.current) return;
    if (exclusiveRef.current > 0) {
      flushHeldRef.current = true; // runExclusive writes it afterwards
      return;
    }
    const payload = getPayloadRef.current();
    if (!payload) return;
    void putLiveDraft(payload.transcript, payload.formData).catch(() => {
      // Best-effort only — component is unmounted, nothing to update.
    });
  }, []);

  const attemptRef = useRef<((trigger: AutosaveTrigger) => void) | null>(null);

  const attempt = useCallback(
    (trigger: AutosaveTrigger) => {
      if (stoppedRef.current) return;
      const payload = getPayloadRef.current();
      if (!payload) return;
      // A second concurrent PUT could land out of order and persist the older
      // transcript over the newer one, and a PUT alongside a delete could undo
      // it. Queue the trigger so the latest payload is written once the
      // in-flight request or exclusive operation has finished.
      if (inFlightRef.current || exclusiveRef.current > 0) {
        pendingTriggerRef.current = trigger;
        return;
      }

      clearRetry();
      // Any previously queued trigger is absorbed into this attempt's payload
      // (getPayloadRef.current() always returns the latest content).
      pendingTriggerRef.current = null;
      inFlightRef.current = true;

      const write = putLiveDraft(payload.transcript, payload.formData)
        .then(() => {
          inFlightRef.current = false;
          if (stoppedRef.current) return;
          if (!isMountedRef.current) {
            // A newer save queued behind this one would otherwise be lost.
            const hadPending = pendingTriggerRef.current !== null;
            pendingTriggerRef.current = null;
            if (hadPending) flushAfterUnmount();
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
          if (stoppedRef.current) return;
          if (!isMountedRef.current) {
            // Unmounted while this write was failing: the retry that would
            // have recovered is gone, so make the one final attempt here.
            pendingTriggerRef.current = null;
            flushAfterUnmount();
            return;
          }

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
      inFlightPromiseRef.current = write;
      void write.finally(() => {
        if (inFlightPromiseRef.current === write)
          inFlightPromiseRef.current = null;
      });
    },
    [clearRetry, commit, flushAfterUnmount]
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
      // If saves have been failing (the retry timer we just cancelled was our
      // only recovery path) or a save was queued but never flushed, write once
      // more. With a write in flight, its settle handler does this instead,
      // after it, so the two cannot land out of order.
      if (!inFlightRef.current) {
        const shouldAttempt =
          stateRef.current.consecutiveFailures > 0 ||
          pendingTriggerRef.current !== null;
        pendingTriggerRef.current = null;
        if (shouldAttempt) flushAfterUnmount();
      }
    };
  }, [flushAfterUnmount]);

  const saveNow = useCallback(
    (trigger: AutosaveTrigger) => attemptRef.current?.(trigger),
    []
  );

  /** Resolve once no write is in flight. New writes cannot start meanwhile. */
  const settleInFlight = useCallback(async () => {
    while (inFlightPromiseRef.current) await inFlightPromiseRef.current;
  }, []);

  const runExclusive = useCallback(
    async <T>(operation: () => Promise<T>): Promise<T> => {
      exclusiveRef.current += 1;
      try {
        await settleInFlight();
        return await operation();
      } finally {
        exclusiveRef.current -= 1;
        if (exclusiveRef.current === 0) {
          const pending = pendingTriggerRef.current;
          if (!isMountedRef.current) {
            const flushHeld = flushHeldRef.current;
            flushHeldRef.current = false;
            pendingTriggerRef.current = null;
            if (flushHeld || pending !== null) flushAfterUnmount();
          } else if (pending !== null) {
            pendingTriggerRef.current = null;
            attemptRef.current?.(pending);
          }
        }
      }
    },
    [settleInFlight, flushAfterUnmount]
  );

  const stop = useCallback(async () => {
    stoppedRef.current = true;
    clearRetry();
    pendingTriggerRef.current = null;
    await settleInFlight();
  }, [clearRetry, settleInFlight]);

  return { state, saveNow, runExclusive, stop };
}
