import {
  type DictationFormValues,
  defaultFormValues,
} from "@/components/audio/dictation/formData";
import {
  type SectionedTranscript,
  transcriptSize,
} from "@/components/audio/dictation/types";
import { normalizeOptionalEditorText } from "@/lib/editor-contracts";
import {
  type AvailableTemplate,
  fittingValue,
  hasAnswers,
  ownValue,
  type TemplateValues,
} from "@/lib/templates-api";

/**
 * What the record page saves in its draft besides the transcript (DIAAT-414):
 * the hearing details, and with them the notes and a template's answers, so
 * none of the judge's work is lost when they leave the page or switch
 * jurisdiction. The API keeps `form_data` as it is given, so the notes and the
 * template ride in it under keys the hearing form does not use.
 */
export type DraftFormData = Partial<DictationFormValues> & {
  notes?: string;
  template?: DraftTemplate;
};

/** The template a draft was started with: which, the judge's answers, and (DIAAT-339)
 * the version of it, which the draft keeps when the template changes. */
export interface DraftTemplate {
  id: string;
  values: TemplateValues;
  revision?: string;
}

export interface RecordDraftWork {
  transcript: SectionedTranscript;
  formData: DictationFormValues;
  /** The notes editor's content, and what it holds untouched. */
  notes: string;
  defaultNotes: string;
  templateId: string | null;
  templateValues: TemplateValues;
  /** The version of the template (DIAAT-339), when the API gives one. */
  templateRevision?: string;
}

export function hasTranscript(transcript: SectionedTranscript): boolean {
  return transcriptSize(transcript) > 0;
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
 * answers only when there are any. The template is kept with its answers, and
 * with dictation (DIAAT-416: which sections it was dictated in are its). */
export function draftFormData(work: RecordDraftWork): DraftFormData {
  return {
    ...work.formData,
    ...(hasNotes(work.notes, work.defaultNotes) && { notes: work.notes }),
    ...(work.templateId !== null &&
      (hasAnswers(work.templateValues) || hasTranscript(work.transcript)) && {
        template: {
          id: work.templateId,
          values: work.templateValues,
          ...(work.templateRevision && { revision: work.templateRevision }),
        },
      }),
  };
}

/** A saved draft's form data, split back into the hearing details (over the
 * blank form), the notes and the template answers. */
export function fromDraftFormData(saved: DraftFormData): {
  formData: DictationFormValues;
  notes: string | null;
  template: DraftTemplate | null;
} {
  const { notes, template, ...hearingDetails } = saved;
  return {
    formData: { ...defaultFormValues, ...hearingDetails },
    notes: typeof notes === "string" ? notes : null,
    template:
      template && typeof template.id === "string" && template.values
        ? {
            id: template.id,
            values: template.values,
            ...(typeof template.revision === "string" && {
              revision: template.revision,
            }),
          }
        : null,
  };
}

/** Restored answers as they fit their template now (its fields and options may
 * have changed since the save): any its form could not show, or the API would
 * refuse, are left out rather than submitted unseen. */
export function fitToTemplate(
  template: AvailableTemplate,
  values: TemplateValues
): TemplateValues {
  return Object.fromEntries(
    template.fields.flatMap((field) => {
      const fitted = fittingValue(field, ownValue(values, field.tag));
      return fitted === undefined || fitted === null
        ? []
        : [[field.tag, fitted]];
    })
  );
}
