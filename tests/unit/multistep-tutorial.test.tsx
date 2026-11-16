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
        "From the home page, select Decisions, then Record a decision to open the dictation workspace."
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
    ).toBe("Illustration of the Decisions page with the Record a decision button");

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

  it("sends the user to Decisions to download the document (DIAAT-400)", () => {
    const { container } = render(<MultistepTutorial />);
    for (let step = 0; step < 4; step += 1) {
      fireEvent.click(screen.getAllByRole("button", { name: /Go to next step/ })[0]);
    }

    expect(
      screen.getByText(
        "After processing finishes, go to Decisions and choose Download document for the hearing you want."
      )
    ).toBeTruthy();
    expect(
      container
        .querySelector('[data-quick-start-illustration="download"]')
        ?.getAttribute("aria-label")
    ).toBe("Illustration of the Decisions page with the Download document option");
  });
});
