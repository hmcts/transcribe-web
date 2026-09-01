import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MultistepTutorial } from "@/components/help/multistep-tutorial";

vi.mock("next/image", () => ({
  default: () => null,
}));

describe("MultistepTutorial", () => {
  it("adds accessible labels to the carousel navigation buttons", () => {
    const { container } = render(<MultistepTutorial />);

    const previousButton = screen.getByRole("button", {
      name: "Previous step",
    });
    const nextButton = screen.getByRole("button", {
      name: "Go to next step: Complete the form",
    });

    expect(
      screen.getByText(
        "From the home page, select Go to recording to open the recording workspace."
      )
    ).toBeTruthy();
    expect(previousButton.hasAttribute("disabled")).toBe(true);
    expect(nextButton.getAttribute("aria-controls")).toBe(
      "step-panel-fill-form"
    );
    expect(
      container
        .querySelector('[data-quick-start-illustration="start-recording"]')
        ?.getAttribute("role")
    ).toBe("img");
    expect(
      container
        .querySelector('[data-quick-start-illustration="start-recording"]')
        ?.getAttribute("aria-label")
    ).toBe("Illustration of the home page with the Go to recording button");

    fireEvent.click(nextButton);

    expect(
      screen.getByRole("button", {
        name: "Go to previous step: Start a new recording",
      })
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Go to next step: Record your dictation",
      })
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Complete the hearing details form before you submit the hearing, and update it if anything changes while you work."
      )
    ).toBeTruthy();
  });
});
