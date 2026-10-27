"use client";

import { TriangleAlert, X } from "lucide-react";
import type { RecordAlert } from "@/lib/record-alerts";
import cn from "@/lib/utils";

export interface RecordAlertBannerProps {
  /** Null renders nothing. Use `selectMostSevereAlert` to pick one. */
  alert: RecordAlert | null;
  /** Only offered for dismissible alerts. */
  onDismiss?: () => void;
  className?: string;
}

/**
 * The record page's persistent alert banner.
 *
 * DIAAT-297: the previous mechanism was `toast.error()`. A toast that fades is
 * the wrong instrument for someone speaking to a courtroom rather than watching
 * a screen, and with a session collapsing every 20 seconds it either fired and
 * was missed 37 times or was collapsed into invisibility. This is deliberately
 * the opposite: full width, solid fill, no timeout, and no dismiss control on
 * anything that means work is being lost right now.
 *
 * Shared with the autosave failure states in DIAAT-296 â€” one banner, so the two
 * failure modes cannot stack or contradict each other.
 */
export default function RecordAlertBanner({
  alert,
  onDismiss,
  className,
}: RecordAlertBannerProps) {
  if (!alert) return null;

  const isError = alert.severity === "error";

  return (
    <div
      data-testid="record-alert-banner"
      data-kind={alert.kind}
      data-severity={alert.severity}
      // Assertive for errors: a screen-reader user dictating needs to be
      // interrupted, because their work is being lost while they speak.
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      className={cn(
        "flex w-full items-start gap-3 px-4 py-3 sm:px-6",
        isError
          ? "border-b-2 border-red-900 bg-red-700 text-white dark:bg-red-800"
          : "border-b border-amber-300 bg-amber-100 text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-50",
        className
      )}
    >
      <TriangleAlert
        aria-hidden="true"
        className={cn(
          "mt-0.5 size-5 shrink-0",
          // A little movement so it registers in peripheral vision when the
          // user is looking at the courtroom, not the screen.
          isError && "animate-pulse motion-reduce:animate-none"
        )}
      />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "font-semibold",
            isError ? "text-base sm:text-lg" : "text-sm"
          )}
        >
          {alert.heading}
        </p>
        <p
          className={cn("mt-0.5", isError ? "text-sm sm:text-base" : "text-sm")}
        >
          {alert.body}
        </p>
        {alert.guidance && (
          <p className="mt-1 text-sm font-medium">{alert.guidance}</p>
        )}
      </div>
      {alert.dismissible && onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss this message"
          className={cn(
            "-mr-1 shrink-0 rounded p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current",
            isError
              ? "hover:bg-red-800"
              : "hover:bg-amber-200 dark:hover:bg-amber-900"
          )}
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      )}
    </div>
  );
}
