"use client";

import type React from "react";
import { useEffect } from "react";
import LicenseCheckFail from "@/components/onboarding/license-check-fail";

export default function ComingSoonPage(): React.JSX.Element {
  // Set page title dynamically in client component
  useEffect(() => {
    document.title = "Coming Soon - Judicial Transcribe";
  }, []);

  return (
    <div
      className="flex min-h-[calc(100vh-50px)] items-center justify-center p-4"
      role="main"
      aria-labelledby="coming-soon-heading"
    >
      <div className="mx-auto max-w-2xl">
        <h1 id="coming-soon-heading" className="sr-only">
          Judicial Transcribe Coming Soon
        </h1>
        <LicenseCheckFail />
      </div>
    </div>
  );
}
