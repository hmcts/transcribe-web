import { describe, expect, it } from "vitest";
import {
  type AvailableTemplate,
  fittingValue,
  hiddenFields,
  missingValues,
  sampleValues,
  type TemplateFormField,
  valuesToSend,
} from "@/lib/templates-api";

// A template's hearing type and anonymity boxes are answered from the jurisdiction's
// Document Content, one choice each, as the built-in IAC decision's were.

const HEARING: TemplateFormField = {
  tag: "Hearing",
  label: "Hearing type",
  type: "hearing_type",
  required: true,
  options: [
    { value: "cvp", label: "Video" },
    { value: "papers", label: "On the papers" },
  ],
};
const ANONYMITY: TemplateFormField = {
  tag: "Anonymity",
  label: "Anonymity",
  type: "anonymity",
  required: true,
  options: [
    { value: "granted", label: "Yes" },
    { value: "not_sought", label: "No" },
  ],
};

describe("hearing type and anonymity fields", () => {
  it("start the preview from the first choice", () => {
    const template: AvailableTemplate = {
      id: "t",
      name: "T",
      service: null,
      fields: [HEARING, ANONYMITY],
      sections: [{ tag: "Background", label: "Background" }],
    };
    expect(sampleValues(template)).toEqual({
      Hearing: "cvp",
      Anonymity: "granted",
    });
  });

  it("keep a sample answer only while it is still offered", () => {
    expect(fittingValue(HEARING, "papers")).toBe("papers");
    expect(fittingValue(HEARING, "gone")).toBeNull();
    expect(fittingValue(ANONYMITY, ["granted"])).toBeNull();
    expect(fittingValue(ANONYMITY, undefined)).toBeUndefined();
  });
});

describe("A question asked only after an answer", () => {
  const ASKED: AvailableTemplate = {
    id: "t",
    name: "Decision",
    service: null,
    fields: [
      HEARING,
      {
        tag: "Attended",
        label: "Appellant attended",
        type: "yes_no",
        required: true,
        options: [],
        show_when: { tag: "Hearing", answers: ["cvp"] },
      },
      {
        tag: "Rep",
        label: "Representative",
        type: "text",
        required: true,
        options: [],
        show_when: { tag: "Attended", answers: ["yes"] },
      },
    ],
  };

  it("is not asked, required or sent until that answer is given, nor is one asked after it", () => {
    const papers = { Hearing: "papers", Attended: true, Rep: "Ms A" };
    expect(hiddenFields(ASKED, papers)).toEqual(new Set(["Attended", "Rep"]));
    expect(missingValues(ASKED, { Hearing: "papers" })).toEqual({});
    expect(valuesToSend(ASKED, papers)).toEqual({ Hearing: "papers" });

    expect(hiddenFields(ASKED, { Hearing: "cvp", Attended: false })).toEqual(
      new Set(["Rep"])
    );
    expect(missingValues(ASKED, { Hearing: "cvp", Attended: true })).toEqual({
      Rep: "Representative is required",
    });
  });
});
