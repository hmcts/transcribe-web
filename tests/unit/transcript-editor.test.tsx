import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import TranscriptEditor from "@/components/audio/dictation/transcript-editor";
import type { SectionedTranscript } from "@/components/audio/dictation/types";

const INITIAL_TRANSCRIPT: SectionedTranscript = {
  background: [
    {
      speaker: "Judge",
      text: "The hearing starts now.",
      timestamp: "09:00",
      timestampMs: 1000,
    },
  ],
  evidence: [],
  facts: [],
};

function TranscriptEditorHarness() {
  const [transcript, setTranscript] =
    useState<SectionedTranscript>(INITIAL_TRANSCRIPT);

  return (
    <TranscriptEditor
      sectionedTranscript={transcript}
      activeSection="background"
      interimTargetSection={null}
      interimText=""
      isListening={false}
      onTranscriptUpdate={setTranscript}
    />
  );
}

beforeAll(() => {
  Element.prototype.scrollTo = vi.fn();
});

describe("TranscriptEditor accessibility", () => {
  it("renders transcript text as an editable button and ties instructions to the textarea", () => {
    render(<TranscriptEditorHarness />);

    const messageButton = screen.getByRole("button", {
      name: "Judge: The hearing starts now.",
    });

    expect(messageButton.className).toContain("focus-visible:ring-accent");

    fireEvent.click(messageButton);

    const textarea = screen.getByRole("textbox", {
      name: "Edit transcript message from Judge",
    });

    expect(textarea.getAttribute("aria-describedby")).toBe(
      "transcript-message-edit-instructions-background-0"
    );
    expect(
      document.getElementById(
        "transcript-message-edit-instructions-background-0"
      )?.textContent
    ).toContain("Press Ctrl+Enter to save, Esc to cancel");
  });

  it("saves keyboard edits made in the transcript textarea", () => {
    render(<TranscriptEditorHarness />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Judge: The hearing starts now.",
      })
    );

    const textarea = screen.getByRole("textbox", {
      name: "Edit transcript message from Judge",
    });

    fireEvent.change(textarea, {
      target: { value: "The hearing is now in session." },
    });
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });

    expect(
      screen.getByRole("button", {
        name: "Judge: The hearing is now in session.",
      })
    ).toBeTruthy();
  });
});

describe("TranscriptEditor in the general section (DIAAT-333)", () => {
  const sectioned = {
    background: [
      { speaker: "Judge", text: "The claimant was dismissed.", timestamp: "00:00" },
    ],
    evidence: [],
    facts: [],
  };

  it("names no section, while listening or after", () => {
    render(
      <TranscriptEditor
        sectionedTranscript={sectioned}
        activeSection="background"
        interimTargetSection="background"
        interimText="Judge: and then"
        isListening
        onTranscriptUpdate={() => undefined}
        showSectionNames={false}
      />
    );

    expect(screen.getByText(/The claimant was dismissed/)).toBeTruthy();
    expect(screen.queryByText(/Background/)).toBeNull();
    expect(screen.getByText("Recording")).toBeTruthy();
  });

  it("names the section by default, as the IAC's do", () => {
    render(
      <TranscriptEditor
        sectionedTranscript={sectioned}
        activeSection="background"
        interimTargetSection="background"
        interimText="Judge: and then"
        isListening
        onTranscriptUpdate={() => undefined}
      />
    );

    expect(screen.getByText("Recording to Background")).toBeTruthy();
  });
});

describe("TranscriptEditor with a template's sections (DIAAT-416)", () => {
  const SECTIONS = [
    { key: "background", label: "Background", color: "bg-blue-500" },
    { key: "box:Findings", label: "Findings of fact", color: "bg-amber-500" },
  ];

  it("names each section as the template does, and edits within its own", () => {
    const onTranscriptUpdate = vi.fn();
    render(
      <TranscriptEditor
        sectionedTranscript={{
          background: [
            {
              speaker: "Judge",
              text: "Heard today.",
              timestamp: "09:00",
              timestampMs: 1000,
            },
          ],
          "box:Findings": [
            {
              speaker: "Judge",
              text: "I find it credible.",
              timestamp: "09:01",
              timestampMs: 2000,
            },
          ],
        }}
        sections={SECTIONS}
        activeSection="box:Findings"
        interimTargetSection={null}
        interimText=""
        isListening={false}
        onTranscriptUpdate={onTranscriptUpdate}
      />
    );

    expect(screen.getByText("Background")).toBeTruthy();
    expect(screen.getByText("Findings of fact")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Judge: I find it credible." })
    );
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "I find it wholly credible." },
    });
    fireEvent.keyDown(screen.getByRole("textbox"), {
      key: "Enter",
      ctrlKey: true,
    });

    expect(onTranscriptUpdate).toHaveBeenLastCalledWith({
      background: [expect.objectContaining({ text: "Heard today." })],
      "box:Findings": [
        expect.objectContaining({ text: "I find it wholly credible." }),
      ],
    });
  });

  it("names the section the speech in progress is going to", () => {
    render(
      <TranscriptEditor
        sectionedTranscript={{}}
        sections={SECTIONS}
        activeSection="box:Findings"
        interimTargetSection="box:Findings"
        interimText="Judge: I find"
        isListening
        onTranscriptUpdate={vi.fn()}
      />
    );
    expect(screen.getByText("Recording to Findings of fact")).toBeTruthy();
  });
});
