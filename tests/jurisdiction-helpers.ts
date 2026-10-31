/**
 * Jurisdictions for component tests (DIAAT-322).
 *
 * `IAC` is the IAC as transcribe-api creates it (fixtures/iac-jurisdiction.json,
 * generated from migration 0004), so a test rendered in it sees the text the
 * screens showed before jurisdictions. Mock the provider module with it:
 *
 *   vi.mock("@/providers/jurisdiction", async () =>
 *     (await import("../jurisdiction-helpers")).mockJurisdictionModule("IAC"));
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
  role: "judge",
  template: null,
  features: { hearing_recordings: false },
  wording: {},
};

const JURISDICTIONS = { IAC, ET } as const;

export function mockJurisdictionModule(code: keyof typeof JURISDICTIONS) {
  const value = jurisdictionContextValue(JURISDICTIONS[code], [
    JURISDICTIONS[code],
  ]);
  return {
    JurisdictionProvider: ({ children }: { children: React.ReactNode }) =>
      children,
    useJurisdiction: () => value,
    useWording: () => value.wording,
  };
}
