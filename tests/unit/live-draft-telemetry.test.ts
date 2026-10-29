import { beforeEach, describe, expect, it, vi } from "vitest";
import { liveDraftTelemetry } from "@/lib/live-draft-telemetry";

const session = vi.hoisted(() => ({
  autosaveFailed: vi.fn(),
  autosaveStalled: vi.fn(),
  autosaveRecovered: vi.fn(),
  restoreFinished: vi.fn(),
}));

// OBS-3: the event stream is the relay (through the dictation session), not PostHog.
vi.mock("@/lib/dictation-session", () => ({
  dictationSessionTelemetry: session,
}));

beforeEach(() => {
  for (const fn of Object.values(session)) fn.mockReset();
});

describe("liveDraftTelemetry.saveFailed", () => {
  it("reports the failure kind and status to the event stream", () => {
    liveDraftTelemetry.saveFailed({
      kind: "network",
      status: undefined,
      consecutiveFailures: 1,
      msSinceLastSave: 3000,
      trigger: "interval",
    });

    expect(session.autosaveFailed).toHaveBeenCalledWith({
      kind: "network",
      status: undefined,
      consecutiveFailures: 1,
      secondsSinceLastSave: 3,
      trigger: "interval",
    });
  });

  it("does not page anyone for a single blip", () => {
    liveDraftTelemetry.saveFailed({
      kind: "network",
      consecutiveFailures: 1,
      msSinceLastSave: null,
      trigger: "interval",
    });
    // The failure is reported; the stall (the alert's source) is the
    // autosave hook's decision, after repeated failures.
    expect(session.autosaveFailed).toHaveBeenCalledTimes(1);
    expect(session.autosaveStalled).not.toHaveBeenCalled();
  });

  it("reports a null elapsed time when nothing has ever been saved", () => {
    liveDraftTelemetry.saveFailed({
      kind: "server",
      status: 500,
      consecutiveFailures: 1,
      msSinceLastSave: null,
      trigger: "pause",
    });
    expect(session.autosaveFailed).toHaveBeenCalledWith(
      expect.objectContaining({ secondsSinceLastSave: null, status: 500 })
    );
  });
});

describe("liveDraftTelemetry.autosaveStalled", () => {
  it("reports the stall, the source of the data-loss alert", () => {
    liveDraftTelemetry.autosaveStalled({
      kind: "network",
      consecutiveFailures: 4,
      msSinceLastSave: 42_000,
    });

    expect(session.autosaveStalled).toHaveBeenCalledWith({
      kind: "network",
      consecutiveFailures: 4,
      secondsSinceLastSave: 42,
    });
  });
});

describe("liveDraftTelemetry.saveRecovered", () => {
  it("records how long the outage lasted so the gap can be measured", () => {
    liveDraftTelemetry.saveRecovered({
      consecutiveFailures: 3,
      outageMs: 12_000,
    });

    expect(session.autosaveRecovered).toHaveBeenCalledWith({
      consecutiveFailures: 3,
      outageSeconds: 12,
    });
    expect(session.autosaveStalled).not.toHaveBeenCalled();
  });
});

describe("liveDraftTelemetry.restoreFailed", () => {
  it("reports a failed restore lookup, which used to be invisible", () => {
    liveDraftTelemetry.restoreFailed({ kind: "auth", status: 401 });

    expect(session.restoreFinished).toHaveBeenCalledWith({
      ok: false,
      kind: "auth",
      status: 401,
    });
  });
});
