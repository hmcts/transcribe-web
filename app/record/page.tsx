"use client";

import { Copy, Pause, Play } from "lucide-react";
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
import RecordAlertBanner from "@/components/audio/recording/record-alert-banner";
import RecordStatusRow from "@/components/audio/recording/record-status-row";
import {
  type DictationSection,
  entryCount,
  type SectionedTranscript,
  type SpeechSessionReport,
  sectionColor,
  sectionLabel,
  type TranscriptSection,
} from "@/components/audio/dictation/types";
import SimpleEditor from "@/components/editor/tiptap-editor";
import submitHearingToast from "@/components/notifications/submitting-hearing";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useLiveDraftAutosave } from "@/hooks/use-live-draft-autosave";
import {
  describeAutosaveAlert,
  describeDraftExpiryAlert,
  describeDraftRestoreAlert,
  describeSaveStatus,
} from "@/lib/autosave-alerts";
import { getAuthToken } from "@/lib/auth-utils";
import {
  copyToClipboard,
  dictationHtml,
  dictationText,
} from "@/lib/dictation-copy";
import { jurisdictionHeaders } from "@/lib/jurisdiction-session";
import {
  isLeavingForJurisdictionSwitch,
  JurisdictionSwitchError,
  onBeforeJurisdictionSwitch,
} from "@/lib/jurisdiction-switch";
import {
  type DraftFormData,
  deleteLiveDraft,
  getLiveDraft,
} from "@/lib/live-draft-api";
import { LiveDraftError, liveDraftFailureKind } from "@/lib/live-draft-errors";
import {
  dictationSessionTelemetry,
  trackDictationPage,
} from "@/lib/dictation-session";
import { liveDraftTelemetry } from "@/lib/live-draft-telemetry";
import {
  liveTranscriptionSubmissionResponseSchema,
  normalizeOptionalEditorText,
  submissionErrorResponseSchema,
} from "@/lib/editor-contracts";
import {
  type RecordAlert,
  selectMostSevereAlert,
} from "@/lib/record-alerts";
import {
  SPEECH_FAILED_EARLIER_ALERT,
  SPEECH_NO_CONTENT_EARLIER_ALERT,
} from "@/lib/speech-alerts";
import cn from "@/lib/utils";
import { TemplateForm } from "@/components/audio/dictation/template-form";
import {
  type AvailableTemplate,
  fetchAvailableTemplates,
  hasAnswers,
  missingValues,
  startingValues,
  TemplateRefusedError,
  type TemplateValues,
  valuesToSend,
} from "@/lib/templates-api";

const TEMPLATES_FAILED_TOAST = "templates-failed";
import { useJurisdiction } from "@/providers/jurisdiction";
import { useTranscripts } from "@/providers/transcripts";
import { useUserSettings } from "@/providers/user-settings";

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

/** DIAAT-333: with no template, the judge dictates into one general section. */
const GENERAL_SECTIONS: DictationSection[] = [
  { tag: "general", label: "General" },
];

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Notes with nothing of the judge's in them: no text but the section headings
 * (which change with the template chosen). */
function isBlankNotes(html: string): boolean {
  return !html
    .replace(/<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
}

/** Blank notes, with a heading per section when there are several: the notes
 * under a heading go into that section of the document. */
function blankNotes(sections: DictationSection[]): string {
  if (sections.length < 2) return "<p></p>";
  return sections
    .map((s) => `<h3>${escapeHtml(s.label)}</h3><ul><li><p></p></li></ul>`)
    .join("");
}

const RECORD_NOTES_EDITOR_ID = "record-notes-editor";
const RECORD_TRANSCRIPT_TAB_ID = "record-transcript-tab";
const RECORD_NOTES_TAB_ID = "record-notes-tab";
const RECORD_TRANSCRIPT_PANEL_ID = "record-transcript-panel";
const RECORD_NOTES_PANEL_ID = "record-notes-panel";

export default function RecordPage() {
  // DIAAT-344: the judge chooses one of the jurisdiction's uploaded templates, fills
  // its Hearing Details form and dictates into its sections (its dictated boxes).
  // DIAAT-333: with none, they dictate into a general section and copy the text out.
  const { wording } = useJurisdiction();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setIsRecording } = useTranscripts();
  // From the URL: only the known modes (anything else is the default, mic).
  const requestedMode = searchParams?.get("mode");
  const mode =
    requestedMode === "screen" || requestedMode === "upload"
      ? requestedMode
      : "mic";
  const [isRecordingActive, setIsRecordingActive] = useState(false);
  const [activeView, setActiveView] = useState<RecordView>("transcript");
  const [templates, setTemplates] = useState<AvailableTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [templateValues, setTemplateValues] = useState<TemplateValues>({});
  const [templateErrors, setTemplateErrors] = useState<Record<string, string>>(
    {}
  );
  const chosenTemplate =
    templates.find((t) => t.id === templateId) ?? templates[0] ?? null;
  // What text questions start with (the judge's name...): not answers of the judge's
  // until changed, so not in the draft, and sent as given unless the judge changes them.
  const { user } = useUserSettings();
  const templateStart = useMemo(
    () => (chosenTemplate ? startingValues(chosenTemplate, user?.email) : {}),
    [chosenTemplate, user?.email]
  );
  // A form to fill and a hearing to submit, rather than text to copy out.
  const hasHearingForm = chosenTemplate !== null;
  // The sections dictated into: the template's dictated boxes, in its order.
  // An API from before sections gives none: one, as before.
  const sections = useMemo(
    () =>
      chosenTemplate?.sections?.length ? chosenTemplate.sections : GENERAL_SECTIONS,
    [chosenTemplate]
  );
  const hasSections = sections.length > 1;
  const [pickedSection, setPickedSection] = useState<TranscriptSection>("");
  // Until the judge picks one (and after another template's are chosen): the first.
  const activeSection = sections.some((s) => s.tag === pickedSection)
    ? pickedSection
    : sections[0].tag;
  const defaultNotes = blankNotes(sections);
  const [sectionedTranscript, setSectionedTranscript] =
    useState<SectionedTranscript>({});
  const [speechDemoKey, setSpeechDemoKey] = useState(0);
  const [notesEditorKey, setNotesEditorKey] = useState(0);
  // Reported up from the dictation component, which owns the Speech SDK
  // session. Without this the footer indicator could only reflect what the user
  // asked for, not what was actually happening (DIAAT-297).
  const [speechReport, setSpeechReport] = useState<SpeechSessionReport | null>(
    null
  );
  const [sessionHadFailure, setSessionHadFailure] = useState(false);
  const [sessionHadNoContent, setSessionHadNoContent] = useState(false);
  const [postSessionNoticeDismissed, setPostSessionNoticeDismissed] =
    useState(false);
  const [restoredTranscript, setRestoredTranscript] = useState<SectionedTranscript | undefined>();
  // DIAAT-296: a restore lookup that failed is not the same fact as "you have
  // no draft", and the two must never look alike on screen again.
  const [restoreFailureAlert, setRestoreFailureAlert] =
    useState<RecordAlert | null>(null);
  const [draftExpiryAlert, setDraftExpiryAlert] = useState<RecordAlert | null>(
    null
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editorContent, setEditorContent] = useState(defaultNotes);
  const formScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const restoreToastIdRef = useRef<string | number | undefined>(undefined);
  const hadDraftContentRef = useRef(false);
  const sectionedTranscriptRef = useRef(sectionedTranscript);
  // What the draft keeps besides the dictation: the template, its answers, the notes.
  const draftFormRef = useRef<DraftFormData>({});
  const prevIsRecordingRef = useRef(false);
  const isDirtyRef = useRef(false);
  // True for 2s after recording stops — lets us catch transcript content
  // that arrives late from the Azure SDK's async finalisation.
  const lateFinalisationWindowRef = useRef(false);
  const isSmUp = useMediaQuery("(min-width: 640px)");

  /**
   * The current draft, or null when there is nothing worth saving: no dictation,
   * no answer and no notes of the judge's. The template's answers and the notes are
   * kept with the dictation, so all of it can be restored.
   */
  const getAutosavePayload = useCallback(() => {
    const transcript = sectionedTranscriptRef.current;
    const form = draftFormRef.current;
    const hasContent =
      entryCount(transcript) > 0 ||
      hasAnswers(form.values ?? {}) ||
      form.notes !== undefined;
    if (!hasContent) return null;
    return { transcript, formData: form };
  }, []);

  const {
    saveNow: saveDraftNow,
    state: autosaveState,
    runExclusive: runWithoutDraftSaves,
    stop: stopDraftSaves,
    flush: flushDraft,
  } = useLiveDraftAutosave({ getPayload: getAutosavePayload });

  // DIAAT-332: before the tab switches jurisdiction, this jurisdiction's draft is
  // saved (nothing once submitted); a failed save, or a submission in progress,
  // stops the switch.
  const isSubmittingRef = useRef(false);
  useEffect(() => {
    isSubmittingRef.current = isSubmitting;
  }, [isSubmitting]);
  // The draft holds the dictation, the answers and the notes: all of it is saved
  // before the switch.
  useEffect(
    () =>
      onBeforeJurisdictionSwitch(async () => {
        const checkNothingIsLost = () => {
          if (isSubmittingRef.current) throw new JurisdictionSwitchError("busy");
        };
        // The page stays editable while the draft is saved: anything typed during
        // the save is checked, and saved, again. The reload follows this handler
        // with nothing awaited between, so nothing can be typed after the last check.
        for (let saves = 0; saves < 3; saves += 1) {
          checkNothingIsLost();
          const saving = JSON.stringify(getAutosavePayload());
          await flushDraft();
          checkNothingIsLost();
          if (JSON.stringify(getAutosavePayload()) === saving) return;
        }
        throw new JurisdictionSwitchError("busy"); // still changing: try again
      }),
    [flushDraft, getAutosavePayload]
  );

  /**
   * Delete the server draft with no autosave write before or alongside it, so
   * a write can neither bring deleted content back nor be deleted itself.
   * Clears the expiry warning, which described that draft.
   */
  const deleteDraft = useCallback(async () => {
    await runWithoutDraftSaves(deleteLiveDraft);
    setDraftExpiryAlert(null);
  }, [runWithoutDraftSaves]);

  // A confirmed save renews the draft's 24 hours (and replaces any older draft),
  // so an expiry warning from the initial lookup no longer applies.
  useEffect(() => {
    if (autosaveState.lastSavedAt !== null) setDraftExpiryAlert(null);
  }, [autosaveState.lastSavedAt]);

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

    if (layoutMode === "mobile" && hasHearingForm) {
      setActiveView("form");
    } else {
      setActiveView("transcript");
    }

    previousLayoutModeRef.current = layoutMode;
  }, [layoutMode, hasHearingForm]);

  // An answer still on its way is for a page left behind or an earlier attempt.
  const templatesRequest = useRef(0);
  const loadTemplates = useCallback(async () => {
    const request = ++templatesRequest.current;
    try {
      const list = await fetchAvailableTemplates();
      if (request !== templatesRequest.current) return;
      toast.dismiss(TEMPLATES_FAILED_TOAST);
      setTemplates(list);
      setTemplateId((id) =>
        list.some((t) => t.id === id) ? id : (list[0]?.id ?? "")
      );
    } catch (error) {
      if (request !== templatesRequest.current) return;
      // An API from before DIAAT-344 has no templates: the page works as before,
      // dictate and copy the text out.
      if (error instanceof TemplateRefusedError && error.status === 404) return;
      // Anything else is not "no templates": say so, with a way to try again. The
      // page still lets the judge dictate and copy the text out meanwhile.
      console.error("Failed to load templates", error);
      toast.error(
        "This jurisdiction's templates could not be loaded, so Hearing details is not shown.",
        {
          id: TEMPLATES_FAILED_TOAST,
          duration: Number.POSITIVE_INFINITY,
          action: { label: "Try again", onClick: () => void loadTemplates() },
        }
      );
    }
  }, []);

  useEffect(() => {
    void loadTemplates();
    return () => {
      // A switch of jurisdiction reloads the page (providers/jurisdiction.tsx).
      templatesRequest.current += 1;
    };
  }, [loadTemplates]);

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

  // OBS-4: one dictation-session journey per visit; ends when the page is left.
  useEffect(() => trackDictationPage(), []);

  // Offer to restore a draft left by an interrupted session (e.g. forced logout mid-recording).
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        console.debug("[live-draft] GET /api/live-draft");
        const draft = await getLiveDraft();
        console.debug("[live-draft] GET result:", draft ? `found (saved_at: ${draft.saved_at})` : "not found");
        if (cancelled || !draft) return;
        // The backend hard-deletes a draft 24h after its last save, on read.
        // A judge who cannot get back in within a day loses the work
        // permanently, so say so while it can still be acted on (DIAAT-296).
        setDraftExpiryAlert(
          describeDraftExpiryAlert({ savedAt: draft.saved_at, now: Date.now() })
        );
        restoreToastIdRef.current = toast(
          `Unsaved transcript found from ${formatDraftDate(draft.saved_at)}`,
          {
            action: {
              label: "Restore",
              onClick: () => {
                // A draft from before templates has the IAC form's fields: its
                // dictation is restored, and goes into the first section.
                const { template_id, values, notes } = draft.form_data;
                setSectionedTranscript(draft.transcript);
                setRestoredTranscript(draft.transcript);
                setSpeechDemoKey(k => k + 1);
                if (typeof template_id === "string") setTemplateId(template_id);
                if (values && typeof values === "object") setTemplateValues(values);
                if (typeof notes === "string") {
                  setEditorContent(notes);
                  setNotesEditorKey((k) => k + 1);
                }
                // Only now has a draft been restored (not when one was found).
                liveDraftTelemetry.restoreSucceeded();
              },
            },
            cancel: {
              label: "Discard",
              onClick: () => { void deleteDraft().catch(console.warn); },
            },
            duration: Infinity,
          },
        );
      } catch (error) {
        // DIAAT-296: this used to be a bare `catch {}` commented "API
        // unavailable — skip restore silently", which made a failed lookup
        // indistinguishable from "you have no draft". A judge coming back for
        // their transcript would have been told, in effect, that it never
        // existed. Say what actually happened instead.
        if (cancelled) return;
        const kind = liveDraftFailureKind(error);
        liveDraftTelemetry.restoreFailed({
          kind,
          status: error instanceof LiveDraftError ? error.status : undefined,
        });
        setRestoreFailureAlert(describeDraftRestoreAlert({ kind }));
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
  }, [deleteDraft]);

  // What the draft keeps besides the dictation. The notes only once they are the
  // judge's own (not the blank headings).
  const notesAreOwn = !isBlankNotes(editorContent);
  const draftForm = useMemo<DraftFormData>(
    () => ({
      template_id: chosenTemplate?.id,
      values: templateValues,
      notes: notesAreOwn ? editorContent : undefined,
    }),
    [chosenTemplate?.id, templateValues, notesAreOwn, editorContent]
  );
  const hasDraftContent =
    entryCount(sectionedTranscript) > 0 ||
    hasAnswers(templateValues) ||
    notesAreOwn;

  // Delete the server draft immediately when everything in it is cleared, so stale
  // drafts don't reappear on the next visit.
  useEffect(() => {
    if (!hasDraftContent) {
      if (hadDraftContentRef.current) {
        void deleteDraft().catch(err => console.warn("Failed to delete draft:", err));
      }
      hadDraftContentRef.current = false;
      return;
    }

    hadDraftContentRef.current = true;
  }, [hasDraftContent, deleteDraft]);

  // Keep refs in sync so interval/pause handlers always read latest values
  // without restarting the interval on every transcript/formData change.
  useEffect(() => {
    sectionedTranscriptRef.current = sectionedTranscript;
    isDirtyRef.current = true;
  }, [sectionedTranscript]);
  useEffect(() => {
    draftFormRef.current = draftForm;
    isDirtyRef.current = true;
  }, [draftForm]);

  // Answers and notes are saved a moment after the judge stops typing, whether or
  // not they are recording.
  // biome-ignore lint/correctness/useExhaustiveDependencies: each change waits again
  useEffect(() => {
    if (!hasDraftContent || isRecordingActive) return;
    const timer = setTimeout(() => {
      if (!isDirtyRef.current) return;
      isDirtyRef.current = false;
      saveDraftNow("edit");
    }, 2_000);
    return () => clearTimeout(timer);
  }, [draftForm, hasDraftContent, isRecordingActive, saveDraftNow]);

  // Save immediately when recording transitions from active → paused/stopped.
  useEffect(() => {
    if (isRecordingActive) {
      prevIsRecordingRef.current = true;
      return;
    }
    if (!prevIsRecordingRef.current) return;
    prevIsRecordingRef.current = false;

    if (getAutosavePayload() !== null) {
      isDirtyRef.current = false;
      saveDraftNow("pause");
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
  }, [isRecordingActive, saveDraftNow, getAutosavePayload]);

  // Catch transcript content that arrives after recording stopped (Azure SDK
  // finalises the last utterance asynchronously after stopTranscribingAsync).
  useEffect(() => {
    if (!lateFinalisationWindowRef.current) return;
    if (entryCount(sectionedTranscript) === 0) return;
    lateFinalisationWindowRef.current = false;
    isDirtyRef.current = false;
    saveDraftNow("late-finalisation");
  }, [sectionedTranscript, saveDraftNow]);

  // Throttle: save every 10 seconds while actively recording, but only if
  // transcript or formData changed since the last save.
  useEffect(() => {
    if (!isRecordingActive) return;

    const timer = setInterval(() => {
      if (!isDirtyRef.current) return;
      if (getAutosavePayload() !== null) {
        isDirtyRef.current = false;
        saveDraftNow("interval");
      }
    }, 3_000);
    return () => clearInterval(timer);
  }, [isRecordingActive, saveDraftNow, getAutosavePayload]);

  useEffect(() => {
    if (!hasDraftContent) return;
    const handler = (e: BeforeUnloadEvent) => {
      // Switching jurisdiction (DIAAT-332) saved the draft first: nothing is lost.
      if (isLeavingForJurisdictionSwitch()) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasDraftContent]);

  // Blank notes follow the template's sections; notes the judge has written stay.
  const previousDefaultNotesRef = useRef(defaultNotes);
  useEffect(() => {
    const previous = previousDefaultNotesRef.current;
    previousDefaultNotesRef.current = defaultNotes;
    if (previous === defaultNotes || !isBlankNotes(editorContent)) return;
    setEditorContent(defaultNotes);
    setNotesEditorKey((k) => k + 1);
  }, [defaultNotes, editorContent]);

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

  /** The text last copied out (DIAAT-333): clearing is only for what was copied. */
  const copiedTextRef = useRef<string | null>(null);

  /** DIAAT-333: done with this dictation (its text copied out): clear it, and the
   * draft this page saved of it, so it is not offered for restore next time. */
  const handleClearDictation = useCallback(async () => {
    if (isRecordingActive) {
      toast.info("Pause recording before you clear the dictation.");
      return;
    }
    if (dictationText(sectionedTranscript, editorContent) !== copiedTextRef.current) {
      toast.info(
        "You have added to the dictation since you copied it. Copy it again before you clear it."
      );
      return;
    }
    // The draft of this page's dictation, if it had any. Notes alone are never
    // saved, so an earlier draft offered for restore is left for the judge.
    const hadDraft = hadDraftContentRef.current;
    // Deleted once, here, so a failure can be told: not by the emptied-transcript
    // effect as well.
    hadDraftContentRef.current = false;
    copiedTextRef.current = null;
    // The page first, so no save can write it back; then its draft.
    setSectionedTranscript({});
    setRestoredTranscript({});
    setSpeechDemoKey((k) => k + 1);
    setEditorContent(defaultNotes);
    setNotesEditorKey((k) => k + 1);
    setSessionHadFailure(false);
    setSessionHadNoContent(false);
    setPostSessionNoticeDismissed(false);
    if (!hadDraft) return;
    try {
      await deleteDraft();
    } catch {
      toast.error(
        "The dictation is cleared from this page, but its saved copy could not be deleted. If it is offered again, discard it."
      );
    }
  }, [
    isRecordingActive,
    sectionedTranscript,
    editorContent,
    deleteDraft,
    defaultNotes,
  ]);

  // The toast's button outlives the render that showed it: it must judge the page
  // as it is when clicked, not as it was when copied.
  const clearDictationRef = useRef(handleClearDictation);
  useEffect(() => {
    clearDictationRef.current = handleClearDictation;
  }, [handleClearDictation]);

  /** DIAAT-333: the text, to paste into the judge's own document. */
  const handleCopyText = useCallback(async () => {
    const text = dictationText(sectionedTranscript, editorContent);
    if (!text) {
      toast.info("There is nothing to copy yet.");
      return;
    }
    try {
      await copyToClipboard(
        text,
        dictationHtml(sectionedTranscript, editorContent)
      );
      copiedTextRef.current = text;
      toast.success("Copied. Paste it into your document.", {
        description: "When you have, you can clear this dictation.",
        action: {
          label: "Clear dictation",
          onClick: () => void clearDictationRef.current(),
        },
      });
    } catch {
      toast.error("Could not copy. Select the text and copy it instead.");
    }
  }, [sectionedTranscript, editorContent]);

  const handleSubmitHearing = useCallback(async () => {
    // DIAAT-344: the chosen template, filled with the judge's values and their
    // dictation, section by section.
    if (!chosenTemplate) return;
    const answers = { ...templateStart, ...templateValues };
    const missing = missingValues(chosenTemplate, answers);
    setTemplateErrors(missing);
    if (Object.keys(missing).length > 0) {
      toast.error(
        `Please review the highlighted fields: ${Object.values(missing).slice(0, 3).join("; ")}`
      );
      return;
    }
    const buildBody = () =>
      JSON.stringify({
        template_id: chosenTemplate.id,
        values: valuesToSend(chosenTemplate, answers),
        messages: sectionedTranscript,
        notes: normalizeOptionalEditorText(editorContent),
      });

    const submissionPromise = (async () => {
      // OBS-4: the submission's outcome and timing, in the dictation session.
      const submittedAt = Date.now();
      let failedStatus: number | undefined;
      let failureCode: string | undefined;
      let submissionReported = false;
      let dictationSessionId: string | null = null;
      try {
        setIsSubmitting(true);
        const authToken = await getAuthToken();
        dictationSessionId = dictationSessionTelemetry.currentSessionId();

        const body = buildBody();

        let response: Response;
        try {
          response = await fetch("/api/live-transcription/submission", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(authToken && { Authorization: `Bearer ${authToken}` }),
              // DIAAT-322: made in the jurisdiction this tab works in.
              ...jurisdictionHeaders(),
              // Relates this dictation session to the submission, server-side.
              ...(dictationSessionId && { "X-Dictation-Session-Id": dictationSessionId }),
            },
            body,
          });
        } catch (error) {
          failureCode = "network"; // the request itself failed
          throw error;
        }

        if (!response.ok) {
          failedStatus = response.status;
          const errorBody = await response.json().catch(() => null);
          const errorResult =
            submissionErrorResponseSchema.safeParse(errorBody);
          // A refusal with a code (e.g. values that do not fit the template)
          // carries its message inside detail.
          const detailMessage = errorBody?.detail?.message;
          const message = errorResult.success
            ? errorResult.data.error
            : typeof detailMessage === "string" && detailMessage
              ? detailMessage
              : "Failed to save submission.";
          throw new Error(message);
        }

        // A 2xx that is not JSON (e.g. a sign-in page from a proxy) is an
        // invalid response too, not a browser error.
        const responseBody = await response.json().catch(() => undefined);
        const parsedResponse =
          liveTranscriptionSubmissionResponseSchema.safeParse(responseBody);
        if (!parsedResponse.success) {
          failureCode = "submission.invalid_response";
          throw new Error(
            "Submission succeeded but returned an invalid response."
          );
        }
        const data = parsedResponse.data;
        dictationSessionTelemetry.submissionFinished({
          ok: true,
          mode,
          durationMs: Date.now() - submittedAt,
          sessionId: dictationSessionId,
        });
        submissionReported = true;
        dictationSessionTelemetry.sessionEnded("submitted");
        setIsRecordingActive(false);
        // Stop autosave for good first: a pending retry or the flush on leaving
        // the page would otherwise write the submitted transcript back as a
        // draft, to be offered for restore on the next visit.
        await stopDraftSaves();
        await deleteLiveDraft().catch(console.warn);
        router.push("/");
        return data;
      } catch (error) {
        // Not after a reported success (clean-up after it failed instead).
        if (!submissionReported) {
          dictationSessionTelemetry.submissionFinished({
            ok: false,
            status: failedStatus,
            errorCode: failureCode,
            mode,
            durationMs: Date.now() - submittedAt,
            sessionId: dictationSessionId,
          });
        }
        throw error;
      } finally {
        setIsSubmitting(false);
      }
    })();

    submitHearingToast(submissionPromise);
  }, [
    sectionedTranscript,
    router,
    editorContent,
    mode,
    stopDraftSaves,
    chosenTemplate,
    templateStart,
    templateValues,
  ]);

  // Only "healthy" counts as recording. `isRecordingActive` is intent; a
  // session can be collapsing behind it.
  const isCapturingSpeechNow = Boolean(
    isRecordingActive && speechReport?.isCapturing
  );

  // Live warnings clear with the session, so remember that this one went wrong.
  // See SPEECH_FAILED_EARLIER_ALERT: the incident ended with the judge pausing,
  // seeing a clean screen, and submitting three empty sections.
  useEffect(() => {
    const kind = speechReport?.alert?.kind;
    if (kind === "speech-failed" || kind === "speech-recovering") {
      setSessionHadFailure(true);
    }
    if (kind === "speech-no-content") {
      setSessionHadNoContent(true);
    }
  }, [speechReport?.alert]);
  useEffect(() => {
    if (!isRecordingActive) return;
    setSessionHadFailure(false);
    setSessionHadNoContent(false);
    setPostSessionNoticeDismissed(false);
  }, [isRecordingActive]);
  const transcriptIsEmpty = entryCount(sectionedTranscript) === 0;
  const showPostSessionNotice = !isRecordingActive && !postSessionNoticeDismissed;

  // One banner for the whole page. DIAAT-296 adds its autosave alerts to this
  // list rather than rendering a second banner.
  const recordAlert = selectMostSevereAlert([
    speechReport?.alert,
    describeAutosaveAlert({
      state: autosaveState,
      recordName: wording("autosave.record_name"),
    }),
    restoreFailureAlert,
    draftExpiryAlert,
    sessionHadFailure && showPostSessionNotice
      ? SPEECH_FAILED_EARLIER_ALERT
      : null,
    // Only while the transcript is still empty: speech that came through after
    // the warning answers it.
    sessionHadNoContent && transcriptIsEmpty && showPostSessionNotice
      ? SPEECH_NO_CONTENT_EARLIER_ALERT
      : null,
  ]);
  const dismissRecordAlert = (() => {
    switch (recordAlert?.kind) {
      case "speech-failed-earlier":
      case "speech-no-content-earlier":
        return () => setPostSessionNoticeDismissed(true);
      case "draft-restore-failed":
        return () => setRestoreFailureAlert(null);
      case "draft-expiring":
        return () => setDraftExpiryAlert(null);
      default:
        return speechReport?.dismissAlert;
    }
  })();

  // Put the alarm in the tab title too. A judge who has switched to the bundle
  // or to another window would otherwise see nothing at all.
  const isSpeechAlert =
    recordAlert?.kind === "speech-failed" ||
    recordAlert?.kind === "speech-recovering" ||
    recordAlert?.kind === "speech-no-content";
  const originalTitleRef = useRef<string | null>(null);
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (originalTitleRef.current === null) {
      originalTitleRef.current = document.title;
    }
    const original = originalTitleRef.current;
    document.title = isSpeechAlert
      ? "\u26a0 NOT RECORDING \u2014 check now"
      : original;
    return () => {
      document.title = original;
    };
  }, [isSpeechAlert]);

  const speechStatusLabel = useMemo(() => {
    if (!isRecordingActive) return null;
    switch (speechReport?.session.health) {
      case "healthy":
        return "Recording";
      case "starting":
        return "Connecting\u2026";
      case "recovering":
        return "Reconnecting \u2014 not recording";
      case "failed":
        return "Not recording";
      default:
        return "Starting\u2026";
    }
  }, [isRecordingActive, speechReport?.session.health]);

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
      className="inline-flex h-10 max-w-full overflow-x-auto rounded-md border border-border bg-muted p-1"
    >
      {sections.map(({ tag: section }) => {
        return (
          <button
            key={section}
            type="button"
            aria-pressed={activeSection === section}
            onClick={() => setPickedSection(section)}
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
                sectionColor(sections, section),
                activeSection === section ? "animate-pulse" : "opacity-60"
              )}
            />
            <span className="truncate font-medium">
              {sectionLabel(sections, section)}
            </span>
          </button>
        );
      })}
    </div>
  );

  const saveStatus = describeSaveStatus({
    state: autosaveState,
    hasContent: hasDraftContent,
  });

  const recordingControl = (
    <div className="flex items-center gap-2 sm:gap-3">
      <div className="flex size-8 shrink-0 items-center justify-center">
        {/* Driven by whether speech is actually being captured, never by
            intent alone â€” the struck-through mic is the honest state while the
            SDK session is down (DIAAT-297). */}
        <AnimatedMicrophone size={28} isActive={isCapturingSpeechNow} />
      </div>
      <Button
        onClick={() => setIsRecordingActive((active) => !active)}
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
      {/* Capture state and save state are one row and one live region: they
          answer a single question between them, and DIAAT-296 asked for the
          "last saved at" to sit with the DIAAT-297 capture status rather than
          becoming a second widget. */}
      <RecordStatusRow
        speechLabel={speechStatusLabel}
        isCapturing={isCapturingSpeechNow}
        saveStatus={saveStatus}
      />
    </div>
  );

  // The chosen template's form (DIAAT-344).
  const hearingForm = chosenTemplate ? (
    <TemplateForm
      templates={templates}
      templateId={chosenTemplate.id}
      onTemplateChange={(id) => {
        // Another template's fields differ: its answers start empty.
        if (
          hasAnswers(templateValues) &&
          !window.confirm(
            "Choose another template? Your answers to this one will be cleared."
          )
        )
          return;
        setTemplateId(id);
        setTemplateValues({});
        setTemplateErrors({});
      }}
      values={templateValues}
      startingValues={templateStart}
      onValuesChange={setTemplateValues}
      errors={templateErrors}
      onClear={() => {
        setTemplateValues({});
        setTemplateErrors({});
      }}
    />
  ) : null;

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
        {/* First child of the page shell and outside every scroll container,
            so it is always on screen while something is wrong. */}
        <RecordAlertBanner
          alert={recordAlert}
          onDismiss={dismissRecordAlert}
          className="shrink-0"
        />
        <footer className="order-last border-t border-border bg-background">
          <div className="mx-auto flex w-full max-w-[1280px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              {recordingControl}

              {layoutMode !== "mobile" && hasSections && (
                <div className="shrink-0">{sectionTabs}</div>
              )}

              {layoutMode === "mobile" && (
                <Tabs
                  value={activeView}
                  onValueChange={handleWorkspaceViewChange}
                >
                  <TabsList className="inline-flex h-10 rounded-md border border-border bg-background">
                    {hasHearingForm && (
                      <TabsTrigger
                        value="form"
                        className="px-3 text-xs sm:text-sm"
                      >
                        Form
                      </TabsTrigger>
                    )}
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

              {layoutMode === "mobile" &&
                activeView === "transcript" &&
                hasSections && (
                  <div className="shrink-0">{sectionTabs}</div>
                )}
            </div>

            <div className="flex items-center gap-2">
              {hasHearingForm ? (
                <Button
                  onClick={handleSubmitHearing}
                  disabled={isSubmitting}
                  size="sm"
                >
                  {isSubmitting ? "Submitting..." : "Submit hearing"}
                </Button>
              ) : (
                <Button onClick={handleCopyText} size="sm">
                  <Copy className="size-4" />
                  Copy text
                </Button>
              )}
            </div>
          </div>
        </footer>
        <main id="main-content" className="relative min-h-0 min-w-0 flex-1 bg-background">
          <div className="flex h-full w-full justify-center overflow-hidden">
            <div className="h-full w-full max-w-[1280px] min-w-0">
              {layoutMode === "wide" && (
                <div
                  className={cn(
                    "grid h-full min-h-0 min-w-0",
                    hasHearingForm
                      ? "grid-cols-[360px_minmax(0,1fr)] xl:grid-cols-[420px_minmax(0,1fr)] 2xl:grid-cols-[480px_minmax(0,1fr)]"
                      : "grid-cols-1"
                  )}
                >
                  {hasHearingForm && (
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
                          {hearingForm}
                        </div>
                      </div>
                    </aside>
                  )}

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
                            key={notesEditorKey}
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
                              initialSectionedTranscript={restoredTranscript}
                              headerSubtitle={recordingModeDescription}
                              recordingActive={isRecordingActive}
                              activeSection={activeSection}
                              sections={sections}
                              onTranscriptChange={setSectionedTranscript}
                              onSpeechSessionChange={setSpeechReport}
                              showSectionNames={hasSections}
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
                  {hasHearingForm && (
                    <section
                      className={
                        activeView === "form" ? "h-full" : "hidden h-full"
                      }
                    >
                      <div className="h-full overflow-y-auto px-4 py-6">
                        {hearingForm}
                      </div>
                    </section>
                  )}

                  <section
                    className={
                      activeView === "tiptap" ? "h-full" : "hidden h-full"
                    }
                  >
                    <div className="h-full overflow-y-auto px-4 py-6">
                      <SimpleEditor
                        key={notesEditorKey}
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
                        initialSectionedTranscript={restoredTranscript}
                        headerSubtitle={recordingModeDescription}
                        recordingActive={isRecordingActive}
                        activeSection={activeSection}
                        sections={sections}
                        onTranscriptChange={setSectionedTranscript}
                        onSpeechSessionChange={setSpeechReport}
                        showSectionNames={hasSections}
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
