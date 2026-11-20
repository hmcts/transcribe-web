"use client";

import type { WordingKey } from "@/lib/jurisdiction-wording";
import { useJurisdiction } from "@/providers/jurisdiction";

/** The current jurisdiction's text for `wordingKey`, from a server-rendered page. */
export function JurisdictionText({ wordingKey }: { wordingKey: WordingKey }) {
  return <>{useJurisdiction().wording(wordingKey)}</>;
}
