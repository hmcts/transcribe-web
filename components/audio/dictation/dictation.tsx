"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import RecordAlertBanner from "@/components/audio/recording/record-alert-banner";
import { useNoSpeechWatchdog } from "@/hooks/use-no-speech-watchdog";
import { useRealtimeTranscription } from "@/hooks/use-realtime-transcription";
import { shouldPrepopulateLocalDemoData } from "@/lib/environment";
import { describeSpeechAlert } from "@/lib/speech-alerts";
import { isCapturingSpeech } from "@/lib/speech-session-health";
import cn, { getJudgeNameFromEmail } from "@/lib/utils";
import { useWording } from "@/providers/jurisdiction";
import { useUserSettings } from "@/providers/user-settings";
import TranscriptEditor from "./transcript-editor";
import {
  entryCount,
  type SectionedTranscript,
  type SpeechDemoProps,
  type TranscriptEntry,
  type TranscriptSection,
} from "./types";

// Dummy conversation for local dev, in the section dictated into first.
const DEV_TRANSCRIPT: TranscriptEntry[] = [
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
  {
    speaker: "Judge",
    text: "Having considered all the evidence, I find the appellant's account to be credible.",
    timestamp: new Date(Date.now() - 100000).toLocaleTimeString(),
    timestampMs: Date.now() - 100000,
  },
];

const DEFAULT_SPEAKER_NAME = "Judge";

const formatTimestamp = () => {
  return new Date().toLocaleTimeString();
};

/**
 * The live transcript of the recording page: what the judge dictates, into the section
 * (a dictated box of the chosen template) they have picked, recording while
 * ``recordingActive``.
 */
export default function LiveDictation({
  className = "",
  headerSubtitle,
  recordingActive,
  activeSection,
  sections,
  showSectionNames = true,
  onTranscriptChange,
  initialSectionedTranscript,
  onSpeechSessionChange,
}: SpeechDemoProps) {
  const wording = useWording();
  const { user } = useUserSettings();
  const { segments, error, session, connect, disconnect } =
    useRealtimeTranscription();
  // `isListening` drives every "we are recording you" affordance, so it is
  // derived from session health rather than from the raw SDK connection state.
  // A session in a reconnect loop reports `connected` between every collapse
  // (DIAAT-297) and must never be allowed to present as recording.
  const isCapturing = isCapturingSpeech(session.health);
  const isListening = isCapturing;
  /** The user has asked for a session, whatever state it is actually in. */
  const isSessionRequested = session.health !== "idle";
  const defaultSpeakerName = useMemo(() => {
    const judgeName = user?.email ? getJudgeNameFromEmail(user.email) : "";
    return judgeName ? `Judge ${judgeName}` : DEFAULT_SPEAKER_NAME;
  }, [user?.email]);
  // Sectioned transcript state
  const [sectionedTranscript, setSectionedTranscript] =
    useState<SectionedTranscript>(() => {
      if (initialSectionedTranscript) return initialSectionedTranscript;
      if (shouldPrepopulateLocalDemoData())
        return { [activeSection]: DEV_TRANSCRIPT };
      return {};
    });
  const [interimText, setInterimText] = useState<string>("");
  // Track which section the current interim speech will be saved to (synced from messageStartSectionRef)
  const [interimTargetSection, setInterimTargetSection] =
    useState<TranscriptSection | null>(null);
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
  const previousIsCapturingRef = useRef(false);
  const shouldRenderHeader = Boolean(headerSubtitle);

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
    // The hook owns reconnection once a session exists. Anything other than
    // "idle" means it is already connecting, connected, or retrying, and
    // starting again from here would race it â€” that render-effect restart loop
    // is what produced 37 sessions in 44 minutes (DIAAT-297).
    if (isSessionRequested) return;
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
  }, [connect, defaultSpeakerName, isSessionRequested]);

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

  // DIAAT-297: `error` used to be surfaced here with `toast.error(error)`. A
  // toast auto-dismisses, so a judge speaking to a courtroom never saw it, and
  // a collapsing session re-raised the same string until it was deduplicated
  // into invisibility. The error is now logged for diagnostics and reported
  // through the persistent banner below instead.
  useEffect(() => {
    if (!error) return;
    console.error("[speech] session error:", error);
  }, [error]);

  const totalTranscriptEntries = entryCount(sectionedTranscript);

  const entriesAtSessionStartRef = useRef<number | null>(null);
  const [hasCapturedSpeech, setHasCapturedSpeech] = useState(false);

  // "Captured anything" is measured from the point recording started, not from
  // an empty transcript â€” otherwise a restored draft would mask a dead session
  // and the no-speech watchdog would never arm.
  useEffect(() => {
    if (!isSessionRequested) {
      entriesAtSessionStartRef.current = null;
      setHasCapturedSpeech(false);
      return;
    }
    if (entriesAtSessionStartRef.current === null) {
      entriesAtSessionStartRef.current = totalTranscriptEntries;
    }
    if (totalTranscriptEntries > entriesAtSessionStartRef.current) {
      setHasCapturedSpeech(true);
    }
  }, [isSessionRequested, totalTranscriptEntries]);

  const { shouldWarn: noSpeechWarning, thresholdMs: noSpeechThresholdMs } =
    useNoSpeechWatchdog({
      active: isSessionRequested,
      hasCapturedSpeech,
    });

  const [resumedNoticeDismissed, setResumedNoticeDismissed] = useState(false);
  useEffect(() => {
    if (!isSessionRequested) setResumedNoticeDismissed(false);
  }, [isSessionRequested]);
  const dismissAlert = useCallback(() => setResumedNoticeDismissed(true), []);

  const speechAlert = useMemo(() => {
    const alert = describeSpeechAlert({
      health: session.health,
      totalCollapses: session.totalCollapses,
      hasCapturedSpeech,
      noSpeechWarning,
      noSpeechThresholdSeconds: Math.round(noSpeechThresholdMs / 1000),
      speechLostGuidance: wording("alerts.speech_lost_guidance"),
    });
    if (alert?.kind === "speech-interrupted" && resumedNoticeDismissed) {
      return null;
    }
    return alert;
  }, [
    session.health,
    session.totalCollapses,
    hasCapturedSpeech,
    noSpeechWarning,
    noSpeechThresholdMs,
    resumedNoticeDismissed,
    wording,
  ]);

  // Detection lives here, in the one component that owns both the SDK session
  // and the transcript. An embedder gets the finished verdict rather than
  // re-deriving it â€” running the watchdog twice would double-report it.
  useEffect(() => {
    onSpeechSessionChange?.({
      session,
      alert: speechAlert,
      isCapturing,
      dismissAlert,
    });
  }, [onSpeechSessionChange, session, speechAlert, isCapturing, dismissAlert]);

  // When an embedder is listening it renders the banner itself, in a location
  // where it cannot be scrolled out of view.
  const speechAlertBanner = onSpeechSessionChange ? null : (
    <RecordAlertBanner alert={speechAlert} onDismiss={dismissAlert} />
  );

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
        [targetSection]: [
          ...(Object.hasOwn(prev, targetSection) ? prev[targetSection] ?? [] : []),
          newEntry,
        ],
      }));

      delete segmentSectionMapRef.current[segment.id];

      if (segment.id === latestSegment.id) {
        messageStartSectionRef.current = null;
        setInterimTargetSection(null);
        setInterimText("");
      }
    }
  }, [segments, mapSpeakerLabel]);

  // Drop the in-flight interim line as soon as capture stops for any reason.
  // Keyed on capture rather than on the raw connection status so a collapsed
  // session does not leave a half-spoken sentence on screen looking live.
  useEffect(() => {
    if (previousIsCapturingRef.current && !isCapturing) {
      setInterimText("");
      messageStartSectionRef.current = null;
      setInterimTargetSection(null);
    }

    previousIsCapturingRef.current = isCapturing;
  }, [isCapturing]);

  const handleTranscriptUpdate = useCallback(
    (updatedTranscript: SectionedTranscript) => {
      setSectionedTranscript(updatedTranscript);
    },
    []
  );

  useEffect(() => {
    if (recordingActive === undefined) return;

    if (recordingActive && !isSessionRequested) {
      startContinuousRecognition();
      return;
    }

    if (!recordingActive && isSessionRequested) {
      stopContinuousRecognition();
    }
  }, [
    isSessionRequested,
    recordingActive,
    startContinuousRecognition,
    stopContinuousRecognition,
  ]);

  const transcriptSectionPadding = shouldRenderHeader ? "py-4" : "py-8";

  return (
    <div className={cn("min-h-0 w-full", className)}>
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
        {speechAlertBanner}
        <div className={`min-h-0 flex-1 ${transcriptSectionPadding}`}>
          <TranscriptEditor
            sectionedTranscript={sectionedTranscript}
            activeSection={activeSection}
            interimTargetSection={interimTargetSection}
            interimText={interimText}
            isListening={isListening}
            onTranscriptUpdate={handleTranscriptUpdate}
            showSectionNames={showSectionNames}
            sections={sections}
          />
        </div>
      </div>
    </div>
  );
}
