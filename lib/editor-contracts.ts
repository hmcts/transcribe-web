import { z } from "zod";

const NON_EMPTY_TEXT = z.string().trim().min(1);
const CONTENT_ID = z
  .string()
  .trim()
  .regex(/^[a-z0-9_]+$/);
const MAX_EDITOR_TEXT_LENGTH = 200_000;

export function normalizeOptionalEditorText(
  value: string | null | undefined
): string | null {
  if (value == null) {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

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
    // A string, or the API's `{code, message}` refusal.
    detail: z
      .union([NON_EMPTY_TEXT, z.object({ message: NON_EMPTY_TEXT }).loose()])
      .optional(),
  })
  .refine(
    (value) => Boolean(value.error || value.detail),
    "Expected either an error or detail message"
  )
  .transform((value) => ({
    error:
      value.error ??
      (typeof value.detail === "string"
        ? value.detail
        : value.detail?.message) ??
      "Unknown error",
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
