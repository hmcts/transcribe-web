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
