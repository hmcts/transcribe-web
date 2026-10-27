import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Toaster } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RecordPage from "@/app/record/page";
import { LiveDraftError } from "@/lib/live-draft-errors";
import { describeSpeechAlert } from "@/lib/speech-alerts";

const mockSetIsRecording = vi.hoisted(() => vi.fn());
const lastSpeechDemoProps = vi.hoisted(() => ({ current: null as any }));
const mockGetLiveDraft = vi.hoisted(() => vi.fn());
const mockPutLiveDraft = vi.hoisted(() => vi.fn());
const mockDeleteLiveDraft = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams("mode=mic"),
}));

vi.mock("@/hooks/use-media-query", () => ({
  useMediaQuery: () => true,
}));

vi.mock("@/providers/user-settings", () => ({
  useUserSettings: () => ({
    user: null,
    loading: false,
    updateUserSettings: vi.fn(),
  }),
}));

vi.mock("@/components/editor/tiptap-editor", () => ({
  default: () => <div>Notes editor</div>,
}));

vi.mock("@/components/audio/dictation", () => ({
  SpeechDemo: (props: any) => {
    lastSpeechDemoProps.current = props;
    return <div>Transcript area</div>;
  },
}));

vi.mock("@/components/audio/dictation/dictation-form", () => ({
  default: () => <div>Dictation form</div>,
}));

vi.mock("@/lib/document-content-api", () => ({
  fetchUserDocumentContent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/admin-access", () => ({
  getAdminAccessStatus: vi.fn().mockResolvedValue("unauthorised"),
}));

vi.mock("@/lib/auth-utils", () => ({
  getAuthToken: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/analytics", () => ({
  track: vi.fn(),
}));

// Mocked for the same reason DIAAT-297 mocks its telemetry module: the real one
// pulls in @sentry/nextjs, which cannot load in this environment.
vi.mock("@/lib/live-draft-telemetry", () => ({
  liveDraftTelemetry: {
    saveFailed: vi.fn(),
    autosaveStalled: vi.fn(),
    saveRecovered: vi.fn(),
    restoreFailed: vi.fn(),
  },
}));

vi.mock("@/providers/transcripts", () => ({
  useTranscripts: () => ({ setIsRecording: mockSetIsRecording }),
}));

vi.mock("@/lib/live-draft-api", () => ({
  getLiveDraft: mockGetLiveDraft,
  putLiveDraft: mockPutLiveDraft,
  deleteLiveDraft: mockDeleteLiveDraft,
}));

const TEST_TRANSCRIPT = {
  background: [
    { speaker: "Judge", text: "Proceedings commenced", timestamp: "00:00" },
  ],
  evidence: [],
  facts: [],
};

const SAVED_AT_RECENT = new Date(Date.now() - 5 * 60 * 1000).toISOString();

describe("Record page accessibility", () => {
  it("keeps the recording control in the footer and removes empty workspace tabs from the initial tab order", () => {
    mockGetLiveDraft.mockResolvedValue(null);
    render(<RecordPage />);

    const startRecordingButton = screen.getByRole("button", {
      name: "Start recording",
    });
    const transcriptTab = screen.getByRole("tab", { name: "Transcript" });
    const notesTab = screen.getByRole("tab", { name: "Notes" });
    const transcriptPanel = document.getElementById("record-transcript-panel");

    expect(startRecordingButton.closest("footer")).toBeTruthy();
    expect(transcriptPanel?.getAttribute("tabindex")).toBe("-1");
    expect(
      transcriptTab.getAttribute("tabindex") ??
        transcriptTab.tabIndex.toString()
    ).toBe("-1");
    expect(
      notesTab.getAttribute("tabindex") ?? notesTab.tabIndex.toString()
    ).toBe("-1");
  });
});

describe("Live draft restore", () => {
  beforeEach(() => {
    lastSpeechDemoProps.current = null;
    mockGetLiveDraft.mockResolvedValue(null);
    mockPutLiveDraft.mockResolvedValue(undefined);
    mockDeleteLiveDraft.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows the restore toast when a draft is found", async () => {
    mockGetLiveDraft.mockResolvedValue({
      transcript: TEST_TRANSCRIPT,
      form_data: {},
      saved_at: SAVED_AT_RECENT,
    });

    render(
      <>
        <Toaster />
        <RecordPage />
      </>
    );

    await waitFor(() => {
      expect(screen.getByText(/Unsaved transcript found from/i)).toBeTruthy();
    });
  });

  it("shows the restore toast even when saved form data is incomplete", async () => {
    // Previously parseLiveDraft ran dictationFormSchema.safeParse() (strict) which
    // returned null on empty formData, so the toast was never fired.
    mockGetLiveDraft.mockResolvedValue({
      transcript: TEST_TRANSCRIPT,
      form_data: {},
      saved_at: SAVED_AT_RECENT,
    });

    render(
      <>
        <Toaster />
        <RecordPage />
      </>
    );

    await waitFor(() => {
      expect(screen.getByText(/Unsaved transcript found from/i)).toBeTruthy();
    });
  });

  it("passes the restored transcript to SpeechDemo when Restore is clicked", async () => {
    // Previously clicking Restore called setSectionedTranscript in the parent but
    // SpeechDemo kept its own internal state from mount — the transcript never appeared.
    mockGetLiveDraft.mockResolvedValue({
      transcript: TEST_TRANSCRIPT,
      form_data: {},
      saved_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    });

    render(
      <>
        <Toaster />
        <RecordPage />
      </>
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /restore/i })).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /restore/i }));
    });

    expect(lastSpeechDemoProps.current.initialSectionedTranscript).toEqual(
      TEST_TRANSCRIPT
    );
  });

  it("does not delete the server draft when Restore is clicked", async () => {
    // Draft is kept in DB after Restore so it acts as a fallback if the app
    // closes before the next autosave fires. The upsert will overwrite it
    // once the user dictates again.
    mockGetLiveDraft.mockResolvedValue({
      transcript: TEST_TRANSCRIPT,
      form_data: {},
      saved_at: SAVED_AT_RECENT,
    });

    render(
      <>
        <Toaster />
        <RecordPage />
      </>
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /restore/i })).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /restore/i }));
    });

    expect(mockDeleteLiveDraft).not.toHaveBeenCalled();
  });

  it("calls deleteLiveDraft when Discard is clicked", async () => {
    mockGetLiveDraft.mockResolvedValue({
      transcript: TEST_TRANSCRIPT,
      form_data: {},
      saved_at: SAVED_AT_RECENT,
    });

    render(
      <>
        <Toaster />
        <RecordPage />
      </>
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /discard/i })).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /discard/i }));
    });

    expect(mockDeleteLiveDraft).toHaveBeenCalled();
  });

  it("saves draft immediately when recording is paused", async () => {
    mockGetLiveDraft.mockResolvedValue(null);

    render(
      <>
        <Toaster />
        <RecordPage />
      </>
    );

    // Add transcript content
    await act(async () => {
      lastSpeechDemoProps.current.onTranscriptChange(TEST_TRANSCRIPT);
    });

    // Start recording
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /start recording/i }));
    });

    mockPutLiveDraft.mockClear();

    // Pause recording — should trigger immediate save
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /pause recording/i }));
    });

    expect(mockPutLiveDraft).toHaveBeenCalledOnce();
  });

  it("saves draft on the 10-second throttle interval during active recording", async () => {
    vi.useFakeTimers();
    mockGetLiveDraft.mockResolvedValue(null);

    render(
      <>
        <Toaster />
        <RecordPage />
      </>
    );

    await act(async () => {
      lastSpeechDemoProps.current.onTranscriptChange(TEST_TRANSCRIPT);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /start recording/i }));
    });

    mockPutLiveDraft.mockClear();

    // Advance 3 seconds — interval fires, dirty flag was true so it saves
    await act(async () => {
      vi.advanceTimersByTime(3_000);
    });

    expect(mockPutLiveDraft).toHaveBeenCalledOnce();

    // Advance another 3 seconds without any new transcript change —
    // dirty flag is now false so the interval should NOT save again
    await act(async () => {
      vi.advanceTimersByTime(3_000);
    });

    expect(mockPutLiveDraft).toHaveBeenCalledTimes(1);

    // Simulate a new transcript change (dirty again), then advance 3s — saves
    await act(async () => {
      lastSpeechDemoProps.current.onTranscriptChange({
        ...TEST_TRANSCRIPT,
        background: [
          ...TEST_TRANSCRIPT.background,
          { speaker: "Counsel", text: "Objection", timestamp: "00:30" },
        ],
      });
    });

    await act(async () => {
      vi.advanceTimersByTime(3_000);
    });

    expect(mockPutLiveDraft).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("does not save on the interval when transcript is empty", async () => {
    vi.useFakeTimers();
    mockGetLiveDraft.mockResolvedValue(null);

    render(
      <>
        <Toaster />
        <RecordPage />
      </>
    );

    // Start recording without any transcript content
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /start recording/i }));
    });

    mockPutLiveDraft.mockClear();

    await act(async () => {
      vi.advanceTimersByTime(3_000);
    });

    expect(mockPutLiveDraft).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("deletes the server draft immediately when transcript transitions from content to empty", async () => {
    mockGetLiveDraft.mockResolvedValue(null);

    render(
      <>
        <Toaster />
        <RecordPage />
      </>
    );

    // Simulate content being added — sets hadDraftContentRef.current = true
    await act(async () => {
      lastSpeechDemoProps.current.onTranscriptChange(TEST_TRANSCRIPT);
    });

    mockDeleteLiveDraft.mockClear();

    // Simulate all sections being cleared — should trigger immediate delete
    await act(async () => {
      lastSpeechDemoProps.current.onTranscriptChange({
        background: [],
        evidence: [],
        facts: [],
      });
    });

    expect(mockDeleteLiveDraft).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// DIAAT-297: a broken dictation session must be impossible to miss.
// ---------------------------------------------------------------------------

const FAILED_SESSION = {
  health: "failed" as const,
  collapsesInWindow: 3,
  totalCollapses: 37,
  lastCancellation: {
    reason: "Error",
    errorCode: "ConnectionFailure",
    errorDetails: "WebSocket closed unexpectedly",
  },
};

const HEALTHY_SESSION = {
  health: "healthy" as const,
  collapsesInWindow: 0,
  totalCollapses: 0,
  lastCancellation: null,
};

/** Push a session report up from the mocked dictation component. */
async function reportSpeechSession(options: {
  session: typeof FAILED_SESSION | typeof HEALTHY_SESSION;
  hasCapturedSpeech?: boolean;
  noSpeechWarning?: boolean;
}) {
  const {
    session,
    hasCapturedSpeech = false,
    noSpeechWarning = false,
  } = options;
  await act(async () => {
    lastSpeechDemoProps.current.onSpeechSessionChange({
      session,
      alert: describeSpeechAlert({
        health: session.health,
        totalCollapses: session.totalCollapses,
        hasCapturedSpeech,
        noSpeechWarning,
        noSpeechThresholdSeconds: 90,
      }),
      isCapturing: session.health === "healthy",
      dismissAlert: vi.fn(),
    });
  });
}

async function startRecording() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
  });
}

describe("Speech session failure states", () => {
  beforeEach(() => {
    mockGetLiveDraft.mockResolvedValue(null);
    lastSpeechDemoProps.current = null;
    document.title = "CourtsTranscribe";
  });

  it("shows no banner and reports recording while the session is healthy", async () => {
    render(<RecordPage />);
    await startRecording();
    await reportSpeechSession({
      session: HEALTHY_SESSION,
      hasCapturedSpeech: true,
    });

    expect(screen.queryByTestId("record-alert-banner")).toBeNull();
    expect(screen.getByTestId("speech-status-label").textContent).toMatch(
      /Recording/
    );
  });

  it("shows a persistent error banner when the speech session has failed", async () => {
    render(<RecordPage />);
    await startRecording();
    await reportSpeechSession({ session: FAILED_SESSION });

    const banner = screen.getByTestId("record-alert-banner");
    expect(banner.getAttribute("data-severity")).toBe("error");
    expect(banner.getAttribute("role")).toBe("alert");
    expect(banner.getAttribute("aria-live")).toBe("assertive");
    expect(
      screen.getByText(/Your dictation is not being recorded/i)
    ).toBeTruthy();
  });

  it("does not present as recording normally while the session has failed", async () => {
    render(<RecordPage />);
    await startRecording();
    await reportSpeechSession({ session: FAILED_SESSION });

    expect(screen.getByTestId("speech-status-label").textContent).toMatch(
      /Not recording/
    );
  });

  it("cannot be dismissed while speech is being lost", async () => {
    render(<RecordPage />);
    await startRecording();
    await reportSpeechSession({ session: FAILED_SESSION });

    expect(screen.queryByRole("button", { name: /dismiss/i })).toBeNull();
  });

  it("puts the alarm in the tab title so it is visible from another window", async () => {
    render(<RecordPage />);
    await startRecording();
    await reportSpeechSession({ session: FAILED_SESSION });

    expect(document.title).toMatch(/NOT RECORDING/);
  });

  it("warns explicitly when nothing has been captured after the threshold", async () => {
    render(<RecordPage />);
    await startRecording();
    await reportSpeechSession({
      session: HEALTHY_SESSION,
      hasCapturedSpeech: false,
      noSpeechWarning: true,
    });

    const banner = screen.getByTestId("record-alert-banner");
    expect(banner.getAttribute("data-kind")).toBe("speech-no-content");
    expect(screen.getByText(/No speech has been recorded yet/i)).toBeTruthy();
    expect(screen.getByText(/90 seconds/)).toBeTruthy();
  });

  it("keeps warning about the failure after recording is paused", async () => {
    render(<RecordPage />);
    await startRecording();
    await reportSpeechSession({ session: FAILED_SESSION });

    // Pausing clears every live warning, which is how the incident ended: the
    // judge stopped, saw a clean screen, and submitted an empty transcript.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pause recording" }));
    });
    await reportSpeechSession({
      session: { ...HEALTHY_SESSION, health: "idle" as never },
    });

    expect(
      screen.getByText(/Recording failed during this session/i)
    ).toBeTruthy();
    expect(screen.getByText(/before you submit/i)).toBeTruthy();
  });

  it("lets the user dismiss the post-session notice", async () => {
    render(<RecordPage />);
    await startRecording();
    await reportSpeechSession({ session: FAILED_SESSION });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pause recording" }));
    });
    await reportSpeechSession({
      session: { ...HEALTHY_SESSION, health: "idle" as never },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    });

    expect(screen.queryByTestId("record-alert-banner")).toBeNull();
  });

  it("clears the sticky notice when a new recording is started", async () => {
    render(<RecordPage />);
    await startRecording();
    await reportSpeechSession({ session: FAILED_SESSION });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pause recording" }));
    });
    await reportSpeechSession({
      session: { ...HEALTHY_SESSION, health: "idle" as never },
    });
    expect(screen.getByTestId("record-alert-banner")).toBeTruthy();

    await startRecording();
    await reportSpeechSession({
      session: HEALTHY_SESSION,
      hasCapturedSpeech: true,
    });

    expect(screen.queryByTestId("record-alert-banner")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// DIAAT-296: autosave failures must never be swallowed.
// ---------------------------------------------------------------------------

describe("Autosave failure states", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    lastSpeechDemoProps.current = null;
    mockGetLiveDraft.mockResolvedValue(null);
    mockPutLiveDraft.mockReset().mockResolvedValue(undefined);
    mockDeleteLiveDraft.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  /** Render, add transcript content, and start recording. */
  async function startDictating() {
    render(<RecordPage />);
    await act(async () => {
      lastSpeechDemoProps.current.onTranscriptChange(TEST_TRANSCRIPT);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
    });
  }

  /** Let the 3s interval fire and the resulting promise settle. */
  async function tickInterval() {
    await act(async () => {
      vi.advanceTimersByTime(3_000);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function tickRetry(ms: number) {
    await act(async () => {
      vi.advanceTimersByTime(ms);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("stays quiet after a single failed save", async () => {
    mockPutLiveDraft.mockRejectedValueOnce(
      new LiveDraftError("network", "boom")
    );
    await startDictating();
    await tickInterval();

    expect(screen.queryByTestId("record-alert-banner")).toBeNull();
  });

  it("shows a persistent banner once saving has actually stopped", async () => {
    mockPutLiveDraft.mockRejectedValue(new LiveDraftError("network", "boom"));
    await startDictating();
    await tickInterval();
    await tickRetry(1_000);

    const banner = screen.getByTestId("record-alert-banner");
    expect(banner.getAttribute("data-kind")).toBe("autosave-failing");
    expect(banner.getAttribute("role")).toBe("alert");
    expect(banner.getAttribute("aria-live")).toBe("assertive");
    expect(
      screen.getByText(/Your transcript is not being saved/i)
    ).toBeTruthy();
  });

  it("cannot be dismissed while work is being lost", async () => {
    mockPutLiveDraft.mockRejectedValue(new LiveDraftError("network", "boom"));
    await startDictating();
    await tickInterval();
    await tickRetry(1_000);

    expect(screen.queryByRole("button", { name: /dismiss/i })).toBeNull();
  });

  it("clears the warning automatically when saving works again", async () => {
    mockPutLiveDraft.mockRejectedValue(new LiveDraftError("network", "boom"));
    await startDictating();
    await tickInterval();
    await tickRetry(1_000);
    expect(screen.getByTestId("record-alert-banner")).toBeTruthy();

    mockPutLiveDraft.mockResolvedValue(undefined);
    await tickRetry(2_000);

    expect(screen.queryByTestId("record-alert-banner")).toBeNull();
  });

  it("prompts re-authentication rather than blaming the network on a 401", async () => {
    mockPutLiveDraft.mockRejectedValue(
      new LiveDraftError("auth", "unauthorised", 401)
    );
    await startDictating();
    await tickInterval();

    const banner = screen.getByTestId("record-alert-banner");
    expect(banner.getAttribute("data-kind")).toBe("auth-expired");
    expect(screen.getByText(/sign in again/i)).toBeTruthy();
  });

  it("lets the capture failure win when speech and saving are both broken", async () => {
    mockPutLiveDraft.mockRejectedValue(new LiveDraftError("network", "boom"));
    await startDictating();
    await tickInterval();
    await tickRetry(1_000);
    await reportSpeechSession({ session: FAILED_SESSION });

    expect(
      screen.getByTestId("record-alert-banner").getAttribute("data-kind")
    ).toBe("speech-failed");
  });

  it("shows the time of the last successful save in the status row", async () => {
    await startDictating();
    await tickInterval();

    expect(screen.getByTestId("save-status-label").textContent).toMatch(
      /^Saved \d{2}:\d{2}$/
    );
  });

  it("says not saved in the status row once saving has stopped", async () => {
    mockPutLiveDraft.mockRejectedValue(new LiveDraftError("network", "boom"));
    await startDictating();
    await tickInterval();
    await tickRetry(1_000);

    expect(screen.getByTestId("save-status-label").textContent).toBe(
      "Not saved"
    );
  });

  it("retries without waiting for the next interval", async () => {
    mockPutLiveDraft.mockRejectedValue(new LiveDraftError("network", "boom"));
    await startDictating();
    await tickInterval();
    expect(mockPutLiveDraft).toHaveBeenCalledTimes(1);

    // One second later â€” well inside the 3s interval â€” the retry has run.
    await tickRetry(1_000);
    expect(mockPutLiveDraft).toHaveBeenCalledTimes(2);
  });
});

describe("Live draft restore failures", () => {
  beforeEach(() => {
    lastSpeechDemoProps.current = null;
    mockPutLiveDraft.mockResolvedValue(undefined);
    mockDeleteLiveDraft.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("reports a failed lookup as a failure, not as an absent draft", async () => {
    mockGetLiveDraft.mockRejectedValue(
      new LiveDraftError("network", "Failed to fetch live draft")
    );

    render(<RecordPage />);
    await waitFor(() => {
      expect(screen.getByTestId("record-alert-banner")).toBeTruthy();
    });

    expect(
      screen.getByTestId("record-alert-banner").getAttribute("data-kind")
    ).toBe("draft-restore-failed");
    expect(
      screen.getByText(/could not check for an unsaved transcript/i)
    ).toBeTruthy();
  });

  it("tells the user to sign in again when the lookup was rejected on auth", async () => {
    mockGetLiveDraft.mockRejectedValue(
      new LiveDraftError("auth", "unauthorised", 401)
    );

    render(<RecordPage />);
    await waitFor(() => {
      expect(screen.getByTestId("record-alert-banner")).toBeTruthy();
    });
    expect(screen.getByText(/sign in again/i)).toBeTruthy();
  });

  it("stays silent when the user genuinely has no draft", async () => {
    mockGetLiveDraft.mockResolvedValue(null);

    render(<RecordPage />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByTestId("record-alert-banner")).toBeNull();
  });

  it("lets the restore failure be dismissed, since nothing is being lost now", async () => {
    mockGetLiveDraft.mockRejectedValue(
      new LiveDraftError("server", "boom", 500)
    );

    render(<RecordPage />);
    await waitFor(() => {
      expect(screen.getByTestId("record-alert-banner")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    });

    expect(screen.queryByTestId("record-alert-banner")).toBeNull();
  });

  it("warns that a draft close to 24 hours old is about to be deleted", async () => {
    mockGetLiveDraft.mockResolvedValue({
      transcript: TEST_TRANSCRIPT,
      form_data: {},
      // 20.5h old leaves 3.5h, which floors to "3 hours" regardless of the
      // few milliseconds between this line and the page reading the clock.
      // Remaining time is floored, never rounded up: telling a judge they have
      // longer than they do is the one direction that loses the transcript.
      saved_at: new Date(Date.now() - 20.5 * 60 * 60 * 1000).toISOString(),
    });

    render(<RecordPage />);
    await waitFor(() => {
      expect(screen.getByTestId("record-alert-banner")).toBeTruthy();
    });

    expect(
      screen.getByTestId("record-alert-banner").getAttribute("data-kind")
    ).toBe("draft-expiring");
    expect(screen.getByText(/will be deleted in 3 hours/i)).toBeTruthy();
  });

  it("does not warn about expiry for a draft saved minutes ago", async () => {
    mockGetLiveDraft.mockResolvedValue({
      transcript: TEST_TRANSCRIPT,
      form_data: {},
      saved_at: SAVED_AT_RECENT,
    });

    render(<RecordPage />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByTestId("record-alert-banner")).toBeNull();
  });

  describe("expiry warning after the draft changes (PR #14 review)", () => {
    const OLD_DRAFT = {
      transcript: TEST_TRANSCRIPT,
      form_data: {},
      saved_at: new Date(Date.now() - 20.5 * 60 * 60 * 1000).toISOString(),
    };

    async function renderWithExpiringDraft() {
      mockGetLiveDraft.mockResolvedValue(OLD_DRAFT);
      mockPutLiveDraft.mockResolvedValue(undefined);
      mockDeleteLiveDraft.mockResolvedValue(undefined);
      render(
        <>
          <Toaster />
          <RecordPage />
        </>
      );
      await waitFor(() => {
        expect(
          screen.getByTestId("record-alert-banner").getAttribute("data-kind")
        ).toBe("draft-expiring");
      });
    }

    it("clears it once the draft is discarded", async () => {
      await renderWithExpiringDraft();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /discard/i }));
      });
      await waitFor(() => expect(mockDeleteLiveDraft).toHaveBeenCalled());
      expect(screen.queryByTestId("record-alert-banner")).toBeNull();
    });

    it("keeps it if the discard failed", async () => {
      await renderWithExpiringDraft();
      mockDeleteLiveDraft.mockRejectedValue(new Error("network"));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /discard/i }));
      });
      await waitFor(() => expect(mockDeleteLiveDraft).toHaveBeenCalled());
      expect(
        screen.getByTestId("record-alert-banner").getAttribute("data-kind")
      ).toBe("draft-expiring");
    });

    it("clears it once a save renews the draft", async () => {
      await renderWithExpiringDraft();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /restore/i }));
      });
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: /start recording/i })
        );
      });
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: /pause recording/i })
        );
      });
      await waitFor(() => expect(mockPutLiveDraft).toHaveBeenCalled());
      await waitFor(() =>
        expect(screen.queryByTestId("record-alert-banner")).toBeNull()
      );
    });
  });
});
