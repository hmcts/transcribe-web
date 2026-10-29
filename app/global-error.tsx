"use client";

import NextError from "next/error";
import { useEffect } from "react";
import { browserFailures } from "@/lib/browser-failures";
import { installRelayLifecycle, telemetryRelay } from "@/lib/telemetry-relay";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    // No error tracker on CNP (Sentry removed, DIAAT-205): the error's type,
    // route and digest go to Application Insights through the relay (never its
    // message). Server-side errors are there with the same digest
    // (instrumentation.ts), which is also shown below for support.
    console.error(error);
    // This page replaces the root layout when it fails, so TelemetryBootstrap may
    // never have mounted: install the relay's page-hide flush here (idempotent), and
    // send now rather than after the batching delay, so leaving or reloading the
    // error page does not lose the report.
    installRelayLifecycle(telemetryRelay);
    browserFailures.clientError(error, "render", error.digest);
    void telemetryRelay.flush();
  }, [error]);

  return (
    // eslint-disable-next-line jsx-a11y/html-has-lang
    <html>
      <body>
        {/* `NextError` is the default Next.js error page component. Its type
        definition requires a `statusCode` prop. However, since the App Router
        does not expose status codes for errors, we simply pass 0 to render a
        generic error message. */}
        <NextError statusCode={0} />
        {error.digest && (
          <p style={{ textAlign: "center", fontFamily: "monospace" }}>
            Error reference: {error.digest}
          </p>
        )}
      </body>
    </html>
  );
}
