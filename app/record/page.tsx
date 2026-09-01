"use client";

import { Pause, Play } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent,
} from "react";
import { toast } from "sonner";
import AnimatedMicrophone from "@/components/audio/animated-microphone";
import { SpeechDemo } from "@/components/audio/dictation";
import DictationForm from "@/components/audio/dictation/dictation-form";
import {
  type DictationFormValues,
  defaultFormValues,
  dictationFormSchema,
} from "@/components/audio/dictation/formData";
import {
  SECTION_CONFIG,
  type SectionedTranscript,
  type TranscriptSection,
} from "@/components/audio/dictation/types";
import SimpleEditor from "@/components/editor/tiptap-editor";
import submitHearingToast from "@/components/notifications/submitting-hearing";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMediaQuery } from "@/hooks/use-media-query";
import { track } from "@/lib/analytics";
import { getAuthToken } from "@/lib/auth-utils";
import { deleteLiveDraft, getLiveDraft, putLiveDraft } from "@/lib/live-draft-api";
import { fetchUserDocumentContent } from "@/lib/document-content-api";
import {
  type DocumentContent,
  liveTranscriptionSubmissionPayloadSchema,
  liveTranscriptionSubmissionResponseSchema,
  normalizeOptionalEditorText,
  submissionErrorResponseSchema,
} from "@/lib/editor-contracts";
import cn from "@/lib/utils";
import { useTranscripts } from "@/providers/transcripts";

function formatDraftDate(isoString: string): string {
  const savedDate = new Date(isoString);
  const now = new Date();
  const time = savedDate.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (savedDate.toDateString() === now.toDateString()) return `today at ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (savedDate.toDateString() === yesterday.toDateString()) return `yesterday at ${time}`;
  const date = savedDate.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  return `${date} at ${time}`;
}

type RecordView = "form" | "tiptap" | "transcript";
type LayoutMode = "mobile" | "wide";

const EMPTY_SECTIONED_TRANSCRIPT: SectionedTranscript = {
  background: [],
  evidence: [],
  facts: [],
};

const DEFAULT_NOTES_EDITOR_CONTENT =
  "<h3>Background</h3><ul><li><p></p></li></ul><h3>Evidence</h3><ul><li><p></p></li></ul><h3>Facts</h3><ul><li><p></p></li></ul>";

const RECORD_NOTES_EDITOR_ID = "record-notes-editor";
const RECORD_TRANSCRIPT_TAB_ID = "record-transcript-tab";
const RECORD_NOTES_TAB_ID = "record-notes-tab";
const RECORD_TRANSCRIPT_PANEL_ID = "record-transcript-panel";
const RECORD_NOTES_PANEL_ID = "record-notes-panel";

export default function RecordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setIsRecording } = useTranscripts();
  const mode = searchParams?.get("mode") || "mic";
  const [isRecordingActive, setIsRecordingActive] = useState(false);
  const [activeSection, setActiveSection] =
    useState<TranscriptSection>("background");
  const [activeView, setActiveView] = useState<RecordView>("form");
  const [formData, setFormData] =
    useState<DictationFormValues>(defaultFormValues);
  const [documentContent, setDocumentContent] = useState<
    DocumentContent | undefined
  >();
  const [sectionedTranscript, setSectionedTranscript] =
    useState<SectionedTranscript>(EMPTY_SECTIONED_TRANSCRIPT);
  const [speechDemoKey, setSpeechDemoKey] = useState(0);
  const [restoredTranscript, setRestoredTranscript] = useState<SectionedTranscript | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState<
    Partial<Record<keyof DictationFormValues, string>>
  >({});
  const [editorContent, setEditorContent] = useState(
    DEFAULT_NOTES_EDITOR_CONTENT
  );
  const formScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const restoreToastIdRef = useRef<string | number | undefined>(undefined);
  const hadDraftContentRef = useRef(false);
  const sectionedTranscriptRef = useRef(sectionedTranscript);
  const formDataRef = useRef(formData);
  const prevIsRecordingRef = useRef(false);
  const isDirtyRef = useRef(false);
  // True for 2s after recording stops — lets us catch transcript content
  // that arrives late from the Azure SDK's async finalisation.
  const lateFinalisationWindowRef = useRef(false);
  const isSmUp = useMediaQuery("(min-width: 640px)");

  const layoutMode = useMemo<LayoutMode>(() => {
    if (isSmUp) return "wide";
    return "mobile";
  }, [isSmUp]);
  const previousLayoutModeRef = useRef<LayoutMode>(layoutMode);

  const recordingModeDescription = useMemo(
    () =>
      mode === "screen"
        ? "Capturing your virtual meeting from this device"
        : "Listening through your microphone for live notes",
    [mode]
  );

  useEffect(() => {
    if (previousLayoutModeRef.current === layoutMode) return;

    if (layoutMode === "mobile") {
      setActiveView("form");
    } else {
      setActiveView("transcript");
    }

    previousLayoutModeRef.current = layoutMode;
  }, [layoutMode]);

  useEffect(() => {
    let isCancelled = false;

    void (async () => {
      try {
        const content = await fetchUserDocumentContent();
        if (!isCancelled) {
          setDocumentContent(content);
        }
      } catch (error) {
        console.error("Failed to load document content", error);
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, []);

  // Keep the Easy Auth session alive during idle/paused recording — the token is only
  // refreshed on API calls, so a long pause would otherwise expire the 1-hour Azure AD token.
  useEffect(() => {
    void getAuthToken(); // check on mount in case the token is already near expiry
    const interval = setInterval(() => {
      void getAuthToken();
    }, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setIsRecording(isRecordingActive);
    return () => setIsRecording(false);
  }, [isRecordingActive, setIsRecording]);

  // When the user starts a new recording, the restore offer is no longer relevant.
  useEffect(() => {
    if (isRecordingActive && restoreToastIdRef.current !== undefined) {
      toast.dismiss(restoreToastIdRef.current);
      restoreToastIdRef.current = undefined;
    }
  }, [isRecordingActive]);

  // Offer to restore a draft left by an interrupted session (e.g. forced logout mid-recording).
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        console.debug("[live-draft] GET /api/live-draft");
        const draft = await getLiveDraft();
        console.debug("[live-draft] GET result:", draft ? `found (saved_at: ${draft.saved_at})` : "not found");
        if (cancelled || !draft) return;
        restoreToastIdRef.current = toast(
          `Unsaved transcript found from ${formatDraftDate(draft.saved_at)}`,
          {
            action: {
              label: "Restore",
              onClick: () => {
                const restoredFormData = { ...defaultFormValues, ...draft.form_data };
                setSectionedTranscript(draft.transcript);
                setFormData(restoredFormData);
                setRestoredTranscript(draft.transcript);
                setSpeechDemoKey(k => k + 1);
              },
            },
            cancel: {
              label: "Discard",
              onClick: () => { void deleteLiveDraft().catch(console.warn); },
            },
            duration: Infinity,
          },
        );
      } catch {
        // API unavailable — skip restore silently
      }
    })();

    return () => {
      cancelled = true;
      // Dismiss on unmount so React Strict Mode's mount→unmount→remount cycle
      // doesn't show the same toast twice.
      if (restoreToastIdRef.current !== undefined) {
        toast.dismiss(restoreToastIdRef.current);
        restoreToastIdRef.current = undefined;
      }
    };
  }, []);

  // Delete the server draft immediately when all transcript sections are cleared,
  // so stale drafts don't reappear on the next visit.
  useEffect(() => {
    const hasContent =
      sectionedTranscript.background.length > 0 ||
      sectionedTranscript.evidence.length > 0 ||
      sectionedTranscript.facts.length > 0;

    if (!hasContent) {
      if (hadDraftContentRef.current) {
        void deleteLiveDraft().catch(err => console.warn("Failed to delete draft:", err));
      }
      hadDraftContentRef.current = false;
      return;
    }

    hadDraftContentRef.current = true;
  }, [sectionedTranscript]);

  // Keep refs in sync so interval/pause handlers always read latest values
  // without restarting the interval on every transcript/formData change.
  useEffect(() => {
    sectionedTranscriptRef.current = sectionedTranscript;
    isDirtyRef.current = true;
  }, [sectionedTranscript]);
  useEffect(() => {
    formDataRef.current = formData;
    isDirtyRef.current = true;
  }, [formData]);

  // Save immediately when recording transitions from active → paused/stopped.
  useEffect(() => {
    if (isRecordingActive) {
      prevIsRecordingRef.current = true;
      return;
    }
    if (!prevIsRecordingRef.current) return;
    prevIsRecordingRef.current = false;

    const hasContent =
      sectionedTranscriptRef.current.background.length > 0 ||
      sectionedTranscriptRef.current.evidence.length > 0 ||
      sectionedTranscriptRef.current.facts.length > 0;
    if (hasContent) {
      isDirtyRef.current = false;
      console.debug("[live-draft] PUT /api/live-draft (on pause)");
      void putLiveDraft(sectionedTranscriptRef.current, formDataRef.current)
        .then(() => console.debug("[live-draft] PUT succeeded"))
        .catch(err => console.warn("[live-draft] PUT failed on pause:", err));
    } else {
      console.debug("[live-draft] no content at pause — opening late-finalisation window");
    }
    // Always open the window regardless of whether we saved — the Azure SDK
    // finalises the last in-progress utterance asynchronously after
    // stopTranscribingAsync, so content that arrives within 2s should overwrite
    // the pause save with the more complete version.
    lateFinalisationWindowRef.current = true;
    const t = setTimeout(() => { lateFinalisationWindowRef.current = false; }, 2000);
    return () => clearTimeout(t);
  }, [isRecordingActive]);

  // Catch transcript content that arrives after recording stopped (Azure SDK
  // finalises the last utterance asynchronously after stopTranscribingAsync).
  useEffect(() => {
    if (!lateFinalisationWindowRef.current) return;
    const hasContent =
      sectionedTranscript.background.length > 0 ||
      sectionedTranscript.evidence.length > 0 ||
      sectionedTranscript.facts.length > 0;
    if (!hasContent) return;
    lateFinalisationWindowRef.current = false;
    isDirtyRef.current = false;
    console.debug("[live-draft] PUT /api/live-draft (late finalisation)");
    void putLiveDraft(sectionedTranscript, formDataRef.current)
      .then(() => console.debug("[live-draft] PUT succeeded (late finalisation)"))
      .catch(err => console.warn("[live-draft] PUT failed (late finalisation):", err));
  }, [sectionedTranscript]);

  // Throttle: save every 10 seconds while actively recording, but only if
  // transcript or formData changed since the last save.
  useEffect(() => {
    if (!isRecordingActive) return;

    const timer = setInterval(() => {
      if (!isDirtyRef.current) return;
      const hasContent =
        sectionedTranscriptRef.current.background.length > 0 ||
        sectionedTranscriptRef.current.evidence.length > 0 ||
        sectionedTranscriptRef.current.facts.length > 0;
      if (hasContent) {
        isDirtyRef.current = false;
        console.debug("[live-draft] PUT /api/live-draft (interval)");
        void putLiveDraft(sectionedTranscriptRef.current, formDataRef.current)
          .then(() => console.debug("[live-draft] PUT succeeded"))
          .catch(err => console.warn("[live-draft] PUT failed (interval):", err));
      }
    }, 3_000);
    return () => clearInterval(timer);
  }, [isRecordingActive]);

  useEffect(() => {
    const hasContent =
      sectionedTranscript.background.length > 0 ||
      sectionedTranscript.evidence.length > 0 ||
      sectionedTranscript.facts.length > 0;
    if (!hasContent) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [sectionedTranscript]);

  const handleCitationClick = useCallback((citationIndex: number) => {
    void citationIndex;
  }, []);

  const focusNotesEditor = useCallback(() => {
    const notesEditor = document.getElementById(RECORD_NOTES_EDITOR_ID);
    if (notesEditor instanceof HTMLElement) {
      notesEditor.focus();
    }
  }, []);

  const handleWorkspaceViewChange = useCallback((value: string) => {
    setActiveView(value as RecordView);
  }, []);

  const handleNotesTabKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== "Tab" || event.shiftKey || activeView !== "tiptap") {
        return;
      }

      event.preventDefault();
      focusNotesEditor();
    },
    [activeView, focusNotesEditor]
  );

  const handleSubmitHearing = useCallback(async () => {
    const validation = dictationFormSchema.safeParse(formData);
    if (!validation.success) {
      const fieldErrors: Partial<Record<keyof DictationFormValues, string>> =
        {};
      const messages: string[] = [];
      validation.error.issues.forEach(({ path, message }) => {
        const key = path[0] as keyof DictationFormValues | undefined;
        if (key) {
          fieldErrors[key] = message;
          messages.push(message);
        }
      });
      setFormErrors(fieldErrors);
      toast.error(
        `Please review the highlighted fields: ${messages.slice(0, 3).join("; ")}`
      );
      return;
    }

    setFormErrors({});

    const submissionPromise = (async () => {
      try {
        setIsSubmitting(true);
        const authToken = await getAuthToken();

        const response = await fetch("/api/live-transcription/submission", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(authToken && { Authorization: `Bearer ${authToken}` }),
          },
          body: JSON.stringify(
            liveTranscriptionSubmissionPayloadSchema.parse({
              form_data: validation.data,
              messages: sectionedTranscript,
              notes: normalizeOptionalEditorText(editorContent),
            })
          ),
        });

        if (!response.ok) {
          const errorBody = await response.json().catch(() => null);
          const errorResult =
            submissionErrorResponseSchema.safeParse(errorBody);
          const message = errorResult.success
            ? errorResult.data.error
            : "Failed to save submission.";
          throw new Error(message);
        }

        const responseBody = await response.json();
        const parsedResponse =
          liveTranscriptionSubmissionResponseSchema.safeParse(responseBody);
        if (!parsedResponse.success) {
          throw new Error(
            "Submission succeeded but returned an invalid response."
          );
        }
        const data = parsedResponse.data;
        track("hearing_submitted", { mode });
        await deleteLiveDraft().catch(console.warn);
        router.push("/");
        return data;
      } catch (error) {
        track("hearing_submission_failed", {
          mode,
          error_type: error instanceof Error ? error.name : "unknown_error",
        });
        throw error;
      } finally {
        setIsSubmitting(false);
      }
    })();

    submitHearingToast(submissionPromise);
  }, [formData, sectionedTranscript, router, editorContent, mode]);

  const handleFormGutterWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      const formContainer = formScrollContainerRef.current;
      if (!formContainer) return;

      const deltaMultiplier =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? formContainer.clientHeight
            : 1;
      const nextTop = event.deltaY * deltaMultiplier;
      if (nextTop === 0) return;

      formContainer.scrollBy({ top: nextTop, behavior: "auto" });
    },
    []
  );

  const sectionTabs = (
    <div
      role="group"
      aria-label="Transcript section"
      className="inline-flex h-10 overflow-hidden rounded-md border border-border bg-muted p-1"
    >
      {(Object.keys(SECTION_CONFIG) as TranscriptSection[]).map((section) => {
        const config = SECTION_CONFIG[section];
        return (
          <button
            key={section}
            type="button"
            aria-pressed={activeSection === section}
            onClick={() => setActiveSection(section)}
            className={cn(
              "relative z-0 inline-flex h-full min-w-[72px] items-center justify-center gap-1 whitespace-nowrap rounded-sm px-2 text-xs font-medium transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-0 sm:min-w-[120px] sm:gap-1.5 sm:px-3 sm:text-sm",
              activeSection === section
                ? "bg-background text-neutral-950 shadow-sm dark:bg-neutral-950 dark:text-neutral-50"
                : "text-neutral-800 hover:bg-neutral-200 hover:text-neutral-950 dark:text-neutral-100 dark:hover:bg-neutral-800 dark:hover:text-neutral-50"
            )}
          >
            <span
              className={cn(
                "size-2 rounded-full",
                config.color,
                activeSection === section ? "animate-pulse" : "opacity-60"
              )}
            />
            <span className="truncate font-medium">{config.label}</span>
          </button>
        );
      })}
    </div>
  );

  const recordingControl = (
    <div className="flex items-center gap-2 sm:gap-3">
      <div className="flex size-8 shrink-0 items-center justify-center">
        <AnimatedMicrophone size={28} isActive={isRecordingActive} />
      </div>
      <Button
        onClick={() =>
          setIsRecordingActive((active) => {
            const nextActive = !active;
            track("dictation_recording_toggled", {
              action: nextActive ? "start" : "pause",
              mode,
            });
            return nextActive;
          })
        }
        variant="outline"
        className="w-min border-border hover:bg-accent focus-visible:ring-inset focus-visible:ring-offset-0"
      >
        {isRecordingActive ? (
          <Pause className="size-4" />
        ) : (
          <Play className="size-4" />
        )}
        {isRecordingActive ? "Pause recording" : "Start recording"}
      </Button>
    </div>
  );

  const hasTranscriptContent =
    sectionedTranscript.background.length > 0 ||
    sectionedTranscript.evidence.length > 0 ||
    sectionedTranscript.facts.length > 0;
  const hasNotesContent =
    normalizeOptionalEditorText(editorContent) !==
    normalizeOptionalEditorText(DEFAULT_NOTES_EDITOR_CONTENT);
  const isWorkspaceNavigationEnabled =
    isRecordingActive || hasTranscriptContent || hasNotesContent;

  const workspaceToggleTabs = (
    <div
      role="tablist"
      aria-label="Workspace panel"
      className="inline-flex h-10 overflow-hidden rounded-md border border-border bg-muted p-1"
    >
      <button
        id={RECORD_TRANSCRIPT_TAB_ID}
        type="button"
        role="tab"
        aria-selected={activeView === "transcript"}
        aria-controls={RECORD_TRANSCRIPT_PANEL_ID}
        onClick={() => handleWorkspaceViewChange("transcript")}
        tabIndex={isWorkspaceNavigationEnabled ? 0 : -1}
        className={cn(
          "relative z-0 inline-flex h-full min-w-[80px] items-center justify-center whitespace-nowrap rounded-sm px-3 text-sm font-medium transition-all focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-0",
          activeView === "transcript"
            ? "bg-background text-neutral-950 shadow-sm dark:bg-neutral-950 dark:text-neutral-50"
            : "text-neutral-800 hover:bg-neutral-200 hover:text-neutral-950 dark:text-neutral-100 dark:hover:bg-neutral-800 dark:hover:text-neutral-50"
        )}
      >
        Transcript
      </button>
      <button
        id={RECORD_NOTES_TAB_ID}
        type="button"
        role="tab"
        aria-selected={activeView === "tiptap"}
        aria-controls={RECORD_NOTES_PANEL_ID}
        onClick={() => handleWorkspaceViewChange("tiptap")}
        onKeyDown={handleNotesTabKeyDown}
        tabIndex={isWorkspaceNavigationEnabled ? 0 : -1}
        className={cn(
          "relative z-0 inline-flex h-full min-w-[80px] items-center justify-center whitespace-nowrap rounded-sm px-3 text-sm font-medium transition-all focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-0",
          activeView === "tiptap"
            ? "bg-background text-neutral-950 shadow-sm dark:bg-neutral-950 dark:text-neutral-50"
            : "text-neutral-800 hover:bg-neutral-200 hover:text-neutral-950 dark:text-neutral-100 dark:hover:bg-neutral-800 dark:hover:text-neutral-50"
        )}
      >
        Notes
      </button>
    </div>
  );

  return (
    <div className="fixed inset-0 top-14 bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:shadow-lg"
      >
        Skip to main content
      </a>
      <div className="flex h-full flex-col">
        <footer className="order-last border-t border-border bg-background">
          <div className="mx-auto flex w-full max-w-[1280px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              {recordingControl}

              {layoutMode !== "mobile" && (
                <div className="shrink-0">{sectionTabs}</div>
              )}

              {layoutMode === "mobile" && (
                <Tabs
                  value={activeView}
                  onValueChange={handleWorkspaceViewChange}
                >
                  <TabsList className="inline-flex h-10 rounded-md border border-border bg-background">
                    <TabsTrigger
                      value="form"
                      className="px-3 text-xs sm:text-sm"
                    >
                      Form
                    </TabsTrigger>
                    <TabsTrigger
                      value="tiptap"
                      className="px-3 text-xs sm:text-sm"
                      onKeyDown={handleNotesTabKeyDown}
                    >
                      Editor
                    </TabsTrigger>
                    <TabsTrigger
                      value="transcript"
                      className="px-3 text-xs sm:text-sm"
                    >
                      Transcript
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              )}

              {layoutMode === "mobile" && activeView === "transcript" && (
                <div className="shrink-0">{sectionTabs}</div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                onClick={handleSubmitHearing}
                disabled={isSubmitting}
                size="sm"
              >
                {isSubmitting ? "Submitting..." : "Submit hearing"}
              </Button>
            </div>
          </div>
        </footer>
        <main id="main-content" className="relative min-h-0 min-w-0 flex-1 bg-background">
          <div className="flex h-full w-full justify-center overflow-hidden">
            <div className="h-full w-full max-w-[1280px] min-w-0">
              {layoutMode === "wide" && (
                <div className="grid h-full min-h-0 min-w-0 grid-cols-[360px_minmax(0,1fr)] xl:grid-cols-[420px_minmax(0,1fr)] 2xl:grid-cols-[480px_minmax(0,1fr)]">
                  <aside className="relative h-full min-h-0 bg-muted/40">
                    <div
                      aria-hidden="true"
                      className="absolute inset-y-0 right-full w-[100vw] bg-muted/40"
                      onWheel={handleFormGutterWheel}
                    />
                    <div className="flex h-full w-full flex-col px-4 py-6 sm:px-6">
                      <div
                        ref={formScrollContainerRef}
                        className="min-h-0 flex-1 overflow-y-auto px-1"
                      >
                        <DictationForm
                          initialValues={formData}
                          onFormStateChange={setFormData}
                          externalErrors={formErrors}
                          documentContent={documentContent}
                        />
                      </div>
                    </div>
                  </aside>

                  <section className="relative h-full min-h-0 min-w-0 bg-background">
                    <Tabs
                      value={activeView === "form" ? "transcript" : activeView}
                      onValueChange={handleWorkspaceViewChange}
                      className="flex h-full min-h-0 flex-col"
                    >
                      <div className="mb-2 flex justify-end px-4 pt-6 sm:px-6">
                        {workspaceToggleTabs}
                      </div>
                      <TabsContent
                        forceMount
                        value="tiptap"
                        id={RECORD_NOTES_PANEL_ID}
                        aria-labelledby={RECORD_NOTES_TAB_ID}
                        className={cn(
                          "mt-0 min-h-0 flex-1",
                          activeView === "tiptap" ? "block" : "hidden"
                        )}
                      >
                        <div className="h-full overflow-y-auto px-4 pb-6 sm:px-6">
                          <SimpleEditor
                            initialContent={editorContent}
                            onContentChange={setEditorContent}
                            isEditing
                            onCitationClick={handleCitationClick}
                            editorId={RECORD_NOTES_EDITOR_ID}
                            editorAriaLabel="Notes editor"
                            toolbarAriaLabel="Notes formatting toolbar"
                          />
                        </div>
                      </TabsContent>
                      <TabsContent
                        forceMount
                        value="transcript"
                        id={RECORD_TRANSCRIPT_PANEL_ID}
                        aria-labelledby={RECORD_TRANSCRIPT_TAB_ID}
                        tabIndex={-1}
                        className={cn(
                          "mt-0 min-h-0 flex-1",
                          activeView === "transcript" ? "block" : "hidden"
                        )}
                      >
                        <div className="flex h-full min-h-0 flex-col overflow-hidden px-4 pb-6 sm:px-6">
                          <p className="mb-2 text-xs text-muted-foreground">
                            Your transcript is automatically saved as you dictate and can be restored within 24 hours if you leave this page.
                          </p>
                          <div className="flex h-full min-h-0 flex-col overflow-hidden">
                            <SpeechDemo
                              key={speechDemoKey}
                              initialTranscript={[]}
                              initialSectionedTranscript={restoredTranscript}
                              headerSubtitle={recordingModeDescription}
                              hideForm
                              recordingActive={isRecordingActive}
                              activeSection={activeSection}
                              onActiveSectionChange={setActiveSection}
                              onTranscriptChange={setSectionedTranscript}
                              showRecordingControls={false}
                              showSectionTabs={false}
                              embedded
                              className="min-h-0 flex-1"
                            />
                          </div>
                        </div>
                      </TabsContent>
                    </Tabs>
                  </section>
                </div>
              )}

              {layoutMode === "mobile" && (
                <div className="h-full min-w-0">
                  <section
                    className={
                      activeView === "form" ? "h-full" : "hidden h-full"
                    }
                  >
                    <div className="h-full overflow-y-auto px-4 py-6">
                      <DictationForm
                        initialValues={formData}
                        onFormStateChange={setFormData}
                        externalErrors={formErrors}
                        documentContent={documentContent}
                      />
                    </div>
                  </section>

                  <section
                    className={
                      activeView === "tiptap" ? "h-full" : "hidden h-full"
                    }
                  >
                    <div className="h-full overflow-y-auto px-4 py-6">
                      <SimpleEditor
                        initialContent={editorContent}
                        onContentChange={setEditorContent}
                        isEditing
                        onCitationClick={handleCitationClick}
                        editorId={RECORD_NOTES_EDITOR_ID}
                        editorAriaLabel="Notes editor"
                        toolbarAriaLabel="Notes formatting toolbar"
                      />
                    </div>
                  </section>

                  <section
                    className={
                      activeView === "transcript" ? "h-full" : "hidden h-full"
                    }
                  >
                    <div className="flex h-full min-h-0 flex-col overflow-hidden px-4 py-6">
                      <p className="mb-2 text-xs text-muted-foreground">
                        Your transcript is automatically saved as you dictate and can be restored within 24 hours if you leave this page.
                      </p>
                      <SpeechDemo
                        key={speechDemoKey}
                        initialTranscript={[]}
                        initialSectionedTranscript={restoredTranscript}
                        headerSubtitle={recordingModeDescription}
                        hideForm
                        recordingActive={isRecordingActive}
                        activeSection={activeSection}
                        onActiveSectionChange={setActiveSection}
                        onTranscriptChange={setSectionedTranscript}
                        showRecordingControls={false}
                        showSectionTabs={false}
                        embedded
                        className="min-h-0 flex-1"
                      />
                    </div>
                  </section>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
