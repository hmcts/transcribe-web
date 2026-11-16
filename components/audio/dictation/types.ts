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
  initialSectionedTranscript?: SectionedTranscript;
  headerSubtitle?: string;
  recordingActive?: boolean;
  /** The section new dictation goes into: a dictated box's tag. */
  activeSection: TranscriptSection;
  /** The chosen template's dictated sections, in its order. */
  sections?: DictationSection[];
  /** Name the section dictated into (DIAAT-333: off when there is only one). */
  showSectionNames?: boolean;
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

// Section types for categorizing transcript parts. A section is one of the chosen
// template's dictated boxes, by its tag; past hearings were stored under the three
// below (and still are, for the hearing viewers).
export type TranscriptSection = string;

export type SectionedTranscript = Record<TranscriptSection, TranscriptEntry[]>;

/** A section the judge dictates into: a dictated box of the chosen template. */
export interface DictationSection {
  tag: string;
  label: string;
}

export type StoredSection = "background" | "evidence" | "facts";

export const STORED_SECTIONS: StoredSection[] = [
  "background",
  "evidence",
  "facts",
];

/** A submitted hearing's transcript, as the hearing viewers read it. */
export type StoredTranscript = Record<StoredSection, TranscriptEntry[]>;

// Section metadata for UI
export const SECTION_CONFIG: Record<
  StoredSection,
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

const SECTION_COLORS = [
  "bg-blue-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-rose-500",
  "bg-cyan-500",
];

/** Each section's dot colour, by its place in the template. */
export function sectionColor(
  sections: DictationSection[],
  tag: TranscriptSection
): string {
  const at = sections.findIndex((s) => s.tag === tag);
  return SECTION_COLORS[Math.max(at, 0) % SECTION_COLORS.length];
}

/** A section's name: the template's, else a stored one's, else its tag. */
export function sectionLabel(
  sections: DictationSection[],
  tag: TranscriptSection
): string {
  return (
    sections.find((s) => s.tag === tag)?.label ??
    SECTION_CONFIG[tag as StoredSection]?.label ??
    tag
  );
}

/** No dictation yet in any of ``sections``. */
export function emptySections(
  sections: DictationSection[]
): SectionedTranscript {
  return Object.fromEntries(sections.map((s) => [s.tag, []]));
}

/** How many messages there are, across every section. */
export function entryCount(transcript: SectionedTranscript): number {
  return Object.values(transcript).reduce((n, list) => n + list.length, 0);
}
