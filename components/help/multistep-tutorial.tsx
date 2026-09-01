"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ComponentType } from "react";
import { Safari } from "@/components/help/safari";
import {
  type Step,
  StepperControls,
  StepperNavigation,
  StepperPanel,
  StepperProvider,
  StepperStep,
  useStepper,
} from "@/components/multistep-wizard";
import { Button } from "@/components/ui/button";

type QuickStartStep = Step & {
  instruction: string;
  Illustration: ComponentType;
};

// SVG Illustrations for each step - rendered inside Safari component screen area (1200x700)
function HomePageIllustration() {
  return (
    <Safari
      decorative
      url="courtstranscribe.justice.gov.uk"
      mode="simple"
      className="w-full"
    >
      <svg viewBox="0 0 1200 700" className="size-full" aria-hidden="true">
        {/* Background */}
        <rect width="1200" height="700" className="fill-background" />

        {/* Page title */}
        <rect
          x="40"
          y="40"
          width="200"
          height="20"
          rx="4"
          className="fill-foreground/60"
        />

        {/* Start Recording Button - highlighted */}
        <rect
          x="40"
          y="90"
          width="240"
          height="55"
          rx="8"
          className="fill-primary"
        />
        <text
          x="160"
          y="125"
          textAnchor="middle"
          fill="white"
          fontSize="18"
          fontWeight="500"
        >
          + Go to recording
        </text>

        {/* Recent recordings section */}
        <rect
          x="40"
          y="180"
          width="140"
          height="14"
          rx="3"
          className="fill-muted-foreground/40"
        />
        <rect
          x="40"
          y="210"
          width="1120"
          height="50"
          rx="6"
          className="fill-muted/30"
        />
        <rect
          x="40"
          y="275"
          width="1120"
          height="50"
          rx="6"
          className="fill-muted/20"
        />
        <rect
          x="40"
          y="340"
          width="1120"
          height="50"
          rx="6"
          className="fill-muted/20"
        />
      </svg>
    </Safari>
  );
}

function FormIllustration() {
  return (
    <Safari
      decorative
      url="courtstranscribe.justice.gov.uk/recording"
      mode="simple"
      className="w-full"
    >
      <svg viewBox="0 0 1200 700" className="size-full" aria-hidden="true">
        {/* Background */}
        <rect width="1200" height="700" className="fill-background" />

        {/* Form panel - highlighted */}
        <rect
          x="20"
          y="20"
          width="350"
          height="660"
          rx="8"
          className="fill-card stroke-primary stroke-[3]"
        />

        {/* Form title */}
        <rect
          x="40"
          y="40"
          width="120"
          height="16"
          rx="3"
          className="fill-foreground/70"
        />

        {/* Form fields */}
        <rect
          x="40"
          y="80"
          width="80"
          height="10"
          rx="2"
          className="fill-muted-foreground/50"
        />
        <rect
          x="40"
          y="96"
          width="310"
          height="36"
          rx="4"
          className="fill-muted/30"
        />

        <rect
          x="40"
          y="150"
          width="100"
          height="10"
          rx="2"
          className="fill-muted-foreground/50"
        />
        <rect
          x="40"
          y="166"
          width="310"
          height="36"
          rx="4"
          className="fill-muted/30"
        />

        <rect
          x="40"
          y="220"
          width="90"
          height="10"
          rx="2"
          className="fill-muted-foreground/50"
        />
        <rect
          x="40"
          y="236"
          width="310"
          height="36"
          rx="4"
          className="fill-muted/30"
        />

        <rect
          x="40"
          y="290"
          width="70"
          height="10"
          rx="2"
          className="fill-muted-foreground/50"
        />
        <rect
          x="40"
          y="306"
          width="310"
          height="36"
          rx="4"
          className="fill-muted/30"
        />

        <rect
          x="40"
          y="360"
          width="110"
          height="10"
          rx="2"
          className="fill-muted-foreground/50"
        />
        <rect
          x="40"
          y="376"
          width="310"
          height="36"
          rx="4"
          className="fill-muted/30"
        />

        <rect
          x="40"
          y="430"
          width="85"
          height="10"
          rx="2"
          className="fill-muted-foreground/50"
        />
        <rect
          x="40"
          y="446"
          width="310"
          height="36"
          rx="4"
          className="fill-muted/30"
        />

        {/* Main content area */}
        <rect
          x="390"
          y="20"
          width="790"
          height="660"
          rx="8"
          className="fill-muted/10"
        />
        <rect
          x="420"
          y="50"
          width="200"
          height="18"
          rx="3"
          className="fill-muted-foreground/30"
        />
        <rect
          x="420"
          y="90"
          width="730"
          height="120"
          rx="6"
          className="fill-muted/20"
        />
      </svg>
    </Safari>
  );
}

function RecordingIllustration() {
  return (
    <Safari
      decorative
      url="courtstranscribe.justice.gov.uk/recording"
      mode="simple"
      className="w-full"
    >
      <svg viewBox="0 0 1200 700" className="size-full" aria-hidden="true">
        {/* Background */}
        <rect width="1200" height="700" className="fill-background" />

        {/* Form panel */}
        <rect
          x="20"
          y="20"
          width="350"
          height="660"
          rx="8"
          className="fill-muted/10"
        />

        {/* Transcript area - highlighted */}
        <rect
          x="390"
          y="20"
          width="790"
          height="660"
          rx="8"
          className="fill-card stroke-primary stroke-[3]"
        />

        {/* Transcript lines */}
        <rect
          x="420"
          y="50"
          width="700"
          height="14"
          rx="3"
          className="fill-foreground/50"
        />
        <rect
          x="420"
          y="80"
          width="620"
          height="14"
          rx="3"
          className="fill-foreground/40"
        />
        <rect
          x="420"
          y="110"
          width="680"
          height="14"
          rx="3"
          className="fill-foreground/50"
        />
        <rect
          x="420"
          y="140"
          width="580"
          height="14"
          rx="3"
          className="fill-foreground/40"
        />
        <rect
          x="420"
          y="170"
          width="660"
          height="14"
          rx="3"
          className="fill-foreground/50"
        />
        <rect
          x="420"
          y="200"
          width="640"
          height="14"
          rx="3"
          className="fill-foreground/40"
        />
        <rect
          x="420"
          y="230"
          width="700"
          height="14"
          rx="3"
          className="fill-foreground/50"
        />
        <rect
          x="420"
          y="260"
          width="600"
          height="14"
          rx="3"
          className="fill-foreground/40"
        />
        <rect
          x="420"
          y="290"
          width="680"
          height="14"
          rx="3"
          className="fill-foreground/50"
        />

        {/* Recording indicator - bottom left of right container */}
        <circle
          cx="440"
          cy="646"
          r="12"
          fill="#ef4444"
          className="animate-pulse"
        />
        <rect
          x="465"
          y="630"
          width="80"
          height="32"
          rx="5"
          className="fill-foreground"
        />

        {/* Section tabs - bottom right of right container */}
        <rect
          x="880"
          y="630"
          width="100"
          height="32"
          rx="5"
          className="fill-primary"
        />
        <rect
          x="990"
          y="630"
          width="100"
          height="32"
          rx="5"
          className="fill-muted/30"
        />
        <rect
          x="1100"
          y="630"
          width="60"
          height="32"
          rx="5"
          className="fill-muted/30"
        />
      </svg>
    </Safari>
  );
}

function SubmitIllustration() {
  return (
    <Safari
      decorative
      url="courtstranscribe.justice.gov.uk/recording"
      mode="simple"
      className="w-full"
    >
      <svg viewBox="0 0 1200 700" className="size-full" aria-hidden="true">
        {/* Background */}
        <rect width="1200" height="700" className="fill-background" />

        {/* Form panel */}
        <rect
          x="20"
          y="20"
          width="350"
          height="660"
          rx="8"
          className="fill-muted/10"
        />

        {/* Submit button - highlighted, at bottom of left panel */}
        <rect
          x="40"
          y="620"
          width="310"
          height="50"
          rx="8"
          className="fill-primary"
        />
        <text
          x="195"
          y="652"
          textAnchor="middle"
          fill="white"
          fontSize="18"
          fontWeight="500"
        >
          Submit Hearing
        </text>

        {/* Arrow pointing to button */}
        <path
          d="M195 550 L195 605"
          strokeWidth="4"
          strokeDasharray="8,8"
          className="stroke-primary"
          fill="none"
        />
        <polygon points="195,615 183,595 207,595" className="fill-primary" />

        {/* Transcript area */}
        <rect
          x="390"
          y="20"
          width="790"
          height="660"
          rx="8"
          className="fill-muted/10"
        />

        {/* Transcript content */}
        <rect
          x="420"
          y="50"
          width="200"
          height="18"
          rx="3"
          className="fill-muted-foreground/30"
        />
        <rect
          x="420"
          y="90"
          width="700"
          height="14"
          rx="3"
          className="fill-foreground/40"
        />
        <rect
          x="420"
          y="120"
          width="620"
          height="14"
          rx="3"
          className="fill-foreground/30"
        />
        <rect
          x="420"
          y="150"
          width="680"
          height="14"
          rx="3"
          className="fill-foreground/40"
        />
        <rect
          x="420"
          y="180"
          width="580"
          height="14"
          rx="3"
          className="fill-foreground/30"
        />
        <rect
          x="420"
          y="210"
          width="660"
          height="14"
          rx="3"
          className="fill-foreground/40"
        />
      </svg>
    </Safari>
  );
}

function DownloadIllustration() {
  return (
    <Safari
      decorative
      url="courtstranscribe.justice.gov.uk"
      mode="simple"
      className="w-full"
    >
      <svg viewBox="0 0 1200 700" className="size-full" aria-hidden="true">
        {/* Background */}
        <rect width="1200" height="700" className="fill-background" />

        {/* Page title */}
        <rect
          x="40"
          y="40"
          width="200"
          height="20"
          rx="4"
          className="fill-foreground/60"
        />

        {/* Recording card - highlighted */}
        <rect
          x="40"
          y="90"
          width="1120"
          height="100"
          rx="8"
          className="fill-card stroke-primary stroke-[3]"
        />

        {/* Recording info */}
        <rect
          x="70"
          y="120"
          width="200"
          height="18"
          rx="3"
          className="fill-foreground/60"
        />
        <rect
          x="70"
          y="150"
          width="140"
          height="14"
          rx="3"
          className="fill-muted-foreground/40"
        />

        {/* Download buttons row */}
        <rect
          x="970"
          y="115"
          width="50"
          height="50"
          rx="6"
          className="fill-primary"
        />
        <rect x="980" y="122" width="30" height="36" rx="3" fill="#2b579a" />
        <text
          x="995"
          y="148"
          textAnchor="middle"
          fill="white"
          fontSize="14"
          fontWeight="bold"
        >
          W
        </text>
        <rect
          x="1030"
          y="115"
          width="50"
          height="50"
          rx="6"
          className="fill-muted/30"
        />
        <rect
          x="1090"
          y="115"
          width="50"
          height="50"
          rx="6"
          className="fill-muted/30"
        />

        {/* Other recordings */}
        <rect
          x="40"
          y="220"
          width="1120"
          height="70"
          rx="6"
          className="fill-muted/20"
        />
        <rect
          x="40"
          y="310"
          width="1120"
          height="70"
          rx="6"
          className="fill-muted/20"
        />
        <rect
          x="40"
          y="400"
          width="1120"
          height="70"
          rx="6"
          className="fill-muted/20"
        />
      </svg>
    </Safari>
  );
}

// Quick Start Guide steps
const quickStartSteps: QuickStartStep[] = [
  {
    id: "start-recording",
    title: "Start a new recording",
    instruction:
      "From the home page, select Go to recording to open the recording workspace.",
    Illustration: HomePageIllustration,
  },
  {
    id: "fill-form",
    title: "Complete the form",
    instruction:
      "Complete the hearing details form before you submit the hearing, and update it if anything changes while you work.",
    Illustration: FormIllustration,
  },
  {
    id: "record",
    title: "Record your dictation",
    instruction:
      "Use the recording controls to start or pause capture while the live transcript builds in the transcript workspace.",
    Illustration: RecordingIllustration,
  },
  {
    id: "submit",
    title: "Submit hearing",
    instruction:
      "When the form and transcript are ready, select Submit hearing to generate the document.",
    Illustration: SubmitIllustration,
  },
  {
    id: "download",
    title: "Download document",
    instruction:
      "After processing finishes, return to the home page and choose Download document for the hearing you want.",
    Illustration: DownloadIllustration,
  },
];

function QuickStartWizardControls() {
  const {
    currentStepIndex,
    steps,
    prevStep,
    nextStep,
    isFirstStep,
    isLastStep,
  } = useStepper();

  const previousStep = steps[currentStepIndex - 1];
  const nextStepData = steps[currentStepIndex + 1];
  const previousStepLabel = previousStep
    ? `Go to previous step: ${previousStep.title}`
    : "Previous step";
  const nextStepLabel = nextStepData
    ? `Go to next step: ${nextStepData.title}`
    : "Next step";

  return (
    <StepperControls className="mb-6">
      <Button
        type="button"
        className="rounded-full"
        size="icon"
        variant="outline"
        onClick={prevStep}
        disabled={isFirstStep}
        aria-label={previousStepLabel}
        aria-controls={
          previousStep ? `step-panel-${previousStep.id}` : undefined
        }
        title={previousStepLabel}
      >
        <ChevronLeft aria-hidden="true" />
      </Button>
      <Button
        type="button"
        className="rounded-full"
        size="icon"
        variant="outline"
        onClick={nextStep}
        disabled={isLastStep}
        aria-label={nextStepLabel}
        aria-controls={
          nextStepData ? `step-panel-${nextStepData.id}` : undefined
        }
        title={nextStepLabel}
      >
        <ChevronRight aria-hidden="true" />
      </Button>
    </StepperControls>
  );
}

export function MultistepTutorial() {
  return (
    <StepperProvider
      steps={quickStartSteps}
      variant="horizontal"
      labelOrientation="vertical"
    >
      <div className="aspect-video">
        <div className="flex gap-8 pt-6 justify-between">
          <StepperNavigation className="mb-8">
            {quickStartSteps.map((step, index) => (
              <StepperStep key={step.id} stepIndex={index} />
            ))}
          </StepperNavigation>

          <QuickStartWizardControls />
        </div>

        <StepperPanel stepIndex={0}>
          <div className="not-prose space-y-4">
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              {quickStartSteps[0].instruction}
            </p>
            <div
              role="img"
              aria-label="Illustration of the home page with the Go to recording button"
              data-quick-start-illustration={quickStartSteps[0].id}
            >
              <HomePageIllustration />
            </div>
          </div>
        </StepperPanel>

        <StepperPanel stepIndex={1}>
          <div className="not-prose space-y-4">
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              {quickStartSteps[1].instruction}
            </p>
            <div
              role="img"
              aria-label="Illustration of the hearing details form"
              data-quick-start-illustration={quickStartSteps[1].id}
            >
              <FormIllustration />
            </div>
          </div>
        </StepperPanel>

        <StepperPanel stepIndex={2}>
          <div className="not-prose space-y-4">
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              {quickStartSteps[2].instruction}
            </p>
            <div
              role="img"
              aria-label="Illustration of the recording controls with a live transcript building in the workspace"
              data-quick-start-illustration={quickStartSteps[2].id}
            >
              <RecordingIllustration />
            </div>
          </div>
        </StepperPanel>

        <StepperPanel stepIndex={3}>
          <div className="not-prose space-y-4">
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              {quickStartSteps[3].instruction}
            </p>
            <div
              role="img"
              aria-label="Illustration of the Submit hearing button"
              data-quick-start-illustration={quickStartSteps[3].id}
            >
              <SubmitIllustration />
            </div>
          </div>
        </StepperPanel>

        <StepperPanel stepIndex={4}>
          <div className="not-prose space-y-4">
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              {quickStartSteps[4].instruction}
            </p>
            <div
              role="img"
              aria-label="Illustration of the home page with the Download document option"
              data-quick-start-illustration={quickStartSteps[4].id}
            >
              <DownloadIllustration />
            </div>
          </div>
        </StepperPanel>
      </div>
    </StepperProvider>
  );
}
