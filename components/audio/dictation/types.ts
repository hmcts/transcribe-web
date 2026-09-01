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
