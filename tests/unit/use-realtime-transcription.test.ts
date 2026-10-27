import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRealtimeTranscription } from "@/hooks/use-realtime-transcription";

// ---------------------------------------------------------------------------
// Speech SDK test double
// ---------------------------------------------------------------------------

interface FakeTranscriber {
  transcribing?: (s: unknown, e: unknown) => void;
  transcribed?: (s: unknown, e: unknown) => void;
  canceled?: (s: unknown, e: unknown) => void;
  sessionStarted?: (s: unknown, e: unknown) => void;
  sessionStopped?: (s: unknown, e: unknown) => void;
  startTranscribingAsync: (
    onOk: () => void,
    onErr: (e: unknown) => void
  ) => void;
  stopTranscribingAsync: (
    onOk: () => void,
    onErr: (e: unknown) => void
  ) => void;
  close: () => void;
}

const transcribers = vi.hoisted(() => ({ current: [] as FakeTranscriber[] }));

vi.mock("microsoft-cognitiveservices-speech-sdk", () => {
  const configStub = () => ({
    setProperty: vi.fn(),
    enableDictation: vi.fn(),
    requestWordLevelTimestamps: vi.fn(),
    setProfanity: vi.fn(),
  });

  class ConversationTranscriber implements FakeTranscriber {
    startTranscribingAsync = vi.fn((onOk: () => void) => onOk());
    stopTranscribingAsync = vi.fn((onOk: () => void) => onOk());
    close = vi.fn();
    constructor() {
      transcribers.current.push(this);
    }
  }

  return {
    SpeechConfig: { fromEndpoint: vi.fn(configStub) },
    AudioConfig: { fromStreamInput: vi.fn(() => ({})) },
    ConversationTranscriber,
    OutputFormat: { Detailed: 1 },
    ProfanityOption: { Raw: 0 },
    ResultReason: { RecognizingSpeech: 2, RecognizedSpeech: 3, NoMatch: 0 },
    CancellationReason: { Error: 1, EndOfStream: 0 },
    CancellationErrorCode: { ConnectionFailure: 7 },
  };
});

const mockGetSpeechToken = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", () => ({
  apiClient: { getSpeechToken: mockGetSpeechToken },
}));

const telemetry = vi.hoisted(() => ({
  sessionStarted: vi.fn(),
  sessionStopped: vi.fn(),
  sessionCanceled: vi.fn(),
  sessionUnhealthy: vi.fn(),
  noSpeechCaptured: vi.fn(),
}));
vi.mock("@/lib/speech-session-telemetry", () => ({
  speechSessionTelemetry: telemetry,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const latest = () => transcribers.current[transcribers.current.length - 1];

/** Simulate the SDK dropping the session the way a reconnect loop does. */
function collapseWithError(transcriber: FakeTranscriber) {
  transcriber.canceled?.(null, {
    reason: 1, // CancellationReason.Error
    errorCode: 7,
    errorDetails: "WebSocket closed unexpectedly",
  });
  // The SDK follows a cancellation with sessionStopped for the same session.
  transcriber.sessionStopped?.(null, {});
}

async function startRecording(connect: () => Promise<void>) {
  await act(async () => {
    await connect();
  });
  await act(async () => {
    latest().sessionStarted?.(null, {});
  });
}

/**
 * Collapse the live session and wait for the hook to bring a new one up.
 * The timeout allows for the reconnect backoff, which grows with each collapse.
 */
async function collapseAndAwaitReconnect() {
  const before = transcribers.current.length;
  await act(async () => {
    collapseWithError(latest());
  });
  await waitFor(
    () => expect(transcribers.current.length).toBeGreaterThan(before),
    { timeout: 5000 }
  );
  await act(async () => {
    latest().sessionStarted?.(null, {});
  });
}

beforeEach(() => {
  transcribers.current = [];
  mockGetSpeechToken.mockResolvedValue({
    data: { token: "t", endpoint: "https://speech.example/stt" },
    error: null,
  });
  (navigator as any).mediaDevices = {
    getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }),
  };
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------

describe("useRealtimeTranscription session health", () => {
  it("starts idle", () => {
    const { result } = renderHook(() => useRealtimeTranscription());
    expect(result.current.session.health).toBe("idle");
    expect(result.current.session.totalCollapses).toBe(0);
  });

  it("reports healthy once the SDK session starts, and records it", async () => {
    const { result } = renderHook(() => useRealtimeTranscription());
    await startRecording(result.current.connect);

    expect(result.current.session.health).toBe("healthy");
    expect(telemetry.sessionStarted).toHaveBeenCalledWith({
      sessionIndex: 1,
      reconnectAttempt: 0,
    });
  });

  it("reports a cancellation with its reason and error code", async () => {
    const { result } = renderHook(() => useRealtimeTranscription());
    await startRecording(result.current.connect);

    await act(async () => {
      collapseWithError(latest());
    });

    expect(telemetry.sessionCanceled).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionIndex: 1,
        cancellation: {
          reason: "Error",
          errorCode: "ConnectionFailure",
          errorDetails: "WebSocket closed unexpectedly",
        },
        collapsesInWindow: 1,
      })
    );
  });

  it("counts an unexpected sessionStopped with no cancellation as a collapse", async () => {
    // The pre-fix code ignored every cancellation reason other than Error and
    // let sessionStopped restart the session silently. That path produced no
    // user-visible signal at all, which is why 37 collapses went unnoticed.
    const { result } = renderHook(() => useRealtimeTranscription());
    await startRecording(result.current.connect);

    await act(async () => {
      latest().sessionStopped?.(null, {});
    });

    expect(result.current.session.totalCollapses).toBe(1);
    expect(result.current.session.health).toBe("recovering");
  });

  it("does not double-count a cancellation followed by sessionStopped", async () => {
    const { result } = renderHook(() => useRealtimeTranscription());
    await startRecording(result.current.connect);

    await act(async () => {
      collapseWithError(latest());
    });

    expect(result.current.session.totalCollapses).toBe(1);
  });

  it("reconnects after a collapse instead of leaving the session dead", async () => {
    const { result } = renderHook(() => useRealtimeTranscription());
    await startRecording(result.current.connect);
    expect(transcribers.current).toHaveLength(1);

    await act(async () => {
      collapseWithError(latest());
    });

    await waitFor(() => expect(transcribers.current.length).toBe(2));
  });

  it("becomes failed once collapses reach the threshold, and reports it once", async () => {
    const { result } = renderHook(() => useRealtimeTranscription());
    await startRecording(result.current.connect);

    for (let i = 0; i < 3; i += 1) {
      await collapseAndAwaitReconnect();
    }

    expect(result.current.session.health).toBe("failed");
    expect(result.current.session.totalCollapses).toBe(3);
    expect(telemetry.sessionUnhealthy).toHaveBeenCalledTimes(1);
    expect(telemetry.sessionUnhealthy).toHaveBeenCalledWith(
      expect.objectContaining({ collapsesInWindow: 3 })
    );
  });

  it("stays failed even while the SDK claims a session is up", async () => {
    const { result } = renderHook(() => useRealtimeTranscription());
    await startRecording(result.current.connect);

    for (let i = 0; i < 3; i += 1) {
      await collapseAndAwaitReconnect();
    }

    // The SDK has just reported sessionStarted for the newest session, so the
    // raw connection status is "connected" â€” but the session as a whole is not
    // trustworthy, and health must say so.
    expect(result.current.status).toBe("connected");
    expect(result.current.session.health).toBe("failed");
  });

  it("stops reconnecting and goes idle when the user pauses", async () => {
    const { result } = renderHook(() => useRealtimeTranscription());
    await startRecording(result.current.connect);

    await act(async () => {
      result.current.disconnect();
    });

    expect(result.current.session.health).toBe("idle");

    const countAfterDisconnect = transcribers.current.length;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(transcribers.current).toHaveLength(countAfterDisconnect);
  });

  it("does not treat a user-initiated stop as a collapse", async () => {
    const { result } = renderHook(() => useRealtimeTranscription());
    await startRecording(result.current.connect);

    await act(async () => {
      result.current.disconnect();
      latest().sessionStopped?.(null, {});
    });

    expect(result.current.session.totalCollapses).toBe(0);
    expect(telemetry.sessionUnhealthy).not.toHaveBeenCalled();
  });

  it("issues segment ids that stay unique across a reconnect", async () => {
    // Regression guard: dictation.tsx de-duplicates finalised segments by id.
    // Resetting the counter on reconnect made the new session reuse ids the
    // consumer had already seen, so captured speech was silently discarded.
    const { result } = renderHook(() => useRealtimeTranscription());
    await startRecording(result.current.connect);

    await act(async () => {
      latest().transcribed?.(null, {
        result: { reason: 3, speakerId: "Guest-1", text: "first utterance" },
      });
    });
    const firstId = result.current.segments[0]?.id;
    expect(firstId).toBeTruthy();

    await act(async () => {
      collapseWithError(latest());
    });
    await waitFor(() => expect(transcribers.current.length).toBe(2));
    await act(async () => {
      latest().sessionStarted?.(null, {});
      latest().transcribed?.(null, {
        result: { reason: 3, speakerId: "Guest-1", text: "second utterance" },
      });
    });

    const ids = result.current.segments.map((segment) => segment.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(firstId);
  });

  it("keeps captured segments through a reconnect", async () => {
    const { result } = renderHook(() => useRealtimeTranscription());
    await startRecording(result.current.connect);

    await act(async () => {
      latest().transcribed?.(null, {
        result: { reason: 3, speakerId: "Guest-1", text: "do not lose me" },
      });
    });

    await act(async () => {
      collapseWithError(latest());
    });
    await waitFor(() => expect(transcribers.current.length).toBe(2));

    expect(
      result.current.segments.some((s) => s.text === "do not lose me")
    ).toBe(true);
  });

  it("surfaces a failure to obtain a token as a failed session", async () => {
    mockGetSpeechToken.mockResolvedValue({ data: null, error: "boom" });
    const { result } = renderHook(() => useRealtimeTranscription());

    await act(async () => {
      await result.current.connect();
    });

    expect(result.current.error).toContain("boom");
    expect(result.current.session.health).not.toBe("healthy");
  });

  describe("pausing mid-utterance (PR #14 review)", () => {
    /** Holds the stop open, as the SDK does while it flushes the last result. */
    function holdStop(transcriber: FakeTranscriber) {
      let complete: () => void = () => undefined;
      transcriber.stopTranscribingAsync = vi.fn((onOk: () => void) => {
        complete = onOk;
      });
      return () => complete();
    }

    const finalResult = (text: string) => ({
      result: { reason: 3, speakerId: "Guest-1", text },
    });

    it("keeps the final result delivered while the recognizer stops", async () => {
      const { result } = renderHook(() => useRealtimeTranscription());
      await startRecording(result.current.connect);
      const stopping = latest();
      const completeStop = holdStop(stopping);

      await act(async () => {
        result.current.disconnect();
      });
      await act(async () => {
        stopping.transcribed?.(null, finalResult("the last sentence"));
      });

      expect(result.current.segments).toEqual([
        expect.objectContaining({ text: "the last sentence", isFinal: true }),
      ]);

      // Once the stop completes, the recognizer is stale.
      await act(async () => {
        completeStop();
        stopping.transcribed?.(null, finalResult("too late"));
      });
      expect(result.current.segments.map((s) => s.text)).toEqual([
        "the last sentence",
      ]);
    });

    it("keeps a final result the SDK delivers inside the stop call", async () => {
      const { result } = renderHook(() => useRealtimeTranscription());
      await startRecording(result.current.connect);
      const stopping = latest();
      stopping.stopTranscribingAsync = vi.fn((onOk: () => void) => {
        stopping.transcribed?.(null, finalResult("flushed during stop"));
        onOk();
      });

      await act(async () => {
        result.current.disconnect();
      });

      expect(result.current.segments.map((s) => s.text)).toEqual([
        "flushed during stop",
      ]);
    });

    it("still ignores other events from a stopping recognizer", async () => {
      const { result } = renderHook(() => useRealtimeTranscription());
      await startRecording(result.current.connect);
      const stopping = latest();
      holdStop(stopping);

      await act(async () => {
        result.current.disconnect();
      });
      await act(async () => {
        stopping.transcribing?.(null, {
          result: { reason: 2, speakerId: "Guest-1", text: "interim" },
        });
        collapseWithError(stopping);
      });

      expect(result.current.segments).toEqual([]);
      expect(result.current.session.health).toBe("idle");
      expect(result.current.session.totalCollapses).toBe(0);
      expect(telemetry.sessionCanceled).not.toHaveBeenCalled();
    });
  });
});
