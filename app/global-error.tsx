"use client";

import NextError from "next/error";
import { useEffect } from "react";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    // No error tracker on CNP (Sentry removed, DIAAT-205): the browser console
    // only. Server-side errors reach Application Insights with their digest
    // (instrumentation.ts), which is shown below for support.
    console.error(error);
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
