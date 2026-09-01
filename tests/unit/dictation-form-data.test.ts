import { describe, expect, it } from "vitest";
import {
  APPELLANT_REP_TYPE_LABELS,
  APPELLANT_REP_TYPES,
  dictationFormSchema,
  getDefaultFormValues,
  getFormFields,
  HEARING_REPRESENTATION_TYPES,
  LOCATION_OTHER,
  RESPONDENT_REP_TYPE_LABELS,
  RESPONDENT_REP_TYPES,
  shouldShowField,
  visibilityRules,
} from "@/components/audio/dictation/formData";

// ─── constants ────────────────────────────────────────────────────────────────

describe("exported constants", () => {
  it("HEARING_REPRESENTATION_TYPES contains expected values", () => {
    expect(HEARING_REPRESENTATION_TYPES).toContain("face_to_face");
    expect(HEARING_REPRESENTATION_TYPES).toContain("cvp");
    expect(HEARING_REPRESENTATION_TYPES).toContain("other");
  });

  it("APPELLANT_REP_TYPES has correct values", () => {
    expect(APPELLANT_REP_TYPES).toContain("no_rep_no_attend");
    expect(APPELLANT_REP_TYPES).toContain("self_rep");
    expect(APPELLANT_REP_TYPES).toContain("represented");
  });

  it("APPELLANT_REP_TYPE_LABELS maps all types", () => {
    for (const type of APPELLANT_REP_TYPES) {
      expect(APPELLANT_REP_TYPE_LABELS[type]).toBeTruthy();
    }
  });

  it("RESPONDENT_REP_TYPES has correct values", () => {
    expect(RESPONDENT_REP_TYPES).toContain("no_rep");
    expect(RESPONDENT_REP_TYPES).toContain("hopo");
    expect(RESPONDENT_REP_TYPES).toContain("counsel");
  });

  it("RESPONDENT_REP_TYPE_LABELS maps all types", () => {
    for (const type of RESPONDENT_REP_TYPES) {
      expect(RESPONDENT_REP_TYPE_LABELS[type]).toBeTruthy();
    }
  });

  it("formFields is a non-empty array", () => {
    expect(getFormFields(undefined).length).toBeGreaterThan(0);
  });

  it("visibilityRules is defined", () => {
    expect(visibilityRules).toBeDefined();
    expect(visibilityRules.locationOther).toBeDefined();
  });
});

// ─── getDefaultFormValues ─────────────────────────────────────────────────────

describe("getDefaultFormValues", () => {
  it("returns empty strings for most fields", () => {
    const vals = getDefaultFormValues();
    expect(vals.caseId).toBe("");
    expect(vals.location).toBe("");
    expect(vals.appellantName).toBe("");
  });

  it("sets jurisdiction to the default value", () => {
    const vals = getDefaultFormValues();
    expect(vals.jurisdiction).toBe(
      "First-tier Tribunal Immigration and Asylum Chamber"
    );
  });

  it("sets hearingDate to today's date", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(getDefaultFormValues().hearingDate).toBe(today);
  });

  it("sets judgeName when provided", () => {
    expect(getDefaultFormValues("Judge Smith").judgeName).toBe("Judge Smith");
  });

  it("returns empty legalIssues array", () => {
    expect(getDefaultFormValues().legalIssues).toEqual([]);
  });
});

// ─── shouldShowField ──────────────────────────────────────────────────────────

describe("shouldShowField", () => {
  const base = getDefaultFormValues();

  it("returns true for fields with no visibility rule", () => {
    expect(shouldShowField("caseId", base)).toBe(true);
    expect(shouldShowField("appellantName", base)).toBe(true);
  });

  it("hides locationOther when location is not 'Other'", () => {
    expect(
      shouldShowField("locationOther", { ...base, location: "London" })
    ).toBe(false);
  });

  it("shows locationOther when location is 'Other'", () => {
    expect(
      shouldShowField("locationOther", { ...base, location: LOCATION_OTHER })
    ).toBe(true);
  });

  it("hides appellantRepType when hearingType is not in HEARING_REPRESENTATION_TYPES", () => {
    expect(
      shouldShowField("appellantRepType", {
        ...base,
        hearingType: "No hearing - A decision on papers",
      })
    ).toBe(false);
  });

  it("shows appellantRepType when hearingType is 'face_to_face'", () => {
    expect(
      shouldShowField("appellantRepType", {
        ...base,
        hearingType: "face_to_face",
      })
    ).toBe(true);
  });

  it("shows appellantRepDetails when appellantRepType is 'represented'", () => {
    expect(
      shouldShowField("appellantRepDetails", {
        ...base,
        appellantRepType: "represented",
      })
    ).toBe(true);
  });

  it("hides appellantRepDetails when appellantRepType is 'self_rep'", () => {
    expect(
      shouldShowField("appellantRepDetails", {
        ...base,
        appellantRepType: "self_rep",
      })
    ).toBe(false);
  });
});

// ─── dictationFormSchema ──────────────────────────────────────────────────────

const validForm = {
  caseId: "ABC123",
  location: "Manchester",
  locationOther: "",
  jurisdiction: "First-tier Tribunal Immigration and Asylum Chamber",
  hearingDate: "2025-01-15",
  judgeName: "Judge Smith",
  anonymityOrder: "No",
  appellantName: "John Doe",
  respondent: "The Immigration Officer",
  hearingType: "No hearing - A decision on papers",
  appellantRepType: "",
  appellantRepDetails: "",
  respondentRepType: "",
  respondentRepName: "",
  appealableDecisionDate: "2024-12-01",
  legalIssues: ["Asylum Pre-NABA"],
  documentType: "Decision",
};

describe("dictationFormSchema", () => {
  it("accepts a valid form", () => {
    expect(dictationFormSchema.safeParse(validForm).success).toBe(true);
  });

  it("rejects missing caseId", () => {
    const result = dictationFormSchema.safeParse({ ...validForm, caseId: "" });
    expect(result.success).toBe(false);
  });

  it("rejects empty legalIssues", () => {
    const result = dictationFormSchema.safeParse({
      ...validForm,
      legalIssues: [],
    });
    expect(result.success).toBe(false);
  });

  it("requires appellantRepType for face-to-face hearings", () => {
    const result = dictationFormSchema.safeParse({
      ...validForm,
      hearingType: "face_to_face",
      appellantRepType: "",
    });
    expect(result.success).toBe(false);
  });

  it("requires locationOther when location is Other", () => {
    const result = dictationFormSchema.safeParse({
      ...validForm,
      location: "Other",
      locationOther: "",
    });
    expect(result.success).toBe(false);
  });
});
