"use client";

import cookieManager from "@hmcts/cookie-manager";
import { useEffect } from "react";
import { CONSENT_COOKIE_NAME } from "@/lib/analytics-consent";

// OBS-3: PostHog and Google Tag Manager are gone. The analytics preference is
// still stored by cookie-manager and read where events are sent
// (lib/analytics-consent, and the telemetry relay on the server), so there is
// nothing to switch on or off here.

export function CookieManagerInit() {
  useEffect(() => {
    cookieManager.init({
      userPreferences: {
        cookieName: CONSENT_COOKIE_NAME,
        cookieExpiry: 365,
        cookieSecure: window.location.protocol === "https:",
      },
      // No analytics cookies are set any more; listed so cookie-manager removes
      // Google Analytics and PostHog (ph_<key>_posthog) cookies left from before
      // when analytics is off.
      cookieManifest: [
        {
          categoryName: "analytics",
          cookies: ["_ga", "_gid", "_gat_UA-", "_gcl_au", "ph_"],
        },
      ],
      additionalOptions: {
        defaultConsent: false,
      },
    });
  }, []);

  return null;
}
