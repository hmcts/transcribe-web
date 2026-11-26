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
  /** Name the section dictated into (DIAAT-333: off for the general section,
   * where there is only one and its IAC name would mean nothing). */
  showSectionNames?: boolean;
  embedded?: boolean;
  onTranscriptChange?: (transcript: SectionedTranscript) => void;
  /**
   * Reports the health of the underlying Speech SDK session so an embedding
   * page can render its own recording indicator honestly and surface a
   * persistent warning (DIAAT-297). When this is supplied the embedder owns the
   * warning banner; otherwise this component renders its own.
   */
  onSpeechSessionChange?: (report: SpeechSessionReport) => void;
  /** The sections dictated into, in order (DIAAT-416): the IAC decision's unless the
   * page gives a template's. */
  sections?: DictationSection[];
}

export interface MessageGroup {
  speaker: string;
  messages: GroupedMessage[];
  startTime: string;
  startTimeMs: number;
}

// The IAC decision's sections, which its hearings are stored and shown in.
export type IacSection = "background" | "evidence" | "facts";

export interface IacSectionedTranscript {
  background: TranscriptEntry[];
  evidence: TranscriptEntry[];
  facts: TranscriptEntry[];
}

/**
 * A section dictated into (DIAAT-416): one of the IAC decision's, or a dictated box
 * of an uploaded template (`box:<tag>`, so each box keeps its dictation however the
 * template's sections are reordered). Where there is one section, "background".
 */
export type TranscriptSection = string;

/** What was dictated, by section; a section with nothing yet may be absent. */
export type SectionedTranscript = Partial<
  Record<TranscriptSection, TranscriptEntry[]>
>;

// Section metadata for UI
export const SECTION_CONFIG: Record<
  IacSection,
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

/** A section the judge can dictate into, as the page shows it (DIAAT-416). */
export interface DictationSection {
  key: TranscriptSection;
  label: string;
  color: string;
}

export const IAC_SECTIONS: DictationSection[] = (
  Object.keys(SECTION_CONFIG) as IacSection[]
).map((key) => ({
  key,
  label: SECTION_CONFIG[key].label,
  color: SECTION_CONFIG[key].color,
}));

/** The one section where there are none to choose (DIAAT-333's general section, or
 * a template with one dictated box). */
export const SINGLE_SECTION: DictationSection[] = [IAC_SECTIONS[0]];

/** Colours for a template's sections, in turn. */
export const SECTION_COLORS = [
  "bg-blue-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-rose-500",
  "bg-cyan-500",
];

/** A section's entries; none when it has nothing yet. */
export function sectionEntries(
  transcript: SectionedTranscript,
  section: TranscriptSection
): TranscriptEntry[] {
  return (Object.hasOwn(transcript, section) && transcript[section]) || [];
}

/** How many entries were dictated, in all sections. */
export function transcriptSize(transcript: SectionedTranscript): number {
  return Object.values(transcript).reduce(
    (total, entries) => total + (entries?.length ?? 0),
    0
  );
}

/**
 * The transcript in exactly ``sections``: what is kept under a section that is not
 * one of them (dictated before the template's sections were known, a draft from
 * before the template changed, another template's) joins the first, so nothing
 * dictated is ever out of sight or left out. It comes before the first section's
 * own, so what is dictated next is added at the end and nothing shown moves.
 */
export function fitTranscript(
  transcript: SectionedTranscript,
  sections: DictationSection[]
): SectionedTranscript {
  const keys = new Set(sections.map((s) => s.key));
  const leftOver = Object.entries(transcript).flatMap(([key, entries]) =>
    keys.has(key) ? [] : (entries ?? [])
  );
  const fitted: SectionedTranscript = {};
  sections.forEach((section, index) => {
    const own = sectionEntries(transcript, section.key);
    fitted[section.key] = index === 0 ? [...leftOver, ...own] : own;
  });
  return fitted;
}
