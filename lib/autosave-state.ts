/**
 * Live-draft autosave state â€” pure decision logic.
 *
 * DIAAT-296: a judge dictated for roughly 50 minutes after autosave had stopped
 * working, because every failure was caught and written to the console. The
 * rules for "is saving actually working, and when do we say so?" live here,
 * free of React and of `fetch`, so they can be tested directly. This mirrors
 * `lib/speech-session-health.ts`, which does the same job for DIAAT-297.
 */

import { getEnv } from "@/lib/env";
import type { LiveDraftFailureKind } from "@/lib/live-draft-errors";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Consecutive failures before the banner appears.
 *
 * Two, not one: the interval save runs every 3 seconds and a single dropped
 * request is not worth interrupting someone mid-sentence for. Two consecutive
 * failures means the first retry has already failed too, which â€” with the
 * one-second first backoff â€” puts the warning on screen within a few seconds
 * of saving genuinely stopping. An auth failure bypasses this entirely; see
 * `isAutosaveFailing`.
 */
const DEFAULT_FAILURE_ALERT_THRESHOLD = 2;

/**
 * How many hours into a draft's 24-hour life the expiry warning starts.
 *
 * Four hours of warning, by default. The draft is hard-deleted by the backend
 * 24h after the last autosave, and a judge who cannot get back in loses the
 * work permanently and silently.
 */
const DEFAULT_EXPIRY_WARNING_AFTER_HOURS = 20;

/** Mirrors `_LIVE_DRAFT_MAX_AGE` in transcribe-api's `interface_dictation.py`. */
export const LIVE_DRAFT_MAX_AGE_HOURS = 24;

const RETRY_BASE_DELAY_MS = 1_000;
/**
 * Ceiling on the backoff. A judge may dictate for an hour, and unbounded
 * doubling would leave the retry hours away by the time the network returns.
 */
const RETRY_MAX_DELAY_MS = 30_000;

function readPositiveInt(
  key: `NEXT_PUBLIC_${string}`,
  fallback: number
): number {
  const raw = getEnv(key);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? fallback : parsed;
}

export function getAutosaveFailureAlertThreshold(): number {
  return readPositiveInt(
    "NEXT_PUBLIC_AUTOSAVE_FAILURE_ALERT_THRESHOLD",
    DEFAULT_FAILURE_ALERT_THRESHOLD
  );
}

export function getDraftExpiryWarningAfterHours(): number {
  return readPositiveInt(
    "NEXT_PUBLIC_LIVE_DRAFT_EXPIRY_WARNING_AFTER_HOURS",
    DEFAULT_EXPIRY_WARNING_AFTER_HOURS
  );
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface AutosaveState {
  /** Epoch ms of the last confirmed write. Null until the first one lands. */
  lastSavedAt: number | null;
  /** Failed attempts since the last success. */
  consecutiveFailures: number;
  /** Kind of the most recent failure; null when saving is working. */
  failureKind: LiveDraftFailureKind | null;
  /** Epoch ms of the first failure in the current run. */
  failingSince: number | null;
}

export const INITIAL_AUTOSAVE_STATE: AutosaveState = {
  lastSavedAt: null,
  consecutiveFailures: 0,
  failureKind: null,
  failingSince: null,
};

/**
 * A success is a full reset, so unlike `recordAutosaveFailure` it does not take
 * the previous state â€” there is nothing in it worth carrying forward.
 */
export function recordAutosaveSuccess(now: number): AutosaveState {
  return {
    lastSavedAt: now,
    consecutiveFailures: 0,
    failureKind: null,
    failingSince: null,
  };
}

export function recordAutosaveFailure(
  state: AutosaveState,
  kind: LiveDraftFailureKind,
  now: number
): AutosaveState {
  return {
    // Deliberately preserved: this is how much work is at risk, and the judge
    // is told "nothing since <this time> has been saved".
    lastSavedAt: state.lastSavedAt,
    consecutiveFailures: state.consecutiveFailures + 1,
    // Latest kind wins. An auth failure arriving after a network blip needs the
    // re-authentication message, not the network one.
    failureKind: kind,
    failingSince: state.failingSince ?? now,
  };
}

/**
 * Whether the user should be told saving has stopped.
 *
 * An auth failure short-circuits the threshold: retrying cannot fix a rejected
 * identity, so waiting for a second failure would only delay the one message
 * that leads to a fix.
 */
export function isAutosaveFailing(state: AutosaveState): boolean {
  if (state.consecutiveFailures === 0) return false;
  if (state.failureKind === "auth") return true;
  return state.consecutiveFailures >= getAutosaveFailureAlertThreshold();
}

/** Exponential backoff, from one second, doubling, capped. */
export function getAutosaveRetryDelayMs(consecutiveFailures: number): number {
  const attempt = Math.max(1, consecutiveFailures);
  return Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
}

// ---------------------------------------------------------------------------
// Draft expiry
// ---------------------------------------------------------------------------

/**
 * Milliseconds left before the backend hard-deletes the draft, counted from
 * the last save rather than from now. NaN for an unparseable timestamp.
 */
export function millisecondsUntilDraftExpiry(
  savedAt: string,
  now: number
): number {
  const savedAtMs = Date.parse(savedAt);
  if (Number.isNaN(savedAtMs)) return Number.NaN;
  return savedAtMs + LIVE_DRAFT_MAX_AGE_HOURS * 60 * 60 * 1000 - now;
}

export function isDraftNearingExpiry(savedAt: string, now: number): boolean {
  const remainingMs = millisecondsUntilDraftExpiry(savedAt, now);
  // An unparseable timestamp is not evidence of anything. Warning on it would
  // train users to ignore the warning.
  if (Number.isNaN(remainingMs)) return false;
  const warnWithinMs =
    (LIVE_DRAFT_MAX_AGE_HOURS - getDraftExpiryWarningAfterHours()) *
    60 *
    60 *
    1000;
  return remainingMs <= warnWithinMs;
}
