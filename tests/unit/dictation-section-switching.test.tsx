import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LiveDictation from "@/components/audio/dictation/dictation";
import type { SectionedTranscript } from "@/components/audio/dictation/types";
import type { TranscriptionSegment } from "@/hooks/use-realtime-transcription";

// DIAAT-417: the judge switches between a template's sections while recording, with
// no pause: what they said goes to the section they said it in.

const speech = vi.hoisted(() => ({ segments: [] as TranscriptionSegment[] }));
vi.mock("@/hooks/use-realtime-transcription", () => ({
  useRealtimeTranscription: () => ({
    segments: speech.segments,
    error: null,
    session: { health: "idle", totalCollapses: 0 },
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
  }),
}));
const editor = vi.hoisted(() => ({ props: null as any }));
vi.mock("@/components/audio/dictation/transcript-editor", () => ({
  default: (props: any) => {
    editor.props = props;
    return <div />;
  },
}));
vi.mock("@/lib/environment", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/environment")>()),
  shouldPrepopulateLocalDemoData: () => false,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), dismiss: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/providers/user-settings", () => ({
  useUserSettings: () => ({ user: null, loading: false }),
}));
vi.mock("@/providers/jurisdiction", async () =>
  (await import("../jurisdiction-helpers")).mockJurisdictionModule("ET")
);
vi.mock("@/hooks/use-media-query", () => ({
  useMediaQuery: () => true,
  default: () => true,
}));

// Another jurisdiction's sections, not the IAC's.
const SECTIONS = [
  { key: "box:Summary", label: "Case Summary", color: "bg-blue-500" },
  { key: "box:Findings", label: "Findings", color: "bg-green-500" },
  { key: "box:Reasons", label: "Reasons", color: "bg-purple-500" },
  { key: "box:Decision", label: "Decision", color: "bg-amber-500" },
];
const EARLIER = {
  speaker: "Judge",
  text: "Dictated earlier.",
  timestamp: "09:00",
};

/** A word every 400 ms from ``at``. */
const words = (text: string, at: number) =>
  text.split(" ").map((word, i) => ({
    word,
    startMs: at + i * 400,
    endMs: at + i * 400 + 350,
  }));

/** When the last of ``said`` ends. */
const endOf = (said: { endMs: number }[]) => said[said.length - 1].endMs;

function renderDictation() {
  const onTranscriptChange = vi.fn();
  const view = (activeSection: string) => (
    <LiveDictation
      embedded
      sections={SECTIONS}
      activeSection={activeSection}
      initialSectionedTranscript={{ "box:Summary": [EARLIER] }}
      onTranscriptChange={onTranscriptChange}
    />
  );
  const { rerender } = render(view("box:Summary"));
  return {
    choose: (section: string, at: number) => {
      vi.spyOn(Date, "now").mockReturnValue(at);
      rerender(view(section));
    },
    hear: (segments: TranscriptionSegment[], at: number, section: string) => {
      vi.spyOn(Date, "now").mockReturnValue(at);
      speech.segments = segments;
      rerender(view(section));
    },
    transcript: (): SectionedTranscript =>
      onTranscriptChange.mock.calls.at(-1)?.[0] ?? {},
  };
}

afterEach(() => {
  speech.segments = [];
  vi.restoreAllMocks();
});

const texts = (transcript: SectionedTranscript, section: string) =>
  (transcript[section] ?? []).map((entry) => entry.text);

describe("switching sections while recording (DIAAT-417)", () => {
  it("files each part of continuous dictation under the section it was said in", () => {
    const dictation = renderDictation();
    const first = words(
      "the claimant was dismissed i heard from the manager i find the dismissal unfair",
      1000
    );
    // Said without a pause: Findings chosen as "i heard" begins, Reasons as "i find".
    // Speech delivers the words a little after they are said.
    dictation.hear(
      [
        {
          id: "seg-1",
          speaker: "Guest-1",
          text: "the claimant",
          isFinal: false,
          heardUntilMs: first[1].endMs,
        },
      ],
      first[2].startMs,
      "box:Summary"
    );
    dictation.choose("box:Findings", first[4].startMs);
    expect(editor.props.activeSection).toBe("box:Findings");
    expect(editor.props.interimTargetSection).toBe("box:Findings");
    // What was being said before the switch stays shown under Case Summary.
    expect(editor.props.interimEarlier).toEqual([
      { section: "box:Summary", text: "the claimant" },
    ]);
    // Delivered after the switch, but said before it: still Case Summary's.
    dictation.hear(
      [
        {
          id: "seg-1",
          speaker: "Guest-1",
          text: "the claimant was dismissed",
          isFinal: false,
          heardUntilMs: first[3].endMs,
        },
      ],
      first[5].startMs,
      "box:Findings"
    );
    expect(editor.props.interimEarlier).toEqual([
      { section: "box:Summary", text: "the claimant was dismissed" },
    ]);
    // Speech has now heard past the switch: what follows shows under Findings.
    dictation.hear(
      [
        {
          id: "seg-1",
          speaker: "Guest-1",
          text: "the claimant was dismissed i heard",
          isFinal: false,
          heardUntilMs: first[5].endMs,
        },
      ],
      first[6].startMs,
      "box:Findings"
    );
    expect(editor.props.interimEarlier).toEqual([
      { section: "box:Summary", text: "the claimant was dismissed" },
    ]);
    expect(editor.props.interimText).toBe("Judge: i heard");
    dictation.choose("box:Reasons", first[9].startMs);
    expect(editor.props.interimTargetSection).toBe("box:Reasons");

    dictation.hear(
      [
        {
          id: "seg-1",
          speaker: "Guest-1",
          text: "The claimant was dismissed. I heard from the manager. I find the dismissal unfair.",
          isFinal: true,
          timing: { startMs: 1000, endMs: endOf(first), words: first },
        },
      ],
      7000,
      "box:Reasons"
    );

    const transcript = dictation.transcript();
    // What was there before stays; each part goes to its own section, once.
    expect(texts(transcript, "box:Summary")).toEqual([
      "Dictated earlier.",
      "The claimant was dismissed.",
    ]);
    expect(texts(transcript, "box:Findings")).toEqual([
      "I heard from the manager.",
    ]);
    expect(texts(transcript, "box:Reasons")).toEqual([
      "I find the dismissal unfair.",
    ]);
    expect(texts(transcript, "box:Decision")).toEqual([]);

    // And on: Decision, then the next utterance goes there whole.
    dictation.choose("box:Decision", 8000);
    const next = words("the claim succeeds", 8100);
    dictation.hear(
      [
        {
          id: "seg-1",
          speaker: "Guest-1",
          text: "The claimant was dismissed. I heard from the manager. I find the dismissal unfair.",
          isFinal: true,
          timing: { startMs: 1000, endMs: endOf(first), words: first },
        },
        {
          id: "seg-2",
          speaker: "Guest-1",
          text: "The claim succeeds.",
          isFinal: true,
          timing: { startMs: 8100, endMs: endOf(next), words: next },
        },
      ],
      10_000,
      "box:Decision"
    );
    const after = dictation.transcript();
    expect(texts(after, "box:Decision")).toEqual(["The claim succeeds."]);
    // Nothing moved, repeated or lost.
    expect(texts(after, "box:Summary")).toHaveLength(2);
    expect(texts(after, "box:Findings")).toHaveLength(1);
    expect(texts(after, "box:Reasons")).toHaveLength(1);
  });

  it("leaves a sentence finished before the switch where it was said, though Speech closed it after", () => {
    const dictation = renderDictation();
    const sentence = words("the claimant was dismissed", 1000);
    dictation.hear(
      [
        {
          id: "seg-1",
          speaker: "Guest-1",
          text: "the claimant",
          isFinal: false,
        },
      ],
      1500,
      "box:Summary"
    );
    // Findings chosen after the last word, before Speech's pause ended.
    dictation.choose("box:Findings", 3000);
    dictation.hear(
      [
        {
          id: "seg-1",
          speaker: "Guest-1",
          text: "The claimant was dismissed.",
          isFinal: true,
          timing: {
            startMs: 1000,
            endMs: endOf(sentence),
            words: sentence,
          },
        },
      ],
      4000,
      "box:Findings"
    );
    expect(texts(dictation.transcript(), "box:Summary")).toEqual([
      "Dictated earlier.",
      "The claimant was dismissed.",
    ]);
    expect(texts(dictation.transcript(), "box:Findings")).toEqual([]);
  });
});
