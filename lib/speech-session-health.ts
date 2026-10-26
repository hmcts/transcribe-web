/**
 * Speech session health â€” pure decision logic.
 *
 * DIAAT-297: a judge dictated for 44 minutes into a session that was collapsing
 * and restarting continuously (37 token fetches, zero captured segments) and the
 * UI presented the whole time as a healthy recording. The rules for "is this
 * session actually working?" live here, free of React and of the Speech SDK, so
 * they can be tested directly.
 */

import { getEnv } from "@/lib/env";

/** How a dictation session is behaving right now. */
export type SpeechSessionHealth =
  /** Not recording. */
  | "idle"
  /** Recording requested, first connection not yet established. */
  | "starting"
  /** Connected and stable â€” speech is being captured. */
  | "healthy"
  /** Dropped once and reconnecting. Speech is not being captured right now. */
  | "recovering"
  /** Collapsing repeatedly. Treat as not recording at all. */
  | "failed";

export interface SpeechCancellationInfo {
  /** `CancellationReason` name, e.g. "Error", "EndOfStream". */
  reason: string;
  /** `CancellationErrorCode` name, when the SDK supplied one. */
  errorCode?: string;
  errorDetails?: string;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_COLLAPSE_THRESHOLD = 3;
const DEFAULT_COLLAPSE_WINDOW_SECONDS = 120;
const DEFAULT_NO_SPEECH_WARNING_SECONDS = 90;

function readPositiveInt(
  key: `NEXT_PUBLIC_${string}`,
  fallback: number
): number {
  const raw = getEnv(key);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? fallback : parsed;
}

/**
 * How many session collapses inside the window mean the session is broken
 * rather than merely blipping. Two or three is already unambiguous â€” a working
 * session collapses zero times.
 */
export function getCollapseThreshold(): number {
  return readPositiveInt(
    "NEXT_PUBLIC_SPEECH_COLLAPSE_THRESHOLD",
    DEFAULT_COLLAPSE_THRESHOLD
  );
}

/** Sliding window, in ms, over which collapses are counted. */
export function getCollapseWindowMs(): number {
  return (
    readPositiveInt(
      "NEXT_PUBLIC_SPEECH_COLLAPSE_WINDOW_SECONDS",
      DEFAULT_COLLAPSE_WINDOW_SECONDS
    ) * 1000
  );
}

/**
 * How long recording may run with all transcript sections still empty before
 * the user is told, explicitly, that nothing is being captured.
 */
export function getNoSpeechWarningMs(): number {
  return (
    readPositiveInt(
      "NEXT_PUBLIC_NO_SPEECH_WARNING_SECONDS",
      DEFAULT_NO_SPEECH_WARNING_SECONDS
    ) * 1000
  );
}

// ---------------------------------------------------------------------------
// Collapse tracking
// ---------------------------------------------------------------------------

/** Drop collapse timestamps that have aged out of the sliding window. */
export function pruneCollapseTimestamps(
  timestamps: readonly number[],
  now: number,
  windowMs: number
): number[] {
  const cutoff = now - windowMs;
  return timestamps.filter((timestamp) => timestamp >= cutoff);
}

export function isUnhealthyCollapseCount(
  collapsesInWindow: number,
  threshold: number
): boolean {
  return collapsesInWindow >= threshold;
}

const RECONNECT_BASE_DELAY_MS = 250;
const RECONNECT_MAX_DELAY_MS = 8_000;

/**
 * Delay before reconnect attempt `attempt` (1-based).
 *
 * The pre-fix behaviour was an unthrottled restart loop driven by a render
 * effect, which is what produced a token fetch every 20 s for 44 minutes. Back
 * off â€” but never give up: a judge mid-hearing needs us to keep trying. The
 * loudness lives in the UI, not in abandoning the session.
 */
export function reconnectDelayMs(attempt: number): number {
  const exponent = Math.max(0, attempt - 1);
  return Math.min(
    RECONNECT_MAX_DELAY_MS,
    RECONNECT_BASE_DELAY_MS * 2 ** exponent
  );
}

// ---------------------------------------------------------------------------
// Health derivation
// ---------------------------------------------------------------------------

export interface DeriveSpeechHealthInput {
  /** The user has asked to be recording (start pressed, not paused). */
  recordingIntended: boolean;
  /** The SDK reported `sessionStarted` and has not since terminated. */
  sdkConnected: boolean;
  collapsesInWindow: number;
  collapseThreshold: number;
}

export function deriveSpeechHealth({
  recordingIntended,
  sdkConnected,
  collapsesInWindow,
  collapseThreshold,
}: DeriveSpeechHealthInput): SpeechSessionHealth {
  if (!recordingIntended) return "idle";

  // Checked before `sdkConnected` on purpose. A reconnect loop reports
  // sessionStarted between every collapse, so a session that is thrashing would
  // otherwise flicker back to "healthy" and hide the banner â€” which is the
  // original defect in a new form.
  if (isUnhealthyCollapseCount(collapsesInWindow, collapseThreshold)) {
    return "failed";
  }

  if (sdkConnected) return "healthy";
  return collapsesInWindow > 0 ? "recovering" : "starting";
}

/** True when speech is definitely not reaching the transcription service. */
export function isCapturingSpeech(health: SpeechSessionHealth): boolean {
  return health === "healthy";
}
