import { describe, expect, it, vi } from "vitest";

const captureMessage = vi.hoisted(() => vi.fn());
vi.mock("@sentry/nextjs", () => ({ captureMessage }));
vi.mock("@/lib/dictation-session", () => ({
  dictationSessionTelemetry: new Proxy({}, { get: () => vi.fn() }),
}));

import { speechSessionTelemetry } from "@/lib/speech-session-telemetry";

describe("speech session alert to Sentry", () => {
  it("carries the enumerated reason and code, never the free-text details", () => {
    const details = "token endpoint said: " + "the appellant";
    speechSessionTelemetry.sessionUnhealthy({
      collapsesInWindow: 3,
      windowSeconds: 120,
      cancellation: {
        reason: "StartFailed",
        errorCode: "ConnectionFailure",
        errorDetails: details,
      },
    });
    const sent = JSON.stringify(captureMessage.mock.calls);
    expect(sent).not.toContain("appellant");
    expect(sent).toContain("StartFailed");
    expect(sent).toContain("ConnectionFailure");
  });
});
