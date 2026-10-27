import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLiveDraftAutosave } from "@/hooks/use-live-draft-autosave";
import { LiveDraftError } from "@/lib/live-draft-errors";

const mockPutLiveDraft = vi.hoisted(() => vi.fn());
const mockTelemetry = vi.hoisted(() => ({
  saveFailed: vi.fn(),
  autosaveStalled: vi.fn(),
  saveRecovered: vi.fn(),
  restoreFailed: vi.fn(),
}));

vi.mock("@/lib/live-draft-api", () => ({ putLiveDraft: mockPutLiveDraft }));
vi.mock("@/lib/live-draft-telemetry", () => ({
  liveDraftTelemetry: mockTelemetry,
}));

const TRANSCRIPT = {
  background: [{ speaker: "Judge", text: "hello", timestamp: "00:00" }],
  evidence: [],
  facts: [],
};

function payloadGetter(
  payload: unknown = { transcript: TRANSCRIPT, formData: {} }
) {
  return vi.fn().mockReturnValue(payload);
}

beforeEach(() => {
  vi.useFakeTimers();
  mockPutLiveDraft.mockReset().mockResolvedValue(undefined);
  Object.values(mockTelemetry).forEach((fn) => fn.mockReset());
});

afterEach(() => {
  vi.useRealTimers();
});

/** Flush the promise microtask queue while fake timers are installed. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useLiveDraftAutosave", () => {
  it("writes the payload when asked to save", async () => {
    const getPayload = payloadGetter();
    const { result } = renderHook(() => useLiveDraftAutosave({ getPayload }));

    act(() => result.current.saveNow("interval"));
    await flush();

    expect(mockPutLiveDraft).toHaveBeenCalledWith(TRANSCRIPT, {});
    expect(result.current.state.lastSavedAt).not.toBeNull();
  });

  it("does not write when there is nothing to save", async () => {
    // The content gating is deliberate existing behaviour and must survive.
    const getPayload = payloadGetter(null);
    const { result } = renderHook(() => useLiveDraftAutosave({ getPayload }));

    act(() => result.current.saveNow("interval"));
    await flush();

    expect(mockPutLiveDraft).not.toHaveBeenCalled();
  });

  it("counts a failure and reports it", async () => {
    mockPutLiveDraft.mockRejectedValue(new LiveDraftError("network", "boom"));
    const { result } = renderHook(() =>
      useLiveDraftAutosave({ getPayload: payloadGetter() })
    );

    act(() => result.current.saveNow("interval"));
    await flush();

    expect(result.current.state.consecutiveFailures).toBe(1);
    expect(result.current.state.failureKind).toBe("network");
    expect(mockTelemetry.saveFailed).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "network", trigger: "interval" })
    );
  });

  it("retries on its own backoff rather than waiting for the next interval", async () => {
    mockPutLiveDraft.mockRejectedValue(new LiveDraftError("network", "boom"));
    const { result } = renderHook(() =>
      useLiveDraftAutosave({ getPayload: payloadGetter() })
    );

    act(() => result.current.saveNow("interval"));
    await flush();
    expect(mockPutLiveDraft).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    await flush();

    expect(mockPutLiveDraft).toHaveBeenCalledTimes(2);
    expect(mockTelemetry.saveFailed).toHaveBeenLastCalledWith(
      expect.objectContaining({ trigger: "retry" })
    );
  });

  it("backs off further after each failed retry", async () => {
    mockPutLiveDraft.mockRejectedValue(new LiveDraftError("network", "boom"));
    const { result } = renderHook(() =>
      useLiveDraftAutosave({ getPayload: payloadGetter() })
    );

    act(() => result.current.saveNow("interval"));
    await flush();
    await act(async () => vi.advanceTimersByTime(1_000));
    await flush();
    expect(mockPutLiveDraft).toHaveBeenCalledTimes(2);

    // Second retry is two seconds out, not one.
    await act(async () => vi.advanceTimersByTime(1_000));
    await flush();
    expect(mockPutLiveDraft).toHaveBeenCalledTimes(2);

    await act(async () => vi.advanceTimersByTime(1_000));
    await flush();
    expect(mockPutLiveDraft).toHaveBeenCalledTimes(3);
  });

  it("clears the warning and reports recovery when a retry succeeds", async () => {
    mockPutLiveDraft
      .mockRejectedValueOnce(new LiveDraftError("network", "boom"))
      .mockRejectedValueOnce(new LiveDraftError("network", "boom"))
      .mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useLiveDraftAutosave({ getPayload: payloadGetter() })
    );

    act(() => result.current.saveNow("interval"));
    await flush();
    await act(async () => vi.advanceTimersByTime(1_000));
    await flush();
    expect(result.current.state.consecutiveFailures).toBe(2);

    await act(async () => vi.advanceTimersByTime(2_000));
    await flush();

    expect(result.current.state.consecutiveFailures).toBe(0);
    expect(result.current.state.failureKind).toBeNull();
    expect(result.current.state.lastSavedAt).not.toBeNull();
    expect(mockTelemetry.saveRecovered).toHaveBeenCalledWith(
      expect.objectContaining({ consecutiveFailures: 2 })
    );
  });

  it("escalates to Sentry once, not on every retry", async () => {
    mockPutLiveDraft.mockRejectedValue(new LiveDraftError("network", "boom"));
    const { result } = renderHook(() =>
      useLiveDraftAutosave({ getPayload: payloadGetter() })
    );

    act(() => result.current.saveNow("interval"));
    await flush();
    // One failure is below the alert threshold â€” nothing escalated yet.
    expect(mockTelemetry.autosaveStalled).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTime(1_000));
    await flush();
    expect(mockTelemetry.autosaveStalled).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTime(2_000));
    await flush();
    await act(async () => vi.advanceTimersByTime(4_000));
    await flush();
    expect(mockTelemetry.autosaveStalled).toHaveBeenCalledTimes(1);
  });

  it("escalates again after recovering and failing a second time", async () => {
    mockPutLiveDraft.mockRejectedValue(new LiveDraftError("network", "boom"));
    const { result } = renderHook(() =>
      useLiveDraftAutosave({ getPayload: payloadGetter() })
    );

    act(() => result.current.saveNow("interval"));
    await flush();
    await act(async () => vi.advanceTimersByTime(1_000));
    await flush();
    expect(mockTelemetry.autosaveStalled).toHaveBeenCalledTimes(1);

    mockPutLiveDraft.mockResolvedValue(undefined);
    await act(async () => vi.advanceTimersByTime(2_000));
    await flush();
    expect(result.current.state.consecutiveFailures).toBe(0);

    mockPutLiveDraft.mockRejectedValue(new LiveDraftError("network", "boom"));
    act(() => result.current.saveNow("interval"));
    await flush();
    await act(async () => vi.advanceTimersByTime(1_000));
    await flush();
    expect(mockTelemetry.autosaveStalled).toHaveBeenCalledTimes(2);
  });

  it("stops retrying once unmounted", async () => {
    mockPutLiveDraft.mockRejectedValue(new LiveDraftError("network", "boom"));
    const { result, unmount } = renderHook(() =>
      useLiveDraftAutosave({ getPayload: payloadGetter() })
    );

    act(() => result.current.saveNow("interval"));
    await flush();
    expect(mockPutLiveDraft).toHaveBeenCalledTimes(1);

    unmount();
    // The cleanup fires a best-effort PUT (consecutiveFailures > 0) then
    // cancels the retry timer. Advancing 30 s must not add further calls.
    await act(async () => vi.advanceTimersByTime(30_000));

    expect(mockPutLiveDraft).toHaveBeenCalledTimes(2);
  });

  it("does not run two writes at once when a save lands during a retry wait", async () => {
    mockPutLiveDraft.mockRejectedValue(new LiveDraftError("network", "boom"));
    const { result } = renderHook(() =>
      useLiveDraftAutosave({ getPayload: payloadGetter() })
    );

    act(() => result.current.saveNow("interval"));
    await flush();

    // An interval save arriving while a retry is pending replaces the retry
    // rather than racing it â€” two concurrent PUTs could land out of order and
    // persist the older transcript.
    act(() => result.current.saveNow("interval"));
    await flush();
    expect(mockPutLiveDraft).toHaveBeenCalledTimes(2);

    await act(async () => vi.advanceTimersByTime(1_000));
    await flush();
    expect(mockPutLiveDraft).toHaveBeenCalledTimes(2);
  });

  describe("unmount and cancellation (PR #14 review)", () => {
    /** A PUT that stays in flight until the test settles it. */
    function holdPut() {
      let settle: { resolve: () => void; reject: (e: unknown) => void } = {
        resolve: () => undefined,
        reject: () => undefined,
      };
      mockPutLiveDraft.mockImplementationOnce(
        () =>
          new Promise<void>((resolve, reject) => {
            settle = { resolve, reject };
          })
      );
      return () => settle;
    }

    it("writes a save queued behind an in-flight PUT after unmount, once", async () => {
      const settle = holdPut();
      const getPayload = payloadGetter();
      const { result, unmount } = renderHook(() =>
        useLiveDraftAutosave({ getPayload })
      );

      act(() => result.current.saveNow("interval"));
      act(() => result.current.saveNow("pause")); // queued behind the PUT
      unmount();
      expect(mockPutLiveDraft).toHaveBeenCalledTimes(1);

      settle().resolve();
      await flush();
      expect(mockPutLiveDraft).toHaveBeenCalledTimes(2);

      await act(async () => vi.advanceTimersByTime(30_000));
      expect(mockPutLiveDraft).toHaveBeenCalledTimes(2);
    });

    it("writes once more after unmount when the in-flight PUT fails, without retrying", async () => {
      const settle = holdPut();
      const { result, unmount } = renderHook(() =>
        useLiveDraftAutosave({ getPayload: payloadGetter() })
      );

      act(() => result.current.saveNow("pause"));
      unmount();
      mockPutLiveDraft.mockRejectedValue(new LiveDraftError("network", "boom"));
      settle().reject(new LiveDraftError("network", "boom"));
      await flush();
      expect(mockPutLiveDraft).toHaveBeenCalledTimes(2);

      await act(async () => vi.advanceTimersByTime(30_000));
      expect(mockPutLiveDraft).toHaveBeenCalledTimes(2);
    });

    it("does not write after unmount when the in-flight PUT saved everything", async () => {
      const settle = holdPut();
      const { result, unmount } = renderHook(() =>
        useLiveDraftAutosave({ getPayload: payloadGetter() })
      );

      act(() => result.current.saveNow("pause"));
      unmount();
      settle().resolve();
      await flush();
      expect(mockPutLiveDraft).toHaveBeenCalledTimes(1);
    });

    it("stop waits for the write in flight, then never writes again", async () => {
      const settle = holdPut();
      const { result, unmount } = renderHook(() =>
        useLiveDraftAutosave({ getPayload: payloadGetter() })
      );

      act(() => result.current.saveNow("interval"));
      act(() => result.current.saveNow("pause")); // queued
      let stopped = false;
      let stopping: Promise<void> = Promise.resolve();
      act(() => {
        stopping = result.current.stop().then(() => {
          stopped = true;
        });
      });
      await flush();
      expect(stopped).toBe(false); // still waiting for the PUT

      settle().reject(new LiveDraftError("network", "boom"));
      await act(async () => {
        await stopping;
      });
      expect(stopped).toBe(true);

      act(() => result.current.saveNow("interval"));
      unmount();
      await act(async () => vi.advanceTimersByTime(30_000));
      expect(mockPutLiveDraft).toHaveBeenCalledTimes(1);
    });

    it("cancelPending drops a scheduled retry but keeps saving afterwards", async () => {
      mockPutLiveDraft.mockRejectedValueOnce(
        new LiveDraftError("network", "boom")
      );
      const { result } = renderHook(() =>
        useLiveDraftAutosave({ getPayload: payloadGetter() })
      );

      act(() => result.current.saveNow("interval"));
      await flush();
      await act(async () => {
        await result.current.cancelPending();
      });
      await act(async () => vi.advanceTimersByTime(30_000));
      expect(mockPutLiveDraft).toHaveBeenCalledTimes(1);

      act(() => result.current.saveNow("interval"));
      await flush();
      expect(mockPutLiveDraft).toHaveBeenCalledTimes(2);
    });
  });
});
