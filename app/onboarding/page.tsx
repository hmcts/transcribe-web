"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import LicenseCheckFail from "@/components/onboarding/license-check-fail";
// Step Components
import Step1Welcome from "@/components/onboarding/step1-welcome";
import Step2BasicTutorial from "@/components/onboarding/step2-transcribe";
import Step3ReviewEdit from "@/components/onboarding/step3-review-edit";
import Step4Ready from "@/components/onboarding/step4-ready";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics";
import { apiClient } from "@/lib/api-client";

const TOTAL_STEPS = 4;
const STEP_NAMES: Record<number, string> = {
  1: "welcome",
  2: "transcribe",
  3: "review_edit",
  4: "ready",
};

export default function OnboardingPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);
  const [hasValidLicense, setHasValidLicense] = useState<boolean | null>(null);
  const [onboardingStatus, setOnboardingStatus] = useState<{
    force_onboarding_override?: boolean;
    environment?: string;
  } | null>(null);
  // Removed formData as step 2 is no longer used

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // Update page title for accessibility (WCAG 2.4.2 Page Titled)
  useEffect(() => {
    if (hasValidLicense === false) {
      document.title = "Judicial Transcribe coming soon – access pending";
      return;
    }

    const titlesByStep = {
      1: "Welcome – Judicial Transcribe onboarding (step 1 of 4)",
      2: "Transcribe a meeting – Judicial Transcribe onboarding (step 2 of 4)",
      3: "Review and edit – Judicial Transcribe onboarding (step 3 of 4)",
      4: "You're ready – Judicial Transcribe onboarding (step 4 of 4)",
    } as const;

    document.title =
      titlesByStep[currentStep as 1 | 2 | 3 | 4] || "Judicial Transcribe";
  }, [currentStep, hasValidLicense]);

  // Fetch onboarding status on page load to show warning banner
  useEffect(() => {
    const fetchOnboardingStatus = async () => {
      try {
        const response = await apiClient.request("/user/onboarding-status");
        if (response.data) {
          setOnboardingStatus(response.data);
        }
      } catch (_error) {
        // Failed to fetch onboarding status, continue silently
      }
    };

    fetchOnboardingStatus();
  }, []);

  useEffect(() => {
    if (hasValidLicense === false) {
      return;
    }
    track("onboarding_step_viewed", {
      step: currentStep,
      step_name: STEP_NAMES[currentStep] || "unknown",
    });
  }, [currentStep, hasValidLicense]);

  const handleNext = async () => {
    // If we're on step 1 (Welcome), check authentication before proceeding
    if (currentStep === 1) {
      try {
        // Try to get current user - this will check Easy Auth
        const response = await apiClient.request("/user/onboarding-status");

        if (response.error || !response.data) {
          // No valid authentication - show sorry message
          track("onboarding_license_check_failed", {
            step: currentStep,
            reason: "missing_auth",
          });
          setHasValidLicense(false);
          return;
        }

        // Store onboarding status for warning banner
        setOnboardingStatus(response.data);

        // Authentication is valid - go to step 2 (Basic Tutorial)
        setCurrentStep(2);
      } catch (_error) {
        // Auth check failed - show sorry message
        track("onboarding_license_check_failed", {
          step: currentStep,
          reason: "auth_request_failed",
        });
        setHasValidLicense(false);
      }
    } else if (currentStep < TOTAL_STEPS) {
      // Go to next step: 2->3, 3->4
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      // Simple back navigation: 4->3, 3->2, 2->1
      setCurrentStep(currentStep - 1);
    }
  };

  const handleStartRecording = async () => {
    track("onboarding_completed", {
      completed_via: "get_started",
    });
    try {
      // Mark onboarding as complete
      const response = await apiClient.request<{
        success: boolean;
        message: string;
        has_completed_onboarding: boolean;
      }>("/user/complete-onboarding", {
        method: "POST",
      });

      if (response.data?.success) {
        // Onboarding marked as complete successfully
      }
    } catch (_error) {
      // Failed to mark onboarding as complete, continue to home page anyway
    }
    router.push("/"); // Return to home to start recording
  };

  // Removed form handlers as step 2 is no longer used

  const handleLicenseRetry = () => {
    // Reset license check state to allow retry
    setHasValidLicense(null);
  };

  const renderStep = () => {
    // Show license check fail page if license check failed
    if (hasValidLicense === false) {
      return <LicenseCheckFail onRetry={handleLicenseRetry} />;
    }

    switch (currentStep) {
      case 1:
        return <Step1Welcome />;
      case 2:
        return <Step2BasicTutorial />;
      case 3:
        return <Step3ReviewEdit />;
      case 4:
        return <Step4Ready />;
      default:
        return <div>Invalid step</div>;
    }
  };

  return (
    <div className="bg-background">
      {/* Skip to main content for screen readers */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:shadow-lg"
      >
        Skip to main content
      </a>
      {/* Show warning banner if dev override is active */}
      {onboardingStatus?.force_onboarding_override && (
        <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-lg border border-amber-400/80 bg-amber-100 px-4 py-3 text-amber-900 shadow-lg dark:border-amber-600/70 dark:bg-amber-950 dark:text-amber-100">
          <div className="flex items-center justify-between">
            <span className="font-medium">
              ⚠️ Warning: Onboarding flow override is active (dev mode)
            </span>
            <span className="ml-4 text-sm text-amber-900/80 dark:text-amber-200/80">
              Environment: {onboardingStatus.environment}
            </span>
          </div>
        </div>
      )}

      <div
        id="main-content"
        className={
          (currentStep === 2 || currentStep === 3) && hasValidLicense !== false
            ? "mx-auto w-full max-w-7xl px-4 pb-24 pt-6 md:pb-0"
            : "container mx-auto max-w-2xl px-3 pb-0 pt-4"
        }
      >
        {/* Main heading for accessibility */}
        <h1 className="sr-only">Complete your Judicial Transcribe setup</h1>
        {/* Step content - centered vertically */}
        {((currentStep === 2 || currentStep === 3) &&
          hasValidLicense !== false) ||
        currentStep === 1 ||
        currentStep === 4 ? (
          renderStep()
        ) : (
          <div className="flex min-h-[calc(100svh-64px)] flex-col justify-center">
            {renderStep()}
          </div>
        )}

        {/* Navigation - Show for all steps, hide for license check fail */}
        {hasValidLicense !== false && (
          <nav
            className="fixed inset-x-0 bottom-0 z-40 border-t bg-background"
            aria-label="Onboarding navigation"
          >
            <div className="container mx-auto max-w-2xl px-4 py-3">
              {(() => {
                if (currentStep === 1) {
                  // Step 1: Centered Continue button only
                  return (
                    <div className="flex w-full items-center justify-center">
                      <Button
                        onClick={handleNext}
                        className="px-8 py-3 text-base"
                      >
                        Continue
                      </Button>
                    </div>
                  );
                }
                if (currentStep === 4) {
                  // Step 4: Back on left, green Get Started on right
                  return (
                    <div className="flex items-center justify-between">
                      <Button onClick={handleBack} variant="outline">
                        Back
                      </Button>
                      <Button
                        onClick={handleStartRecording}
                        className="bg-emerald-700 px-8 py-3 text-base text-white hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                      >
                        Get started
                      </Button>
                    </div>
                  );
                }
                // Steps 2, 3: Back on left, Continue on right
                return (
                  <div className="flex items-center justify-between">
                    <Button onClick={handleBack} variant="outline">
                      Back
                    </Button>
                    <Button onClick={handleNext}>Continue</Button>
                  </div>
                );
              })()}
            </div>
          </nav>
        )}
      </div>
    </div>
  );
}
