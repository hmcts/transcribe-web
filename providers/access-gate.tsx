"use client";
import type React from "react";
import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api-client";
import type { OnboardingStatusResponse } from "@/src/api/generated/models/OnboardingStatusResponse";

export default function AccessGate({
  children,
}: {
  children: React.ReactNode;
}) {
  // Start with 'checking' to prevent flash of content
  const [accessStatus, setAccessStatus] = useState<"checking" | "allowed">(
    "checking"
  );
  const [isRedirecting, setIsRedirecting] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const checkAccess = async () => {
      try {
        const response = await apiClient.request<OnboardingStatusResponse>(
          "/user/onboarding-status"
        );

        if (isMounted && response.data) {
          const should_show_onboarding = false;
          const { should_show_coming_soon } = response.data;

          // Handle redirects - check if we're in browser environment
          if (typeof window !== "undefined") {
            const currentPathname = window.location.pathname;
            const currentSearch = window.location.search;
            const onComingSoon = currentPathname?.startsWith("/coming-soon");
            const onOnboarding = currentPathname?.startsWith("/onboarding");
            // More specific check for transcript pages - look for ?id= or &id= pattern
            const isTranscriptPage = currentSearch?.match(/[?&]id=/);

            if (should_show_coming_soon && !onComingSoon) {
              setIsRedirecting(true);
              window.location.href = "/coming-soon";
              return;
            }
            if (
              !should_show_coming_soon &&
              should_show_onboarding &&
              !onOnboarding &&
              !isTranscriptPage
            ) {
              setIsRedirecting(true);
              window.location.href = "/onboarding";
              return;
            }
            if (
              !should_show_coming_soon &&
              !should_show_onboarding &&
              onComingSoon
            ) {
              setIsRedirecting(true);
              window.location.href = "/";
              return;
            }
          }

          // If we got here, no redirect needed - allow page to render
          setAccessStatus("allowed");
        }
      } catch (_e) {
        if (isMounted) {
          // On error, redirect to coming-soon if not already there
          if (typeof window !== "undefined") {
            const currentPathname = window.location.pathname;
            const onComingSoon = currentPathname?.startsWith("/coming-soon");
            if (!onComingSoon) {
              setIsRedirecting(true);
              window.location.href = "/coming-soon";
              return;
            }
          }
          // If already on coming-soon, allow it to render
          setAccessStatus("allowed");
        }
      }
    };

    checkAccess();

    return () => {
      isMounted = false;
    };
  }, []); // Empty dependency array - only run once

  // Show loading screen while checking or redirecting
  if (accessStatus === "checking" || isRedirecting) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50">
        <div
          className="text-center"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <h1 className="text-2xl font-semibold text-gray-800 mb-6">
            {isRedirecting ? "Redirecting" : "Access Verification"}
          </h1>
          <div
            className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"
            aria-hidden="true"
          />
          <p
            className="text-gray-600 font-medium"
            aria-label="Verifying your access permissions"
          >
            {isRedirecting ? "Redirecting..." : "Verifying access..."}
          </p>
        </div>
      </main>
    );
  }

  // Render page content once check is complete and no redirect needed
  return children;
}
