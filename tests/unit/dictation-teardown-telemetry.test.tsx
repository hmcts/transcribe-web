import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LiveDictation from "@/components/audio/dictation/dictation";
import {
  dictationSessionTelemetry,
  JOURNEY_DICTATION_SESSION,
  trackDictationPage,
} from "@/lib/dictation-session";
import { type RelayEvent, telemetryRelay } from "@/lib/telemetry-relay";

/**
 * A pause is recorded only when the user pauses. Submitting, leaving the page or
 * the Dictation unmounting while recording is not a pause, and a speech session
 * stopped after the dictation session ended belongs to no journey.
 *
 * Through the real component, hook and telemetry modules; only the Speech SDK and
 * the relay's network side are doubled. On unmount the hook's own cleanup runs
 * before the component's (effects are cleaned up in declaration order) and clears
 * the recording intent, so the component's disconnect() records nothing: these
 * tests pin that, and fail if a pause or a stray stop is ever recorded instead.
 */

interface FakeTranscriber {
  sessionStarted?: (s: unknown, e: unknown) => void;
}

const transcribers = vi.hoisted(() => ({ current: [] as FakeTranscriber[] }));

vi.mock("microsoft-cognitiveservices-speech-sdk", () => {
  class ConversationTranscriber implements FakeTranscriber {
    sessionStarted?: (s: unknown, e: unknown) => void;
    constructor() {
      transcribers.current.push(this);
    }
    startTranscribingAsync = vi.fn((onOk: () => void) => onOk());
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

const relayed = vi.hoisted(() => ({ events: [] as RelayEvent[] }));
vi.mock("@/lib/telemetry-relay", () => ({
  telemetryRelay: {
    emit: (event: RelayEvent) => relayed.events.push(event),
    flush: vi.fn(),
    flushOnHide: vi.fn(),
  },
  installRelayLifecycle: vi.fn(),
}));

vi.mock("@/lib/auth-utils", () => ({
  getAuthToken: vi.fn().mockResolvedValue(null),
  setAuthTokenListener: vi.fn(),
}));

const mockGetSpeechToken = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", () => ({
  apiClient: { getSpeechToken: mockGetSpeechToken },
}));

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), dismiss: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/providers/user-settings", () => ({
  useUserSettings: () => ({ user: null, loading: false }),
}));
vi.mock("@/hooks/use-media-query", () => ({
  useMediaQuery: () => false,
  default: () => false,
}));
vi.mock("@/components/audio/dictation/transcript-editor", () => ({
  default: () => <div data-testid="transcript-editor" />,
}));

const SDK_SESSION = "0123456789abcdef0123456789abcdef";
const names = () => relayed.events.map((event) => event.name);

/** Render the Dictation recording, with its Speech SDK session up. */
async function recording() {
  const view = render(<LiveDictation recordingActive hideForm />);
  await waitFor(() => expect(transcribers.current).toHaveLength(1));
  await act(async () => {
    transcribers.current[0].sessionStarted?.(null, { sessionId: SDK_SESSION });
  });
  expect(names()).toContain("speech.session_started");
  return view;
}

beforeEach(() => {
  transcribers.current = [];
  relayed.events = [];
  dictationSessionTelemetry.discardSession();
  mockGetSpeechToken.mockResolvedValue({
    data: { token: "t", endpoint: "https://speech.example/stt" },
    error: null,
  });
  (navigator as any).mediaDevices = {
    getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }),
  };
});

afterEach(() => {
  dictationSessionTelemetry.discardSession();
  vi.clearAllMocks();
});

describe("Dictation teardown telemetry", () => {
  it("records an explicit pause", async () => {
    const view = await recording();

    view.rerender(<LiveDictation recordingActive={false} hideForm />);

    await waitFor(() => expect(names()).toContain("dictation.paused"));
    const stopped = relayed.events.filter(
      (e) => e.name === "speech.session_stopped"
    );
    expect(stopped).toHaveLength(1);
    expect(stopped[0].attributes?.["dictation.user_initiated"]).toBe(true);
    expect(names().slice(-2)).toEqual([
      "dictation.paused",
      "speech.session_stopped",
    ]);
  });

  it("does not record a pause when unmounted while recording", async () => {
    const view = await recording();

    view.unmount();
    dictationSessionTelemetry.sessionEnded("left_page"); // the page's own end

    expect(names()).not.toContain("dictation.paused");
    expect(names().at(-1)).toBe("dictation.session_ended");
  });

  it("does not record a pause when submitted while recording, and sends nothing after the end", async () => {
    const view = await recording();

    // As the record page: the submission ends the session, then navigates away.
    dictationSessionTelemetry.sessionEnded("submitted");
    view.unmount();

    expect(names()).not.toContain("dictation.paused");
    expect(names().at(-1)).toBe("dictation.session_ended");
    // No stray stop without a journey once the session has ended.
    for (const event of relayed.events) {
      expect(event.journey?.type).toBe(JOURNEY_DICTATION_SESSION);
    }
  });
});

/**
 * OBS-5: realtime audio usage is the sum of `speech.session_stopped` durations, so
 * the Speech session running when the dictation ends (submitted, unmounted, page
 * exit) is stopped exactly once, with its length, before the journey ends. Still
 * not a pause.
 */
describe("the running Speech session is counted when the dictation ends", () => {
  const stops = () =>
    relayed.events.filter((e) => e.name === "speech.session_stopped");

  /** Recording, with some Speech time on the clock. */
  async function recordingForAWhile() {
    const view = await recording();
    await new Promise((resolve) => setTimeout(resolve, 20));
    return view;
  }

  function expectFinalStop(reason: string) {
    expect(stops()).toHaveLength(1);
    const [stop] = stops();
    expect(stop.durationMs).toBeGreaterThan(0);
    expect(stop.attributes).toMatchObject({
      "speech.session_id": SDK_SESSION,
      "dictation.session_index": 1,
      "dictation.user_initiated": false,
      "speech.stop_reason": reason,
    });
    expect(names()).not.toContain("dictation.paused");
    // Stopped, then ended, in the same journey.
    const ended = relayed.events.findIndex(
      (e) => e.name === "dictation.session_ended"
    );
    expect(ended).toBeGreaterThan(relayed.events.indexOf(stop));
    expect(stop.journey).toEqual(relayed.events[ended].journey);
    for (const event of relayed.events) {
      expect(event.journey?.type).toBe(JOURNEY_DICTATION_SESSION);
    }
  }

  it("submitted while recording: one stop with its duration, then the end", async () => {
    const view = await recordingForAWhile();

    dictationSessionTelemetry.sessionEnded("submitted"); // as the record page
    view.unmount();

    expectFinalStop("submitted");
    expect(names().at(-1)).toBe("dictation.session_ended");
  });

  it("unmounted while recording: one stop with its duration, then the end", async () => {
    const view = await recordingForAWhile();

    view.unmount();
    dictationSessionTelemetry.sessionEnded("left_page"); // the page's own end

    expectFinalStop("teardown");
    expect(names().slice(-2)).toEqual([
      "speech.session_stopped",
      "dictation.session_ended",
    ]);
  });

  it("paused, then submitted: no second stop", async () => {
    const view = await recordingForAWhile();
    view.rerender(<LiveDictation recordingActive={false} hideForm />);
    await waitFor(() => expect(names()).toContain("dictation.paused"));

    dictationSessionTelemetry.sessionEnded("submitted");
    view.unmount();

    expect(stops()).toHaveLength(1);
    expect(stops()[0].attributes?.["speech.stop_reason"]).toBe("paused");
    expect(names().filter((n) => n === "dictation.paused")).toHaveLength(1);
    expect(names().at(-1)).toBe("dictation.session_ended");
  });

  it("page exit while recording: the stop is sent with the end", async () => {
    const stopTracking = trackDictationPage(
      dictationSessionTelemetry,
      telemetryRelay,
      () => null
    );
    const view = await recordingForAWhile();

    window.dispatchEvent(
      new PageTransitionEvent("pagehide", { persisted: false })
    );
    view.unmount();
    stopTracking();

    expectFinalStop("page_exit");
    expect(names().at(-1)).toBe("dictation.session_ended");
  });
});
