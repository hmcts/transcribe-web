/**
 * Screen wording that each jurisdiction sets (DIAAT-330).
 *
 * These defaults are neutral, so a jurisdiction that sets nothing still sees no
 * other jurisdiction's wording. A jurisdiction's settings override them. The
 * keys match WORDING_KEYS in transcribe-api (domain/jurisdictions.py); the IAC's
 * values there are the text these screens showed before.
 */

export const WORDING_DEFAULTS = {
  "home.intro":
    "Supporting judicial work through live dictation, so you can focus on the proceedings.",
  "help.subtitle": "Getting started with BenchNotes",
  "nav.recordings": "Recordings",
  "records.column_title": "Title",
  "records.column_type": "Type",
  "records.search_placeholder": "Search titles or dates",
  "records.search_hint": "Search your recent dictations by title or date.",
  "records.filter_label": "Filter your recent dictations by type",
  "records.filter_placeholder": "Filter by type",
  "records.filter_all": "All types",
  "records.no_match": "Nothing matched your current search or filters.",
  "records.open": "Open",
  "records.rename_hint": "Update the title shown in your list.",
  "records.no_transcript": "No saved transcript was found.",
  "autosave.record_name": "record",
  "alerts.speech_lost_guidance":
    "Pause then restart recording to restart dictation. If this warning comes back, make your record in another way and raise with your Support team for investigation.",
} as const;

export type WordingKey = keyof typeof WORDING_DEFAULTS;
export type Wording = Partial<Record<WordingKey, string>>;

/**
 * A label for use mid-sentence ("Go to hearing recordings"): a capital that only
 * starts the label is lowered; an acronym ("CVP recordings") is kept.
 */
export function inSentence(label: string): string {
  return /^[A-Z][a-z]/.test(label) ? label[0].toLowerCase() + label.slice(1) : label;
}

/** The text for `key`: the jurisdiction's own, else the neutral default. */
export function wordingFor(
  wording: Wording | undefined,
  key: WordingKey
): string {
  const own = wording?.[key]?.trim();
  return own ? own : WORDING_DEFAULTS[key];
}
