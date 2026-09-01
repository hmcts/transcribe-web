"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { Check } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// #region Types

type StepperVariant = "horizontal" | "vertical" | "circle";
type StepperLabelOrientation = "horizontal" | "vertical";

type Step = {
  id: string;
  title: string;
  description?: string;
};

type StepperContextValue = {
  steps: Step[];
  currentStepIndex: number;
  variant: StepperVariant;
  labelOrientation: StepperLabelOrientation;
  tracking: boolean;
  goToStep: (index: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  isFirstStep: boolean;
  isLastStep: boolean;
  currentStep: Step;
};

// #endregion Types

// #region Context

const StepperContext = React.createContext<StepperContextValue | null>(null);

const useStepper = (): StepperContextValue => {
  const context = React.useContext(StepperContext);
  if (!context) {
    throw new Error("useStepper must be used within a StepperProvider.");
  }
  return context;
};

// #endregion Context

// #region Stepper Provider

type StepperProviderProps = {
  steps: Step[];
  initialStep?: number;
  variant?: StepperVariant;
  labelOrientation?: StepperLabelOrientation;
  tracking?: boolean;
  children: React.ReactNode;
  className?: string;
  onStepChange?: (stepIndex: number) => void;
};

const StepperProvider = ({
  steps,
  initialStep = 0,
  variant = "horizontal",
  labelOrientation = "horizontal",
  tracking = false,
  children,
  className,
  onStepChange,
}: StepperProviderProps) => {
  const [currentStepIndex, setCurrentStepIndex] = React.useState(initialStep);

  const goToStep = React.useCallback(
    (index: number) => {
      if (index >= 0 && index < steps.length) {
        setCurrentStepIndex(index);
        onStepChange?.(index);
      }
    },
    [steps.length, onStepChange]
  );

  const nextStep = React.useCallback(() => {
    goToStep(currentStepIndex + 1);
  }, [currentStepIndex, goToStep]);

  const prevStep = React.useCallback(() => {
    goToStep(currentStepIndex - 1);
  }, [currentStepIndex, goToStep]);

  const value = React.useMemo(
    () => ({
      steps,
      currentStepIndex,
      variant,
      labelOrientation,
      tracking,
      goToStep,
      nextStep,
      prevStep,
      isFirstStep: currentStepIndex === 0,
      isLastStep: currentStepIndex === steps.length - 1,
      currentStep: steps[currentStepIndex],
    }),
    [
      steps,
      currentStepIndex,
      variant,
      labelOrientation,
      tracking,
      goToStep,
      nextStep,
      prevStep,
    ]
  );

  return (
    <StepperContext.Provider value={value}>
      <div className={cn("stepper w-full", className)}>
        <div aria-live="polite" aria-atomic="true" className="sr-only">
          {`Step ${currentStepIndex + 1} of ${steps.length}: ${steps[currentStepIndex].title}`}
        </div>
        {children}
      </div>
    </StepperContext.Provider>
  );
};

// #endregion Stepper Provider

// #region Stepper Navigation

type StepperNavigationProps = React.ComponentProps<"nav">;

const StepperNavigation = ({
  children,
  className,
  "aria-label": ariaLabel = "Stepper Navigation",
  ...props
}: StepperNavigationProps) => {
  const { variant } = useStepper();

  return (
    <nav
      aria-label={ariaLabel}
      className={cn("stepper-navigation", className)}
      {...props}
    >
      <ol className={listVariants({ variant })}>{children}</ol>
    </nav>
  );
};

// #endregion Stepper Navigation

// #region Stepper Step

type StepperStepProps = React.ComponentProps<"button"> & {
  stepIndex: number;
  icon?: React.ReactNode;
};

const StepperStep = ({
  stepIndex,
  icon,
  className,
  children,
  ...props
}: StepperStepProps) => {
  const { steps, currentStepIndex, variant, labelOrientation, goToStep } =
    useStepper();

  const step = steps[stepIndex];
  const isLast = stepIndex === steps.length - 1;
  const isActive = currentStepIndex === stepIndex;
  const isCompleted = currentStepIndex > stepIndex;
  const dataState = isActive
    ? "active"
    : isCompleted
      ? "completed"
      : "inactive";
  const stepLabel = `Step ${stepIndex + 1} of ${steps.length}: ${step.title}`;

  const handleClick = () => {
    goToStep(stepIndex);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const directions = {
      next: ["ArrowRight", "ArrowDown"],
      prev: ["ArrowLeft", "ArrowUp"],
    };

    if (directions.next.includes(e.key)) {
      const nextIndex = stepIndex + 1;
      if (nextIndex < steps.length) {
        const nextElement = document.getElementById(
          `step-${steps[nextIndex].id}`
        );
        nextElement?.focus();
      }
    } else if (directions.prev.includes(e.key)) {
      const prevIndex = stepIndex - 1;
      if (prevIndex >= 0) {
        const prevElement = document.getElementById(
          `step-${steps[prevIndex].id}`
        );
        prevElement?.focus();
      }
    }
  };

  if (variant === "circle") {
    return (
      <li
        className={cn(
          "stepper-step flex shrink-0 items-center gap-4 rounded-md transition-colors",
          className
        )}
      >
        <CircleStepIndicator
          currentStep={stepIndex + 1}
          totalSteps={steps.length}
        />
        <div className="stepper-step-content flex flex-col items-start gap-1">
          <StepperTitle>{step.title}</StepperTitle>
          {step.description && (
            <StepperDescription>{step.description}</StepperDescription>
          )}
        </div>
      </li>
    );
  }

  return (
    <>
      <li
        className={cn([
          "stepper-step group peer relative flex gap-2",
          "data-[variant=vertical]:flex-row data-[variant=vertical]:items-center",
          "data-[label-orientation=vertical]:w-full",
          "data-[label-orientation=vertical]:flex-col",
          "data-[label-orientation=vertical]:items-center",
        ])}
        data-variant={variant}
        data-label-orientation={labelOrientation}
        data-state={dataState}
        data-disabled={props.disabled}
      >
        <Button
          id={`step-${step.id}`}
          type="button"
          tabIndex={0}
          className="stepper-step-indicator rounded-full shrink-0 cursor-pointer"
          variant={dataState !== "inactive" ? "default" : "secondary"}
          size="icon"
          aria-controls={`step-panel-${step.id}`}
          aria-current={isActive ? "step" : undefined}
          aria-label={stepLabel}
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          {...props}
        >
          {isCompleted ? (
            <Check aria-hidden="true" className="size-4" />
          ) : (
            (icon ?? stepIndex + 1)
          )}
        </Button>
        {variant === "horizontal" && labelOrientation === "vertical" && (
          <StepperSeparator
            orientation="horizontal"
            labelOrientation={labelOrientation}
            isLast={isLast}
            state={dataState}
            disabled={props.disabled}
          />
        )}
        <div className="stepper-step-content flex flex-col items-center text-center">
          <StepperTitle>{step.title}</StepperTitle>
          {step.description && (
            <StepperDescription>{step.description}</StepperDescription>
          )}
        </div>
      </li>

      {variant === "horizontal" && labelOrientation === "horizontal" && (
        <StepperSeparator
          orientation="horizontal"
          isLast={isLast}
          state={dataState}
          disabled={props.disabled}
        />
      )}

      {variant === "vertical" && !isLast && (
        <div className="flex gap-4">
          <div className="flex justify-center ps-5">
            <StepperSeparator
              orientation="vertical"
              isLast={isLast}
              state={dataState}
              disabled={props.disabled}
            />
          </div>
          <div className="my-3 flex-1 ps-4">{children}</div>
        </div>
      )}
    </>
  );
};

// #endregion Stepper Step

// #region Stepper Title

type StepperTitleProps = React.ComponentProps<"h3"> & { asChild?: boolean };

const StepperTitle = ({
  children,
  className,
  asChild,
  ...props
}: StepperTitleProps) => {
  const Comp = asChild ? Slot : "h3";

  return (
    <Comp
      className={cn(
        "stepper-step-title text-base font-medium max-w-[20ch]",
        className
      )}
      {...props}
    >
      {children}
    </Comp>
  );
};

// #endregion Stepper Title

// #region Stepper Description

type StepperDescriptionProps = React.ComponentProps<"p"> & {
  asChild?: boolean;
};

const StepperDescription = ({
  children,
  className,
  asChild,
  ...props
}: StepperDescriptionProps) => {
  const Comp = asChild ? Slot : "p";

  return (
    <Comp
      className={cn(
        "stepper-step-description text-sm text-muted-foreground",
        className
      )}
      {...props}
    >
      {children}
    </Comp>
  );
};

// #endregion Stepper Description

// #region Stepper Panel

type StepperPanelProps = React.ComponentProps<"div"> & {
  stepIndex: number;
  asChild?: boolean;
};

const StepperPanel = ({
  stepIndex,
  children,
  className,
  asChild,
  ...props
}: StepperPanelProps) => {
  const { currentStepIndex, tracking, steps } = useStepper();
  const Comp = asChild ? Slot : "div";

  if (currentStepIndex !== stepIndex) {
    return null;
  }

  return (
    <Comp
      id={`step-panel-${steps[stepIndex].id}`}
      aria-labelledby={`step-${steps[stepIndex].id}`}
      className={cn("stepper-step-panel", className)}
      ref={(node: HTMLDivElement | null) => {
        if (tracking && node) {
          node.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }}
      {...props}
    >
      {children}
    </Comp>
  );
};

// #endregion Stepper Panel

// #region Stepper Controls

type StepperControlsProps = React.ComponentProps<"div"> & { asChild?: boolean };

const StepperControls = ({
  children,
  className,
  asChild,
  ...props
}: StepperControlsProps) => {
  const Comp = asChild ? Slot : "div";

  return (
    <Comp
      className={cn("stepper-controls flex justify-end gap-4", className)}
      {...props}
    >
      {children}
    </Comp>
  );
};

// #endregion Stepper Controls

// #region Stepper Separator

type StepperSeparatorProps = {
  orientation: "horizontal" | "vertical";
  labelOrientation?: StepperLabelOrientation;
  isLast: boolean;
  state: string;
  disabled?: boolean;
};

const StepperSeparator = ({
  orientation,
  isLast,
  labelOrientation,
  state,
  disabled,
}: StepperSeparatorProps) => {
  if (isLast) {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      data-orientation={orientation}
      data-state={state}
      data-disabled={disabled}
      className={classForSeparator({ orientation, labelOrientation })}
    />
  );
};

// #endregion Stepper Separator

// #region Circle Indicator

type CircleStepIndicatorProps = {
  currentStep: number;
  totalSteps: number;
  size?: number;
  strokeWidth?: number;
};

const CircleStepIndicator = ({
  currentStep,
  totalSteps,
  size = 80,
  strokeWidth = 6,
}: CircleStepIndicatorProps) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const fillPercentage = (currentStep / totalSteps) * 100;
  const dashOffset = circumference - (circumference * fillPercentage) / 100;

  return (
    <div
      role="progressbar"
      aria-valuenow={currentStep}
      aria-valuemin={1}
      aria-valuemax={totalSteps}
      tabIndex={-1}
      className="stepper-step-indicator relative inline-flex items-center justify-center"
    >
      <svg width={size} height={size}>
        <title>Step Indicator</title>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-muted-foreground"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          className="text-primary transition-all duration-300 ease-in-out"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-sm font-medium" aria-live="polite">
          {currentStep} of {totalSteps}
        </span>
      </div>
    </div>
  );
};

// #endregion Circle Indicator

// #region Styles

const listVariants = cva("stepper-navigation-list flex gap-2", {
  variants: {
    variant: {
      horizontal: "flex-row items-start justify-between",
      vertical: "flex-col",
      circle: "flex-row items-center justify-between",
    },
  },
});

const classForSeparator = cva(
  [
    "bg-muted",
    "data-[state=completed]:bg-primary data-[disabled]:opacity-50",
    "transition-all duration-300 ease-in-out",
  ],
  {
    variants: {
      orientation: {
        horizontal: "h-0.5 flex-1",
        vertical: "h-full w-0.5",
      },
      labelOrientation: {
        horizontal: "",
        vertical:
          "absolute left-[calc(50%+30px)] right-[calc(-50%+20px)] top-5 block shrink-0",
      },
    },
  }
);

// #endregion Styles

export {
  CircleStepIndicator,
  type Step,
  StepperControls,
  StepperDescription,
  type StepperLabelOrientation,
  StepperNavigation,
  StepperPanel,
  StepperProvider,
  StepperStep,
  StepperTitle,
  type StepperVariant,
  useStepper,
};
