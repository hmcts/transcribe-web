"use client";

import type React from "react";
import { Can } from "@/components/access/require-permission";
import { DictationOnly } from "@/components/flags/dictation-only";

/**
 * Guidance for dictation: only for a role that uses it (`dictation.use`) and only while dictation
 * is switched on (the runtime flag, else the deploy default), so an administrator switching it
 * off takes the instructions away with the feature and Help does not describe what the API refuses.
 */
export function DictationGuidance({
  children,
}: {
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <Can permission="dictation.use">
      <DictationOnly>{children}</DictationOnly>
    </Can>
  );
}
