/**
 * The words a judge reads when their transcript has stopped being saved.
 *
 * DIAAT-296 was a data-loss incident whose whole cause was that the app never
 * said anything: 254 autosaves succeeded, the 255th failed, and every failure
 * after it went to `console.warn`. The judge kept dictating for roughly fifty
 * minutes believing her work was being saved every few seconds. The copy is
 * therefore part of the fix, and it is kept here — out of the component — so it
 * is reviewable and testable on its own.
 *
 * This is one producer for the shared record-page alert channel; see
 * `lib/record-alerts.ts` for the type and for how competing alerts are ranked,
 * and `lib/speech-alerts.ts` for the DIAAT-297 producer this mirrors.
 *
 * Three rules the wording follows, the same three as the speech alerts:
 *  1. Lead with what is happening to their work, not with the technical fault.
 *     "Your transcript is not being saved", not "PUT /api/live-draft 401".
 *  2. Be explicit about what has and has not been saved. A judge deciding
 *     whether to carry on speaking or to stop and write needs that fact, and
 *     the time of the last good save is the fact that tells them.
 *  3. Always give the next action. A warning with no instruction leaves someone
 *     mid-hearing guessing.
 */

import {
  type AutosaveState,
  isAutosaveFailing,
  isDraftNearingExpiry,
  millisecondsUntilDraftExpiry,
} from "@/lib/autosave-state";
import type { LiveDraftFailureKind } from "@/lib/live-draft-errors";
import type { RecordAlert } from "@/lib/record-alerts";

/**
 * Clock time, e.g. "14:32".
 *
 * A clock time, not "3 minutes ago": a judge scanning the screen mid-sentence
 * can compare a clock time to when they started speaking without doing
 * arithmetic, and it does not silently go stale between renders.
 */
export function formatClockTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export interface DescribeAutosaveAlertInput {
  state: AutosaveState;
}

export function describeAutosaveAlert({
  state,
}: DescribeAutosaveAlertInput): RecordAlert | null {
  if (!isAutosaveFailing(state)) return null;

  const unsavedSince =
    state.lastSavedAt === null
      ? "Nothing from this session has been saved."
      : `Nothing you have said since ${formatClockTime(
          state.lastSavedAt
        )} has been saved.`;

  if (state.failureKind === "auth") {
    return {
      kind: "auth-expired",
      severity: "error",
      heading: "You have been signed out — your transcript is not being saved",
      body: `Your sign-in has expired, so this device can no longer save to the case record. ${unsavedSince} What is on screen is still here, and is not lost unless you close this tab.`,
      guidance:
        "Open this service in a new tab and sign in again, then come back to this tab. Do not close this tab until your transcript has been saved.",
      dismissible: false,
    };
  }

  if (state.failureKind === "server") {
    return {
      kind: "autosave-failing",
      severity: "error",
      heading: "Your transcript is not being saved",
      body: `Saving to the case record has stopped working. ${unsavedSince} What is on screen will remain unless you close the tab.`,
      guidance:
        "Keep this tab open — saving will resume if the issue clears. If this message does not clear, copy your transcript somewhere safe before closing the tab.",
      dismissible: false,
    };
  }

  return {
    kind: "autosave-failing",
    severity: "error",
    heading: "Your transcript is not being saved",
    body: `Connection has been lost. ${unsavedSince} What is on screen will remain unless you close the tab.`,
    guidance:
      "Check your internet connection. When a connection is re-established, saving will resume automatically and this message will clear. If it doesn't, copy your transcript somewhere safe before closing the tab.",
    dismissible: false,
  };
}

/**
 * Shown when the restore lookup at page load could not be completed.
 *
 * The DIAAT-296 defect on the read path was a bare `catch {}` commented "API
 * unavailable — skip restore silently", which made a failed lookup
 * indistinguishable from "you have no draft". A judge coming back to find their
 * work would have been told, in effect, that it never existed.
 *
 * Dismissible, unlike the save failures: nothing is being lost at this moment,
 * and the user may reasonably want it out of the way to start a fresh dictation.
 */
export function describeDraftRestoreAlert({
  kind,
}: {
  kind: LiveDraftFailureKind;
}): RecordAlert {
  const isAuth = kind === "auth";
  return {
    kind: "draft-restore-failed",
    severity: "error",
    heading: "We could not check for an unsaved transcript",
    body: isAuth
      ? "Your sign-in was rejected, so we could not look for work saved from an earlier session. This does not mean there is nothing saved."
      : "We could not reach the service to look for work saved from an earlier session. This does not mean there is nothing saved.",
    guidance: isAuth
      ? "Sign in again and reload this page before starting a new dictation, so that any earlier transcript is offered back to you."
      : "Reload this page to try again before starting a new dictation, so that any earlier transcript is offered back to you.",
    dismissible: true,
  };
}

/** Whole hours left, phrased for someone who needs to act, not to calculate. */
function formatHoursRemaining(remainingMs: number): string {
  const hours = Math.floor(remainingMs / (60 * 60 * 1000));
  if (hours < 1) return "less than an hour";
  if (hours === 1) return "1 hour";
  return `${hours} hours`;
}

/**
 * Shown when a restored draft is approaching — or past — the backend's 24h
 * hard delete (`_LIVE_DRAFT_MAX_AGE` in `interface_dictation.py`, which deletes
 * on read). A judge who cannot get back in within a day loses the work
 * permanently, and until now silently.
 */
export function describeDraftExpiryAlert({
  savedAt,
  now,
}: {
  savedAt: string;
  now: number;
}): RecordAlert | null {
  if (!isDraftNearingExpiry(savedAt, now)) return null;
  const remainingMs = millisecondsUntilDraftExpiry(savedAt, now);

  if (remainingMs <= 0) {
    return {
      kind: "draft-expiring",
      severity: "error",
      heading: "This unsaved transcript has expired",
      body: "Unsaved transcripts are deleted 24 hours after they were last saved, and this one is past that point. It may already have been deleted, and will be as soon as it is next looked up.",
      guidance:
        "If this transcript matters, restore it and submit it now. If it is already gone, contact support — do not assume it can be recovered later.",
      dismissible: false,
    };
  }

  return {
    kind: "draft-expiring",
    severity: "warning",
    heading: `This unsaved transcript will be deleted in ${formatHoursRemaining(
      remainingMs
    )}`,
    body: "Unsaved transcripts are kept for 24 hours after they were last saved, then deleted permanently.",
    guidance:
      "Restore it and submit it before then, or it cannot be recovered.",
    dismissible: true,
  };
}

export type SaveStatusTone = "ok" | "pending" | "error";

export interface SaveStatus {
  label: string;
  tone: SaveStatusTone;
}

/**
 * The save half of the record page's status row.
 *
 * DIAAT-296 asks for a live "last saved at" state so the judge can see at a
 * glance that saving is current. It sits beside the DIAAT-297 capture status as
 * one row, because the two answer one question between them: is my work being
 * recorded, and is it being kept?
 *
 * A single failure deliberately does not change this label. The banner is what
 * escalates; the status row showing "Saved 14:32" while one retry is in flight
 * is accurate — that save did happen, and flicking to a warning for a blip that
 * self-corrects three seconds later would teach the judge to ignore the row.
 */
export function describeSaveStatus({
  state,
  hasContent,
}: {
  state: AutosaveState;
  hasContent: boolean;
}): SaveStatus | null {
  if (!hasContent) return null;
  if (isAutosaveFailing(state)) return { label: "Not saved", tone: "error" };
  if (state.lastSavedAt === null)
    return { label: "Not saved yet", tone: "pending" };
  return {
    label: `Saved ${formatClockTime(state.lastSavedAt)}`,
    tone: "ok",
  };
}
