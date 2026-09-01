"use client";

import { FileText, Pause, Play } from "lucide-react";
import { useRouter } from "next/navigation";
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
import DictationFormContainer from "@/components/audio/dictation/dictation-form-container";
import {
  type DictationFormValues,
  defaultFormValues,
  dictationFormSchema,
} from "@/components/audio/dictation/formData";
import submitHearingToast from "@/components/notifications/submitting-hearing";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useRealtimeTranscription } from "@/hooks/use-realtime-transcription";
import { getAuthToken } from "@/lib/auth-utils";
import { shouldPrepopulateLocalDemoData } from "@/lib/environment";
import cn, { getJudgeNameFromEmail } from "@/lib/utils";
import { useUserSettings } from "@/providers/user-settings";
import TranscriptEditor from "./transcript-editor";
import type {
  SectionedTranscript,
  SpeechDemoProps,
  TranscriptEntry,
  TranscriptSection,
} from "./types";
import { SECTION_CONFIG } from "./types";

// Dummy conversation for local dev - organized by section with 2 messages each
const DEV_SECTIONED_TRANSCRIPT: SectionedTranscript = {
  background: [
    {
      speaker: "Judge",
      text: "Good morning. This is the appeal hearing in the case of Smith versus the Secretary of State. Could I have appearances please?",
      timestamp: new Date(Date.now() - 300000).toLocaleTimeString(),
      timestampMs: Date.now() - 300000,
    },
    {
      speaker: "Counsel",
      text: "Good morning, Your Honour. Sarah Williams appearing on behalf of the appellant.",
      timestamp: new Date(Date.now() - 280000).toLocaleTimeString(),
      timestampMs: Date.now() - 280000,
    },
  ],
  evidence: [
    {
      speaker: "Counsel",
      text: "I would like to draw the court's attention to the medical evidence at tab 3 of the bundle.",
      timestamp: new Date(Date.now() - 200000).toLocaleTimeString(),
      timestampMs: Date.now() - 200000,
    },
    {
      speaker: "Judge",
      text: "Yes, I have read that report. The scarring is described as highly consistent with the account given.",
      timestamp: new Date(Date.now() - 180000).toLocaleTimeString(),
      timestampMs: Date.now() - 180000,
    },
  ],
  facts: [
    {
      speaker: "Judge",
      text: "Having considered all the evidence, I find the appellant's account to be credible.",
      timestamp: new Date(Date.now() - 100000).toLocaleTimeString(),
      timestampMs: Date.now() - 100000,
    },
    {
      speaker: "Judge",
      text: "The appeal is allowed on asylum grounds and on human rights grounds under Article 3.",
      timestamp: new Date(Date.now() - 80000).toLocaleTimeString(),
      timestampMs: Date.now() - 80000,
    },
  ],
};

const EMPTY_SECTIONED_TRANSCRIPT: SectionedTranscript = {
  background: [],
  evidence: [],
  facts: [],
};

const DEFAULT_SPEAKER_NAME = "Judge";

const formatTimestamp = () => {
  return new Date().toLocaleTimeString();
};

export default function LiveDictation({
  className = "",
  initialTranscript,
  onExit,
  headerSubtitle,
  hideForm = false,
  recordingActive,
  onToggleRecording,
  activeSection: controlledActiveSection,
  onActiveSectionChange,
  showRecordingControls = true,
  showSectionTabs = true,
  embedded = false,
  onTranscriptChange,
  initialSectionedTranscript,
}: SpeechDemoProps) {
  const router = useRouter();
  const { user } = useUserSettings();
  const { status, segments, error, connect, disconnect } =
    useRealtimeTranscription();
  const isProcessing = status === "connecting";
  const isListening = status === "connected";
  const defaultSpeakerName = useMemo(() => {
    const judgeName = user?.email ? getJudgeNameFromEmail(user.email) : "";
    return judgeName ? `Judge ${judgeName}` : DEFAULT_SPEAKER_NAME;
  }, [user?.email]);
  // Sectioned transcript state
  const [sectionedTranscript, setSectionedTranscript] =
    useState<SectionedTranscript>(() => {
      if (initialSectionedTranscript) return initialSectionedTranscript;
      if (initialTranscript && initialTranscript.length > 0)
        return { background: initialTranscript, evidence: [], facts: [] };
      if (shouldPrepopulateLocalDemoData()) return DEV_SECTIONED_TRANSCRIPT;
      return EMPTY_SECTIONED_TRANSCRIPT;
    });
  // Current active section for new messages
  const [internalActiveSection, setInternalActiveSection] =
    useState<TranscriptSection>("background");
  const activeSection = controlledActiveSection ?? internalActiveSection;
  const [interimText, setInterimText] = useState<string>("");
  // Track which section the current interim speech will be saved to (synced from messageStartSectionRef)
  const [interimTargetSection, setInterimTargetSection] =
    useState<TranscriptSection | null>(null);
  const [formData, setFormData] =
    useState<DictationFormValues>(defaultFormValues);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState<
    Partial<Record<keyof DictationFormValues, string>>
  >({});

  const formScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const speakerLabelMapRef = useRef<Record<string, string>>({});
  const sessionSpeakerNameRef = useRef<string>(DEFAULT_SPEAKER_NAME);
  // Ref to track active section for use in speech callbacks (avoids stale closure)
  const activeSectionRef = useRef<TranscriptSection>(activeSection);
  // Ref to track which section a message started recording in
  const messageStartSectionRef = useRef<TranscriptSection | null>(null);
  // Track already-finalized realtime segments to avoid duplicate appends.
  const processedFinalSegmentIdsRef = useRef<Set<string>>(new Set());
  // Lock each segment to the section where its interim speech started.
  const segmentSectionMapRef = useRef<Record<string, TranscriptSection>>({});
  const previousStatusRef = useRef(status);
  const shouldRenderHeader = Boolean(onExit || headerSubtitle);

  // Keep the ref in sync with state
  useEffect(() => {
    activeSectionRef.current = activeSection;
  }, [activeSection]);

  // Notify parent whenever transcript changes
  useEffect(() => {
    onTranscriptChange?.(sectionedTranscript);
  }, [sectionedTranscript, onTranscriptChange]);

  const mapSpeakerLabel = useCallback((rawSpeakerId?: string) => {
    const incomingId = rawSpeakerId?.trim() || "Unknown";

    // Reuse existing mapping if we've seen this speaker ID before.
    if (speakerLabelMapRef.current[incomingId]) {
      return speakerLabelMapRef.current[incomingId];
    }

    speakerLabelMapRef.current[incomingId] = sessionSpeakerNameRef.current;
    return sessionSpeakerNameRef.current;
  }, []);

  const startContinuousRecognition = useCallback(() => {
    if (isListening || isProcessing) return;
    speakerLabelMapRef.current = {};
    sessionSpeakerNameRef.current = defaultSpeakerName;
    messageStartSectionRef.current = null;
    processedFinalSegmentIdsRef.current.clear();
    segmentSectionMapRef.current = {};
    setInterimTargetSection(null);
    setInterimText("");
    connect().catch((connectError) => {
      console.error("Exception in startContinuousRecognition:", connectError);
      toast.error(
        connectError instanceof Error
          ? connectError.message
          : "Failed to start transcription."
      );
    });
  }, [connect, defaultSpeakerName, isListening, isProcessing]);

  const stopContinuousRecognition = useCallback(() => {
    messageStartSectionRef.current = null;
    setInterimTargetSection(null);
    setInterimText("");
    disconnect();
  }, [disconnect]);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  useEffect(() => {
    if (!error) return;
    toast.error(error);
  }, [error]);

  useEffect(() => {
    if (segments.length === 0) return;

    const latestSegment = segments[segments.length - 1];

    for (const segment of segments) {
      if (!segmentSectionMapRef.current[segment.id]) {
        const startSection = activeSectionRef.current;
        segmentSectionMapRef.current[segment.id] = startSection;
      }

      const targetSection: TranscriptSection =
        segmentSectionMapRef.current[segment.id] ?? activeSectionRef.current;
      const incomingId = segment.speaker?.trim() || "Unknown";

      if (!segment.isFinal) {
        if (segment.id === latestSegment.id) {
          messageStartSectionRef.current = targetSection;
          setInterimTargetSection(targetSection);
          const speakerLabel = mapSpeakerLabel(incomingId);
          setInterimText(`${speakerLabel}: ${segment.text}`);
        }
        continue;
      }

      if (processedFinalSegmentIdsRef.current.has(segment.id)) {
        continue;
      }
      processedFinalSegmentIdsRef.current.add(segment.id);

      const text = segment.text.trim();
      if (!text) {
        delete segmentSectionMapRef.current[segment.id];
        continue;
      }

      const speakerLabel = mapSpeakerLabel(incomingId);

      const now = Date.now();
      const newEntry: TranscriptEntry = {
        speaker: speakerLabel,
        text,
        timestamp: formatTimestamp(),
        timestampMs: now,
      };

      setSectionedTranscript((prev: SectionedTranscript) => ({
        ...prev,
        [targetSection]: [...prev[targetSection], newEntry],
      }));

      delete segmentSectionMapRef.current[segment.id];

      if (segment.id === latestSegment.id) {
        messageStartSectionRef.current = null;
        setInterimTargetSection(null);
        setInterimText("");
      }
    }
  }, [segments, mapSpeakerLabel]);

  useEffect(() => {
    const previousStatus = previousStatusRef.current;

    if (previousStatus === "connected" && status === "disconnected") {
      setInterimText("");
      messageStartSectionRef.current = null;
      setInterimTargetSection(null);
    }

    previousStatusRef.current = status;
  }, [status]);

  const handleTranscriptUpdate = useCallback(
    (updatedTranscript: SectionedTranscript) => {
      setSectionedTranscript(updatedTranscript);
    },
    []
  );

  // Handle section tab change
  const handleSectionChange = useCallback(
    (section: string) => {
      const nextSection = section as TranscriptSection;
      if (controlledActiveSection === undefined) {
        setInternalActiveSection(nextSection);
      }
      onActiveSectionChange?.(nextSection);
    },
    [controlledActiveSection, onActiveSectionChange]
  );

  const handleFormGutterWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      const formContainer = formScrollContainerRef.current;
      if (!formContainer) return;

      // Convert line/page deltas to pixels so wheel behavior is consistent.
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

  const handleSaveTranscript = useCallback(async () => {
    const validation = dictationFormSchema.safeParse(formData);
    if (!validation.success) {
      // Extract field errors from validation result
      const fieldErrors: Partial<Record<keyof DictationFormValues, string>> =
        {};
      const errorMessages: string[] = [];

      validation.error.issues.forEach(({ path, message }) => {
        const key = path[0] as keyof DictationFormValues | undefined;
        if (key) {
          fieldErrors[key] = message;
          errorMessages.push(message);
        }
      });

      // Set errors so the form can display them
      setFormErrors(fieldErrors);

      // Show a toast with the first few errors
      const errorSummary = errorMessages.slice(0, 3).join("; ");
      toast.error(`Please review the highlighted fields: ${errorSummary}`);

      // Move focus to the first invalid field so keyboard and screen-reader
      // users are guided directly to the field that needs correction
      const firstErrorKey = Object.keys(fieldErrors)[0];
      if (firstErrorKey) {
        document.getElementById(firstErrorKey)?.focus();
      }
      return;
    }

    // Clear any previous errors
    setFormErrors({});

    // Create the submission promise
    const submissionPromise = (async () => {
      try {
        setIsSubmitting(true);

        // Get auth token to forward to backend
        const authToken = await getAuthToken();

        const response = await fetch("/api/live-transcription/submission", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(authToken && { Authorization: `Bearer ${authToken}` }),
          },
          body: JSON.stringify({
            form_data: validation.data,
            // Send sectioned messages to backend
            messages: sectionedTranscript,
          }),
        });

        if (!response.ok) {
          const errorBody = await response.json().catch(() => null);
          const message =
            (errorBody && (errorBody.detail || errorBody.error)) ||
            "Failed to save submission.";
          throw new Error(message);
        }

        const data = await response.json();

        router.push("/");

        return data;
      } finally {
        setIsSubmitting(false);
      }
    })();

    submitHearingToast(submissionPromise);
  }, [formData, sectionedTranscript, router]);

  const handleMicButtonClick = useCallback(() => {
    if (onToggleRecording) {
      onToggleRecording();
      return;
    }

    if (isProcessing && !isListening) {
      return;
    }
    if (isListening) {
      stopContinuousRecognition();
    } else {
      startContinuousRecognition();
    }
  }, [
    isListening,
    isProcessing,
    onToggleRecording,
    startContinuousRecognition,
    stopContinuousRecognition,
  ]);

  useEffect(() => {
    if (recordingActive === undefined) return;

    if (recordingActive && !isListening && !isProcessing) {
      startContinuousRecognition();
      return;
    }

    if (!recordingActive && (isListening || isProcessing)) {
      stopContinuousRecognition();
    }
  }, [
    isListening,
    isProcessing,
    recordingActive,
    startContinuousRecognition,
    stopContinuousRecognition,
  ]);

  const transcriptSectionPadding = shouldRenderHeader ? "py-4" : "py-8";
  const isInlineFormLayout = useMediaQuery("(min-width: 1280px)");
  const shouldShowForm = !hideForm;

  if (embedded) {
    return (
      <div className={cn("min-h-0 w-full", className)}>
        <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
          <div className={`min-h-0 flex-1 ${transcriptSectionPadding}`}>
            <TranscriptEditor
              sectionedTranscript={sectionedTranscript}
              activeSection={activeSection}
              interimTargetSection={interimTargetSection}
              interimText={interimText}
              isListening={isListening}
              onTranscriptUpdate={handleTranscriptUpdate}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex h-full w-full justify-center overflow-hidden",
        className
      )}
    >
      <div className="flex h-full w-full max-w-[1280px] min-w-0">
        {/* Left Sidebar - Form (desktop wide) */}
        {shouldShowForm && isInlineFormLayout && (
          <aside className="relative h-full w-[420px] bg-neutral-50 dark:bg-neutral-900 2xl:w-[480px]">
            <div
              aria-hidden="true"
              className="absolute inset-y-0 right-full w-[100vw] bg-neutral-50 dark:bg-neutral-900"
              onWheel={handleFormGutterWheel}
            />
            <div className="flex h-full w-full flex-col gap-6 px-4 py-6 sm:px-6">
              <DictationFormContainer
                formScrollContainerRef={formScrollContainerRef}
                formData={formData}
                formErrors={formErrors}
                transcriptLength={
                  sectionedTranscript.background.length +
                  sectionedTranscript.evidence.length +
                  sectionedTranscript.facts.length
                }
                isSubmitting={isSubmitting}
                onFormStateChange={setFormData}
                onSaveTranscript={handleSaveTranscript}
              />
            </div>
          </aside>
        )}

        {/* Main Content - Transcript */}
        <main className="relative h-full min-w-0 flex-1 bg-white dark:bg-neutral-950">
          <div className="flex h-full w-full min-w-0 flex-col overflow-hidden px-4 py-6 sm:px-6">
            <div className="flex-1 overflow-y-auto mb-2">
              <div className={`h-full ${transcriptSectionPadding}`}>
                <TranscriptEditor
                  sectionedTranscript={sectionedTranscript}
                  activeSection={activeSection}
                  interimTargetSection={interimTargetSection}
                  interimText={interimText}
                  isListening={isListening}
                  onTranscriptUpdate={handleTranscriptUpdate}
                />
              </div>
            </div>

            <Separator className="mb-6" />

            <div className="flex w-full flex-wrap items-center gap-3 sm:gap-4 min-[960px]:flex-nowrap">
              <div className="flex w-full items-center justify-between gap-3 min-[960px]:w-auto min-[960px]:justify-start min-[960px]:gap-4">
                {/* Form sheet trigger (mobile) */}
                {shouldShowForm && !isInlineFormLayout && (
                  <Sheet>
                    <SheetTrigger asChild>
                      <Button
                        variant="outline"
                        size="lg"
                        className="shrink-0 border-neutral-200 bg-white hover:bg-neutral-100 hover:border-neutral-200 dark:border-neutral-700 dark:bg-neutral-700 dark:hover:border-neutral-900 dark:hover:bg-neutral-900"
                      >
                        <FileText className="size-4" />
                        Hearing details
                      </Button>
                    </SheetTrigger>
                    <SheetContent
                      side="left"
                      className="w-[92vw] max-w-[460px] p-0 sm:max-w-[460px]"
                    >
                      <SheetHeader className="border-b border-neutral-200 px-4 py-4 dark:border-neutral-800 sm:px-6">
                        <SheetTitle>Hearing details</SheetTitle>
                        <SheetDescription>
                          Complete required fields before submitting.
                        </SheetDescription>
                      </SheetHeader>
                      <div className="flex h-[calc(100%-4.5rem)] flex-col gap-6 px-4 py-6 sm:px-6">
                        <DictationFormContainer
                          formScrollContainerRef={formScrollContainerRef}
                          formData={formData}
                          formErrors={formErrors}
                          transcriptLength={
                            sectionedTranscript.background.length +
                            sectionedTranscript.evidence.length +
                            sectionedTranscript.facts.length
                          }
                          isSubmitting={isSubmitting}
                          onFormStateChange={setFormData}
                          onSaveTranscript={handleSaveTranscript}
                        />
                      </div>
                    </SheetContent>
                  </Sheet>
                )}

                {showRecordingControls && (
                  <div className="ml-auto flex items-center gap-3 sm:ml-0">
                    {/* Mic icon */}
                    <div className="flex size-8 shrink-0 items-center justify-center">
                      <AnimatedMicrophone size={32} isActive={isListening} />
                    </div>

                    {/* Start/Pause button */}
                    <Button
                      onClick={handleMicButtonClick}
                      disabled={isProcessing && !isListening}
                      variant="outline"
                      size="lg"
                      className="w-min shrink-0 border-neutral-200 bg-white hover:bg-neutral-100 hover:border-neutral-200 dark:border-neutral-700 dark:bg-neutral-700 dark:hover:border-neutral-900 dark:hover:bg-neutral-900 [&>svg]:text-neutral-900 dark:[&>svg]:text-neutral-100"
                    >
                      {isListening ? (
                        <Pause className="size-4" />
                      ) : (
                        <Play className="size-4" />
                      )}
                      <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
                        {isProcessing && !isListening
                          ? "Preparing..."
                          : isListening
                            ? "Pause recording"
                            : "Start recording"}
                      </span>
                    </Button>
                  </div>
                )}
              </div>

              {/* Section Tabs */}
              {showSectionTabs && (
                <Tabs
                  value={activeSection}
                  onValueChange={handleSectionChange}
                  className="order-3 w-full min-[960px]:order-none min-[960px]:ml-auto min-[960px]:w-auto"
                >
                  <TabsList className="inline-flex h-11 w-full overflow-hidden rounded-md border-2 border-neutral-200 bg-neutral-100 px-0 dark:border-neutral-800 dark:bg-neutral-700 min-[960px]:w-auto">
                    {(Object.keys(SECTION_CONFIG) as TranscriptSection[]).map(
                      (section) => {
                        const config = SECTION_CONFIG[section];
                        const count = sectionedTranscript[section].length;
                        return (
                          <TabsTrigger
                            key={section}
                            value={section}
                            className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-none px-3 py-2.5 text-xs hover:bg-neutral-200 dark:hover:bg-neutral-900 sm:px-4 sm:text-sm min-[960px]:w-40 min-[960px]:flex-none"
                          >
                            <span
                              className={cn(
                                "size-2 rounded-full",
                                config.color,
                                activeSection === section
                                  ? "animate-pulse"
                                  : "opacity-60"
                              )}
                            />
                            <span className="truncate font-medium">
                              {config.label}
                            </span>
                            {count > 0 && (
                              <span className="ml-0.5 rounded-full bg-neutral-300 dark:bg-neutral-600 px-1.5 py-0.5 text-xs">
                                {count}
                              </span>
                            )}
                          </TabsTrigger>
                        );
                      }
                    )}
                  </TabsList>
                </Tabs>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
