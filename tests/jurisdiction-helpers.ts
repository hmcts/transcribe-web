/**
 * Jurisdictions for component tests (DIAAT-322).
 *
 * `IAC` is the IAC as transcribe-api creates it (fixtures/iac-jurisdiction.json,
 * generated from migration 0004), so a test rendered in it sees the text the
 * screens showed before jurisdictions. Mock the provider module with it:
 *
 *   vi.mock("@/providers/jurisdiction", async () =>
 *     (await import("../jurisdiction-helpers")).mockJurisdictionModule("IAC"));
 *
 * or, to switch between tests, with a getter: `mockJurisdictionModule(() => code)`.
 */

import type React from "react";
import type { CurrentJurisdiction } from "@/lib/jurisdiction-api";
import { jurisdictionContextValue } from "@/lib/jurisdiction-context";
import iac from "./fixtures/iac-jurisdiction.json";

export const IAC = iac as CurrentJurisdiction;

/** A jurisdiction with no template, no recordings and none of its own wording. */
export const ET: CurrentJurisdiction = {
  code: "ET",
  name: "Employment Tribunal",
  template: null,
  features: { hearing_recordings: false },
  wording: {},
};

/** A jurisdiction other than the IAC that uses the decision template (DIAAT-342). */
export const DT: CurrentJurisdiction = {
  code: "DT",
  name: "Decision Tribunal",
  template: "iac_decision",
  features: { hearing_recordings: false },
  wording: {},
};

type Code = "IAC" | "ET" | "DT";

export function mockJurisdictionModule(code: Code | (() => Code)) {
  const current = typeof code === "function" ? code : () => code;
  const values = {
    IAC: jurisdictionContextValue(IAC, [IAC]),
    ET: jurisdictionContextValue(ET, [ET]),
    DT: jurisdictionContextValue(DT, [DT]),
  };
  return {
    JurisdictionProvider: ({ children }: { children: React.ReactNode }) =>
      children,
    useJurisdiction: () => values[current()],
    useWording: () => values[current()].wording,
  };
}
