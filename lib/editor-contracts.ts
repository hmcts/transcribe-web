import { z } from "zod";

const NON_EMPTY_TEXT = z.string().trim().min(1);
const OPTIONAL_TEXT = z.string().trim();
const CONTENT_ID = z
  .string()
  .trim()
  .regex(/^[a-z0-9_]+$/);
const MAX_EDITOR_TEXT_LENGTH = 200_000;

export const notesHtmlSchema = z
  .string()
  .max(MAX_EDITOR_TEXT_LENGTH)
  .transform((value) => value.trim());

export function normalizeOptionalEditorText(
  value: string | null | undefined
): string | null {
  if (value == null) {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export const liveTranscriptMessageSchema = z.object({
  speaker: NON_EMPTY_TEXT,
  text: NON_EMPTY_TEXT,
  timestamp: NON_EMPTY_TEXT,
  timestampMs: z.number().int().nonnegative().optional(),
});

export const sectionedTranscriptSchema = z.object({
  background: z.array(liveTranscriptMessageSchema),
  evidence: z.array(liveTranscriptMessageSchema),
  facts: z.array(liveTranscriptMessageSchema),
});

export const liveTranscriptionFormDataSchema = z
  .object({
    caseId: NON_EMPTY_TEXT,
    location: NON_EMPTY_TEXT,
    locationOther: OPTIONAL_TEXT,
    jurisdiction: NON_EMPTY_TEXT,
    hearingDate: NON_EMPTY_TEXT,
    judgeName: NON_EMPTY_TEXT,
    anonymityOrder: NON_EMPTY_TEXT,
    appellantName: NON_EMPTY_TEXT,
    respondent: NON_EMPTY_TEXT,
    hearingType: NON_EMPTY_TEXT,
    appellantRepType: OPTIONAL_TEXT,
    appellantRepDetails: OPTIONAL_TEXT,
    respondentRepType: OPTIONAL_TEXT,
    respondentRepName: OPTIONAL_TEXT,
    appealableDecisionDate: NON_EMPTY_TEXT,
    legalIssues: z.array(NON_EMPTY_TEXT).min(1),
    documentType: NON_EMPTY_TEXT,
    nextHearingType: OPTIONAL_TEXT.optional(),
    nextHearingAdjudicator: OPTIONAL_TEXT.optional(),
  })
  .strict();

/**
 * The same where the jurisdiction has no legal wording (DIAAT-342): the form has
 * no legal issues field, so none are required, and none are submitted.
 */
export const liveTranscriptionFormDataWithoutLegalIssuesSchema =
  liveTranscriptionFormDataSchema.extend({
    legalIssues: z.array(NON_EMPTY_TEXT).max(0),
  });

const submissionPayloadSchema = (
  formData:
    | typeof liveTranscriptionFormDataSchema
    | typeof liveTranscriptionFormDataWithoutLegalIssuesSchema
) =>
  z
    .object({
      form_data: formData,
      messages: sectionedTranscriptSchema,
      notes: z.string().max(MAX_EDITOR_TEXT_LENGTH).nullable().optional(),
    })
    .strict()
    .transform((payload) => ({
      ...payload,
      notes: normalizeOptionalEditorText(payload.notes),
    }));

export const liveTranscriptionSubmissionPayloadSchema = submissionPayloadSchema(
  liveTranscriptionFormDataSchema
);

export const liveTranscriptionSubmissionPayloadWithoutLegalIssuesSchema =
  submissionPayloadSchema(liveTranscriptionFormDataWithoutLegalIssuesSchema);

export type LiveTranscriptionSubmissionPayload = z.infer<
  typeof liveTranscriptionSubmissionPayloadSchema
>;

export const liveTranscriptionSubmissionResponseSchema = z.object({
  blob_path: NON_EMPTY_TEXT,
  document_blob_path: NON_EMPTY_TEXT,
  document_download_url: NON_EMPTY_TEXT,
  transcription_id: NON_EMPTY_TEXT,
  message: NON_EMPTY_TEXT,
});

export type LiveTranscriptionSubmissionResponse = z.infer<
  typeof liveTranscriptionSubmissionResponseSchema
>;

export const submissionErrorResponseSchema = z
  .object({
    error: NON_EMPTY_TEXT.optional(),
    detail: NON_EMPTY_TEXT.optional(),
  })
  .refine(
    (value) => Boolean(value.error || value.detail),
    "Expected either an error or detail message"
  )
  .transform((value) => ({
    error: value.error ?? value.detail ?? "Unknown error",
  }));

export const hearingTypeSchema = z.object({
  id: CONTENT_ID,
  title: NON_EMPTY_TEXT,
  hearing_title: NON_EMPTY_TEXT,
  hearing_description: NON_EMPTY_TEXT.max(MAX_EDITOR_TEXT_LENGTH),
});

export type HearingType = z.infer<typeof hearingTypeSchema>;

export const legalFrameworkSchema = z.object({
  id: CONTENT_ID,
  title: NON_EMPTY_TEXT,
  rank: z.number().int().min(1),
  content: NON_EMPTY_TEXT.max(MAX_EDITOR_TEXT_LENGTH),
  issues: z
    .array(z.string())
    .default([])
    .transform((issues) =>
      issues.map((issue) => issue.trim()).filter((issue) => issue.length > 0)
    ),
});

export type LegalFramework = z.infer<typeof legalFrameworkSchema>;

export const anonymityStatusSchema = z.object({
  id: CONTENT_ID,
  title: NON_EMPTY_TEXT,
  content: NON_EMPTY_TEXT.max(MAX_EDITOR_TEXT_LENGTH),
  identifier: z.string().trim(),
  header: NON_EMPTY_TEXT,
  order_header: NON_EMPTY_TEXT,
  order_text: NON_EMPTY_TEXT.max(MAX_EDITOR_TEXT_LENGTH),
});

export type AnonymityStatus = z.infer<typeof anonymityStatusSchema>;

export const documentContentSchema = z.object({
  // DIAAT-342: which jurisdiction's wording this is, and whether it has legal
  // wording at all. Both are read leniently, so a web build running against an
  // API that does not send them yet keeps working: missing means the IAC's
  // behaviour before (legal wording present).
  jurisdiction: z
    .object({ code: NON_EMPTY_TEXT, name: z.string() })
    .optional()
    .catch(undefined),
  has_legal_wording: z.boolean().optional().catch(undefined),
  hearing_types: z.array(hearingTypeSchema),
  legal_frameworks: z.array(legalFrameworkSchema),
  anonymity: z.object({
    statuses: z.array(anonymityStatusSchema),
  }),
});

export type DocumentContent = z.infer<typeof documentContentSchema>;

/** Whether the jurisdiction has legal wording (legal frameworks) to ask about. */
export function hasLegalWording(content: DocumentContent): boolean {
  return content.has_legal_wording ?? true;
}

/**
 * `content` if it is the wording of the jurisdiction `code` the tab works in,
 * else undefined: content fetched for another jurisdiction is never used
 * (DIAAT-342). Content that does not say which jurisdiction it is for (an older
 * API) is taken as the active one's.
 */
export function contentForJurisdiction(
  content: DocumentContent | undefined,
  code: string | undefined
): DocumentContent | undefined {
  if (!content) return undefined;
  if (content.jurisdiction && content.jurisdiction.code !== code) {
    return undefined;
  }
  return content;
}
