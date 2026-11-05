import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DictationFormContainer from "@/components/audio/dictation/dictation-form-container";
import {
  type DictationFormValues,
  dictationFormSchema,
  getDefaultFormValues,
} from "@/components/audio/dictation/formData";

// The standalone dictation demo (/speech-demo, SpeechDemo -> DictationFormContainer)
// is the IAC's form, validated by the IAC schema, which requires a legal issue: so
// its form must ask for one (DIAAT-342 made the field depend on the jurisdiction's
// wording, with the IAC's shipped list as the fallback).

class ResizeObserverMock {
  observe() {
    // No-op for jsdom.
  }
  unobserve() {
    // No-op for jsdom.
  }
  disconnect() {
    // No-op for jsdom.
  }
}
vi.stubGlobal("ResizeObserver", ResizeObserverMock);
vi.mock("@/providers/user-settings", () => ({
  useUserSettings: () => ({
    user: null,
    loading: false,
    updateUserSettings: vi.fn(),
  }),
}));

describe("DictationFormContainer (the standalone dictation form)", () => {
  function renderContainer(onFormStateChange = vi.fn()) {
    render(
      <DictationFormContainer
        formScrollContainerRef={{ current: null }}
        formData={getDefaultFormValues("")}
        formErrors={{}}
        transcriptLength={1}
        isSubmitting={false}
        onFormStateChange={onFormStateChange}
        onSaveTranscript={vi.fn()}
      />
    );
    return onFormStateChange;
  }

  it("shows the legal issues field, from the IAC's list", () => {
    renderContainer();

    expect(screen.getByText("Legal issues")).toBeTruthy();
    expect(screen.getByLabelText("Credibility")).toBeTruthy();
  });

  it("lets a legal issue be chosen, so the form it feeds can pass the IAC schema", async () => {
    const onFormStateChange = renderContainer();
    // The form ignores changes while it takes its initial values from the parent.
    await new Promise((resolve) => setTimeout(resolve, 10));

    fireEvent.click(screen.getByLabelText("Credibility"));

    await waitFor(() =>
      expect(onFormStateChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ legalIssues: ["credibility"] })
      )
    );
    const chosen = onFormStateChange.mock.calls.at(
      -1
    )?.[0] as DictationFormValues;
    const complete = {
      ...chosen,
      caseId: "1",
      location: "Belfast",
      hearingDate: "2026-01-01",
      judgeName: "Judge",
      anonymityOrder: "granted",
      appellantName: "A",
      respondent: "R",
      hearingType: "no_hearing_papers",
      appealableDecisionDate: "2026-01-01",
      documentType: "Decision",
    };
    // What LiveDictation.handleSaveTranscript validates with.
    expect(dictationFormSchema.safeParse(complete).success).toBe(true);
    expect(
      dictationFormSchema.safeParse({ ...complete, legalIssues: [] }).success
    ).toBe(false);
  });
});
