/**
 * The analytics preference from the cookie banner (@hmcts/cookie-manager), shared
 * by the cookie settings page and `lib/analytics`. The relay checks the same
 * cookie on the server (transcribe-api `runtime/browser_telemetry.py`).
 */

export const CONSENT_COOKIE_NAME = "judicial-transcribe-cookie-preferences";

export type AnalyticsConsent = "on" | "off";

export function readAnalyticsConsent(
  cookies: string = typeof document === "undefined" ? "" : document.cookie
): AnalyticsConsent {
  const match = cookies.match(
    new RegExp(`(?:^|;\\s*)${CONSENT_COOKIE_NAME}=([^;]+)`)
  );
  if (!match) return "off";
  try {
    const prefs = JSON.parse(decodeURIComponent(match[1]));
    return prefs?.analytics === "on" ? "on" : "off";
  } catch {
    return "off";
  }
}

export function hasAnalyticsConsent(): boolean {
  return readAnalyticsConsent() === "on";
}
