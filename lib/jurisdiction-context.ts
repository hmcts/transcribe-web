import type {
  CurrentJurisdiction,
  JurisdictionSummary,
} from "@/lib/jurisdiction-api";
import { type WordingKey, wordingFor } from "@/lib/jurisdiction-wording";

/** The IAC's code, as transcribe-api creates it (domain/jurisdictions.py). */
export const IAC_CODE = "IAC";

/**
 * An admin of a jurisdiction that has legal wording (the decision template) can
 * edit it (DIAAT-342), whatever their app role. The API decides; this only tells
 * the UI where to offer the editor.
 */
export function canEditLegalWording(
  current: CurrentJurisdiction | null | undefined
): boolean {
  return current?.role === "admin" && current.template === "iac_decision";
}

/** What components see of the jurisdiction they work in (DIAAT-330). */
export interface JurisdictionContextValue {
  current: CurrentJurisdiction | null;
  jurisdictions: JurisdictionSummary[];
  wording: (key: WordingKey) => string;
  /** Uses the IAC hearing form and decision document (DIAAT-323 adds more). */
  hasDecisionTemplate: boolean;
  hasHearingRecordings: boolean;
  /** The provider has finished loading which jurisdiction this tab works in
   * (`current` may still be null: none, a choice pending, or the load failed). */
  resolved: boolean;
  /** Save this tab's work, then reload it in `code` (DIAAT-332). Rejects, and
   * stays put, if the work could not be saved or the choice was refused. */
  switchTo: (code: string) => Promise<void>;
}

export const NEUTRAL: JurisdictionContextValue = {
  current: null,
  jurisdictions: [],
  wording: (key) => wordingFor(undefined, key),
  hasDecisionTemplate: false,
  hasHearingRecordings: false,
  resolved: false,
  // Outside a jurisdiction there is nothing to switch from.
  switchTo: () => Promise.resolve(),
};

/** What components see when working in `current` (or outside any jurisdiction). */
export function jurisdictionContextValue(
  current: CurrentJurisdiction | null,
  jurisdictions: JurisdictionSummary[] = [],
  switchTo: (code: string) => Promise<void> = NEUTRAL.switchTo
): JurisdictionContextValue {
  if (!current) return { ...NEUTRAL, jurisdictions, switchTo, resolved: true };
  return {
    current,
    resolved: true,
    jurisdictions,
    switchTo,
    wording: (key) => wordingFor(current.wording, key),
    hasDecisionTemplate: current.template === "iac_decision",
    hasHearingRecordings: current.features.hearing_recordings,
  };
}
