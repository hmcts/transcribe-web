import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Sentry monitoring config
    await import("./sentry.server.config");

    // Azure Monitor OpenTelemetry config — only active when connection string is set
    if (process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) {
      const { useAzureMonitor } = await import("@azure/monitor-opentelemetry");
      // biome-ignore lint/correctness/useHookAtTopLevel: not a React hook, it's an Azure Monitor setup function
      useAzureMonitor();
    }
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
