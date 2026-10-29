"use client";

import { useEffect, useState } from "react";
import { Separator } from "@/components/ui/separator";
import {
  type AnalyticsConsent,
  CONSENT_COOKIE_NAME,
  readAnalyticsConsent,
} from "@/lib/analytics-consent";

const COOKIE_EXPIRY_DAYS = 365;

export default function CookiesPage() {
  const [analytics, setAnalytics] = useState<AnalyticsConsent>("off");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setAnalytics(readAnalyticsConsent());
  }, []);

  function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();

    // Persist the preference using the same cookie format as @hmcts/cookie-manager.
    // We cannot rely on cookie-manager's PreferencesFormHandler because it is
    // initialised once in the layout. On client-side navigation to this page the
    // form is not in the DOM at init time, so no submit listener is attached.
    // The preference is read whenever an analytics event is sent, so it applies
    // immediately.
    const prefs = { analytics };
    const expires = new Date();
    expires.setDate(expires.getDate() + COOKIE_EXPIRY_DAYS);
    const secure = window.location.protocol === "https:" ? ";secure" : "";
    document.cookie = `${CONSENT_COOKIE_NAME}=${JSON.stringify(prefs)};expires=${expires.toUTCString()};path=/${secure}`;

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
          We use cookies to make Bench Notes work and to collect information about how you use the service.
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
                  <td className="px-4 py-2 font-mono text-xs">transcribe_session</td>
                  <td className="px-4 py-2 text-muted-foreground">Keeps you signed in</td>
                  <td className="px-4 py-2 text-muted-foreground">12 hours</td>
                </tr>
                <tr className="border-t">
                  <td className="px-4 py-2 font-mono text-xs">transcribe_login_state</td>
                  <td className="px-4 py-2 text-muted-foreground">Protects your sign-in while it is in progress</td>
                  <td className="px-4 py-2 text-muted-foreground">10 minutes</td>
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
          <h2 className="text-xl font-semibold">Analytics (optional)</h2>
          <p className="text-sm text-muted-foreground">
            If you allow analytics, we record which parts of Bench Notes are used, for example
            which pages are viewed and when minutes are generated or copied, so we can improve
            the service. These records are kept in HMCTS&apos;s own monitoring service. They do
            not include your name, email address, transcripts, notes or case details, and no
            analytics cookies are set on your device.
          </p>
          <p className="text-sm text-muted-foreground">
            Whatever you choose, we record whether the service is working (for example, when a
            recording fails to start or an autosave fails) so that problems can be fixed. This
            information is needed to run the service and does not include your name, email
            address, transcripts, notes or case details. Your browser&apos;s local storage holds
            these records briefly if they cannot be sent straight away, for example when the
            page closes unexpectedly.
          </p>

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
                Do you want to allow analytics?
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
                  Yes, allow analytics
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
                  No, do not allow analytics
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
