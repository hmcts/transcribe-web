/**
 * The words a judge reads when dictation is not working.
 *
 * DIAAT-297 was a data-loss incident whose whole cause was that the app never
 * said anything. The copy is therefore part of the fix, and it is kept here —
 * out of the component — so it is reviewable and testable on its own.
 *
 * This is one producer for the shared record-page alert channel; see
 * `lib/record-alerts.ts` for the type and for how competing alerts are ranked.
 *
 * Three rules the wording follows:
 *  1. Lead with what is happening to their work, not with the technical fault.
 *     "Your dictation is not being recorded", not "WebSocket error 1006".
 *  2. Be explicit about what has and has not been saved. A judge deciding
 *     whether to carry on speaking or to stop and write needs that fact.
 *  3. Always give the next action. A warning with no instruction leaves someone
 *     mid-hearing guessing.
 */

import type { RecordAlert } from "@/lib/record-alerts";
import type { SpeechSessionHealth } from "@/lib/speech-session-health";

export interface DescribeSpeechAlertInput {
  health: SpeechSessionHealth;
  /** Collapses since the user pressed start. Does not self-clear. */
  totalCollapses: number;
  /** Any transcript content captured since the user pressed start. */
  hasCapturedSpeech: boolean;
  /** The no-speech watchdog has tripped. */
  noSpeechWarning: boolean;
  noSpeechThresholdSeconds: number;
}

/**
 * Threshold as a phrase. Stays in seconds below two minutes rather than
 * rounding: the default threshold is 90 seconds, and telling a judge that
 * recording "has been running for 2 minutes" when it has been running for 90
 * seconds undermines the one number in the message they might check.
 */
function formatDuration(seconds: number): string {
  if (seconds < 120) return `${seconds} seconds`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} minutes`;
}

function pluraliseInterruptions(count: number): string {
  return count === 1 ? "1 interruption" : `${count} interruptions`;
}

export function describeSpeechAlert({
  health,
  totalCollapses,
  hasCapturedSpeech,
  noSpeechWarning,
  noSpeechThresholdSeconds,
}: DescribeSpeechAlertInput): RecordAlert | null {
  if (health === "failed") {
    return {
      kind: "speech-failed",
      severity: "error",
      heading: "Your dictation is not being recorded",
      body: hasCapturedSpeech
        ? "Connection to the transcription service has been lost. Anything said since the last line in your transcript is not being captured."
        : "Connection to the transcription service has been lost. Nothing from this session has been captured.",
      guidance:
        "Pause then restart recording to restart dictation. If this warning comes back, record this decision in another way and raise with your Support team for investigation.",
      dismissible: false,
    };
  }

  if (health === "recovering") {
    return {
      kind: "speech-recovering",
      severity: "error",
      heading: "Reconnecting — pause before you continue",
      body: "The connection to the transcription service dropped and is being re-established. Speech is not being recorded until it is back.",
      guidance:
        "Wait for this message to clear before continuing to dictate, then check your transcript.",
      dismissible: false,
    };
  }

  if (noSpeechWarning && !hasCapturedSpeech) {
    return {
      kind: "speech-no-content",
      severity: "error",
      heading: "No speech has been recorded yet",
      body: `Recording has been running for ${formatDuration(
        noSpeechThresholdSeconds
      )} and nothing has been transcribed. If you have been speaking, your dictation is not being saved.`,
      guidance:
        "Check that the right microphone is selected and not muted, then pause and start recording again.",
      dismissible: false,
    };
  }

  if (health === "idle") return null;

  if (health === "healthy" && totalCollapses > 0) {
    return {
      kind: "speech-interrupted",
      severity: "warning",
      heading: `Recording resumed after ${pluraliseInterruptions(
        totalCollapses
      )}`,
      body: "Speech during the interruption was not captured. Check your transcript for a gap before you submit.",
      dismissible: true,
    };
  }

  return null;
}

/**
 * Shown after a session that hit trouble has been paused or stopped.
 *
 * Live warnings all clear when recording stops, which would leave a judge
 * looking at a short or empty transcript with nothing on screen to explain it.
 * That is precisely how the DIAAT-297 incident ended: the judge submitted three
 * empty sections and deleted the result two minutes later. This notice survives
 * the pause and points at the transcript before submission.
 */
export const SPEECH_FAILED_EARLIER_ALERT: RecordAlert = {
  kind: "speech-failed-earlier",
  severity: "error",
  heading: "Recording failed during this session",
  body: "Connection was lost whilst you were dictating so parts of your speech may not have been captured.",
  guidance:
    "Check the transcript before you submit. If incomplete, please raise with the Support team for investigation.",
  dismissible: true,
};
