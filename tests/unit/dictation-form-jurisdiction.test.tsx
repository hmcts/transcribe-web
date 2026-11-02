import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DictationForm from "@/components/audio/dictation/dictation-form";
import { getDefaultFormValues } from "@/components/audio/dictation/formData";
import { IAC_CONTENT, IAC_NAME, TAX_CONTENT } from "./helpers/document-content";

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

const taxValues = () => ({
  ...getDefaultFormValues(""),
  jurisdiction: TAX_CONTENT.jurisdiction.name,
});

describe("Dictation form legal issues", () => {
  it("shows the legal issues field for a jurisdiction with legal wording", () => {
    const { container } = render(
      <DictationForm
        initialValues={getDefaultFormValues("")}
        documentContent={IAC_CONTENT}
      />
    );

    expect(screen.getByText("Legal issues")).toBeTruthy();
    expect(container.querySelector("fieldset")).toBeTruthy();
    expect(screen.getByLabelText("Credibility")).toBeTruthy();
  });

  it("shows no legal issues field for a jurisdiction without legal wording", () => {
    const { container } = render(
      <DictationForm
        initialValues={taxValues()}
        documentContent={TAX_CONTENT}
      />
    );

    expect(screen.queryByText("Legal issues")).toBeNull();
    expect(container.querySelector("fieldset")).toBeNull();
    // The rest of the form is unaffected.
    expect(screen.getByText("Hearing type")).toBeTruthy();
  });

  it("never shows another jurisdiction's wording under the one selected", () => {
    const { container, rerender } = render(
      <DictationForm
        initialValues={getDefaultFormValues("")}
        documentContent={IAC_CONTENT}
      />
    );
    expect(container.querySelector("fieldset")).toBeTruthy();

    // The judge switched to Tax; its wording has not arrived yet.
    rerender(
      <DictationForm
        initialValues={taxValues()}
        documentContent={IAC_CONTENT}
      />
    );

    expect(container.querySelector("fieldset")).toBeNull();
    expect(screen.queryByLabelText("Credibility")).toBeNull();
  });

  it("does not offer the IAC's built-in legal issues to another jurisdiction", () => {
    const { container } = render(<DictationForm initialValues={taxValues()} />);

    expect(container.querySelector("fieldset")).toBeNull();
  });

  it("offers the built-in legal issues for the IAC before its wording loads", () => {
    render(<DictationForm initialValues={getDefaultFormValues("")} />);

    expect(screen.getAllByRole("checkbox")).toHaveLength(17);
  });

  it("saves the form without legal issues when there is no legal wording", () => {
    const values = {
      ...taxValues(),
      caseId: "T1",
      location: "Manchester",
      judgeName: "A Smith",
      anonymityOrder: "granted",
      appellantName: "Appellant",
      respondent: "The Immigration Officer",
      hearingType: "tax_hearing",
      appealableDecisionDate: "2024-12-01",
      documentType: "Decision",
    };
    const { container } = render(
      <DictationForm initialValues={values} documentContent={TAX_CONTENT} />
    );

    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    expect(container.querySelector("[id$='-error']")).toBeNull();
    expect(screen.queryByText(/legal issue/i)).toBeNull();
  });

  it("still asks for a legal issue when there is legal wording", () => {
    const { container } = render(
      <DictationForm
        initialValues={{
          ...getDefaultFormValues(""),
          jurisdiction: IAC_NAME,
        }}
        documentContent={IAC_CONTENT}
      />
    );

    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    expect(
      screen.getByText("Select at least one legal issue relevant to the case")
    ).toBeTruthy();
  });
});
