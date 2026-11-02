export async function register() {
  // Azure Monitor OpenTelemetry (Application Insights), only when the connection
  // string is set (charts/transcribe-web mounts it from Key Vault). Errors in
  // the Node.js server's requests reach Application Insights through it; there
  // is no Sentry on CNP.
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.APPLICATIONINSIGHTS_CONNECTION_STRING
  ) {
    const { useAzureMonitor } = await import("@azure/monitor-opentelemetry");
    // biome-ignore lint/correctness/useHookAtTopLevel: not a React hook, it's an Azure Monitor setup function
    useAzureMonitor();
  }
}

type RequestErrorContext = { routePath: string; routeType: string };

/**
 * Errors Next.js caught in a server component, route handler, server action or
 * the proxy: recorded on the request's span (or a span of their own) so they
 * appear in Application Insights. The error type and the digest only, never the
 * message, which can quote request data (as transcribe-api does, DIAAT-205).
 * The digest is what the error page shows the user.
 */
export async function onRequestError(
  err: unknown,
  request: { method: string },
  context: RequestErrorContext
) {
  if (
    process.env.NEXT_RUNTIME !== "nodejs" ||
    !process.env.APPLICATIONINSIGHTS_CONNECTION_STRING
  ) {
    return;
  }
  const { SpanStatusCode, trace } = await import("@opentelemetry/api");
  const type = err instanceof Error && err.name ? err.name : "Error";
  const digest = (err as { digest?: unknown } | null)?.digest;
  const record = (span: import("@opentelemetry/api").Span) => {
    span.recordException({ name: type, message: type });
    span.setStatus({ code: SpanStatusCode.ERROR });
    span.setAttributes({
      "exception.type": type,
      "http.request.method": request.method,
      "next.route_path": context.routePath,
      "next.route_type": context.routeType,
      ...(typeof digest === "string" ? { "next.error.digest": digest } : {}),
    });
  };
  const active = trace.getActiveSpan();
  if (active) {
    record(active);
    return;
  }
  trace
    .getTracer("transcribe-web")
    .startActiveSpan("next.request_error", (span) => {
      record(span);
      span.end();
    });
}
