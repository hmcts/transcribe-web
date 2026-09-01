"use client";

import { useEffect, useState } from "react";
import { Separator } from "@/components/ui/separator";

type AnalyticsConsent = "on" | "off";

const COOKIE_NAME = "judicial-transcribe-cookie-preferences";
const COOKIE_EXPIRY_DAYS = 365;

function readStoredAnalyticsConsent(): AnalyticsConsent {
  if (typeof document === "undefined") return "off";
  const match = document.cookie.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!match) return "off";
  try {
    const prefs = JSON.parse(decodeURIComponent(match[1]));
    return prefs.analytics === "on" ? "on" : "off";
  } catch {
    return "off";
  }
}

export default function CookiesPage() {
  const [analytics, setAnalytics] = useState<AnalyticsConsent>("off");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setAnalytics(readStoredAnalyticsConsent());
  }, []);

  function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();

    // Persist the preference using the same cookie format as @hmcts/cookie-manager.
    // We cannot rely on cookie-manager's PreferencesFormHandler because it is
    // initialised once in the layout. On client-side navigation to this page the
    // form is not in the DOM at init time, so no submit listener is attached.
    // PostHog and GTM sync automatically on the next page load via the
    // UserPreferencesLoaded event in CookieManagerInit.
    const prefs = { analytics };
    const expires = new Date();
    expires.setDate(expires.getDate() + COOKIE_EXPIRY_DAYS);
    const secure = window.location.protocol === "https:" ? ";secure" : "";
    document.cookie = `${COOKIE_NAME}=${JSON.stringify(prefs)};expires=${expires.toUTCString()};path=/${secure}`;

    setSaved(true);
    setTimeout(() => setSaved(false), 4000);
  }

  return (
    <div className="container max-w-3xl py-6 md:py-10">
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Cookie settings</h1>
        <Separator />

        <p className="text-muted-foreground">
          Cookies are small files saved on your phone, tablet or computer when you visit a website.
        </p>
        <p className="text-muted-foreground">
          We use cookies to make Judicial Transcribe work and to collect information about how you use the service.
        </p>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Essential cookies</h2>
          <p className="text-sm text-muted-foreground">
            These cookies are needed for the service to work. They cannot be turned off.
          </p>
          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Name</th>
                  <th className="px-4 py-2 text-left font-medium">Purpose</th>
                  <th className="px-4 py-2 text-left font-medium">Expires</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t">
                  <td className="px-4 py-2 font-mono text-xs">AppServiceAuthSession</td>
                  <td className="px-4 py-2 text-muted-foreground">Keeps you signed in</td>
                  <td className="px-4 py-2 text-muted-foreground">Session</td>
                </tr>
                <tr className="border-t">
                  <td className="px-4 py-2 font-mono text-xs">judicial-transcribe-cookie-preferences</td>
                  <td className="px-4 py-2 text-muted-foreground">Saves your cookie consent preferences</td>
                  <td className="px-4 py-2 text-muted-foreground">1 year</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Analytics cookies (optional)</h2>
          <p className="text-sm text-muted-foreground">
            These help us understand how you use the service so we can improve it. We use Google
            Analytics and PostHog to collect usage data. This may include your email address to
            associate activity with your account.
          </p>
          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Name</th>
                  <th className="px-4 py-2 text-left font-medium">Purpose</th>
                  <th className="px-4 py-2 text-left font-medium">Expires</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t">
                  <td className="px-4 py-2 font-mono text-xs">_ga</td>
                  <td className="px-4 py-2 text-muted-foreground">Google Analytics – distinguishes users</td>
                  <td className="px-4 py-2 text-muted-foreground">2 years</td>
                </tr>
                <tr className="border-t">
                  <td className="px-4 py-2 font-mono text-xs">_ga_*</td>
                  <td className="px-4 py-2 text-muted-foreground">Google Analytics – maintains session state</td>
                  <td className="px-4 py-2 text-muted-foreground">2 years</td>
                </tr>
              </tbody>
            </table>
          </div>

          {saved && (
            <div className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-800 dark:bg-green-950 dark:text-green-200">
              Your cookie settings have been saved.
            </div>
          )}

          <form
            className="cookie-preferences-form space-y-4"
            onSubmit={handleSubmit}
          >
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">
                Do you want to accept analytics cookies?
              </legend>
              <div className="flex items-center gap-2">
                <input
                  id="analytics-on"
                  type="radio"
                  name="analytics"
                  value="on"
                  checked={analytics === "on"}
                  onChange={() => setAnalytics("on")}
                  className="h-4 w-4 accent-primary"
                />
                <label htmlFor="analytics-on" className="text-sm">
                  Yes, accept analytics cookies
                </label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="analytics-off"
                  type="radio"
                  name="analytics"
                  value="off"
                  checked={analytics === "off"}
                  onChange={() => setAnalytics("off")}
                  className="h-4 w-4 accent-primary"
                />
                <label htmlFor="analytics-off" className="text-sm">
                  No, do not accept analytics cookies
                </label>
              </div>
            </fieldset>

            <button
              type="submit"
              className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
            >
              Save cookie settings
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
