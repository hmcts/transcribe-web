import { describe, expect, it } from "vitest";
import {
  type SectionSwitch,
  type SegmentTiming,
  sectionAt,
  segmentTiming,
  splitBySection,
} from "@/lib/section-switches";

// DIAAT-417: an utterance holding speech from before and after the judge switched
// section is split where they switched.

/** Words said one after another, 400 ms each, from ``at``. */
function said(words: string, at = 1000): SegmentTiming {
  const timed = words.split(" ").map((word, i) => ({
    word,
    startMs: at + i * 400,
    endMs: at + i * 400 + 350,
  }));
  return { startMs: at, endMs: timed.at(-1)?.endMs ?? at, words: timed };
}

const switched = (...changes: [number, string][]): SectionSwitch[] =>
  changes.map(([at, section]) => ({ at, section }));

describe("splitting an utterance by section (DIAAT-417)", () => {
  it("keeps an utterance whole, as Speech wrote it, when no switch falls within it", () => {
    const timing = said("the appellant arrived in twenty fourteen");
    expect(
      splitBySection(
        "The appellant arrived in 2014.",
        timing,
        "background",
        switched([100, "background"], [9000, "evidence"])
      )
    ).toEqual([
      { section: "background", text: "The appellant arrived in 2014." },
    ]);
  });

  it("gives what was said after a switch to the new section, keeping punctuation and numbers", () => {
    // the(1000) appellant(1400) arrived(1800) in(2200) twenty(2600) fourteen(3000)
    // and(3400) i(3800) heard(4200) evidence(4600); Evidence chosen at 3400.
    const timing = said(
      "the appellant arrived in twenty fourteen and i heard evidence"
    );
    expect(
      splitBySection(
        "The appellant arrived in 2014, and I heard evidence.",
        timing,
        "background",
        switched([3400, "evidence"])
      )
    ).toEqual([
      { section: "background", text: "The appellant arrived in 2014," },
      { section: "evidence", text: "And I heard evidence." },
    ]);
  });

  it("splits one utterance across several switches made while saying it, each word once", () => {
    const timing = said("first part second part third part");
    // first(1000) part(1400) second(1800) part(2200) third(2600) part(3000)
    const parts = splitBySection(
      "First part. Second part. Third part.",
      timing,
      "box:Summary",
      switched([1800, "box:Findings"], [2600, "box:Reasons"])
    );
    expect(parts).toEqual([
      { section: "box:Summary", text: "First part." },
      { section: "box:Findings", text: "Second part." },
      { section: "box:Reasons", text: "Third part." },
    ]);
    expect(parts.map((p) => p.text).join(" ")).toBe(
      "First part. Second part. Third part."
    );
  });

  it("leaves a sentence finished before the switch where it was said, though Speech closed it after", () => {
    const timing = said("the appellant attended");
    // Last word ends at 1800 + 350; Evidence chosen at 2600, before Speech's pause ended.
    expect(
      splitBySection(
        "The appellant attended.",
        timing,
        "background",
        switched([2600, "evidence"])
      )
    ).toEqual([{ section: "background", text: "The appellant attended." }]);
  });

  it("gives a word begun as the judge switched to the new section", () => {
    const timing = said("one two three");
    // two starts at 1400.
    expect(
      splitBySection(
        "One two three.",
        timing,
        "background",
        switched([1400, "evidence"])
      )
    ).toEqual([
      { section: "background", text: "One" },
      { section: "evidence", text: "Two three." },
    ]);
  });

  it("without words, leaves the utterance where it started, as before", () => {
    const timing: SegmentTiming = { startMs: 1000, endMs: 3000, words: [] };
    expect(
      splitBySection(
        "Some words.",
        timing,
        "background",
        switched([2000, "evidence"])
      )
    ).toEqual([{ section: "background", text: "Some words." }]);
  });

  it("without timing, leaves the utterance where it started", () => {
    expect(
      splitBySection(
        "Some words.",
        undefined,
        "background",
        switched([1, "evidence"])
      )
    ).toEqual([{ section: "background", text: "Some words." }]);
  });

  it("aligns written numbers with the words they stand for, as a whole", () => {
    // 105(one hundred and five) and(and) 6(six): six starts at 3000.
    const timing = said("one hundred and five and six");
    expect(
      splitBySection(
        "105 and 6.",
        timing,
        "background",
        switched([3000, "evidence"])
      )
    ).toEqual([
      { section: "background", text: "105 and" },
      { section: "evidence", text: "6." },
    ]);
  });

  it("keeps the written text when it cannot be matched to the words, splitting by position", () => {
    // More written tokens than words can be aligned with: matched from both ends.
    const timing = said("the sum was owed");
    const parts = splitBySection(
      "The sum of £1,000,000,000,000,000,000,000 was owed.",
      timing,
      "background",
      switched([1800, "evidence"])
    );
    expect(parts.map((part) => part.section)).toEqual([
      "background",
      "evidence",
    ]);
    // All the written text, as written but for the capital a part starts with.
    expect(
      parts
        .map((part) => part.text)
        .join(" ")
        .toLowerCase()
    ).toBe("the sum of £1,000,000,000,000,000,000,000 was owed.");
  });

  it("keeps punctuation standing alone with what it follows", () => {
    const timing = said("yes and no");
    expect(
      splitBySection(
        "Yes — and no.",
        timing,
        "background",
        switched([1400, "evidence"])
      )
    ).toEqual([
      { section: "background", text: "Yes —" },
      { section: "evidence", text: "And no." },
    ]);
  });
});

describe("reading Speech's timing (DIAAT-417)", () => {
  it("dates the utterance and its words from when the audio began", () => {
    const json = JSON.stringify({
      NBest: [
        {
          Display: "Hello there.",
          Words: [
            { Word: "hello", Offset: 5_000_000, Duration: 3_000_000 },
            { Word: "there", Offset: 9_000_000, Duration: 2_000_000 },
          ],
        },
      ],
    });
    expect(segmentTiming(10_000, 5_000_000, 6_000_000, json)).toEqual({
      startMs: 10_500,
      endMs: 11_100,
      words: [
        { word: "hello", startMs: 10_500, endMs: 10_800 },
        { word: "there", startMs: 10_900, endMs: 11_100 },
      ],
    });
  });

  it("has no words for a result that is not detailed, and no timing without an offset", () => {
    expect(segmentTiming(0, 10_000, 10_000, "not json")).toEqual({
      startMs: 1,
      endMs: 2,
      words: [],
    });
    expect(segmentTiming(0, undefined, undefined, undefined)).toBeUndefined();
  });

  it("takes the section chosen last by then", () => {
    const switches = switched([2000, "evidence"], [4000, "facts"]);
    expect(sectionAt(1000, "background", switches)).toBe("background");
    expect(sectionAt(3000, "background", switches)).toBe("evidence");
    expect(sectionAt(9000, "background", switches)).toBe("facts");
  });
});
