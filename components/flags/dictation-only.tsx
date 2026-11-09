"use client";

import type React from "react";
import { useDictationEnabled } from "@/providers/runtime-flags";

/** Children only while dictation is switched on (the runtime flag, else the deploy default). */
export function DictationOnly({
  children,
}: {
  children: React.ReactNode;
}): React.ReactNode {
  const enabled = useDictationEnabled();
  return enabled ? children : null;
}
