import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNoSpeechWatchdog } from "@/hooks/use-no-speech-watchdog";

const telemetry = vi.hoisted(() => ({
  recordingRequested: vi.fn(),
  tokenFetched: vi.fn(),
  firstText: vi.fn(),
  segmentCaptured: vi.fn(),
  paused: vi.fn(),
  sessionStarted: vi.fn(),
  sessionStopped: vi.fn(),
  sessionCanceled: vi.fn(),
  sessionUnhealthy: vi.fn(),
  noSpeechCaptured: vi.fn(),
}));
vi.mock("@/lib/speech-session-telemetry", () => ({
  speechSessionTelemetry: telemetry,
}));

const THRESHOLD_MS = 90_000;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

/** Advance timers inside act so state updates are flushed. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("useNoSpeechWatchdog", () => {
  it("does not warn before the threshold elapses", async () => {
    const { result } = renderHook(() =>
      useNoSpeechWatchdog({
        active: true,
        hasCapturedSpeech: false,
        thresholdMs: THRESHOLD_MS,
      })
    );

    await advance(THRESHOLD_MS - 1_000);

    expect(result.current.shouldWarn).toBe(false);
    expect(telemetry.noSpeechCaptured).not.toHaveBeenCalled();
  });

  it("warns once the threshold elapses with nothing captured", async () => {
    const { result } = renderHook(() =>
      useNoSpeechWatchdog({
        active: true,
        hasCapturedSpeech: false,
        thresholdMs: THRESHOLD_MS,
      })
    );

    await advance(THRESHOLD_MS);

    expect(result.current.shouldWarn).toBe(true);
    expect(result.current.elapsedMs).toBeGreaterThanOrEqual(THRESHOLD_MS);
  });

  it("reports the warning exactly once per episode", async () => {
    renderHook(() =>
      useNoSpeechWatchdog({
        active: true,
        hasCapturedSpeech: false,
        thresholdMs: THRESHOLD_MS,
      })
    );

    await advance(THRESHOLD_MS * 3);

    expect(telemetry.noSpeechCaptured).toHaveBeenCalledTimes(1);
    expect(telemetry.noSpeechCaptured).toHaveBeenCalledWith({
      elapsedSeconds: THRESHOLD_MS / 1000,
    });
  });

  it("never warns while recording is inactive", async () => {
    const { result } = renderHook(() =>
      useNoSpeechWatchdog({
        active: false,
        hasCapturedSpeech: false,
        thresholdMs: THRESHOLD_MS,
      })
    );

    await advance(THRESHOLD_MS * 2);

    expect(result.current.shouldWarn).toBe(false);
    expect(telemetry.noSpeechCaptured).not.toHaveBeenCalled();
  });

  it("clears the warning as soon as speech is captured", async () => {
    const { result, rerender } = renderHook(
      (props: { active: boolean; hasCapturedSpeech: boolean }) =>
        useNoSpeechWatchdog({ ...props, thresholdMs: THRESHOLD_MS }),
      { initialProps: { active: true, hasCapturedSpeech: false } }
    );

    await advance(THRESHOLD_MS);
    expect(result.current.shouldWarn).toBe(true);

    rerender({ active: true, hasCapturedSpeech: true });

    expect(result.current.shouldWarn).toBe(false);
  });

  it("restarts the countdown when recording is paused and resumed", async () => {
    const { result, rerender } = renderHook(
      (props: { active: boolean; hasCapturedSpeech: boolean }) =>
        useNoSpeechWatchdog({ ...props, thresholdMs: THRESHOLD_MS }),
      { initialProps: { active: true, hasCapturedSpeech: false } }
    );

    await advance(THRESHOLD_MS - 5_000);
    rerender({ active: false, hasCapturedSpeech: false });
    await advance(10_000);
    rerender({ active: true, hasCapturedSpeech: false });
    await advance(5_000);

    expect(result.current.shouldWarn).toBe(false);

    await advance(THRESHOLD_MS);
    expect(result.current.shouldWarn).toBe(true);
  });
});
