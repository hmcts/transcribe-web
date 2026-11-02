import { describe, expect, it } from "vitest";
import {
  contentForJurisdiction,
  dictationFormSchema,
  getDefaultFormValues,
  getDictationFormSchema,
  getFormFields,
  jurisdictionHasLegalWording,
  sanitizeFormValues,
} from "@/components/audio/dictation/formData";
import {
  createLiveTranscriptionSubmissionPayloadSchema,
  liveTranscriptionSubmissionPayloadSchema,
} from "@/lib/editor-contracts";
import {
  IAC_CONTENT,
  IAC_NAME,
  TAX_CONTENT,
} from "./helpers/document-content";

const TAX_NAME = TAX_CONTENT.jurisdiction.name;

const validForm = {
  caseId: "ABC123",
  location: "Manchester",
  locationOther: "",
  jurisdiction: IAC_NAME,
  hearingDate: "2025-01-15",
  judgeName: "Judge Smith",
  anonymityOrder: "granted",
  appellantName: "John Doe",
  respondent: "The Immigration Officer",
  hearingType: "no_hearing_papers",
  appellantRepType: "",
  appellantRepDetails: "",
  respondentRepType: "",
  respondentRepName: "",
  appealableDecisionDate: "2024-12-01",
  legalIssues: [] as string[],
  documentType: "Decision",
};

const fieldNames = (fields: ReturnType<typeof getFormFields>) =>
  fields.map((field) => field.name);

describe("legal issues are required only where there is legal wording", () => {
  it("form schema: required by default, as for the IAC", () => {
    expect(dictationFormSchema.safeParse(validForm).success).toBe(false);
    expect(getDictationFormSchema().safeParse(validForm).success).toBe(false);
    expect(
      getDictationFormSchema(true).safeParse({
        ...validForm,
        legalIssues: ["credibility"],
      }).success
    ).toBe(true);
  });

  it("form schema: not required for a jurisdiction with no legal wording", () => {
    const result = getDictationFormSchema(false).safeParse({
      ...validForm,
      jurisdiction: TAX_NAME,
    });

    expect(result.success).toBe(true);
  });

  it("form schema: the other rules still apply without legal wording", () => {
    const result = getDictationFormSchema(false).safeParse({
      ...validForm,
      caseId: "",
      hearingType: "face_to_face",
    });

    expect(result.success).toBe(false);
    const paths = result.error?.issues.map((issue) => issue.path[0]);
    expect(paths).toContain("caseId");
    expect(paths).toContain("appellantRepType");
    expect(paths).not.toContain("legalIssues");
  });

  const payload = (legalIssues: string[]) => ({
    form_data: { ...validForm, legalIssues },
    messages: { background: [], evidence: [], facts: [] },
  });

  it("submission schema: required by default", () => {
    expect(
      liveTranscriptionSubmissionPayloadSchema.safeParse(payload([])).success
    ).toBe(false);
    expect(
      createLiveTranscriptionSubmissionPayloadSchema({
        requiresLegalIssues: true,
      }).safeParse(payload([])).success
    ).toBe(false);
  });

  it("submission schema: an empty list is accepted without legal wording", () => {
    const parsed = createLiveTranscriptionSubmissionPayloadSchema({
      requiresLegalIssues: false,
    }).safeParse(payload([]));

    expect(parsed.success).toBe(true);
    expect(parsed.data?.form_data.legalIssues).toEqual([]);
  });

  it("submission schema: still rejects blank legal issue entries", () => {
    expect(
      createLiveTranscriptionSubmissionPayloadSchema({
        requiresLegalIssues: false,
      }).safeParse(payload([" "])).success
    ).toBe(false);
  });
});

describe("the legal issues field", () => {
  it("is shown for the IAC, with and without loaded wording", () => {
    expect(fieldNames(getFormFields(undefined))).toContain("legalIssues");
    expect(fieldNames(getFormFields(IAC_CONTENT))).toContain("legalIssues");
  });

  it("is hidden when the loaded jurisdiction has no legal wording", () => {
    const fields = getFormFields(TAX_CONTENT, { jurisdiction: TAX_NAME });

    expect(fieldNames(fields)).not.toContain("legalIssues");
    expect(fieldNames(fields)).toContain("hearingType");
  });

  it("is hidden for another jurisdiction whose wording has not loaded", () => {
    expect(
      fieldNames(getFormFields(undefined, { jurisdiction: TAX_NAME }))
    ).not.toContain("legalIssues");
  });

  it("jurisdictionHasLegalWording follows the loaded content", () => {
    expect(jurisdictionHasLegalWording(IAC_CONTENT, IAC_NAME)).toBe(true);
    expect(jurisdictionHasLegalWording(TAX_CONTENT, TAX_NAME)).toBe(false);
    expect(jurisdictionHasLegalWording(undefined, IAC_NAME)).toBe(true);
    expect(jurisdictionHasLegalWording(undefined, TAX_NAME)).toBe(false);
  });

  it("legal issues from another jurisdiction are dropped on sanitising", () => {
    const sanitised = sanitizeFormValues(
      {
        ...getDefaultFormValues(""),
        jurisdiction: TAX_NAME,
        hearingType: "face_to_face",
        legalIssues: ["credibility"],
      },
      TAX_CONTENT
    );

    expect(sanitised.legalIssues).toEqual([]);
    expect(sanitised.hearingType).toBe("");
  });
});

describe("the built-in fallback wording is the IAC's alone", () => {
  const optionValues = (
    fields: ReturnType<typeof getFormFields>,
    name: string
  ) =>
    fields.find((field) => field.name === name)?.options?.map((o) => o.value);

  it("fills the IAC's options while its wording has not loaded", () => {
    const fields = getFormFields(undefined);

    expect(optionValues(fields, "legalIssues")).toHaveLength(17);
    expect(optionValues(fields, "hearingType")).toContain("face_to_face");
    expect(optionValues(fields, "anonymityOrder")).toContain("granted");
  });

  it("fills none of another jurisdiction's options", () => {
    const fields = getFormFields(undefined, { jurisdiction: TAX_NAME });

    expect(optionValues(fields, "legalIssues")).toBeUndefined();
    expect(optionValues(fields, "hearingType")).toEqual([]);
    expect(optionValues(fields, "anonymityOrder")).toEqual([]);
  });

  it("uses the loaded wording instead of the fallback", () => {
    const fields = getFormFields(IAC_CONTENT);

    expect(optionValues(fields, "legalIssues")).toEqual(["credibility"]);
    expect(optionValues(fields, "hearingType")).toEqual(["face_to_face"]);
  });
});

describe("jurisdiction options", () => {
  const optionValues = (fields: ReturnType<typeof getFormFields>) =>
    fields.find((field) => field.name === "jurisdiction")?.options;

  it("defaults to the IAC alone", () => {
    expect(optionValues(getFormFields(undefined))).toEqual([
      { label: IAC_NAME, value: IAC_NAME },
    ]);
  });

  it("lists what the API offers, by display name", () => {
    const fields = getFormFields(undefined, {
      jurisdictions: [
        { id: "iac", name: IAC_NAME, has_legal_wording: true },
        { id: "tax", name: TAX_NAME, has_legal_wording: false },
      ],
    });

    expect(optionValues(fields)?.map((option) => option.value)).toEqual([
      IAC_NAME,
      TAX_NAME,
    ]);
  });

  it("the default form still names the IAC", () => {
    expect(getDefaultFormValues("").jurisdiction).toBe(IAC_NAME);
  });
});

describe("contentForJurisdiction", () => {
  it("returns content only for the jurisdiction it was fetched for", () => {
    expect(contentForJurisdiction(IAC_CONTENT, IAC_NAME)).toBe(IAC_CONTENT);
    expect(contentForJurisdiction(IAC_CONTENT, "iac")).toBe(IAC_CONTENT);
    expect(contentForJurisdiction(IAC_CONTENT, TAX_NAME)).toBeUndefined();
    expect(contentForJurisdiction(undefined, IAC_NAME)).toBeUndefined();
  });
});
