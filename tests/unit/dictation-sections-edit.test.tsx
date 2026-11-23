import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LiveDictation from "@/components/audio/dictation/dictation";
import type { SectionedTranscript } from "@/components/audio/dictation/types";

// DIAAT-416: the editor is shown the transcript in the page's sections, with what
// is kept under any other section in the first. Its edits must not move that.

vi.mock("@/hooks/use-realtime-transcription", () => ({
  useRealtimeTranscription: () => ({
    segments: [],
    error: null,
    session: { health: "idle", totalCollapses: 0 },
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
  }),
}));
const editor = vi.hoisted(() => ({
  props: null as any,
}));
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

const said = (text: string) => ({ speaker: "Judge", text, timestamp: "10:00" });
const SECTIONS = [
  { key: "background", label: "Background", color: "bg-blue-500" },
  { key: "box:Decision", label: "Decision", color: "bg-amber-500" },
];
const KEPT: SectionedTranscript = {
  background: [said("Heard today.")],
  "box:Decision": [said("The claim succeeds.")],
  "box:Gone": [said("From another template.")],
};

function renderDictation() {
  const onTranscriptChange = vi.fn();
  render(
    <LiveDictation
      embedded
      sections={SECTIONS}
      initialSectionedTranscript={KEPT}
      onTranscriptChange={onTranscriptChange}
    />
  );
  return onTranscriptChange;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("editing the dictation in a template's sections (DIAAT-416)", () => {
  it("shows what is kept under another section in the first", () => {
    renderDictation();
    expect(editor.props.sectionedTranscript).toEqual({
      background: [said("Heard today."), said("From another template.")],
      "box:Decision": [said("The claim succeeds.")],
    });
  });

  it("leaves it where it is kept when another section is edited", () => {
    const onTranscriptChange = renderDictation();
    const shown = editor.props.sectionedTranscript;
    act(() => {
      editor.props.onTranscriptUpdate({
        ...shown,
        "box:Decision": [said("The claim is allowed.")],
      });
    });
    expect(onTranscriptChange).toHaveBeenLastCalledWith({
      background: [said("Heard today.")],
      "box:Decision": [said("The claim is allowed.")],
      "box:Gone": [said("From another template.")],
    });
  });

  it("takes it into the first section when that is edited, where it was shown", () => {
    const onTranscriptChange = renderDictation();
    const shown = editor.props.sectionedTranscript;
    act(() => {
      editor.props.onTranscriptUpdate({
        ...shown,
        background: [
          said("Heard today, in person."),
          said("From another template."),
        ],
      });
    });
    expect(onTranscriptChange).toHaveBeenLastCalledWith({
      background: [
        said("Heard today, in person."),
        said("From another template."),
      ],
      "box:Decision": [said("The claim succeeds.")],
    });
  });
});
