import { beforeEach, describe, expect, it, vi } from "vitest";
import { liveDraftTelemetry } from "@/lib/live-draft-telemetry";

const mockTrack = vi.hoisted(() => vi.fn());
const mockCaptureMessage = vi.hoisted(() => vi.fn());

vi.mock("@/lib/analytics", () => ({ track: mockTrack }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: mockCaptureMessage }));

beforeEach(() => {
  mockTrack.mockReset();
  mockCaptureMessage.mockReset();
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

    expect(mockTrack).toHaveBeenCalledWith("live_draft_save_failed", {
      failure_kind: "network",
      status: null,
      consecutive_failures: 1,
      seconds_since_last_save: 3,
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
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  it("reports a null elapsed time when nothing has ever been saved", () => {
    liveDraftTelemetry.saveFailed({
      kind: "server",
      status: 500,
      consecutiveFailures: 1,
      msSinceLastSave: null,
      trigger: "pause",
    });
    expect(mockTrack).toHaveBeenCalledWith(
      "live_draft_save_failed",
      expect.objectContaining({ seconds_since_last_save: null, status: 500 })
    );
  });
});

describe("liveDraftTelemetry.autosaveStalled", () => {
  it("escalates to Sentry, because this is data loss in progress", () => {
    liveDraftTelemetry.autosaveStalled({
      kind: "network",
      consecutiveFailures: 4,
      msSinceLastSave: 42_000,
    });

    expect(mockTrack).toHaveBeenCalledWith("live_draft_autosave_stalled", {
      failure_kind: "network",
      consecutive_failures: 4,
      seconds_since_last_save: 42,
    });
    expect(mockCaptureMessage).toHaveBeenCalledWith(
      expect.stringContaining("4"),
      expect.objectContaining({
        level: "error",
        tags: expect.objectContaining({ feature: "live-dictation" }),
      })
    );
  });
});

describe("liveDraftTelemetry.saveRecovered", () => {
  it("records how long the outage lasted so the gap can be measured", () => {
    liveDraftTelemetry.saveRecovered({
      consecutiveFailures: 3,
      outageMs: 12_000,
    });

    expect(mockTrack).toHaveBeenCalledWith("live_draft_save_recovered", {
      failures_before_recovery: 3,
      outage_seconds: 12,
    });
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });
});

describe("liveDraftTelemetry.restoreFailed", () => {
  it("reports a failed restore lookup, which used to be invisible", () => {
    liveDraftTelemetry.restoreFailed({ kind: "auth", status: 401 });

    expect(mockTrack).toHaveBeenCalledWith("live_draft_restore_failed", {
      failure_kind: "auth",
      status: 401,
    });
  });
});
