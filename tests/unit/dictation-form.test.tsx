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
      <DictationForm initialValues={getDefaultFormValues("")} />
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
