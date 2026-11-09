"use client";

import { DEV_PERSONAS, devLoginUrl } from "@/lib/dev-personas";

/**
 * Local development only: nobody is signed in, so pick a seeded persona. Shown
 * instead of the Entra login when the app runs in dev login mode.
 */
export function DevLoginScreen() {
  const returnTo =
    typeof window === "undefined" ? "/" : window.location.pathname || "/";
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 py-8">
      <h1 className="text-3xl font-bold">Sign in as a persona</h1>
      <p className="text-lg text-muted-foreground">
        Local development only. These are the test accounts the API seeds when it
        runs with ENVIRONMENT=local.
      </p>
      <ul className="flex flex-col gap-3">
        {DEV_PERSONAS.map((persona) => (
          <li key={persona.name}>
            <a
              href={devLoginUrl(persona.name, returnTo)}
              className="flex flex-col rounded-md border px-4 py-3 hover:bg-foreground/5"
            >
              <span className="text-lg font-medium">{persona.name}</span>
              <span className="text-sm text-muted-foreground">
                {persona.description}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
