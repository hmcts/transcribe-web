"use client";

import type { SaveStatus } from "@/lib/autosave-alerts";
import cn from "@/lib/utils";

export interface RecordStatusRowProps {
  /** Capture state from DIAAT-297, e.g. "Recording". Null when not recording. */
  speechLabel: string | null;
  /** Whether speech is genuinely being captured, not whether it was asked for. */
  isCapturing: boolean;
  /** Save state from DIAAT-296. Null when there is nothing to save. */
  saveStatus: SaveStatus | null;
}

const SAVE_TONE_CLASS: Record<SaveStatus["tone"], string> = {
  ok: "text-muted-foreground",
  pending: "text-muted-foreground",
  error: "text-red-700 dark:text-red-400",
};

/**
 * The record page's status row: is my dictation being captured, and is it being
 * kept?
 *
 * The two halves come from the two incidents â€” DIAAT-297 added the capture
 * state, DIAAT-296 adds the save state â€” but they are one row and one live
 * region on purpose. They answer a single question between them, and a judge
 * glancing down mid-sentence should read one line, not hunt across two widgets.
 * Two separate `role="status"` regions would also announce independently and
 * could interleave into nonsense for a screen-reader user.
 *
 * Polite, not assertive: this row is the reassuring case. Anything that needs
 * to interrupt goes to the banner (`record-alert-banner`), which is assertive.
 */
export default function RecordStatusRow({
  speechLabel,
  isCapturing,
  saveStatus,
}: RecordStatusRowProps) {
  if (!speechLabel && !saveStatus) return null;

  return (
    <span
      role="status"
      aria-live="polite"
      className="flex min-w-0 items-center gap-1.5 text-xs font-semibold"
    >
      {speechLabel && (
        <span
          data-testid="speech-status-label"
          className={cn(
            "whitespace-nowrap",
            isCapturing
              ? "text-muted-foreground"
              : "text-red-700 dark:text-red-400"
          )}
        >
          {speechLabel}
        </span>
      )}
      {speechLabel && saveStatus && (
        <span aria-hidden="true" className="text-muted-foreground/60">
          &middot;
        </span>
      )}
      {saveStatus && (
        <span
          data-testid="save-status-label"
          data-tone={saveStatus.tone}
          className={cn("whitespace-nowrap", SAVE_TONE_CLASS[saveStatus.tone])}
        >
          {saveStatus.label}
        </span>
      )}
    </span>
  );
}
