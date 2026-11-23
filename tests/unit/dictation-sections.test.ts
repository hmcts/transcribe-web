import { describe, expect, it } from "vitest";
import {
  fitTranscript,
  IAC_SECTIONS,
  sectionEntries,
  transcriptSize,
} from "@/components/audio/dictation/types";

// DIAAT-416: the sections dictated into are the IAC decision's or a template's.

const entry = (text: string) => ({
  speaker: "Judge",
  text,
  timestamp: "10:00",
});
const SECTIONS = [
  { key: "background", label: "Background", color: "bg-blue-500" },
  { key: "box:Decision", label: "Decision", color: "bg-amber-500" },
];

describe("dictation sections (DIAAT-416)", () => {
  it("keeps the IAC decision's three sections, in order", () => {
    expect(IAC_SECTIONS.map((s) => [s.key, s.label])).toEqual([
      ["background", "Background"],
      ["evidence", "Evidence"],
      ["facts", "Facts"],
    ]);
  });

  it("reads a section with nothing yet as empty, whatever its name", () => {
    expect(sectionEntries({}, "box:Decision")).toEqual([]);
    expect(sectionEntries({}, "constructor")).toEqual([]);
    expect(sectionEntries({ background: [entry("a")] }, "background")).toEqual([
      entry("a"),
    ]);
  });

  it("counts what was dictated in every section", () => {
    expect(
      transcriptSize({
        background: [entry("a")],
        "box:Decision": [entry("b"), entry("c")],
      })
    ).toBe(3);
    expect(transcriptSize({})).toBe(0);
  });

  it("puts what is kept under a section that is not the page's in its first", () => {
    expect(
      fitTranscript(
        {
          "box:Gone": [entry("old")],
          background: [entry("a")],
          "box:Decision": [entry("b")],
        },
        SECTIONS
      )
    ).toEqual({
      background: [entry("a"), entry("old")],
      "box:Decision": [entry("b")],
    });
    expect(fitTranscript({}, SECTIONS)).toEqual({
      background: [],
      "box:Decision": [],
    });
  });
});
