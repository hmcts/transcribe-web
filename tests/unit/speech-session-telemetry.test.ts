import { describe, expect, it, vi } from "vitest";

const speechUnhealthy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/dictation-session", () => ({
  dictationSessionTelemetry: new Proxy(
    {},
    {
      get: (_target, name) =>
        name === "speechUnhealthy" ? speechUnhealthy : vi.fn(),
    }
  ),
}));

import { speechSessionTelemetry } from "@/lib/speech-session-telemetry";

describe("speech session unhealthy event (the alert's source)", () => {
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
    const sent = JSON.stringify(speechUnhealthy.mock.calls);
    expect(sent).not.toContain("appellant");
    expect(sent).toContain("StartFailed");
    expect(sent).toContain("ConnectionFailure");
  });
});
