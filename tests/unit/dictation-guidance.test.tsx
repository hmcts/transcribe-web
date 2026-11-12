import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// DIAAT-373: Help describes dictation only to a role that uses it, and only while dictation is
// switched on (the runtime flag): an administrator switching it off takes the instructions away too.

let persona: "judge" | "legal";
vi.mock("@/providers/access", async () => {
  const helpers = await import("../access-helpers");
  return helpers.mockAccessModule(() =>
    persona === "judge" ? helpers.ME.judge : helpers.ME.legalTextManager
  );
});

import { DictationGuidance } from "@/components/flags/dictation-guidance";

afterEach(() => vi.unstubAllEnvs());

describe("DictationGuidance", () => {
  it.each([
    ["judge", "true", true],
    ["judge", "false", false], // dictation switched off: the guidance goes with it
    ["legal", "true", false], // a role that does not dictate never saw it
    ["legal", "false", false],
  ] as const)("as %s with dictation %s: shown is %s", (who, flag, shown) => {
    persona = who;
    vi.stubEnv("NEXT_PUBLIC_DICTATION_ENABLED", flag);
    render(
      <DictationGuidance>
        <p>How to dictate</p>
      </DictationGuidance>
    );
    expect(screen.queryByText("How to dictate") !== null).toBe(shown);
  });
});
