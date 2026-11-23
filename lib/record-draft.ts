import {
  type DictationFormValues,
  defaultFormValues,
} from "@/components/audio/dictation/formData";
import type { SectionedTranscript } from "@/components/audio/dictation/types";
import { normalizeOptionalEditorText } from "@/lib/editor-contracts";
import { hasAnswers, type TemplateValues } from "@/lib/templates-api";

/**
 * What the record page saves in its draft besides the transcript (DIAAT-414):
 * the hearing details, and with them the notes and a template's answers, so
 * none of the judge's work is lost when they leave the page or switch
 * jurisdiction. The API keeps `form_data` as it is given, so the notes and the
 * template ride in it under keys the hearing form does not use.
 */
export type DraftFormData = Partial<DictationFormValues> & {
  notes?: string;
  template?: { id: string; values: TemplateValues };
};

export interface RecordDraftWork {
  transcript: SectionedTranscript;
  formData: DictationFormValues;
  /** The notes editor's content, and what it holds untouched. */
  notes: string;
  defaultNotes: string;
  templateId: string | null;
  templateValues: TemplateValues;
}

export function hasTranscript(transcript: SectionedTranscript): boolean {
  return (
    transcript.background.length > 0 ||
    transcript.evidence.length > 0 ||
    transcript.facts.length > 0
  );
}

/** Hearing details the judge entered: the judge's name is filled in from their
 * sign-in, here and again on any later visit, so it is not their own work. */
export function hasHearingDetails(formData: DictationFormValues): boolean {
  const { judgeName: _filledIn, ...entered } = formData;
  const { judgeName: _blank, ...blank } = defaultFormValues;
  return JSON.stringify(entered) !== JSON.stringify(blank);
}

export function hasNotes(notes: string, defaultNotes: string): boolean {
  return (
    normalizeOptionalEditorText(notes) !==
    normalizeOptionalEditorText(defaultNotes)
  );
}

/** Whether the page holds anything of the judge's that a draft should keep. */
export function hasWork(work: RecordDraftWork): boolean {
  return (
    hasTranscript(work.transcript) ||
    hasHearingDetails(work.formData) ||
    hasNotes(work.notes, work.defaultNotes) ||
    (work.templateId !== null && hasAnswers(work.templateValues))
  );
}

/** The draft's form data: the hearing details, and the notes and template
 * answers only when there are any. */
export function draftFormData(work: RecordDraftWork): DraftFormData {
  return {
    ...work.formData,
    ...(hasNotes(work.notes, work.defaultNotes) && { notes: work.notes }),
    ...(work.templateId !== null &&
      hasAnswers(work.templateValues) && {
        template: { id: work.templateId, values: work.templateValues },
      }),
  };
}

/** A saved draft's form data, split back into the hearing details (over the
 * blank form), the notes and the template answers. */
export function fromDraftFormData(saved: DraftFormData): {
  formData: DictationFormValues;
  notes: string | null;
  template: { id: string; values: TemplateValues } | null;
} {
  const { notes, template, ...hearingDetails } = saved;
  return {
    formData: { ...defaultFormValues, ...hearingDetails },
    notes: typeof notes === "string" ? notes : null,
    template:
      template && typeof template.id === "string" && template.values
        ? template
        : null,
  };
}
