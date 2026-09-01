import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  CircleStepIndicator,
  StepperControls,
  StepperNavigation,
  StepperPanel,
  StepperProvider,
  StepperStep,
  useStepper,
} from "@/components/multistep-wizard";

const STEPS = [
  { id: "step1", title: "Step One" },
  { id: "step2", title: "Step Two" },
  { id: "step3", title: "Step Three", description: "A description" },
];

function TestHarness({ onStepChange = vi.fn() }) {
  return (
    <StepperProvider steps={STEPS} onStepChange={onStepChange}>
      <StepperNavigation>
        {STEPS.map((_, i) => (
          <StepperStep key={STEPS[i].id} stepIndex={i} />
        ))}
      </StepperNavigation>
      <StepperPanel stepIndex={0}>Panel 0</StepperPanel>
      <StepperPanel stepIndex={1}>Panel 1</StepperPanel>
      <StepperPanel stepIndex={2}>Panel 2</StepperPanel>
      <StepperControls>
        <NextPrevButtons />
      </StepperControls>
    </StepperProvider>
  );
}

function NextPrevButtons() {
  const { nextStep, prevStep, isFirstStep, isLastStep } = useStepper();
  return (
    <>
      <button type="button" onClick={prevStep} disabled={isFirstStep}>
        Prev
      </button>
      <button type="button" onClick={nextStep} disabled={isLastStep}>
        Next
      </button>
    </>
  );
}

function CurrentStepDisplay() {
  const { currentStep, currentStepIndex } = useStepper();
  return (
    <div data-testid="current">
      {currentStepIndex}: {currentStep.title}
    </div>
  );
}

describe("StepperProvider", () => {
  it("renders children", () => {
    render(<TestHarness />);
    expect(screen.getByText("Panel 0")).toBeTruthy();
  });

  it("only shows panel for current step", () => {
    render(<TestHarness />);
    expect(screen.getByText("Panel 0")).toBeTruthy();
    expect(screen.queryByText("Panel 1")).toBeNull();
    expect(screen.queryByText("Panel 2")).toBeNull();
  });

  it("starts at the initial step", () => {
    render(
      <StepperProvider steps={STEPS} initialStep={1}>
        <CurrentStepDisplay />
      </StepperProvider>
    );
    expect(screen.getByTestId("current").textContent).toBe("1: Step Two");
  });
});

describe("useStepper", () => {
  it("throws when used outside a StepperProvider", () => {
    const ThrowingComponent = () => {
      useStepper();
      return null;
    };
    expect(() => render(<ThrowingComponent />)).toThrow(
      "useStepper must be used within a StepperProvider."
    );
  });
});

describe("navigation", () => {
  it("nextStep advances to the next step and shows correct panel", () => {
    render(<TestHarness />);
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("Panel 1")).toBeTruthy();
    expect(screen.queryByText("Panel 0")).toBeNull();
  });

  it("prevStep goes back to previous step", () => {
    render(
      <StepperProvider steps={STEPS} initialStep={1}>
        <StepperPanel stepIndex={0}>Panel 0</StepperPanel>
        <StepperPanel stepIndex={1}>Panel 1</StepperPanel>
        <NextPrevButtons />
      </StepperProvider>
    );
    fireEvent.click(screen.getByText("Prev"));
    expect(screen.getByText("Panel 0")).toBeTruthy();
  });

  it("Prev button is disabled on first step", () => {
    render(<TestHarness />);
    expect((screen.getByText("Prev") as HTMLButtonElement).disabled).toBe(true);
  });

  it("Next button is disabled on last step", () => {
    render(
      <StepperProvider steps={STEPS} initialStep={2}>
        <NextPrevButtons />
      </StepperProvider>
    );
    expect((screen.getByText("Next") as HTMLButtonElement).disabled).toBe(true);
  });

  it("calls onStepChange when step changes", () => {
    const onStepChange = vi.fn();
    render(<TestHarness onStepChange={onStepChange} />);
    fireEvent.click(screen.getByText("Next"));
    expect(onStepChange).toHaveBeenCalledWith(1);
  });
});

describe("StepperStep", () => {
  it("renders step titles", () => {
    render(<TestHarness />);
    expect(screen.getByText("Step One")).toBeTruthy();
    expect(screen.getByText("Step Two")).toBeTruthy();
  });

  it("renders step description when provided", () => {
    render(<TestHarness />);
    expect(screen.getByText("A description")).toBeTruthy();
  });
});

describe("CircleStepIndicator", () => {
  it("renders a progressbar with correct aria attributes", () => {
    render(<CircleStepIndicator currentStep={2} totalSteps={4} />);
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("2");
    expect(bar.getAttribute("aria-valuemax")).toBe("4");
  });

  it("displays current/total text", () => {
    render(<CircleStepIndicator currentStep={1} totalSteps={3} />);
    expect(screen.getByText("1 of 3")).toBeTruthy();
  });
});

describe("StepperProvider with circle variant", () => {
  it("renders circle variant without crashing", () => {
    render(
      <StepperProvider steps={STEPS} variant="circle">
        <StepperNavigation>
          {STEPS.map((_, i) => (
            <StepperStep key={STEPS[i].id} stepIndex={i} />
          ))}
        </StepperNavigation>
      </StepperProvider>
    );
    expect(screen.getAllByRole("progressbar").length).toBeGreaterThan(0);
  });
});
