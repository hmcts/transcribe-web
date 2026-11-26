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
import DictationForm from "@/components/audio/dictation/dictation-form";
import {
  asksForLegalIssues,
  type DictationFormValues,
  defaultFormValues,
  getDictationFormSchema,
} from "@/components/audio/dictation/formData";
import {
  type DictationSection,
  fitTranscript,
  IAC_SECTIONS,
  SECTION_COLORS,
  type SectionedTranscript,
  SINGLE_SECTION,
  type SpeechSessionReport,
  sectionEntries,
  type TranscriptSection,
  transcriptSize,
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
import {
  SUBMISSION_CONTENT_TYPE,
  SUBMISSION_PATH,
} from "@/lib/dictation-submission";
import { IAC_CODE } from "@/lib/jurisdiction-context";
import { jurisdictionHeaders } from "@/lib/jurisdiction-session";
import {
  isLeavingForJurisdictionSwitch,
  JurisdictionSwitchError,
  onBeforeJurisdictionSwitch,
} from "@/lib/jurisdiction-switch";
import { deleteLiveDraft, getLiveDraft } from "@/lib/live-draft-api";
import { LiveDraftError, liveDraftFailureKind } from "@/lib/live-draft-errors";
import {
  dictationSessionTelemetry,
  trackDictationPage,
} from "@/lib/dictation-session";
import { liveDraftTelemetry } from "@/lib/live-draft-telemetry";
import {
  type DraftTemplate,
  draftFormData,
  fitToTemplate,
  fromDraftFormData,
  hasTranscript,
  hasWork,
  type RecordDraftWork,
} from "@/lib/record-draft";
import { fetchUserDocumentContent } from "@/lib/document-content-api";
import { DECISIONS_HREF } from "@/lib/navigation";
import {
  contentForJurisdiction,
  type DocumentContent,
  liveTranscriptionSubmissionPayloadSchema,
  liveTranscriptionSubmissionPayloadWithoutLegalIssuesSchema,
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
import cn, { getJudgeNameFromEmail } from "@/lib/utils";
import { useLeaveGuard } from "@/hooks/use-leave-guard";
import { TemplateForm } from "@/components/audio/dictation/template-form";
import {
  type AvailableTemplate,
  fetchAvailableTemplates,
  fetchTemplateRevision,
  hasAnswers,
  missingValues,
  ownValue,
  TemplateRefusedError,
  type TemplateValues,
  valuesToSend,
  withPrefills,
} from "@/lib/templates-api";

const TEMPLATES_FAILED_TOAST = "templates-failed";
const RESTORED_TEMPLATE_GONE_TOAST = "restored-template-gone";
const STARTED_TEMPLATE_TOAST = "started-template";
/** How soon after the judge stops typing their hearing details or notes the
 * draft is saved (DIAAT-414); while recording, the 3-second interval saves. */
const EDIT_SAVE_DELAY_MS = 1_000;
const LEAVE_BEFORE_RESTORE =
  "Leave this page? What you have entered is not saved until you restore or discard the unsaved work found from earlier.";
/** Whether the page may save its work over the draft on the server (DIAAT-414):
 * not while the lookup for an earlier draft is unanswered, nor while that draft
 * is offered for restore. */
type DraftLookup = "pending" | "offered" | "settled";
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

const EMPTY_SECTIONED_TRANSCRIPT: SectionedTranscript = {
  background: [],
  evidence: [],
  facts: [],
};

const DEFAULT_NOTES_EDITOR_CONTENT =
  "<h3>Background</h3><ul><li><p></p></li></ul><h3>Evidence</h3><ul><li><p></p></li></ul><h3>Facts</h3><ul><li><p></p></li></ul>";
/** DIAAT-333: blank notes where there is no decision template to section them. */
const GENERAL_NOTES_EDITOR_CONTENT = "<p></p>";

const RECORD_NOTES_EDITOR_ID = "record-notes-editor";
const RECORD_TRANSCRIPT_TAB_ID = "record-transcript-tab";
const RECORD_NOTES_TAB_ID = "record-notes-tab";
const RECORD_TRANSCRIPT_PANEL_ID = "record-transcript-panel";
const RECORD_NOTES_PANEL_ID = "record-notes-panel";

export default function RecordPage() {
  // DIAAT-333: without the decision template, the judge dictates into the general
  // section and copies the text out: no hearing form, no section tabs, no
  // submission. Unless (DIAAT-344) the jurisdiction has uploaded templates: then
  // the chosen one's form, and a submission, but still no IAC sections.
  const { current, wording, hasDecisionTemplate } = useJurisdiction();
  const jurisdictionCode = current?.code;
  const jurisdictionName = current?.name;
  const defaultNotes = hasDecisionTemplate
    ? DEFAULT_NOTES_EDITOR_CONTENT
    : GENERAL_NOTES_EDITOR_CONTENT;
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
  const [activeSection, setActiveSection] =
    useState<TranscriptSection>("background");
  const [activeView, setActiveView] = useState<RecordView>(
    hasDecisionTemplate ? "form" : "transcript"
  );
  const [formData, setFormData] =
    useState<DictationFormValues>(defaultFormValues);
  const [fetched, setFetched] = useState<{
    code: string | undefined;
    content: DocumentContent;
  }>();
  // DIAAT-342: only this jurisdiction's wording, and the IAC's shipped legal
  // issues only for the IAC; with no legal wording the form has no legal issues.
  const documentContent =
    fetched?.code === jurisdictionCode
      ? contentForJurisdiction(fetched?.content, jurisdictionCode)
      : undefined;
  const legalIssuesFallback = jurisdictionCode === IAC_CODE;
  const asksLegalIssues = asksForLegalIssues(
    documentContent,
    legalIssuesFallback
  );
  // Another jurisdiction's wording is not guessed: until its own has loaded (or
  // when it could not), a hearing is not submitted, since whether it has legal
  // issues to ask for is not yet known.
  const [contentFailed, setContentFailed] = useState(false);
  const legalWordingPending =
    hasDecisionTemplate && !legalIssuesFallback && !documentContent;
  // DIAAT-344: a jurisdiction without the decision template may have uploaded
  // templates; the judge chooses one and fills its own Hearing Details form.
  const [templates, setTemplates] = useState<AvailableTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [templateValues, setTemplateValues] = useState<TemplateValues>({});
  // DIAAT-340: fields that start with the judge's name, as the IAC's form does.
  const { user } = useUserSettings();
  const judgeName = user?.email ? getJudgeNameFromEmail(user.email) : "";
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  // DIAAT-414: a restored template's answers, as saved, until the templates have
  // loaded and they are fitted to it; or, if it is no longer offered, until the
  // judge answers another. Meanwhile the draft keeps them as they were.
  const [restoredTemplate, setRestoredTemplate] =
    useState<DraftTemplate | null>(null);
  // DIAAT-339: a restored draft's template as it was started with, once it has
  // changed or been switched off: offered in its place (or as well) for this draft
  // alone, until the judge chooses another.
  const [startedTemplate, setStartedTemplate] =
    useState<AvailableTemplate | null>(null);
  // While that version loads, or after it could not be loaded: the form waits for
  // it, so nothing is answered or submitted with another version meanwhile.
  const [startedPending, setStartedPending] = useState<
    "loading" | "failed" | null
  >(null);
  const [templateErrors, setTemplateErrors] = useState<Record<string, string>>(
    {}
  );
  const choosableTemplates = useMemo(() => {
    if (!startedTemplate) return templates;
    return templates.some((t) => t.id === startedTemplate.id)
      ? templates.map((t) =>
          t.id === startedTemplate.id ? startedTemplate : t
        )
      : [startedTemplate, ...templates];
  }, [templates, startedTemplate]);
  const chosenTemplate =
    choosableTemplates.find((t) => t.id === templateId) ??
    choosableTemplates[0] ??
    null;
  // DIAAT-339: also while a restored draft's template loads, which may be one no
  // longer offered: its status shows where Hearing details goes.
  const hasTemplateForm =
    !hasDecisionTemplate &&
    (chosenTemplate !== null || startedPending !== null);
  // A form to fill and a hearing to submit, rather than text to copy out.
  const hasHearingForm = hasDecisionTemplate || hasTemplateForm;
  // DIAAT-416: the sections the judge dictates into: the IAC decision's, or an
  // uploaded template's dictated boxes when it has several, each by its box (so it
  // keeps its dictation if the admin reorders them); else one, as before. What is
  // dictated before the templates load joins the first (fitTranscript).
  const templateSections = hasTemplateForm
    ? chosenTemplate?.sections
    : undefined;
  const [restoredTranscript, setRestoredTranscript] = useState<
    SectionedTranscript | undefined
  >();
  const dictationSections = useMemo<DictationSection[]>(() => {
    if (hasDecisionTemplate) return IAC_SECTIONS;
    // DIAAT-339: while the draft's template version loads (or could not be
    // loaded), the sections its dictation was kept in, so nothing is moved out of
    // them meanwhile. Named by their boxes until the template has loaded.
    const kept = startedPending
      ? Object.keys(restoredTranscript ?? {}).filter((key) =>
          key.startsWith("box:")
        )
      : [];
    if (kept.length > 0) {
      return kept.map((key, index) => ({
        key,
        label: key.slice("box:".length),
        color: SECTION_COLORS[index % SECTION_COLORS.length],
      }));
    }
    if (!templateSections || templateSections.length < 2) return SINGLE_SECTION;
    return templateSections.map((section, index) => ({
      key: `box:${section.tag}`,
      label: section.label,
      color: SECTION_COLORS[index % SECTION_COLORS.length],
    }));
  }, [
    hasDecisionTemplate,
    templateSections,
    startedPending,
    restoredTranscript,
  ]);
  const hasSectionChoice = dictationSections.length > 1;
  const [sectionedTranscript, setSectionedTranscript] =
    useState<SectionedTranscript>(EMPTY_SECTIONED_TRANSCRIPT);
  // What was dictated in the page's sections, for copying out and submitting:
  // anything kept under another section (a draft from before the template
  // changed, say) joins the first rather than being left out.
  const fittedTranscript = useMemo(
    () => fitTranscript(sectionedTranscript, dictationSections),
    [sectionedTranscript, dictationSections]
  );
  // The section dictated into is one of the page's: its first when they change.
  useEffect(() => {
    if (!dictationSections.some((section) => section.key === activeSection)) {
      setActiveSection(dictationSections[0].key);
    }
  }, [dictationSections, activeSection]);
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
  // DIAAT-296: a restore lookup that failed is not the same fact as "you have
  // no draft", and the two must never look alike on screen again.
  const [restoreFailureAlert, setRestoreFailureAlert] =
    useState<RecordAlert | null>(null);
  const [draftExpiryAlert, setDraftExpiryAlert] = useState<RecordAlert | null>(
    null
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState<
    Partial<Record<keyof DictationFormValues, string>>
  >({});
  const [editorContent, setEditorContent] = useState(defaultNotes);
  const formScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const restoreToastIdRef = useRef<string | number | undefined>(undefined);
  // State for what the page shows and does, the ref for the save and switch
  // handlers; set together.
  const [draftLookup, setDraftLookupState] = useState<DraftLookup>("pending");
  const draftLookupRef = useRef<DraftLookup>("pending");
  const setDraftLookup = useCallback((next: DraftLookup) => {
    draftLookupRef.current = next;
    setDraftLookupState(next);
  }, []);
  const draftSettled = draftLookup === "settled";
  const hadDraftContentRef = useRef(false);
  // DIAAT-414: everything of the judge's the draft keeps. The template answers
  // are the restored ones while those are not yet fitted to their template.
  const chosenTemplateId = chosenTemplate?.id ?? null;
  const chosenTemplateRevision = chosenTemplate?.revision;
  const work = useMemo<RecordDraftWork>(() => {
    const template: DraftTemplate | null = hasDecisionTemplate
      ? null
      : (restoredTemplate ??
        (chosenTemplateId === null
          ? null
          : {
              id: chosenTemplateId,
              values: templateValues,
              revision: chosenTemplateRevision,
            }));
    return {
      transcript: sectionedTranscript,
      formData,
      notes: editorContent,
      defaultNotes,
      templateId: template?.id ?? null,
      templateValues: template?.values ?? {},
      templateRevision: template?.revision,
    };
  }, [
    sectionedTranscript,
    formData,
    editorContent,
    defaultNotes,
    hasDecisionTemplate,
    restoredTemplate,
    chosenTemplateId,
    chosenTemplateRevision,
    templateValues,
  ]);
  const pageHasWork = hasWork(work);
  const workRef = useRef(work);
  const prevIsRecordingRef = useRef(false);
  const isDirtyRef = useRef(false);
  // True for 2s after recording stops — lets us catch transcript content
  // that arrives late from the Azure SDK's async finalisation.
  const lateFinalisationWindowRef = useRef(false);
  const isSmUp = useMediaQuery("(min-width: 640px)");

  /**
   * The current draft, or null when there is nothing worth saving.
   *
   * DIAAT-414: the draft holds all of the judge's work: the transcript, the
   * hearing details, the notes and a template's answers, so none is lost when
   * they leave the page or switch jurisdiction. An earlier draft is not written
   * over until the lookup for it has answered and, if one was found, the judge
   * restores or discards it (or starts recording, which leaves it behind, as
   * before).
   */
  const getAutosavePayload = useCallback(() => {
    const current = workRef.current;
    if (draftLookupRef.current !== "settled" || !hasWork(current)) return null;
    return { transcript: current.transcript, formData: draftFormData(current) };
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
  // DIAAT-414: the draft holds all of the judge's work, so the switch saves it
  // and goes ahead. Only work typed before an earlier draft is answered for is
  // not saved (it would write over that draft): the switch waits for the lookup,
  // and for the judge to restore or discard a draft it found.
  useEffect(
    () =>
      onBeforeJurisdictionSwitch(async () => {
        const checkNothingIsLost = () => {
          if (isSubmittingRef.current) throw new JurisdictionSwitchError("busy");
          const lookup = draftLookupRef.current;
          if (lookup !== "settled" && hasWork(workRef.current)) {
            throw new JurisdictionSwitchError(
              lookup === "offered" ? "restore_pending" : "busy"
            );
          }
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
    if (hasDecisionTemplate) {
      setTemplates([]);
      return;
    }
    const request = ++templatesRequest.current;
    try {
      const list = await fetchAvailableTemplates();
      if (request !== templatesRequest.current) return;
      toast.dismiss(TEMPLATES_FAILED_TOAST);
      setTemplates(list);
      setTemplateId((id) =>
        list.some((t) => t.id === id) ? id : (list[0]?.id ?? "")
      );
      setTemplatesLoaded(true);
    } catch (error) {
      if (request !== templatesRequest.current) return;
      // An API from before DIAAT-344 has no templates: the page works as before,
      // dictate and copy the text out.
      if (error instanceof TemplateRefusedError && error.status === 404) {
        setTemplatesLoaded(true);
        return;
      }
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
  }, [hasDecisionTemplate]);

  useEffect(() => {
    void loadTemplates();
    return () => {
      // A switch of jurisdiction reloads the page (providers/jurisdiction.tsx).
      templatesRequest.current += 1;
    };
  }, [loadTemplates]);

  const contentRequest = useRef(0);
  const loadContent = useCallback(async () => {
    // The hearing form's options: the decision template's alone.
    if (!hasDecisionTemplate) return;
    const request = ++contentRequest.current;
    setContentFailed(false);
    try {
      const content = await fetchUserDocumentContent();
      if (request === contentRequest.current) {
        setFetched({ code: jurisdictionCode, content });
      }
    } catch (error) {
      console.error("Failed to load document content", error);
      if (request === contentRequest.current) setContentFailed(true);
    }
  }, [hasDecisionTemplate, jurisdictionCode]);

  useEffect(() => {
    void loadContent();
    return () => {
      // An answer still on its way is for a jurisdiction (or page) left behind.
      contentRequest.current += 1;
    };
  }, [loadContent]);

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

  // When the user starts a new recording, the restore offer is no longer relevant:
  // the recording is saved over the earlier draft, as before DIAAT-414.
  useEffect(() => {
    if (!isRecordingActive) return;
    if (restoreToastIdRef.current !== undefined) {
      toast.dismiss(restoreToastIdRef.current);
      restoreToastIdRef.current = undefined;
    }
    setDraftLookup("settled");
  }, [isRecordingActive, setDraftLookup]);

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
        if (cancelled) return;
        // None, or a recording started meanwhile and is saved over it.
        if (!draft || draftLookupRef.current === "settled") {
          setDraftLookup("settled");
          return;
        }
        // The backend hard-deletes a draft 24h after its last save, on read.
        // A judge who cannot get back in within a day loses the work
        // permanently, so say so while it can still be acted on (DIAAT-296).
        setDraftExpiryAlert(
          describeDraftExpiryAlert({ savedAt: draft.saved_at, now: Date.now() })
        );
        const found = hasTranscript(draft.transcript) ? "Unsaved transcript" : "Unsaved work";
        /** The offer is answered: closed, and the page's own work saved from now. */
        const closeOffer = () => {
          if (restoreToastIdRef.current !== undefined) toast.dismiss(restoreToastIdRef.current);
          restoreToastIdRef.current = undefined;
          setDraftLookup("settled");
        };
        setDraftLookup("offered");
        restoreToastIdRef.current = toast(
          `${found} found from ${formatDraftDate(draft.saved_at)}`,
          {
            action: {
              label: "Restore",
              onClick: () => {
                closeOffer();
                const restored = fromDraftFormData(draft.form_data);
                setSectionedTranscript(draft.transcript);
                setFormData(restored.formData);
                setRestoredTranscript(draft.transcript);
                setSpeechDemoKey(k => k + 1);
                if (restored.notes !== null) {
                  setEditorContent(restored.notes);
                  setNotesEditorKey(k => k + 1);
                }
                // Fitted to its template once the templates have loaded (below).
                if (restored.template) setRestoredTemplate(restored.template);
                // Only now has a draft been restored (not when one was found).
                liveDraftTelemetry.restoreSucceeded();
              },
            },
            cancel: {
              label: "Discard",
              onClick: () => {
                // What was typed while the draft was offered is saved once it
                // is deleted: saves wait for the delete.
                closeOffer();
                void deleteDraft().catch(console.warn);
              },
            },
            // Swiped away: no longer offered, so the page's own work is saved.
            onDismiss: closeOffer,
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
        // Whether there is an earlier draft is not known: the judge's work is
        // saved rather than held back with nothing to answer.
        setDraftLookup("settled");
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
  }, [deleteDraft, setDraftLookup]);

  // DIAAT-414: restored answers are fitted to their template, once the templates
  // have loaded: only answers its form can show and the API takes. DIAAT-339: the
  // template as the draft started with it, even if it has changed or been switched
  // off since; else (a draft from before then, or a version the API no longer
  // gives) as it is now.
  useEffect(() => {
    if (!restoredTemplate || !templatesLoaded) return;
    const restored = restoredTemplate;
    const listed = templates.find((t) => t.id === restored.id);
    const answerWith = (template: AvailableTemplate) => {
      setTemplateId(template.id);
      setTemplateValues(fitToTemplate(template, restored.values));
      setRestoredTemplate(null);
    };
    const asItIsNow = () => {
      if (!listed && !hasAnswers(restored.values)) {
        // Only its dictation was kept: that is in the first section now.
        setRestoredTemplate(null);
        return;
      }
      if (!listed) {
        toast.info(
          "The template your saved answers were for is no longer offered. They stay saved until you answer another template.",
          { id: RESTORED_TEMPLATE_GONE_TOAST }
        );
        return;
      }
      answerWith(listed);
    };
    // The listed one is the version it started with; or an API with no versions.
    if (
      !restored.revision ||
      (listed && (!listed.revision || listed.revision === restored.revision))
    ) {
      asItIsNow();
      return;
    }
    const revision = restored.revision;
    let cancelled = false;
    setStartedPending("loading");
    fetchTemplateRevision(restored.id, revision).then(
      (fetched) => {
        if (cancelled) return;
        const started = { ...fetched, revision: fetched.revision ?? revision };
        setStartedPending(null);
        setStartedTemplate(started);
        answerWith(started);
        toast.info(
          listed
            ? `${started.name} has changed since you started this draft. It keeps the version you started with.`
            : `${started.name} is no longer offered for new documents. You can still finish this draft with it.`,
          { id: STARTED_TEMPLATE_TOAST }
        );
      },
      (error) => {
        if (cancelled) return;
        if (error instanceof TemplateRefusedError && error.status === 404) {
          setStartedPending(null);
          // Not a version the judge may use (or an API with none): as it is now.
          asItIsNow();
          return;
        }
        // Not known: the draft keeps its version and answers until it loads.
        setStartedPending("failed");
        console.error("The draft's template version could not be loaded", error);
        toast.error(
          "The template this draft was started with could not be loaded, so Hearing details is not shown.",
          {
            id: STARTED_TEMPLATE_TOAST,
            duration: Number.POSITIVE_INFINITY,
            action: {
              label: "Try again",
              onClick: () => setRestoredTemplate({ ...restored }),
            },
          }
        );
      }
    );
    return () => {
      cancelled = true;
    };
  }, [restoredTemplate, templatesLoaded, templates]);

  // Delete the server draft as soon as the page holds nothing of the judge's
  // (the transcript cleared, the hearing details reset), so stale drafts don't
  // reappear on the next visit.
  useEffect(() => {
    if (!pageHasWork) {
      if (hadDraftContentRef.current) {
        void deleteDraft().catch(err => console.warn("Failed to delete draft:", err));
      }
      hadDraftContentRef.current = false;
      return;
    }
    // Not before an earlier draft is answered for: this page's work is not saved
    // over it until then.
    if (draftSettled) hadDraftContentRef.current = true;
  }, [pageHasWork, draftSettled, deleteDraft]);

  // Keep the ref in sync so interval/pause handlers always read latest values
  // without restarting the interval on every change.
  useEffect(() => {
    workRef.current = work;
    isDirtyRef.current = true;
  }, [work]);

  // DIAAT-414: the page's work is saved shortly after it last changed (typed,
  // or a transcript edited while paused), as the transcript is while recording.
  const editSavePendingRef = useRef(false);
  useEffect(() => {
    editSavePendingRef.current = false;
    // While recording the interval below saves; until an earlier draft is
    // answered for, nothing is saved over it.
    if (isRecordingActive || !draftSettled) return;
    if (!isDirtyRef.current || !hasWork(work)) return;
    editSavePendingRef.current = true;
    const timer = setTimeout(() => {
      editSavePendingRef.current = false;
      if (!isDirtyRef.current || getAutosavePayload() === null) return;
      isDirtyRef.current = false;
      saveDraftNow("interval");
    }, EDIT_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [work, isRecordingActive, draftSettled, getAutosavePayload, saveDraftNow]);
  // The page left (in the app) before that moment had passed: saved as it closes.
  useEffect(
    () => () => {
      if (editSavePendingRef.current) saveDraftNow("interval");
    },
    [saveDraftNow]
  );

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
  }, [isRecordingActive, getAutosavePayload, saveDraftNow]);

  // Catch transcript content that arrives after recording stopped (Azure SDK
  // finalises the last utterance asynchronously after stopTranscribingAsync).
  useEffect(() => {
    if (!lateFinalisationWindowRef.current) return;
    if (transcriptSize(sectionedTranscript) === 0) return;
    lateFinalisationWindowRef.current = false;
    isDirtyRef.current = false;
    saveDraftNow("late-finalisation");
  }, [sectionedTranscript, saveDraftNow]);

  // Throttle: save every 10 seconds while actively recording, but only if
  // transcript or formData changed since the last save.
  useEffect(() => {
    if (!isRecordingActive) return;

    const timer = setInterval(() => {
      if (!isDirtyRef.current || getAutosavePayload() === null) return;
      isDirtyRef.current = false;
      saveDraftNow("interval");
    }, 3_000);
    return () => clearInterval(timer);
  }, [isRecordingActive, getAutosavePayload, saveDraftNow]);

  // Closing the tab could cut off a save still to be made, so the browser asks.
  // Leaving the page in the app needs no asking: the draft is saved as it goes,
  // and once more as the page closes (DIAAT-414).
  useEffect(() => {
    if (!pageHasWork) return;
    const handler = (e: BeforeUnloadEvent) => {
      // Switching jurisdiction (DIAAT-332) saved the draft first: nothing is lost.
      if (isLeavingForJurisdictionSwitch()) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [pageHasWork]);

  // Until an earlier draft is restored or discarded, what is typed is not saved
  // (it would be saved over that draft): a link in the app asks first. Not Back:
  // its guard entry would outlive this short wait, and the recording's own.
  useLeaveGuard(!draftSettled && pageHasWork, LEAVE_BEFORE_RESTORE, {
    history: false,
  });

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
    if (dictationText(fittedTranscript, editorContent) !== copiedTextRef.current) {
      toast.info(
        "You have added to the dictation since you copied it. Copy it again before you clear it."
      );
      return;
    }
    // The draft of this page's dictation, if it had any. An earlier draft still
    // offered for restore is left for the judge.
    const hadDraft = hadDraftContentRef.current;
    // Deleted once, here, so a failure can be told: not by the emptied-transcript
    // effect as well.
    hadDraftContentRef.current = false;
    copiedTextRef.current = null;
    // The page first, so no save can write it back; then its draft.
    setSectionedTranscript(EMPTY_SECTIONED_TRANSCRIPT);
    setRestoredTranscript(EMPTY_SECTIONED_TRANSCRIPT);
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
    fittedTranscript,
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
    const text = dictationText(fittedTranscript, editorContent);
    if (!text) {
      toast.info("There is nothing to copy yet.");
      return;
    }
    try {
      await copyToClipboard(
        text,
        dictationHtml(fittedTranscript, editorContent)
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
  }, [fittedTranscript, editorContent]);

  const handleSubmitHearing = useCallback(async () => {
    let buildBody: () => string;
    if (!hasDecisionTemplate) {
      // DIAAT-344: the chosen template, filled with the judge's values. Not while
      // a restored draft's answers wait for their template (DIAAT-339).
      if (startedPending) {
        toast.error(
          "Hearing details are not ready yet: wait for the draft's template to load, then submit again."
        );
        return;
      }
      if (!chosenTemplate) return;
      const answers = withPrefills(chosenTemplate, templateValues, judgeName);
      const missing = missingValues(chosenTemplate, answers);
      setTemplateErrors(missing);
      if (Object.keys(missing).length > 0) {
        toast.error(
          `Please review the highlighted fields: ${Object.values(missing).slice(0, 3).join("; ")}`
        );
        return;
      }
      // DIAAT-416: with several sections, each one's dictation by its box, so it
      // goes in that box alone; and all of it, in order, as before.
      const sectionsByBox =
        hasSectionChoice && templateSections
          ? Object.fromEntries(
              templateSections.map((section, index) => [
                section.tag,
                sectionEntries(fittedTranscript, dictationSections[index].key),
              ])
            )
          : undefined;
      buildBody = () =>
        JSON.stringify({
          template_id: chosenTemplate.id,
          // DIAAT-339: the version the work was started with makes the document.
          ...(chosenTemplate.revision && {
            template_revision: chosenTemplate.revision,
          }),
          values: valuesToSend(chosenTemplate, answers),
          messages: {
            background: dictationSections.flatMap((section) =>
              sectionEntries(fittedTranscript, section.key)
            ),
          },
          ...(sectionsByBox && { sections: sectionsByBox }),
          notes: normalizeOptionalEditorText(editorContent),
        });
    } else {
      if (legalWordingPending) {
        toast.error(
          contentFailed
            ? `Legal wording for ${jurisdictionName ?? "this jurisdiction"} could not be loaded, reload and try again.`
            : `Legal wording for ${jurisdictionName ?? "this jurisdiction"} hasn't loaded yet, reload and try again.`,
          { action: { label: "Try again", onClick: () => void loadContent() } }
        );
        return;
      }
      const validation = getDictationFormSchema(asksLegalIssues).safeParse(formData);
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
      const formValues = validation.data;
      buildBody = () =>
        JSON.stringify(
          (asksLegalIssues
            ? liveTranscriptionSubmissionPayloadSchema
            : liveTranscriptionSubmissionPayloadWithoutLegalIssuesSchema
          ).parse({
            // No legal issues where there is no legal wording, whatever a
            // restored draft still carries.
            form_data: asksLegalIssues
              ? formValues
              : { ...formValues, legalIssues: [] },
            messages: fittedTranscript,
            notes: normalizeOptionalEditorText(editorContent),
          })
        );
    }

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
          response = await fetch(SUBMISSION_PATH, {
            method: "POST",
            headers: {
              // Not application/json: see SUBMISSION_CONTENT_TYPE.
              "Content-Type": SUBMISSION_CONTENT_TYPE,
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
        router.push(DECISIONS_HREF);
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
    formData,
    fittedTranscript,
    dictationSections,
    hasSectionChoice,
    templateSections,
    router,
    editorContent,
    mode,
    stopDraftSaves,
    asksLegalIssues,
    legalWordingPending,
    contentFailed,
    jurisdictionName,
    loadContent,
    hasDecisionTemplate,
    chosenTemplate,
    templateValues,
    judgeName,
    startedPending,
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
  const transcriptIsEmpty = transcriptSize(sectionedTranscript) === 0;
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
      {dictationSections.map(({ key: section, ...config }) => {
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

  const hasTranscriptContent = transcriptSize(sectionedTranscript) > 0;

  const saveStatus = describeSaveStatus({
    state: autosaveState,
    hasContent: hasTranscriptContent,
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

  // The decision's form, or the chosen template's (DIAAT-344).
  const hearingForm = hasDecisionTemplate ? (
    <DictationForm
      initialValues={formData}
      onFormStateChange={setFormData}
      externalErrors={formErrors}
      documentContent={documentContent}
      legalIssuesFallback={legalIssuesFallback}
    />
  ) : startedPending ? (
    // DIAAT-339: the draft's answers are for the version it started with.
    <p role="status" className="text-sm text-muted-foreground">
      {startedPending === "loading"
        ? "Loading the template this draft was started with"
        : "The template this draft was started with could not be loaded."}
    </p>
  ) : chosenTemplate ? (
    <TemplateForm
      templates={choosableTemplates}
      templateId={chosenTemplate.id}
      onTemplateChange={(id) => {
        // Another template's fields differ: its answers start empty. So do
        // answers kept for a template no longer offered (DIAAT-414).
        const keptAnswers =
          restoredTemplate !== null && hasAnswers(restoredTemplate.values);
        if (
          (hasAnswers(templateValues) || keptAnswers) &&
          !window.confirm(
            keptAnswers
              ? "Choose another template? Your saved answers for a template no longer offered will be cleared."
              : "Choose another template? Your answers to this one will be cleared."
          )
        )
          return;
        setTemplateId(id);
        setTemplateValues({});
        setTemplateErrors({});
        setRestoredTemplate(null);
        // Another template: the draft's earlier version is no longer offered.
        setStartedTemplate(null);
        toast.dismiss(STARTED_TEMPLATE_TOAST);
      }}
      values={templateValues}
      judgeName={judgeName}
      onValuesChange={(values) => {
        // Answering this template: answers kept for one no longer offered go.
        setRestoredTemplate(null);
        // A field the judge changed is no longer what the last submit said of it
        // (DIAAT-340: a date corrected); a typed date is checked as they move on.
        setTemplateErrors((errors) =>
          Object.fromEntries(
            Object.entries(errors).filter(
              ([tag]) => ownValue(values, tag) === ownValue(templateValues, tag)
            )
          )
        );
        setTemplateValues(values);
      }}
      errors={templateErrors}
      onClear={() => {
        setTemplateValues({});
        setTemplateErrors({});
      }}
    />
  ) : null;

  const hasNotesContent =
    normalizeOptionalEditorText(editorContent) !==
    normalizeOptionalEditorText(defaultNotes);
  // Without a template the workspace is all there is: notes can come first.
  const isWorkspaceNavigationEnabled =
    !hasDecisionTemplate ||
    isRecordingActive ||
    hasTranscriptContent ||
    hasNotesContent;

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

              {layoutMode !== "mobile" && hasSectionChoice && (
                <div className="max-w-full shrink-0">{sectionTabs}</div>
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
                hasSectionChoice && (
                  <div className="max-w-full shrink-0">{sectionTabs}</div>
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
                            Your transcript, hearing details and notes are saved automatically and can be restored within 24 hours if you leave this page.
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
                              onSpeechSessionChange={setSpeechReport}
                              showRecordingControls={false}
                              showSectionTabs={false}
                              showSectionNames={hasSectionChoice}
                              sections={dictationSections}
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
                        Your transcript, hearing details and notes are saved automatically and can be restored within 24 hours if you leave this page.
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
                        onSpeechSessionChange={setSpeechReport}
                        showRecordingControls={false}
                        showSectionTabs={false}
                        showSectionNames={hasSectionChoice}
                        sections={dictationSections}
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
