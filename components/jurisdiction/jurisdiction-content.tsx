"use client";

import type React from "react";
import type { WordingKey } from "@/lib/jurisdiction-wording";
import { useJurisdiction } from "@/providers/jurisdiction";

/**
 * Content about the IAC hearing form and decision document, shown only in a
 * jurisdiction that uses it (DIAAT-330); `otherwise` is shown everywhere else.
 */
export function DecisionTemplateOnly({
  children,
  otherwise = null,
}: {
  children: React.ReactNode;
  otherwise?: React.ReactNode;
}) {
  return <>{useJurisdiction().hasDecisionTemplate ? children : otherwise}</>;
}

/** The current jurisdiction's text for `wordingKey`, from a server-rendered page. */
export function JurisdictionText({ wordingKey }: { wordingKey: WordingKey }) {
  return <>{useJurisdiction().wording(wordingKey)}</>;
}
