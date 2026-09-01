"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import WelcomePage from "@/components/welcome-page";
import useBrowserNavigation from "@/hooks/use-browser-navigation";
import { apiClient } from "@/lib/api-client";

interface OnboardingStatus {
  has_completed_onboarding: boolean;
  force_onboarding_override: boolean;
  should_show_onboarding: boolean;
  user_id: string;
  environment: string;
}

function MainParentComponent() {
  const { currentParams } = useBrowserNavigation();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);

  // Check if we're directly accessing a transcript via URL
  const transcriptId = currentParams?.get("id");

  useEffect(() => {
    const checkOnboardingStatus = async () => {
      try {
        const response = await apiClient.request<OnboardingStatus>(
          "/user/onboarding-status"
        );

        if (response.data) {
          // First-login onboarding redirect disabled: users go straight to the app
          const shouldShowOnboarding = false;
          const isOnOnboardingPage =
            window.location.pathname.includes("/onboarding");

          if (
            shouldShowOnboarding &&
            response.data.should_show_onboarding &&
            !isOnOnboardingPage &&
            !transcriptId
          ) {
            router.push("/onboarding");
          }
        }
      } catch (error) {
        console.error("Failed to check onboarding status:", error);
        // Continue without onboarding check on error
      } finally {
        setIsLoading(false);
      }
    };

    checkOnboardingStatus();
  }, [router, transcriptId]);

  // Show loading while checking onboarding status
  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <div className="text-lg text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex">
      <div className="mx-auto flex w-full items-center justify-center">
        <div className="w-full mx-auto overflow-x-hidden">
          <WelcomePage />
        </div>
      </div>
    </div>
  );
}

export default MainParentComponent;
