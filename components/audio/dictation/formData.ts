import { z } from "zod";
import {
  DEFAULT_JURISDICTION_NAME,
  type DocumentContent,
  type JurisdictionSummary,
} from "@/lib/editor-contracts";
import { shouldPrepopulateLocalDemoData } from "@/lib/environment";

type VisibilityRule = {
  dependsOn: keyof DictationFormValues;
  values: string[];
};

export type FormFieldOption = {
  label: string;
  value: string;
};

const optionalString = () =>
  z
    .string()
    .trim()
    .optional()
    .transform((val) => val ?? "");

const requiredString = (label: string) =>
  z.string().trim().min(1, `${label} is required`);

const toOptions = (values: readonly string[]): FormFieldOption[] =>
  values.map((value) => ({ label: value, value }));

// Hearing types that require representation fields
export const HEARING_REPRESENTATION_TYPES = [
  "face_to_face",
  "cvp",
  "other",
] as const;

// Appellant representative type options
export const APPELLANT_REP_TYPES = [
  "no_rep_no_attend",
  "self_rep",
  "represented",
] as const;

export type AppellantRepType = (typeof APPELLANT_REP_TYPES)[number];

// Labels for appellant representative types (for dropdown display)
export const APPELLANT_REP_TYPE_LABELS: Record<AppellantRepType, string> = {
  no_rep_no_attend: "No representative and did not attend",
  self_rep: "Representing themselves",
  represented: "Represented",
};

const APPELLANT_REP_TYPE_OPTIONS = APPELLANT_REP_TYPES.map((value) => ({
  label: APPELLANT_REP_TYPE_LABELS[value],
  value,
}));

// Respondent representative type options
export const RESPONDENT_REP_TYPES = ["no_rep", "hopo", "counsel"] as const;

export type RespondentRepType = (typeof RESPONDENT_REP_TYPES)[number];

// Labels for respondent representative types (for dropdown display)
export const RESPONDENT_REP_TYPE_LABELS: Record<RespondentRepType, string> = {
  no_rep: "No representative",
  hopo: "Home Office Presenting Officer",
  counsel: "Counsel",
};

const RESPONDENT_REP_TYPE_OPTIONS = RESPONDENT_REP_TYPES.map((value) => ({
  label: RESPONDENT_REP_TYPE_LABELS[value],
  value,
}));

// "Other" document type is for future-proofing but doesn't trigger any conditional behavior yet
export const DOCUMENT_TYPE_OTHER = "Other" as const;

// Location "Other" value that triggers the free-text field
export const LOCATION_OTHER = "Other" as const;

const FALLBACK_HEARING_TYPE_OPTIONS: FormFieldOption[] = [
  { label: "Face to face", value: "face_to_face" },
  { label: "CVP", value: "cvp" },
  { label: "No hearing - A decision on papers", value: "no_hearing_papers" },
  { label: "Other", value: "other" },
];

const FALLBACK_ANONYMITY_ORDER_OPTIONS: FormFieldOption[] = [
  { label: "Yes", value: "granted" },
  { label: "One was sought but refused", value: "sought_but_refused" },
  { label: "No", value: "not_sought" },
];

const FALLBACK_LEGAL_ISSUE_OPTIONS: FormFieldOption[] = [
  {
    label: "Revocation of Protection for Danger - Section 72",
    value: "revocation_protection_danger_section_72",
  },
  {
    label: "Revocation of Protection - Cessation",
    value: "revocation_protection_cessation",
  },
  {
    label: "Revocation of Protection for Misrepresentation",
    value: "revocation_protection_misrepresentation",
  },
  {
    label: "Revocation of Protection for Bad Conduct Pre-Grant - Exclusion",
    value: "revocation_protection_exclusion",
  },
  { label: "Asylum Pre-NABA", value: "asylum_pre_naba" },
  { label: "Asylum Post-NABA", value: "asylum_post_naba" },
  { label: "Humanitarian Protection", value: "humanitarian_protection" },
  { label: "Article 8 Non-deportation", value: "article_8_non_deportation" },
  { label: "EEA Deportation", value: "eea_deportation" },
  { label: "Article 8 Deportation", value: "article_8_deportation" },
  { label: "Article 3 - Deliberate Harm", value: "article_3_deliberate_harm" },
  { label: "Article 3 - Medical", value: "article_3_medical" },
  { label: "EU Settlement Scheme", value: "eu_settlement_scheme" },
  {
    label: "Deprivation of Citizenship - Fraud",
    value: "deprivation_citizenship_fraud",
  },
  {
    label: "Deprivation of Citizenship - Conducive",
    value: "deprivation_citizenship_conducive",
  },
  { label: "Credibility", value: "credibility" },
  { label: "Devaseelan", value: "devaseelan" },
];

// The built-in fallback wording below is the IAC's. It stands in only while the
// IAC's wording has not loaded, never for another jurisdiction.
export const isDefaultJurisdiction = (jurisdiction: string) =>
  jurisdiction === DEFAULT_JURISDICTION_NAME;

// The wording that belongs to the jurisdiction the form currently names.
// Content fetched for another jurisdiction is ignored so a change of
// jurisdiction can never show or submit the previous one's wording.
export const contentForJurisdiction = (
  documentContent: DocumentContent | undefined,
  jurisdiction: string
): DocumentContent | undefined =>
  documentContent &&
  (documentContent.jurisdiction.name === jurisdiction ||
    documentContent.jurisdiction.id === jurisdiction)
    ? documentContent
    : undefined;

// Whether the form asks for legal issues. Until a jurisdiction's wording has
// loaded only the default one is assumed to have legal wording.
export const jurisdictionHasLegalWording = (
  documentContent: DocumentContent | undefined,
  jurisdiction: string
): boolean =>
  documentContent
    ? documentContent.has_legal_wording
    : isDefaultJurisdiction(jurisdiction);

export const dictationFormSchema = z
  .object({
    caseId: requiredString("Case number"),
    location: requiredString("Hearing location"),
    locationOther: optionalString(),
    jurisdiction: requiredString("Jurisdiction"),
    hearingDate: requiredString("Hearing date"),
    judgeName: requiredString("Judge name"),
    anonymityOrder: requiredString("Anonymity order"),
    appellantName: requiredString("Appellant name"),
    respondent: requiredString("Respondent"),
    hearingType: requiredString("Hearing type"),
    // Appellant representation fields
    appellantRepType: optionalString(),
    appellantRepDetails: optionalString(),
    // Respondent representation fields
    respondentRepType: optionalString(),
    respondentRepName: optionalString(),
    appealableDecisionDate: requiredString("Appealable decision date"),
    legalIssues: z
      .array(z.string())
      .min(1, "Select at least one legal issue relevant to the case"),
    documentType: requiredString("Document type"),
  })
  .superRefine((values, ctx) => {
    const needsRepresentation = HEARING_REPRESENTATION_TYPES.includes(
      values.hearingType as (typeof HEARING_REPRESENTATION_TYPES)[number]
    );

    // Appellant representation validation
    if (needsRepresentation && !values.appellantRepType) {
      ctx.addIssue({
        code: "custom",
        message:
          "Appellant representation type is required for this hearing type.",
        path: ["appellantRepType"],
      });
    }

    // Appellant rep details required when "Represented" is selected
    if (
      values.appellantRepType === "represented" &&
      !values.appellantRepDetails.trim()
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Please provide the representative's name and role.",
        path: ["appellantRepDetails"],
      });
    }

    // Respondent representation validation
    if (needsRepresentation && !values.respondentRepType) {
      ctx.addIssue({
        code: "custom",
        message:
          "Respondent representation type is required for this hearing type.",
        path: ["respondentRepType"],
      });
    }

    // Respondent rep name required when HOPO or Counsel is selected
    if (
      (values.respondentRepType === "hopo" ||
        values.respondentRepType === "counsel") &&
      !values.respondentRepName.trim()
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Please provide the representative's name.",
        path: ["respondentRepName"],
      });
    }

    // Require locationOther when "Other" is selected for location
    if (values.location === LOCATION_OTHER && !values.locationOther.trim()) {
      ctx.addIssue({
        code: "custom",
        message: "Please specify the hearing location.",
        path: ["locationOther"],
      });
    }

    // Note: "Other" document type doesn't trigger any conditional behavior yet
    // Future document types may require additional validation here
  });

// The same form for a jurisdiction with no legal wording: no legal issues are
// asked for, so none are required.
const dictationFormSchemaWithoutLegalIssues = dictationFormSchema.safeExtend({
  legalIssues: z.array(z.string()),
});

export const getDictationFormSchema = (requiresLegalIssues = true) =>
  requiresLegalIssues
    ? dictationFormSchema
    : dictationFormSchemaWithoutLegalIssues;

export type DictationFormValues = z.infer<typeof dictationFormSchema>;

export type FieldType = "text" | "select" | "date" | "multiselect";

export type FormField = {
  id: number;
  name: keyof DictationFormValues;
  label: string;
  conditional: boolean;
  conditions?: string | null;
  required: boolean;
  fieldType: FieldType;
  options?: FormFieldOption[];
};

const getHearingTypeOptions = (
  documentContent?: DocumentContent,
  jurisdiction = DEFAULT_JURISDICTION_NAME
): FormFieldOption[] => {
  if (documentContent) {
    return documentContent.hearing_types.map(({ id, title }) => ({
      label: title,
      value: id,
    }));
  }
  return isDefaultJurisdiction(jurisdiction)
    ? FALLBACK_HEARING_TYPE_OPTIONS
    : [];
};

const getAnonymityOrderOptions = (
  documentContent?: DocumentContent,
  jurisdiction = DEFAULT_JURISDICTION_NAME
): FormFieldOption[] => {
  if (documentContent) {
    return documentContent.anonymity.statuses.map(
      ({ id, identifier, title }) => ({
        label: identifier || title,
        value: id,
      })
    );
  }
  return isDefaultJurisdiction(jurisdiction)
    ? FALLBACK_ANONYMITY_ORDER_OPTIONS
    : [];
};

const getLegalIssueOptions = (
  documentContent?: DocumentContent,
  jurisdiction = DEFAULT_JURISDICTION_NAME
): FormFieldOption[] => {
  if (documentContent) {
    return [...documentContent.legal_frameworks]
      .sort((left, right) => left.rank - right.rank)
      .map(({ id, title }) => ({
        label: title,
        value: id,
      }));
  }
  return isDefaultJurisdiction(jurisdiction)
    ? FALLBACK_LEGAL_ISSUE_OPTIONS
    : [];
};

type FormFieldsOptions = {
  // The jurisdiction the form currently names. Defaults to the IAC.
  jurisdiction?: string;
  // Options for the jurisdiction select. Defaults to the IAC alone.
  jurisdictions?: JurisdictionSummary[];
};

export const getFormFields = (
  documentContent?: DocumentContent,
  {
    jurisdiction = DEFAULT_JURISDICTION_NAME,
    jurisdictions,
  }: FormFieldsOptions = {}
): FormField[] => [
  // 1. Case number
  {
    id: 1,
    name: "caseId",
    label: "Case number",
    conditional: false,
    conditions: null,
    required: true,
    fieldType: "text",
    options: [],
  },
  // 2. Document type
  {
    id: 2,
    name: "documentType",
    label: "Document type",
    conditional: false,
    conditions: null,
    required: true,
    fieldType: "select",
    options: toOptions(["Decision", "Other"]),
  },
  // 3. Hearing location
  {
    id: 3,
    name: "location",
    label: "Hearing location",
    conditional: false,
    conditions: null,
    required: true,
    fieldType: "select",
    options: toOptions([
      "Belfast",
      "Birmingham",
      "Bradford",
      "Coventry",
      "Glasgow",
      "Harmondsworth",
      "Hatton Cross",
      "Manchester",
      "Newcastle",
      "Newport",
      "Nottingham",
      "Taylor House",
      "Yarl's Wood",
      "Other",
    ]),
  },
  // 3a. Other location (conditional - shown when "Other" is selected)
  {
    id: 31,
    name: "locationOther",
    label: "Specify location",
    conditional: true,
    conditions: "Visible when 'Other' is selected for hearing location.",
    required: true,
    fieldType: "text",
    options: [],
  },
  // 4. Jurisdiction
  {
    id: 4,
    name: "jurisdiction",
    label: "Jurisdiction",
    conditional: false,
    conditions: null,
    required: true,
    fieldType: "select",
    options: toOptions(
      jurisdictions?.map(({ name }) => name) ?? [DEFAULT_JURISDICTION_NAME]
    ),
  },
  // 5. Hearing date (header field)
  {
    id: 5,
    name: "hearingDate",
    label: "Hearing date",
    conditional: false,
    conditions: null,
    required: true,
    fieldType: "date",
    options: [],
  },
  // 6. Judge name (header field)
  {
    id: 6,
    name: "judgeName",
    label: "Name",
    conditional: false,
    conditions: null,
    required: true,
    fieldType: "text",
    options: [],
  },
  // 7. Hearing type
  {
    id: 7,
    name: "hearingType",
    label: "Hearing type",
    conditional: true,
    conditions:
      "Appellant/Respondent rep fields visible when Face to face or CVP is selected.",
    required: true,
    fieldType: "select",
    options: getHearingTypeOptions(documentContent, jurisdiction),
  },
  // 8. Appellant name
  {
    id: 8,
    name: "appellantName",
    label: "Appellant name",
    conditional: false,
    conditions: null,
    required: true,
    fieldType: "text",
    options: [],
  },
  // 8a. Appellant representative type (conditional dropdown)
  {
    id: 81,
    name: "appellantRepType",
    label: "Appellant representation",
    conditional: true,
    conditions: "Visible when hearing type is Face to face, CVP, or Other.",
    required: true,
    fieldType: "select",
    options: APPELLANT_REP_TYPE_OPTIONS,
  },
  // 8b. Appellant representative details (conditional on appellantRepType)
  {
    id: 82,
    name: "appellantRepDetails",
    label: "Representative name and role",
    conditional: true,
    conditions: "Visible when appellant is represented.",
    required: true,
    fieldType: "text",
    options: [],
  },
  // 9. Respondent
  {
    id: 9,
    name: "respondent",
    label: "Respondent",
    conditional: false,
    conditions: null,
    required: true,
    fieldType: "select",
    options: toOptions([
      "The Entry Clearance Officer",
      "The Immigration Officer",
      "The Secretary of State for the Home Department",
    ]),
  },
  // 9a. Respondent representative type (conditional dropdown)
  {
    id: 91,
    name: "respondentRepType",
    label: "Respondent representation",
    conditional: true,
    conditions: "Visible when hearing type is Face to face, CVP, or Other.",
    required: true,
    fieldType: "select",
    options: RESPONDENT_REP_TYPE_OPTIONS,
  },
  // 9b. Respondent representative name (conditional on respondentRepType)
  {
    id: 92,
    name: "respondentRepName",
    label: "Name of representative",
    conditional: true,
    conditions: "Visible when HOPO or Counsel is selected.",
    required: true,
    fieldType: "text",
    options: [],
  },
  // 10. Anonymity order
  {
    id: 10,
    name: "anonymityOrder",
    label: "Anonymity order",
    conditional: true,
    conditions:
      "Choice determines which blocks of text to pull from the anonymity order table.",
    required: true,
    fieldType: "select",
    options: getAnonymityOrderOptions(documentContent, jurisdiction),
  },
  // 11. Appealed decision date
  {
    id: 11,
    name: "appealableDecisionDate",
    label: "Appealed decision date",
    conditional: false,
    conditions: null,
    required: true,
    fieldType: "date",
    options: [],
  },
  // 12. Legal issues (only for a jurisdiction that has legal wording)
  ...(jurisdictionHasLegalWording(documentContent, jurisdiction)
    ? [
        {
          id: 12,
          name: "legalIssues" as const,
          label: "Legal issues",
          conditional: false,
          conditions:
            "Choice determines which blocks of text to pull from the legal framework table.",
          required: true,
          fieldType: "multiselect" as const,
          options: getLegalIssueOptions(documentContent, jurisdiction),
        },
      ]
    : []),
];

export const visibilityRules: Partial<
  Record<keyof DictationFormValues, VisibilityRule>
> = {
  locationOther: {
    dependsOn: "location",
    values: [LOCATION_OTHER],
  },
  appellantRepType: {
    dependsOn: "hearingType",
    values: [...HEARING_REPRESENTATION_TYPES],
  },
  appellantRepDetails: {
    dependsOn: "appellantRepType",
    values: ["represented"],
  },
  respondentRepType: {
    dependsOn: "hearingType",
    values: [...HEARING_REPRESENTATION_TYPES],
  },
  respondentRepName: {
    dependsOn: "respondentRepType",
    values: ["hopo", "counsel"],
  },
};

export const sanitizeFormValues = (
  values: DictationFormValues,
  documentContent?: DocumentContent
): DictationFormValues => {
  if (!documentContent) {
    return values;
  }

  const validHearingTypes = new Set(
    getHearingTypeOptions(documentContent).map(({ value }) => value)
  );
  const validAnonymityOrders = new Set(
    getAnonymityOrderOptions(documentContent).map(({ value }) => value)
  );
  const validLegalIssues = new Set(
    getLegalIssueOptions(documentContent).map(({ value }) => value)
  );

  return {
    ...values,
    hearingType: validHearingTypes.has(values.hearingType)
      ? values.hearingType
      : "",
    anonymityOrder: validAnonymityOrders.has(values.anonymityOrder)
      ? values.anonymityOrder
      : "",
    legalIssues: values.legalIssues.filter((value) =>
      validLegalIssues.has(value)
    ),
  };
};

// Helper function to get today's date in YYYY-MM-DD format
const getTodayDate = () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const getDefaultFormValues = (judgeName = ""): DictationFormValues =>
  shouldPrepopulateLocalDemoData()
    ? {
        caseId: "31415",
        documentType: "Decision",
        location: "Other",
        locationOther: "St Mellons",
        jurisdiction: DEFAULT_JURISDICTION_NAME,
        hearingDate: getTodayDate(),
        judgeName,
        hearingType: "face_to_face",
        appellantName: "Emily",
        appellantRepType: "self_rep",
        appellantRepDetails: "",
        respondent: "The Secretary of State for the Home Department",
        respondentRepType: "counsel",
        respondentRepName: "Sadie the GSD",
        anonymityOrder: "granted",
        appealableDecisionDate: getTodayDate(),
        legalIssues: ["eea_deportation", "eu_settlement_scheme", "credibility"],
      }
    : {
        caseId: "",
        location: "",
        locationOther: "",
        jurisdiction: DEFAULT_JURISDICTION_NAME,
        hearingDate: getTodayDate(),
        judgeName,
        anonymityOrder: "",
        appellantName: "",
        respondent: "",
        hearingType: "",
        appellantRepType: "",
        appellantRepDetails: "",
        respondentRepType: "",
        respondentRepName: "",
        appealableDecisionDate: "",
        legalIssues: [],
        documentType: "",
      };

export const defaultFormValues: DictationFormValues = getDefaultFormValues();

export const shouldShowField = (
  name: keyof DictationFormValues,
  values: DictationFormValues
) => {
  const rule = visibilityRules[name];

  if (!rule) {
    return true;
  }

  const dependentValue = values[rule.dependsOn];

  if (Array.isArray(dependentValue)) {
    return false;
  }

  return rule.values.includes(dependentValue);
};
