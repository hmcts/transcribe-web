import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Toaster } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RecordPage from "@/app/record/page";

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

vi.mock("@/providers/transcripts", () => ({
  useTranscripts: () => ({ setIsRecording: mockSetIsRecording }),
}));

vi.mock("@/lib/live-draft-api", () => ({
  getLiveDraft: mockGetLiveDraft,
  putLiveDraft: mockPutLiveDraft,
  deleteLiveDraft: mockDeleteLiveDraft,
}));

const TEST_TRANSCRIPT = {
  background: [{ speaker: "Judge", text: "Proceedings commenced", timestamp: "00:00" }],
  evidence: [],
  facts: [],
};

const SAVED_AT_RECENT = new Date(Date.now() - 5 * 60 * 1000).toISOString();

describe("Record page accessibility", () => {
  it("keeps the recording control in the footer and removes empty workspace tabs from the initial tab order", () => {
    mockGetLiveDraft.mockResolvedValue(null);
    render(<RecordPage />);

    const startRecordingButton = screen.getByRole("button", { name: "Start recording" });
    const transcriptTab = screen.getByRole("tab", { name: "Transcript" });
    const notesTab = screen.getByRole("tab", { name: "Notes" });
    const transcriptPanel = document.getElementById("record-transcript-panel");

    expect(startRecordingButton.closest("footer")).toBeTruthy();
    expect(transcriptPanel?.getAttribute("tabindex")).toBe("-1");
    expect(
      transcriptTab.getAttribute("tabindex") ?? transcriptTab.tabIndex.toString()
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

    expect(lastSpeechDemoProps.current.initialSectionedTranscript).toEqual(TEST_TRANSCRIPT);
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
        background: [...TEST_TRANSCRIPT.background, { speaker: "Counsel", text: "Objection", timestamp: "00:30" }],
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
