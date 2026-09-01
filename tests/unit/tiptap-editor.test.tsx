import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SimpleEditor from "@/components/editor/tiptap-editor";

vi.mock("@/providers/transcripts", () => ({
  useTranscripts: () => ({
    currentTranscription: null,
    transcriptionJobs: [],
  }),
}));

describe("SimpleEditor accessibility", () => {
  it("announces the state of toolbar toggle buttons", async () => {
    render(
      <SimpleEditor
        initialContent="<p>Notes</p>"
        onContentChange={vi.fn()}
        isEditing
        onCitationClick={vi.fn()}
        editorId="notes-editor"
        editorAriaLabel="Notes editor"
        toolbarAriaLabel="Notes formatting toolbar"
      />
    );

    expect(
      (await screen.findByRole("button", { name: "Bold" })).getAttribute(
        "aria-pressed"
      )
    ).toBe("false");
    expect(
      screen
        .getByRole("button", { name: "Italic" })
        .getAttribute("aria-pressed")
    ).toBe("false");
    expect(
      screen
        .getByRole("button", { name: "Bullet List" })
        .getAttribute("aria-pressed")
    ).toBe("false");
    expect(
      screen
        .getByRole("button", { name: "Numbered List" })
        .getAttribute("aria-pressed")
    ).toBe("false");
    expect(
      screen
        .getByRole("button", { name: "Heading" })
        .getAttribute("aria-pressed")
    ).toBe("false");
  });
});
