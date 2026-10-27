import { describe, expect, it } from "vitest";
import {
  deriveSpeechHealth,
  isUnhealthyCollapseCount,
  pruneCollapseTimestamps,
  reconnectDelayMs,
} from "@/lib/speech-session-health";

describe("pruneCollapseTimestamps", () => {
  it("keeps only collapses inside the sliding window", () => {
    const now = 100_000;
    const windowMs = 60_000;
    const timestamps = [10_000, 39_999, 40_000, 90_000, now];

    expect(pruneCollapseTimestamps(timestamps, now, windowMs)).toEqual([
      40_000,
      90_000,
      now,
    ]);
  });

  it("returns an empty list when every collapse has aged out", () => {
    expect(pruneCollapseTimestamps([1_000, 2_000], 500_000, 60_000)).toEqual(
      []
    );
  });
});

describe("isUnhealthyCollapseCount", () => {
  it("treats a single blip as recoverable", () => {
    expect(isUnhealthyCollapseCount(1, 3)).toBe(false);
    expect(isUnhealthyCollapseCount(2, 3)).toBe(false);
  });

  it("treats the threshold and above as unambiguously broken", () => {
    expect(isUnhealthyCollapseCount(3, 3)).toBe(true);
    expect(isUnhealthyCollapseCount(37, 3)).toBe(true);
  });
});

describe("reconnectDelayMs", () => {
  it("retries the first collapse almost immediately", () => {
    expect(reconnectDelayMs(1)).toBeLessThanOrEqual(500);
  });

  it("backs off as collapses accumulate", () => {
    expect(reconnectDelayMs(2)).toBeGreaterThan(reconnectDelayMs(1));
    expect(reconnectDelayMs(3)).toBeGreaterThan(reconnectDelayMs(2));
    expect(reconnectDelayMs(4)).toBeGreaterThan(reconnectDelayMs(3));
  });

  it("caps the delay so a recovering session is never abandoned", () => {
    expect(reconnectDelayMs(50)).toBe(reconnectDelayMs(10));
    expect(reconnectDelayMs(50)).toBeLessThanOrEqual(10_000);
  });
});

describe("deriveSpeechHealth", () => {
  it("is idle when the user is not recording", () => {
    expect(
      deriveSpeechHealth({
        recordingIntended: false,
        sdkConnected: false,
        collapsesInWindow: 0,
        collapseThreshold: 3,
      })
    ).toBe("idle");
  });

  it("stays idle when the user has stopped even after earlier collapses", () => {
    expect(
      deriveSpeechHealth({
        recordingIntended: false,
        sdkConnected: false,
        collapsesInWindow: 9,
        collapseThreshold: 3,
      })
    ).toBe("idle");
  });

  it("is starting while the first connection is being established", () => {
    expect(
      deriveSpeechHealth({
        recordingIntended: true,
        sdkConnected: false,
        collapsesInWindow: 0,
        collapseThreshold: 3,
      })
    ).toBe("starting");
  });

  it("is healthy when the SDK session is up and stable", () => {
    expect(
      deriveSpeechHealth({
        recordingIntended: true,
        sdkConnected: true,
        collapsesInWindow: 0,
        collapseThreshold: 3,
      })
    ).toBe("healthy");
  });

  it("is recovering after an isolated collapse", () => {
    expect(
      deriveSpeechHealth({
        recordingIntended: true,
        sdkConnected: false,
        collapsesInWindow: 1,
        collapseThreshold: 3,
      })
    ).toBe("recovering");
  });

  it("is failed once collapses cross the threshold, even mid-reconnect", () => {
    expect(
      deriveSpeechHealth({
        recordingIntended: true,
        sdkConnected: false,
        collapsesInWindow: 3,
        collapseThreshold: 3,
      })
    ).toBe("failed");
  });

  it("stays failed while collapses keep recurring even if the SDK is momentarily up", () => {
    // A reconnect loop reports sessionStarted between every collapse. The
    // session must not be allowed to claim health on the strength of that.
    expect(
      deriveSpeechHealth({
        recordingIntended: true,
        sdkConnected: true,
        collapsesInWindow: 4,
        collapseThreshold: 3,
      })
    ).toBe("failed");
  });
});
