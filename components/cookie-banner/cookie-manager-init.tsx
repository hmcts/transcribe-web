"use client";

import cookieManager from "@hmcts/cookie-manager";
import posthog from "posthog-js";
import { useEffect } from "react";

type CookiePreferences = {
  analytics?: "on" | "off";
};

function applyAnalyticsConsent(preferences: CookiePreferences) {
  const analyticsOn = preferences.analytics === "on";

  // Push preferences to GTM dataLayer so GA4 tags respond
  if (typeof window !== "undefined") {
    const dataLayer = ((window as Window & { dataLayer?: unknown[] }).dataLayer ??= []);
    dataLayer.push({ event: "Cookie Preferences", cookiePreferences: preferences });
  }

  // Enable/disable PostHog based on consent
  if (analyticsOn) {
    posthog.opt_in_capturing();
  } else {
    posthog.opt_out_capturing();
  }
}

export function CookieManagerInit() {
  useEffect(() => {
    const loadedToken = cookieManager.on("UserPreferencesLoaded", applyAnalyticsConsent);
    const savedToken = cookieManager.on("UserPreferencesSaved", applyAnalyticsConsent);

    cookieManager.init({
      userPreferences: {
        cookieName: "judicial-transcribe-cookie-preferences",
        cookieExpiry: 365,
        cookieSecure: window.location.protocol === "https:",
      },
      cookieManifest: [
        {
          categoryName: "analytics",
          cookies: ["_ga", "_gid", "_gat_UA-", "_gcl_au"],
        },
      ],
      additionalOptions: {
        defaultConsent: false,
      },
    });

    return () => {
      cookieManager.off(loadedToken);
      cookieManager.off(savedToken);
    };
  }, []);

  return null;
}
