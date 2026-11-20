import { describe, expect, it } from "vitest";
import {
  type DocumentContent,
  documentContentSchema,
  hasLegalWording,
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
