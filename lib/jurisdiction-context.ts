import type { JurisdictionRef } from "@/lib/access/types";
import type { CurrentJurisdiction } from "@/lib/jurisdiction-api";
import { type WordingKey, wordingFor } from "@/lib/jurisdiction-wording";

/** The IAC's code, as transcribe-api creates it (domain/jurisdictions.py). */
export const IAC_CODE = "IAC";

/** What components see of the jurisdiction they work in (DIAAT-330). Who the
 * user is and what they may do is the access provider's (providers/access.tsx). */
export interface JurisdictionContextValue {
  current: CurrentJurisdiction | null;
  /** The jurisdictions the user holds a role in. */
  jurisdictions: JurisdictionRef[];
  wording: (key: WordingKey) => string;
  /** Uses the IAC hearing form and decision document (DIAAT-323 adds more). */
  hasDecisionTemplate: boolean;
  hasHearingRecordings: boolean;
  /** The provider has finished loading which jurisdiction this tab works in
   * (`current` may still be null: none, or the load failed). */
  resolved: boolean;
}

export const NEUTRAL: JurisdictionContextValue = {
  current: null,
  jurisdictions: [],
  wording: (key) => wordingFor(undefined, key),
  hasDecisionTemplate: false,
  hasHearingRecordings: false,
  resolved: false,
};

/** What components see when working in `current` (or outside any jurisdiction). */
export function jurisdictionContextValue(
  current: CurrentJurisdiction | null,
  jurisdictions: JurisdictionRef[] = []
): JurisdictionContextValue {
  if (!current) return { ...NEUTRAL, jurisdictions, resolved: true };
  return {
    current,
    resolved: true,
    jurisdictions,
    wording: (key) => wordingFor(current.wording, key),
    hasDecisionTemplate: current.template === "iac_decision",
    hasHearingRecordings: current.features.hearing_recordings,
  };
}
