/**
 * The record page's single alert channel.
 *
 * The record page can go wrong in more than one way at once, and each way was
 * originally discovered as its own data-loss incident:
 *  - DIAAT-297: the Speech SDK session collapses, so nothing is captured.
 *  - DIAAT-296: live-draft autosave fails, so what is captured is not saved.
 *
 * Both need the same instrument â€” a persistent, non-dismissible banner â€” so
 * they share one. Two independently-owned banners would stack red on red, and
 * could contradict each other. Producers return a `RecordAlert`;
 * `selectMostSevereAlert` decides which single one the user sees.
 */

export type RecordAlertSeverity = "error" | "warning";

export type RecordAlertKind =
  // --- speech capture (DIAAT-297) ---
  /** Session collapsing repeatedly â€” treat as not recording at all. */
  | "speech-failed"
  /** Connected, but the transcript is still empty after the threshold. */
  | "speech-no-content"
  /** Dropped and reconnecting â€” nothing is captured right now. */
  | "speech-recovering"
  /** Recording failed earlier in this session; survives the pause. */
  | "speech-failed-earlier"
  /** Nothing was transcribed in this session; survives the pause. */
  | "speech-no-content-earlier"
  /** Working again after a drop; the transcript may have a gap. */
  | "speech-interrupted"
  // --- live-draft autosave (DIAAT-296) ---
  /** Autosave is failing, so captured speech is not being persisted. */
  | "autosave-failing"
  /** Token refresh failed; the user needs to re-authenticate. */
  | "auth-expired"
  /** The restore lookup failed, so we cannot say whether a draft exists. */
  | "draft-restore-failed"
  /** The saved draft is approaching its 24h hard delete. */
  | "draft-expiring";

/**
 * Which alert wins when several are live at once. Higher wins.
 *
 * The ordering rule: **a capture failure outranks a save failure.** If nothing
 * is reaching the transcript there is nothing to save, so telling the user
 * "your dictation is not being recorded" is strictly more actionable than
 * "your transcript is not being saved" â€” and showing the save message first
 * would send them looking in the wrong place.
 *
 * Below that, anything happening *now* outranks anything already survived.
 */
export const RECORD_ALERT_PRIORITY: Record<RecordAlertKind, number> = {
  "speech-failed": 100,
  "speech-no-content": 90,
  "speech-recovering": 80,
  "auth-expired": 75,
  "autosave-failing": 70,
  // Below the two live-loss states and above the expiry warning. A failed
  // lookup is a question we could not answer rather than work being lost as
  // the user speaks, but it is actionable now â€” the alternative to showing it
  // is the DIAAT-296 defect itself, where a failed lookup was indistinguishable
  // from "you have no draft".
  "draft-restore-failed": 60,
  "speech-failed-earlier": 50,
  "speech-no-content-earlier": 48,
  "draft-expiring": 45,
  "speech-interrupted": 40,
};

export interface RecordAlert {
  kind: RecordAlertKind;
  severity: RecordAlertSeverity;
  heading: string;
  body: string;
  /** What to do next. A warning with no instruction leaves someone guessing. */
  guidance?: string;
  /**
   * False for anything that means work is being lost right now. Those must not
   * be dismissible — a notice the user can make disappear is what failed in
   * both incidents.
   */
  dismissible: boolean;
}

/**
 * Pick the one alert to show. Nulls are ignored so producers can return null
 * for "nothing wrong" without the caller filtering.
 */
export function selectMostSevereAlert(
  alerts: readonly (RecordAlert | null | undefined)[]
): RecordAlert | null {
  let winner: RecordAlert | null = null;
  for (const alert of alerts) {
    if (!alert) continue;
    if (
      winner === null ||
      RECORD_ALERT_PRIORITY[alert.kind] > RECORD_ALERT_PRIORITY[winner.kind]
    ) {
      winner = alert;
    }
  }
  return winner;
}
