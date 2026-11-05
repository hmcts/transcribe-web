import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DictationForm from "@/components/audio/dictation/dictation-form";
import { getDefaultFormValues } from "@/components/audio/dictation/formData";
import { DatePicker } from "@/components/ui/date-picker";

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

vi.mock("@/providers/user-settings", () => ({
  useUserSettings: () => ({
    user: null,
    loading: false,
    updateUserSettings: vi.fn(),
  }),
}));

vi.stubGlobal("ResizeObserver", ResizeObserverMock);

describe("Dictation form accessibility", () => {
  it("associates field errors with the relevant controls", () => {
    const { container } = render(
      <DictationForm
        initialValues={getDefaultFormValues("")}
        externalErrors={{
          caseId: "Case number is required",
          hearingDate: "Hearing date is required",
          documentType: "Document type is required",
        }}
      />
    );

    const caseNumberInput = container.querySelector("#caseId");
    const hearingDateTrigger = container.querySelector("#hearingDate");
    const documentTypeTrigger = container.querySelector("#documentType");

    expect(caseNumberInput?.getAttribute("aria-invalid")).toBe("true");
    expect(caseNumberInput?.getAttribute("aria-errormessage")).toBe(
      "caseId-error"
    );
    expect(caseNumberInput?.getAttribute("aria-describedby")).toContain(
      "caseId-error"
    );

    expect(hearingDateTrigger?.getAttribute("aria-invalid")).toBe("true");
    expect(hearingDateTrigger?.getAttribute("aria-errormessage")).toBe(
      "hearingDate-error"
    );
    expect(hearingDateTrigger?.getAttribute("aria-describedby")).toContain(
      "hearingDate-error"
    );

    expect(documentTypeTrigger?.getAttribute("aria-invalid")).toBe("true");
    expect(documentTypeTrigger?.getAttribute("aria-errormessage")).toBe(
      "documentType-error"
    );
    expect(documentTypeTrigger?.getAttribute("aria-describedby")).toContain(
      "documentType-error"
    );

    expect(screen.getByText("Case number is required").id).toBe("caseId-error");
    expect(screen.getByText("Hearing date is required").id).toBe(
      "hearingDate-error"
    );
    expect(screen.getByText("Document type is required").id).toBe(
      "documentType-error"
    );
  });

  it("ties the legal issues checkbox group to the visible heading", () => {
    const { container } = render(
      <DictationForm
        initialValues={getDefaultFormValues("")}
        legalIssuesFallback
      />
    );

    const legalIssuesLabel = screen.getByText("Legal issues");
    const legalIssuesGroup = container.querySelector("fieldset");
    const firstCheckbox = screen.getByLabelText(
      "Revocation of Protection for Danger - Section 72"
    );

    expect(legalIssuesLabel.id).toBe("legalIssues-label");
    expect(legalIssuesGroup?.getAttribute("aria-labelledby")).toBe(
      "legalIssues-label"
    );
    expect(firstCheckbox.getAttribute("aria-describedby")).toContain(
      "legalIssues-hint"
    );
  });
});

// DIAAT-342: legal wording is the jurisdiction's own; without it the form has no
// legal issues field and asks for nothing about them.
describe("Dictation form legal issues (DIAAT-342)", () => {
  const LEGAL_ISSUES_ERROR = "Select at least one legal issue relevant to the case";
  const content = (overrides: Record<string, unknown> = {}) => ({
    jurisdiction: { code: "DT", name: "Decision Tribunal" },
    has_legal_wording: true,
    hearing_types: [
      {
        id: "face_to_face",
        title: "Face to face",
        hearing_title: "Hearing",
        hearing_description: "Held in person",
      },
    ],
    legal_frameworks: [
      { id: "z_last", title: "Last", rank: 2, content: "c", issues: [] },
      { id: "a_first", title: "First", rank: 1, content: "c", issues: [] },
    ],
    anonymity: { statuses: [] },
    ...overrides,
  });

  function submitEmptyForm(container: HTMLElement) {
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
  }

  it("asks for legal issues from the jurisdiction's own frameworks, in rank order", () => {
    const { container } = render(
      <DictationForm
        initialValues={getDefaultFormValues("")}
        documentContent={content()}
      />
    );

    const labels = screen
      .getAllByRole("checkbox")
      .map((box) => box.closest("div")?.textContent);
    expect(screen.getByText("Legal issues")).toBeTruthy();
    expect(labels).toEqual(["First", "Last"]);
    // Not the IAC's shipped list.
    expect(screen.queryByLabelText("Credibility")).toBeNull();

    submitEmptyForm(container);
    expect(screen.getByText(LEGAL_ISSUES_ERROR)).toBeTruthy();
  });

  it("has no legal issues field, and requires none, without legal wording", () => {
    const { container } = render(
      <DictationForm
        initialValues={getDefaultFormValues("")}
        documentContent={content({ has_legal_wording: false, legal_frameworks: [] })}
        legalIssuesFallback
      />
    );

    expect(screen.queryByText("Legal issues")).toBeNull();
    expect(container.querySelector("fieldset")).toBeNull();

    submitEmptyForm(container);
    // Other fields are still required; legal issues are not.
    expect(screen.getByText("Case number is required")).toBeTruthy();
    expect(screen.queryByText(LEGAL_ISSUES_ERROR)).toBeNull();
  });

  it("uses the IAC's shipped legal issues only for the IAC while its wording loads", () => {
    const { unmount } = render(
      <DictationForm
        initialValues={getDefaultFormValues("")}
        legalIssuesFallback
      />
    );
    expect(screen.getByLabelText("Credibility")).toBeTruthy();
    unmount();

    // Another jurisdiction: never the IAC's list, and nothing asked.
    render(<DictationForm initialValues={getDefaultFormValues("")} />);
    expect(screen.queryByText("Legal issues")).toBeNull();
    expect(screen.queryByLabelText("Credibility")).toBeNull();
  });

  it("treats content that does not say whether it has legal wording as having it", () => {
    render(
      <DictationForm
        initialValues={getDefaultFormValues("")}
        documentContent={content({ has_legal_wording: undefined })}
      />
    );
    expect(screen.getByText("Legal issues")).toBeTruthy();
  });
});

describe("Date picker accessibility", () => {
  it("announces the calendar dialog context when opened", () => {
    render(
      <>
        <label htmlFor="hearing-date">Hearing date</label>
        <DatePicker
          id="hearing-date"
          label="Hearing date"
          value=""
          onChange={vi.fn()}
          placeholder="Select date"
        />
      </>
    );

    const trigger = document.getElementById("hearing-date");

    expect(trigger?.getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger?.getAttribute("aria-controls")).toBe("hearing-date-dialog");
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(trigger as HTMLElement);

    const dialog = screen.getByRole("dialog");

    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBe(
      "hearing-date-dialog-title"
    );
    expect(dialog.getAttribute("aria-describedby")).toBe(
      "hearing-date-dialog-description"
    );
    expect(screen.getByText("Hearing date calendar")).toBeTruthy();
    expect(
      screen.getByText(
        "Hearing date calendar opened. Use arrow keys to move between days and Enter to select a date."
      )
    ).toBeTruthy();
  });

  it("includes the selected date in the trigger name and announces updates", async () => {
    const { rerender } = render(
      <DatePicker
        id="hearing-date"
        label="Hearing date"
        value=""
        onChange={vi.fn()}
        placeholder="Select date"
      />
    );

    expect(
      screen.getByRole("button", { name: "Hearing date, no date selected" })
    ).toBeTruthy();

    rerender(
      <DatePicker
        id="hearing-date"
        label="Hearing date"
        value="2026-03-24"
        onChange={vi.fn()}
        placeholder="Select date"
      />
    );

    expect(
      screen.getByRole("button", { name: "Hearing date, March 24th, 2026" })
    ).toBeTruthy();
    expect(await screen.findByText(/Hearing date selected/i)).toBeTruthy();
  });
});
