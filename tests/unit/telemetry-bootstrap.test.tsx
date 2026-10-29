/**
 * Code review: relay delivery (page-hide flush, restore of unsent events) runs on
 * every page, not only /record.
 */
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const installRelayLifecycle = vi.hoisted(() => vi.fn());
vi.mock("@/lib/telemetry-relay", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/telemetry-relay")>()),
  installRelayLifecycle,
}));

import { startBrowserTelemetry } from "@/lib/dictation-session";
import type { TelemetryRelay } from "@/lib/telemetry-relay";
import TelemetryBootstrap from "@/providers/telemetry-bootstrap";

describe("browser telemetry bootstrap", () => {
  it("is mounted by the root layout", async () => {
    const { readFileSync } = await import("node:fs");
    const layout = readFileSync(`${__dirname}/../../app/layout.tsx`, "utf8");
    expect(layout).toContain("<TelemetryBootstrap />");
  });

  it("installs the relay's page-hide flush and restore of unsent events", () => {
    const relay = {} as TelemetryRelay;
    startBrowserTelemetry(relay);
    expect(installRelayLifecycle).toHaveBeenLastCalledWith(relay);
  });

  it("starts from the component, on any page", () => {
    installRelayLifecycle.mockClear();
    render(<TelemetryBootstrap />);
    expect(installRelayLifecycle).toHaveBeenCalledTimes(1);
  });
});

describe("ends of dictations whose page was killed while hidden", () => {
  it("are sent from any page, not only /record", async () => {
    const { PENDING_END_STORAGE_KEY } = await import("@/lib/dictation-session");
    const end = {
      name: "dictation.session_ended",
      journey: { type: "dictation.session", id: "j1" },
    };
    const stop = { name: "speech.session_stopped", journey: end.journey };
    window.localStorage.setItem(
      `${PENDING_END_STORAGE_KEY}:gone-page`,
      JSON.stringify({ storedAt: 1, event: end, speechStop: stop })
    );
    const emit = vi.fn();
    startBrowserTelemetry({ emit } as unknown as TelemetryRelay);
    expect(emit.mock.calls.map(([event]) => event.name)).toEqual([
      "speech.session_stopped",
      "dictation.session_ended",
    ]);
    expect(
      window.localStorage.getItem(`${PENDING_END_STORAGE_KEY}:gone-page`)
    ).toBeNull();
  });
});
