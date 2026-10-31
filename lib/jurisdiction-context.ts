import type {
  CurrentJurisdiction,
  JurisdictionSummary,
} from "@/lib/jurisdiction-api";
import { type WordingKey, wordingFor } from "@/lib/jurisdiction-wording";

/** What components see of the jurisdiction they work in (DIAAT-330). */
export interface JurisdictionContextValue {
  current: CurrentJurisdiction | null;
  jurisdictions: JurisdictionSummary[];
  wording: (key: WordingKey) => string;
  /** Uses the IAC hearing form and decision document (DIAAT-323 adds more). */
  hasDecisionTemplate: boolean;
  hasHearingRecordings: boolean;
}

export const NEUTRAL: JurisdictionContextValue = {
  current: null,
  jurisdictions: [],
  wording: (key) => wordingFor(undefined, key),
  hasDecisionTemplate: false,
  hasHearingRecordings: false,
};

/** What components see when working in `current` (or outside any jurisdiction). */
export function jurisdictionContextValue(
  current: CurrentJurisdiction | null,
  jurisdictions: JurisdictionSummary[] = []
): JurisdictionContextValue {
  if (!current) return { ...NEUTRAL, jurisdictions };
  return {
    current,
    jurisdictions,
    wording: (key) => wordingFor(current.wording, key),
    hasDecisionTemplate: current.template === "iac_decision",
    hasHearingRecordings: current.features.hearing_recordings,
  };
}
