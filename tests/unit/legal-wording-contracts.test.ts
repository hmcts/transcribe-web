import { describe, expect, it } from "vitest";
import { DT, ET } from "../jurisdiction-helpers";
import {
  asksForLegalIssues,
  dictationFormSchema,
  getDictationFormSchema,
  getFormFields,
  sanitizeFormValues,
} from "@/components/audio/dictation/formData";
import { canEditLegalWording } from "@/lib/jurisdiction-context";
import {
  contentForJurisdiction,
  type DocumentContent,
  documentContentSchema,
  hasLegalWording,
  liveTranscriptionSubmissionPayloadSchema,
  liveTranscriptionSubmissionPayloadWithoutLegalIssuesSchema,
} from "@/lib/editor-contracts";

// DIAAT-342: legal wording belongs to a jurisdiction, and may be absent.

const HEARING_TYPE = {
  id: "face_to_face",
  title: "Face to face",
  hearing_title: "Hearing",
  hearing_description: "Held in person",
};
const FRAMEWORK = {
  id: "credibility",
  title: "Credibility",
  rank: 1,
  content: "Text",
  issues: [],
};
const LEGACY_RESPONSE = {
  hearing_types: [HEARING_TYPE],
  legal_frameworks: [FRAMEWORK],
  anonymity: { statuses: [] },
};

const parse = (value: unknown): DocumentContent =>
  documentContentSchema.parse(value);

describe("documentContentSchema (DIAAT-342)", () => {
  it("reads which jurisdiction the wording is for and whether it has legal wording", () => {
    const content = parse({
      ...LEGACY_RESPONSE,
      jurisdiction: { code: "ET", name: "Employment Tribunal" },
      has_legal_wording: false,
      legal_frameworks: [],
    });

    expect(content.jurisdiction).toEqual({
      code: "ET",
      name: "Employment Tribunal",
    });
    expect(hasLegalWording(content)).toBe(false);
  });

  it("accepts an older API's response, and takes it as having legal wording", () => {
    const content = parse(LEGACY_RESPONSE);

    expect(content.jurisdiction).toBeUndefined();
    expect(content.has_legal_wording).toBeUndefined();
    expect(hasLegalWording(content)).toBe(true);
  });

  it("does not fail on a malformed jurisdiction or flag", () => {
    const content = parse({
      ...LEGACY_RESPONSE,
      jurisdiction: "ET",
      has_legal_wording: "no",
    });

    expect(content.jurisdiction).toBeUndefined();
    expect(hasLegalWording(content)).toBe(true);
  });
});

describe("contentForJurisdiction", () => {
  const forEt = parse({
    ...LEGACY_RESPONSE,
    jurisdiction: { code: "ET", name: "Employment Tribunal" },
  });

  it("uses content for the jurisdiction the tab works in", () => {
    expect(contentForJurisdiction(forEt, "ET")).toBe(forEt);
  });

  it("ignores content fetched for another jurisdiction", () => {
    expect(contentForJurisdiction(forEt, "IAC")).toBeUndefined();
    expect(contentForJurisdiction(forEt, undefined)).toBeUndefined();
  });

  it("takes content that does not name its jurisdiction as the active one's", () => {
    const legacy = parse(LEGACY_RESPONSE);
    expect(contentForJurisdiction(legacy, "IAC")).toBe(legacy);
  });

  it("has nothing for no content", () => {
    expect(contentForJurisdiction(undefined, "IAC")).toBeUndefined();
  });
});

describe("legal issues in the hearing form schema", () => {
  const valid = {
    caseId: "1",
    location: "Belfast",
    locationOther: "",
    jurisdiction: "First-tier Tribunal Immigration and Asylum Chamber",
    hearingDate: "2026-01-01",
    judgeName: "Judge",
    anonymityOrder: "granted",
    appellantName: "A",
    respondent: "R",
    hearingType: "no_hearing_papers",
    appellantRepType: "",
    appellantRepDetails: "",
    respondentRepType: "",
    respondentRepName: "",
    appealableDecisionDate: "2026-01-01",
    legalIssues: [] as string[],
    documentType: "Decision",
  };

  it("requires one where the jurisdiction has legal wording", () => {
    expect(dictationFormSchema.safeParse(valid).success).toBe(false);
    expect(getDictationFormSchema(true).safeParse(valid).success).toBe(false);
    expect(
      getDictationFormSchema(true).safeParse({
        ...valid,
        legalIssues: ["credibility"],
      }).success
    ).toBe(true);
  });

  it("requires none where it has not, and still requires the rest", () => {
    const schema = getDictationFormSchema(false);

    expect(schema.safeParse(valid).success).toBe(true);
    expect(schema.safeParse({ ...valid, caseId: "" }).success).toBe(false);
  });
});

describe("legal issues in the submission payload schema", () => {
  const messages = { background: [], evidence: [], facts: [] };
  const form = {
    caseId: "1",
    location: "Belfast",
    locationOther: "",
    jurisdiction: "First-tier Tribunal Immigration and Asylum Chamber",
    hearingDate: "2026-01-01",
    judgeName: "Judge",
    anonymityOrder: "granted",
    appellantName: "A",
    respondent: "R",
    hearingType: "no_hearing_papers",
    appellantRepType: "",
    appellantRepDetails: "",
    respondentRepType: "",
    respondentRepName: "",
    appealableDecisionDate: "2026-01-01",
    documentType: "Decision",
  };

  it("requires legal issues by default (the IAC and any jurisdiction with legal wording)", () => {
    const parse = (legalIssues: string[]) =>
      liveTranscriptionSubmissionPayloadSchema.safeParse({
        form_data: { ...form, legalIssues },
        messages,
      }).success;

    expect(parse([])).toBe(false);
    expect(parse(["credibility"])).toBe(true);
  });

  it("submits an empty list, and only that, without legal wording", () => {
    const parse = (legalIssues: string[]) =>
      liveTranscriptionSubmissionPayloadWithoutLegalIssuesSchema.safeParse({
        form_data: { ...form, legalIssues },
        messages,
      }).success;

    expect(parse([])).toBe(true);
    expect(parse(["credibility"])).toBe(false);
  });

  it("stays strict about unknown fields", () => {
    expect(
      liveTranscriptionSubmissionPayloadWithoutLegalIssuesSchema.safeParse({
        form_data: { ...form, legalIssues: [], extra: "x" },
        messages,
      }).success
    ).toBe(false);
  });
});

describe("the form's legal issues field", () => {
  const withoutFrameworks = parse({
    ...LEGACY_RESPONSE,
    has_legal_wording: false,
    legal_frameworks: [],
  });
  const names = (fields: ReturnType<typeof getFormFields>) =>
    fields.map((field) => field.name);

  it("is the jurisdiction's frameworks, in rank order, when it has legal wording", () => {
    const content = parse({
      ...LEGACY_RESPONSE,
      has_legal_wording: true,
      legal_frameworks: [
        { ...FRAMEWORK, id: "b", title: "Second", rank: 2 },
        { ...FRAMEWORK, id: "a", title: "First", rank: 1 },
      ],
    });

    const field = getFormFields(content).find((f) => f.name === "legalIssues");

    expect(field?.options?.map((option) => option.value)).toEqual(["a", "b"]);
  });

  it("is absent when the jurisdiction has no legal wording, even for the IAC", () => {
    expect(names(getFormFields(withoutFrameworks, true))).not.toContain(
      "legalIssues"
    );
    expect(asksForLegalIssues(withoutFrameworks, true)).toBe(false);
  });

  it("falls back to the IAC's shipped list only where that is allowed", () => {
    const iac = getFormFields(undefined, true).find(
      (f) => f.name === "legalIssues"
    );
    expect(iac?.options).toHaveLength(17);

    expect(names(getFormFields(undefined, false))).not.toContain("legalIssues");
    expect(names(getFormFields(undefined))).not.toContain("legalIssues");
    expect(asksForLegalIssues(undefined, false)).toBe(false);
    expect(asksForLegalIssues(undefined, true)).toBe(true);
  });

  it("is dropped from what is already filled in when there is no legal wording", () => {
    const values = {
      ...dictationFormSchema.parse({
        caseId: "1",
        location: "Belfast",
        jurisdiction: "J",
        hearingDate: "2026-01-01",
        judgeName: "Judge",
        anonymityOrder: "granted",
        appellantName: "A",
        respondent: "R",
        hearingType: "face_to_face",
        appellantRepType: "self_rep",
        respondentRepType: "no_rep",
        appealableDecisionDate: "2026-01-01",
        legalIssues: ["credibility"],
        documentType: "Decision",
      }),
    };

    expect(sanitizeFormValues(values, withoutFrameworks).legalIssues).toEqual(
      []
    );
  });
});

describe("canEditLegalWording", () => {
  it("is for an admin of a jurisdiction that has the decision template", () => {
    expect(canEditLegalWording({ ...DT, role: "admin" })).toBe(true);
  });

  it("is not for a judge, a jurisdiction without the template, or none", () => {
    expect(canEditLegalWording({ ...DT, role: "judge" })).toBe(false);
    expect(canEditLegalWording({ ...ET, role: "admin" })).toBe(false);
    expect(canEditLegalWording(null)).toBe(false);
  });
});
