import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LiveDictation from "@/components/audio/dictation/dictation";

/**
 * DIAAT-297 acceptance criterion, end to end through the real hook:
 * "with the speech WebSocket path blocked or failing, the record page shows a
 * persistent error state and does not present as recording normally."
 *
 * The Speech SDK is doubled so that every session it opens is cancelled the way
 * a blocked WebSocket cancels it. Everything above the SDK â€” collapse counting,
 * backoff, health derivation, copy, banner â€” is the real implementation.
 */

interface FakeTranscriber {
  canceled?: (s: unknown, e: unknown) => void;
  sessionStarted?: (s: unknown, e: unknown) => void;
  sessionStopped?: (s: unknown, e: unknown) => void;
  transcribing?: (s: unknown, e: unknown) => void;
  transcribed?: (s: unknown, e: unknown) => void;
}

const transcribers = vi.hoisted(() => ({ current: [] as FakeTranscriber[] }));

vi.mock("microsoft-cognitiveservices-speech-sdk", () => {
  class ConversationTranscriber implements FakeTranscriber {
    canceled?: (s: unknown, e: unknown) => void;

    constructor() {
      transcribers.current.push(this);
    }

    startTranscribingAsync = vi.fn((onOk: () => void) => {
      onOk();
      // The upgrade succeeds and the socket then closes â€” the shape of the
      // failure seen in production, where every token request returned 200.
      setTimeout(() => {
        this.canceled?.(null, {
          reason: 1,
          errorCode: 7,
          errorDetails: "Connection was closed by the remote host",
        });
      }, 0);
    });

    stopTranscribingAsync = vi.fn((onOk: () => void) => onOk());
    close = vi.fn();
  }

  return {
    SpeechConfig: {
      fromEndpoint: vi.fn(() => ({
        setProperty: vi.fn(),
        enableDictation: vi.fn(),
        requestWordLevelTimestamps: vi.fn(),
        setProfanity: vi.fn(),
      })),
    },
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

const mockToast = vi.hoisted(() => ({ error: vi.fn(), dismiss: vi.fn() }));
vi.mock("sonner", () => ({ toast: mockToast }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

vi.mock("@/providers/user-settings", () => ({
  useUserSettings: () => ({ user: null, loading: false }),
}));

vi.mock("@/hooks/use-media-query", () => ({
  useMediaQuery: () => false,
  default: () => false,
}));

vi.mock("@/components/audio/dictation/transcript-editor", () => ({
  default: ({ isListening }: { isListening: boolean }) => (
    <div data-testid="transcript-editor" data-listening={String(isListening)} />
  ),
}));

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
});

describe("Live dictation with a failing speech WebSocket path", () => {
  it("shows a persistent, non-dismissible error banner", async () => {
    render(<LiveDictation recordingActive hideForm />);

    const banner = await waitFor(
      () => screen.getByTestId("record-alert-banner"),
      { timeout: 8000 }
    );

    await waitFor(
      () => expect(banner.getAttribute("data-kind")).toBe("speech-failed"),
      { timeout: 8000 }
    );
    expect(banner.getAttribute("role")).toBe("alert");
    expect(screen.queryByRole("button", { name: /dismiss/i })).toBeNull();
    expect(
      screen.getByText(/Your dictation is not being recorded/i)
    ).toBeTruthy();
    expect(
      screen.getByText(/Nothing from this session has been captured/i)
    ).toBeTruthy();
  });

  it("does not present as recording", async () => {
    render(<LiveDictation recordingActive hideForm />);

    await waitFor(() => screen.getByTestId("record-alert-banner"), {
      timeout: 8000,
    });

    // The microphone indicator must show the not-recording state...
    const microphone = screen.getByRole("img", {
      name: /microphone not recording/i,
    });
    expect(microphone.getAttribute("data-active")).toBe("false");
    // ...and the transcript editor's "listening" affordance must be off.
    expect(
      screen.getByTestId("transcript-editor").getAttribute("data-listening")
    ).toBe("false");
  });

  it("still lets the user pause the broken session", async () => {
    render(<LiveDictation recordingActive hideForm />);

    await waitFor(() => screen.getByTestId("record-alert-banner"), {
      timeout: 8000,
    });

    // Pause is the action the guidance tells them to take, so it must not be
    // disabled or relabelled just because the session is unhealthy.
    const pause = screen.getByRole("button", { name: /pause recording/i });
    expect(pause.hasAttribute("disabled")).toBe(false);
  });

  it("never falls back to a transient toast for the session error", async () => {
    render(<LiveDictation recordingActive hideForm />);

    await waitFor(() => screen.getByTestId("record-alert-banner"), {
      timeout: 8000,
    });

    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it("reports the cancellation reason and error code to telemetry", async () => {
    render(<LiveDictation recordingActive hideForm />);

    await waitFor(() => expect(telemetry.sessionCanceled).toHaveBeenCalled(), {
      timeout: 8000,
    });

    expect(telemetry.sessionCanceled).toHaveBeenCalledWith(
      expect.objectContaining({
        cancellation: expect.objectContaining({
          reason: "Error",
          errorCode: "ConnectionFailure",
          errorDetails: "Connection was closed by the remote host",
        }),
      })
    );
  });

  it("escalates the reconnect loop once, rather than per collapse", async () => {
    render(<LiveDictation recordingActive hideForm />);

    await waitFor(
      () => expect(telemetry.sessionUnhealthy).toHaveBeenCalledTimes(1),
      { timeout: 8000 }
    );
  });

  it("backs off instead of restarting the session without limit", async () => {
    // The pre-fix restart loop was driven by a render effect with no delay,
    // which is what produced 37 token fetches in 44 minutes.
    render(<LiveDictation recordingActive hideForm />);

    await waitFor(() => screen.getByTestId("record-alert-banner"), {
      timeout: 8000,
    });

    const sessionsSoFar = transcribers.current.length;
    expect(sessionsSoFar).toBeLessThan(10);
  });
});
