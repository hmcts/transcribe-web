import { describe, expect, it } from "vitest";
import { defaultFormValues } from "@/components/audio/dictation/formData";
import {
  draftFormData,
  fromDraftFormData,
  hasWork,
  type RecordDraftWork,
} from "@/lib/record-draft";

// DIAAT-414: the record page's draft keeps the hearing details, notes and a
// template's answers, as well as the transcript.

const NOTES = "<p>Default notes</p>";
const BLANK: RecordDraftWork = {
  transcript: { background: [], evidence: [], facts: [] },
  formData: defaultFormValues,
  notes: NOTES,
  defaultNotes: NOTES,
  templateId: null,
  templateValues: {},
};

describe("the record page's draft (DIAAT-414)", () => {
  it("has nothing to save on an untouched page, or with only the judge's own name", () => {
    expect(hasWork(BLANK)).toBe(false);
    expect(
      hasWork({
        ...BLANK,
        formData: { ...defaultFormValues, judgeName: "Judge Smith" },
      })
    ).toBe(false);
  });

  it("has work to save once anything is entered", () => {
    expect(
      hasWork({
        ...BLANK,
        formData: { ...defaultFormValues, appellantName: "A Person" },
      })
    ).toBe(true);
    expect(hasWork({ ...BLANK, notes: "<p>Credibility</p>" })).toBe(true);
    expect(
      hasWork({
        ...BLANK,
        templateId: "t1",
        templateValues: { Reference: "1/2026" },
      })
    ).toBe(true);
    // Answers with no template to put them in are not kept.
    expect(hasWork({ ...BLANK, templateValues: { Reference: "1/2026" } })).toBe(
      false
    );
  });

  it("keeps the notes and template answers only when there are any, and splits them back", () => {
    expect(draftFormData(BLANK)).toEqual(defaultFormValues);

    const work = {
      ...BLANK,
      formData: { ...defaultFormValues, appellantName: "A Person" },
      notes: "<p>Credibility</p>",
      templateId: "t1",
      templateValues: { Reference: "1/2026" },
    };
    const saved = draftFormData(work);
    expect(saved).toMatchObject({
      appellantName: "A Person",
      notes: "<p>Credibility</p>",
      template: { id: "t1", values: { Reference: "1/2026" } },
    });

    expect(fromDraftFormData(saved)).toEqual({
      formData: work.formData,
      notes: "<p>Credibility</p>",
      template: { id: "t1", values: { Reference: "1/2026" } },
    });
  });

  it("reads a draft saved before DIAAT-414: hearing details only, over the blank form", () => {
    expect(fromDraftFormData({ appellantName: "A Person" })).toEqual({
      formData: { ...defaultFormValues, appellantName: "A Person" },
      notes: null,
      template: null,
    });
  });
});
