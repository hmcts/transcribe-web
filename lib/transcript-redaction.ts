import type {
  SectionedTranscript,
  TranscriptEntry,
} from "@/components/audio/dictation/types";

export interface TranscriptRedactionContext {
  appellantName?: string | null;
}

const PII_PLACEHOLDER_PATTERN = /(?:<|&lt;)\s*([^>&]+?)\s*(?:>|&gt;)/gi;
const DATE_VALUE_PATTERN =
  "\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}|\\d{1,2}\\s+(?:jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\\s+\\d{2,4}";
const POSTCODE_VALUE_PATTERN = "[A-Z]{1,2}\\d[A-Z\\d]?\\s*\\d[A-Z]{2}";

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN = /(?:\+44\s?(?:\(0\)\s?)?|0)\d(?:[\s-]?\d){8,10}\b/g;
const NI_NUMBER_PATTERN =
  /\b(?!BG|GB|KN|NK|NT|TN|ZZ)[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/gi;
const DOB_NUMERIC_PATTERN = new RegExp(
  `\\b((?:date of birth|dob)\\s*[:-]?\\s*)(${DATE_VALUE_PATTERN})\\b`,
  "gi"
);
const DOB_TEXTUAL_PATTERN = new RegExp(
  `\\b((?:date of birth|dob)\\s*[:-]?\\s*)(${DATE_VALUE_PATTERN})\\b`,
  "gi"
);
const BORN_ON_PATTERN = new RegExp(
  `\\b((?:was born on|born on|born)\\s+)(${DATE_VALUE_PATTERN})\\b`,
  "gi"
);
const POSTCODE_PATTERN = new RegExp(
  `\\b((?:post\\s?code)\\s*[:-]?\\s*)(${POSTCODE_VALUE_PATTERN})\\b`,
  "gi"
);
const STANDALONE_POSTCODE_PATTERN = new RegExp(
  `\\b${POSTCODE_VALUE_PATTERN}\\b`,
  "gi"
);
const ADDRESS_PATTERN = new RegExp(
  `\\b(?:(?:Flat|Apartment|Apt|Unit|Room)\\s+[A-Z0-9-]+,?\\s+)?\\d{1,5}[A-Z]?\\s+[A-Z][a-z]+(?:\\s+[A-Z][a-z]+){0,4}\\s+(?:Street|St|Road|Rd|Lane|Ln|Avenue|Ave|Drive|Dr|Way|Close|Court|Place|Pl|Terrace|Gardens|Grove|Crescent|Cres|Square|Parade|Mews)\\b(?:,?\\s+(?![A-Z]{1,2}\\d)[A-Z][A-Za-z'-]+(?:\\s+(?![A-Z]{1,2}\\d)[A-Z][A-Za-z'-]+)*)*(?:,?\\s*${POSTCODE_VALUE_PATTERN})?`,
  "gi"
);
const HONORIFIC_NAME_PATTERN =
  /\b(?:Mr|Mrs|Ms|Miss|Mx|Dr|Prof(?:essor)?|Sir|Dame|Lord|Lady|Judge|Justice)\.?\s+[A-Z][a-z]+(?:[-'][A-Z][a-z]+)*(?:\s+[A-Z][a-z]+(?:[-'][A-Z][a-z]+)*){0,2}\b/g;
const CASE_NAME_PATTERN =
  /\b((?:case|appeal)\s+of\s+)([A-Z][a-z]+(?:[-'][A-Z][a-z]+)*(?:\s+[A-Z][a-z]+(?:[-'][A-Z][a-z]+)*){0,2})(?=\s+(?:versus|v\.?)\b)/g;
const SELF_IDENTIFICATION_PATTERN =
  /\b(?:([Mm]y name is|[Ii] am|[Tt]his is)\s+)([A-Z][a-z]+(?:[-'][A-Z][a-z]+)*(?:\s+[A-Z][a-z]+(?:[-'][A-Z][a-z]+)*){0,2})\b/g;
const APPEARANCE_NAME_PATTERN =
  /\b([A-Z][a-z]+(?:[-'][A-Z][a-z]+)*(?:\s+[A-Z][a-z]+(?:[-'][A-Z][a-z]+)*){1,2})(?=\s+(?:appearing|speaking|submitting|representing|on behalf of)\b)/g;

const GENERIC_SPEAKER_PATTERN =
  /^(?:judge|counsel|witness|appellant|respondent|interpreter|clerk|unknown|participant-\d+|speaker \d+)$/i;
const PERSON_SPEAKER_PATTERN =
  /^(?:(?:Mr|Mrs|Ms|Miss|Mx|Dr|Prof(?:essor)?|Sir|Dame|Lord|Lady|Judge|Justice)\.?\s+)?[A-Z][a-z]+(?:[-'][A-Z][a-z]+)*(?:\s+[A-Z][a-z]+(?:[-'][A-Z][a-z]+)*){0,2}$/;
const HONORIFIC_TOKEN_PATTERN =
  /^(?:mr|mrs|ms|miss|mx|dr|prof|professor|sir|dame|lord|lady|judge|justice)\.?$/i;

const normalizePlaceholder = (value: string) =>
  value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();

const normalizePersonName = (value: string) =>
  value.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildAppellantNameVariants = (
  appellantName?: string | null
): string[] => {
  const parts = normalizePersonName(appellantName ?? "");
  if (parts.length === 0) {
    return [];
  }

  const meaningfulParts = parts.filter(
    (part) => !HONORIFIC_TOKEN_PATTERN.test(part)
  );
  const baseParts = meaningfulParts.length > 0 ? meaningfulParts : parts;
  const variants = new Set<string>();
  const fullName = baseParts.join(" ");

  if (fullName) {
    variants.add(fullName);
  }
  if (baseParts.length > 0) {
    variants.add(baseParts[0] ?? "");
  }
  if (baseParts.length > 1) {
    const surname = baseParts[baseParts.length - 1];
    if (surname && surname.length >= 4) {
      variants.add(surname);
    }
    variants.add(`${baseParts[0]} ${surname}`);
  }

  return [...variants]
    .map((variant) => variant.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
};

const redactAppellantName = (
  value: string,
  appellantName?: string | null
): string => {
  let redacted = value;

  for (const variant of buildAppellantNameVariants(appellantName)) {
    const pattern = variant
      .split(/\s+/)
      .map((part) => escapeRegExp(part))
      .join("\\s+");
    const regex = new RegExp(`\\b${pattern}\\b(['’]s)?`, "gi");

    redacted = redacted.replace(regex, "[NAME REDACTED]$1");
  }

  return redacted;
};

const getPlaceholderRedaction = (placeholder: string): string | null => {
  const normalized = normalizePlaceholder(placeholder);

  if (
    normalized === "name" ||
    normalized.includes("full name") ||
    normalized.includes("first name") ||
    normalized.includes("last name") ||
    normalized.includes("given name") ||
    normalized.includes("surname")
  ) {
    return "[NAME REDACTED]";
  }

  if (normalized.includes("email")) {
    return "[EMAIL REDACTED]";
  }

  if (
    normalized.includes("phone") ||
    normalized.includes("telephone") ||
    normalized.includes("mobile") ||
    normalized.includes("contact number")
  ) {
    return "[PHONE REDACTED]";
  }

  if (normalized.includes("address")) {
    return "[ADDRESS REDACTED]";
  }

  if (
    normalized === "dob" ||
    normalized.includes("date of birth") ||
    normalized.includes("birth date")
  ) {
    return "[DATE OF BIRTH REDACTED]";
  }

  if (
    normalized.includes("national insurance") ||
    normalized === "ni number" ||
    normalized === "nino"
  ) {
    return "[NI NUMBER REDACTED]";
  }

  if (normalized.includes("post code") || normalized.includes("postcode")) {
    return "[POSTCODE REDACTED]";
  }

  return null;
};

export const redactPiiText = (
  value: string,
  context: TranscriptRedactionContext = {}
): string => {
  if (!value) {
    return value;
  }

  let redacted = value.replace(
    PII_PLACEHOLDER_PATTERN,
    (match, placeholder) => {
      return getPlaceholderRedaction(placeholder) ?? match;
    }
  );

  redacted = redacted.replace(EMAIL_PATTERN, "[EMAIL REDACTED]");
  redacted = redacted.replace(PHONE_PATTERN, "[PHONE REDACTED]");
  redacted = redacted.replace(NI_NUMBER_PATTERN, "[NI NUMBER REDACTED]");
  redacted = redacted.replace(
    DOB_NUMERIC_PATTERN,
    "$1[DATE OF BIRTH REDACTED]"
  );
  redacted = redacted.replace(
    DOB_TEXTUAL_PATTERN,
    "$1[DATE OF BIRTH REDACTED]"
  );
  redacted = redacted.replace(BORN_ON_PATTERN, "$1[DATE OF BIRTH REDACTED]");
  redacted = redacted.replace(POSTCODE_PATTERN, "$1[POSTCODE REDACTED]");
  redacted = redacted.replace(ADDRESS_PATTERN, "[ADDRESS REDACTED]");
  redacted = redacted.replace(
    STANDALONE_POSTCODE_PATTERN,
    "[POSTCODE REDACTED]"
  );
  redacted = redacted.replace(HONORIFIC_NAME_PATTERN, "[NAME REDACTED]");
  redacted = redacted.replace(CASE_NAME_PATTERN, "$1[NAME REDACTED]");
  redacted = redacted.replace(
    SELF_IDENTIFICATION_PATTERN,
    "$1 [NAME REDACTED]"
  );
  redacted = redacted.replace(APPEARANCE_NAME_PATTERN, "[NAME REDACTED]");
  redacted = redactAppellantName(redacted, context.appellantName);

  return redacted;
};

const redactSpeakerLabel = (
  speaker: string,
  context: TranscriptRedactionContext = {}
): string => {
  const redactedSpeaker = redactPiiText(speaker, context);
  if (redactedSpeaker !== speaker) {
    return redactedSpeaker;
  }

  const trimmedSpeaker = speaker.trim();
  if (!trimmedSpeaker || GENERIC_SPEAKER_PATTERN.test(trimmedSpeaker)) {
    return speaker;
  }

  if (PERSON_SPEAKER_PATTERN.test(trimmedSpeaker)) {
    return "[NAME REDACTED]";
  }

  return speaker;
};

export const redactTranscriptEntry = (
  entry: TranscriptEntry,
  context: TranscriptRedactionContext = {}
): TranscriptEntry => ({
  ...entry,
  speaker: redactSpeakerLabel(entry.speaker, context),
  text: redactPiiText(entry.text, context),
});

export const redactSectionedTranscript = (
  transcript: SectionedTranscript,
  context: TranscriptRedactionContext = {}
): SectionedTranscript => ({
  background: transcript.background.map((entry) =>
    redactTranscriptEntry(entry, context)
  ),
  evidence: transcript.evidence.map((entry) =>
    redactTranscriptEntry(entry, context)
  ),
  facts: transcript.facts.map((entry) => redactTranscriptEntry(entry, context)),
});
