import type { SpeechSessionState } from "@/hooks/use-realtime-transcription";
import type { RecordAlert } from "@/lib/record-alerts";

export interface TranscriptEntry {
  speaker: string;
  text: string;
  timestamp: string;
  timestampMs?: number; // Unix timestamp in milliseconds for easier comparison
}

export interface GroupedMessage {
  text: string;
  index: number;
  timestamp: string;
}

/**
 * Everything an embedding page needs to render an honest recording indicator
 * and a persistent warning without duplicating the detection logic (DIAAT-297).
 */
export interface SpeechSessionReport {
  session: SpeechSessionState;
  /**
   * What the user needs to be told about speech capture, or null. The embedder
   * ranks this against its own alerts with `selectMostSevereAlert`.
   */
  alert: RecordAlert | null;
  /** True only while speech is actually reaching the transcription service. */
  isCapturing: boolean;
  /** Dismisses `alert` when it is dismissible. */
  dismissAlert: () => void;
}

export interface SpeechDemoProps {
  className?: string;
  initialTranscript?: TranscriptEntry[];
  initialSectionedTranscript?: SectionedTranscript;
  onExit?: () => void;
  headerSubtitle?: string;
  exitLabel?: string;
  hideForm?: boolean;
  recordingActive?: boolean;
  onToggleRecording?: () => void;
  activeSection?: TranscriptSection;
  onActiveSectionChange?: (section: TranscriptSection) => void;
  showRecordingControls?: boolean;
  showSectionTabs?: boolean;
  embedded?: boolean;
  onTranscriptChange?: (transcript: SectionedTranscript) => void;
  /**
   * Reports the health of the underlying Speech SDK session so an embedding
   * page can render its own recording indicator honestly and surface a
   * persistent warning (DIAAT-297). When this is supplied the embedder owns the
   * warning banner; otherwise this component renders its own.
   */
  onSpeechSessionChange?: (report: SpeechSessionReport) => void;
}

export interface MessageGroup {
  speaker: string;
  messages: GroupedMessage[];
  startTime: string;
  startTimeMs: number;
}

// Section types for categorizing transcript parts
export type TranscriptSection = "background" | "evidence" | "facts";

export interface SectionedTranscript {
  background: TranscriptEntry[];
  evidence: TranscriptEntry[];
  facts: TranscriptEntry[];
}

// Section metadata for UI
export const SECTION_CONFIG: Record<
  TranscriptSection,
  { label: string; description: string; color: string }
> = {
  background: {
    label: "Background",
    description: "Case background and initial proceedings",
    color: "bg-blue-500",
  },
  evidence: {
    label: "Evidence",
    description: "Evidence presented and discussed",
    color: "bg-amber-500",
  },
  facts: {
    label: "Facts",
    description: "Facts established during the hearing",
    color: "bg-emerald-500",
  },
};
