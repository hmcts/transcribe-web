"use client";

import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import React from "react";
import { identifyUser } from "@/lib/analytics";
import { getEnv } from "@/lib/env";
import { isLocalDevelopment } from "@/lib/environment";
import { useUserSettings } from "@/providers/user-settings";
import PostHogPageView from "./posthog-page-view";

// Only initialize on client-side when API key is provided
const apiKey = getEnv("NEXT_PUBLIC_POSTHOG_API_KEY") || "";
if (typeof window !== "undefined" && apiKey !== "") {
  posthog.init(apiKey, {
    api_host: getEnv("NEXT_PUBLIC_POSTHOG_HOST") || "/ingest",
    ui_host: "https://eu.posthog.com",
    capture_pageview: false,
    capture_pageleave: true,
    person_profiles: "identified_only",
    opt_out_capturing_by_default: true,
    // Avoid analytics cookies being scoped across *.justice.gov.uk.
    persistence: "localStorage",
    cross_subdomain_cookie: false,
    session_recording: {
      enabled: true,
      maskAllInputs: false,
      maskTextSelector: ".ph-mask", // Only mask elements with ph-mask class
    },
    before_send: (event: any) => {
      // Redact comment in rating events
      if (
        event.event === "minutes_rating_submitted" &&
        event.properties?.comment
      ) {
        event.properties.comment = "[REDACTED]";
      }

      // Redact meeting title from all events
      if (event.properties?.title) {
        // eslint-disable-next-line no-param-reassign
        event.properties.title = "[REDACTED]";
      }

      return event;
    },
  } as any);
}

function PosthogProvider({ children }: React.PropsWithChildren) {
  const { user } = useUserSettings();

  React.useEffect(() => {
    if (user?.email && getEnv("NEXT_PUBLIC_POSTHOG_API_KEY")) {
      identifyUser(user.email, {
        email: user.email,
        has_completed_onboarding: user.has_completed_onboarding,
        environment: isLocalDevelopment() ? "development" : "production",
      });
    }
  }, [user]);

  // If PostHog API key is not provided, just render children without PostHog wrapper
  if (!getEnv("NEXT_PUBLIC_POSTHOG_API_KEY")) {
    return children;
  }

  return (
    <PostHogProvider client={posthog}>
      <PostHogPageView />
      {children}
    </PostHogProvider>
  );
}

export default PosthogProvider;
