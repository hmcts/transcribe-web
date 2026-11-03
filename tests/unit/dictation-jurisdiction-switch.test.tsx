import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LiveDictation from "@/components/audio/dictation/dictation";
import {
  type DictationFormValues,
  defaultFormValues,
} from "@/components/audio/dictation/formData";
import type { SectionedTranscript } from "@/components/audio/dictation/types";
import { prepareForJurisdictionSwitch } from "@/lib/jurisdiction-switch";

// A jurisdiction switch reloads the tab. On /speech-demo nothing LiveDictation
// holds is saved, so it stops the switch while it holds a transcript, a
// recording or hearing details, or is submitting. Embedded in the record page,
// which saves its draft before a switch, it leaves the switch to that page.

const speech = vi.hoisted(() => ({ health: "idle" }));
vi.mock("@/hooks/use-realtime-transcription", () => ({
  useRealtimeTranscription: () => ({
    segments: [],
    error: null,
    session: { health: speech.health, totalCollapses: 0 },
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
  }),
}));

const mockSubmitDictation = vi.hoisted(() => vi.fn());
vi.mock("@/lib/dictation-submission", () => ({
  submitDictation: mockSubmitDictation,
}));

vi.mock("@/components/audio/dictation/formData", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/components/audio/dictation/formData")
    >();
  return {
    ...actual,
    dictationFormSchema: {
      safeParse: (data: DictationFormValues) => ({ success: true, data }),
    },
  };
});

vi.mock("@/components/audio/dictation/dictation-form-container", () => ({
  default: ({
    onFormStateChange,
    onSaveTranscript,
  }: {
    onFormStateChange: (values: DictationFormValues) => void;
    onSaveTranscript: () => void;
  }) => (
    <div>
      <button
        type="button"
        onClick={() =>
          onFormStateChange({ ...defaultFormValues, judgeName: "Judge Smith" })
        }
      >
        Fill in judge name
      </button>
      <button
        type="button"
        onClick={() =>
          onFormStateChange({ ...defaultFormValues, caseId: "PA/12345/2026" })
        }
      >
        Enter case ID
      </button>
      <button type="button" onClick={onSaveTranscript}>
        Submit
      </button>
    </div>
  ),
}));

vi.mock("@/components/audio/dictation/transcript-editor", () => ({
  default: () => <div data-testid="transcript-editor" />,
}));

vi.mock("@/components/notifications/submitting-hearing", () => ({
  default: vi.fn(),
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
  (await import("../jurisdiction-helpers")).mockJurisdictionModule("IAC")
);

vi.mock("@/hooks/use-media-query", () => ({
  useMediaQuery: () => true,
  default: () => true,
}));

const TRANSCRIPT: SectionedTranscript = {
  background: [
    {
      speaker: "Judge",
      text: "This is the appeal of the appellant.",
      timestamp: "10:00:00",
      timestampMs: 0,
    },
  ],
  evidence: [],
  facts: [],
};

afterEach(() => {
  speech.health = "idle";
  vi.clearAllMocks();
});

describe("LiveDictation on /speech-demo during a jurisdiction switch", () => {
  it("lets the switch through when there is nothing to lose", async () => {
    render(<LiveDictation />);

    await expect(prepareForJurisdictionSwitch()).resolves.toBeUndefined();
  });

  it("lets the switch through when only the judge's name is filled in", async () => {
    render(<LiveDictation />);
    fireEvent.click(screen.getByRole("button", { name: "Fill in judge name" }));

    await expect(prepareForJurisdictionSwitch()).resolves.toBeUndefined();
  });

  it("stops the switch while it holds a transcript", async () => {
    render(<LiveDictation initialSectionedTranscript={TRANSCRIPT} />);

    await expect(prepareForJurisdictionSwitch()).rejects.toMatchObject({
      step: "unsaved_changes",
    });
  });

  it("stops the switch while recording", async () => {
    speech.health = "connected";
    render(<LiveDictation />);

    await expect(prepareForJurisdictionSwitch()).rejects.toMatchObject({
      step: "unsaved_changes",
    });
  });

  it("stops the switch once hearing details are entered", async () => {
    render(<LiveDictation />);
    fireEvent.click(screen.getByRole("button", { name: "Enter case ID" }));

    await expect(prepareForJurisdictionSwitch()).rejects.toMatchObject({
      step: "unsaved_changes",
    });
  });

  it("stops the switch while the hearing is being submitted", async () => {
    mockSubmitDictation.mockReturnValue(new Promise(() => undefined));
    render(<LiveDictation />);
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(mockSubmitDictation).toHaveBeenCalled());

    await expect(prepareForJurisdictionSwitch()).rejects.toMatchObject({
      step: "busy",
    });
  });

  it("leaves the switch to an embedder that takes the transcript", async () => {
    speech.health = "connected";
    render(
      <LiveDictation
        hideForm
        initialSectionedTranscript={TRANSCRIPT}
        onTranscriptChange={vi.fn()}
      />
    );

    await expect(prepareForJurisdictionSwitch()).resolves.toBeUndefined();
  });

  it("stops guarding once it unmounts", async () => {
    const view = render(
      <LiveDictation initialSectionedTranscript={TRANSCRIPT} />
    );
    view.unmount();

    await expect(prepareForJurisdictionSwitch()).resolves.toBeUndefined();
  });
});
