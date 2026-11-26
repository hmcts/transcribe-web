"use client";

import type React from "react";
import { useDictationEnabled } from "@/providers/runtime-flags";

/**
 * Shown on a dictation page that was already open when an administrator switched dictation off (the
 * runtime flag, read again when the tab is refreshed or an API call is refused with 403
 * `dictation_disabled`). Nothing on the page is removed: what the user has typed or dictated stays, so
 * it can be copied out. The API now refuses to save or submit it, and this says why.
 */
export function DictationSwitchedOff(): React.ReactNode {
  if (useDictationEnabled()) return null;
  return (
    <div
      role="alert"
      className="sticky top-0 z-50 border-b border-border bg-destructive/10 px-4 py-3 text-sm text-foreground"
    >
      <strong>Dictation has been switched off.</strong> What you have already
      typed or dictated stays on this page, so copy it somewhere safe now: it
      can no longer be saved or submitted, and starting a new recording will be
      refused.
    </div>
  );
}
