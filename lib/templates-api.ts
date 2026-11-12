/**
 * A jurisdiction's uploaded Word templates (DIAAT-344).
 *
 * In the admin area an administrator who may manage templates uploads one, gets a field for each of
 * its fill-in boxes and links them; judges then choose a template on the
 * recording page and fill its Hearing Details form. Before then (DIAAT-346) the admin
 * previews it: fills that form with sample details and downloads the document a judge
 * would get.
 *
 * The upload goes as the raw request body with Content-Type exactly
 * application/octet-stream and the file's name in X-Upload-Filename, never
 * multipart: Front Door's WAF blocks multipart bodies and lets this path through by
 * a custom Allow rule (see lib/recording/upload-contract.ts).
 */

import { apiClient } from "@/lib/api-client";
import type { SignOff } from "@/lib/sign-off";

export type TemplateFieldType =
  | "text"
  | "date"
  | "dropdown"
  | "multi_select"
  | "yes_no"
  | "number"
  | "legal_issues"
  | "benchnotes"
  | "dictated";

export type BenchNotesSource = "jurisdiction" | "year";

/** The admin's field types, in the order the field list offers them. */
export const FIELD_TYPES: { value: TemplateFieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "date", label: "Date" },
  { value: "dropdown", label: "Dropdown" },
  { value: "multi_select", label: "Select / list (several)" },
  { value: "yes_no", label: "Yes / No" },
  { value: "number", label: "Number" },
  { value: "legal_issues", label: "Existing capability" },
  { value: "benchnotes", label: "Filled by BenchNotes" },
  { value: "dictated", label: "Dictated text (the judgment)" },
];

export const BENCHNOTES_SOURCES: { value: BenchNotesSource; label: string }[] =
  [
    { value: "jurisdiction", label: "The jurisdiction's name" },
    { value: "year", label: "The year" },
  ];

export const LIST_TYPES: TemplateFieldType[] = ["dropdown", "multi_select"];

/** A box in the uploaded file: every content control with this key. */
export interface TemplateBox {
  key: string;
  label: string;
  kind: "text" | "dropdown" | "date";
  options: string[];
  count: number;
}

/** What fills one box, as the admin set it up. */
export interface TemplateField {
  tag: string;
  label: string;
  type: TemplateFieldType;
  required: boolean;
  options: string[];
  source: BenchNotesSource | null;
}

export interface AdminTemplate {
  id: string;
  name: string;
  service: string | null;
  file_name: string;
  /** Who can choose it (DIAAT-347): draft, no judge; test, the jurisdiction's test
   * group and administrators; live, all its judges. */
  stage: TemplateStage;
  /** The service lead's sign-off it went live with; null while it is not live. */
  sign_off: SignOff | null;
  boxes: TemplateBox[];
  fields: TemplateField[];
  /** What stops it being saved or moved on; empty when it is complete. */
  problems: string[];
  version: string;
}

export type TemplateStage = "draft" | "test" | "live";

export const TEMPLATE_STAGES: { value: TemplateStage; label: string }[] = [
  { value: "draft", label: "Draft: no judge can choose it" },
  {
    value: "test",
    label: "Test: its test group and administrators can choose it",
  },
  { value: "live", label: "Live: all its judges can choose it" },
];

export interface TemplateSave {
  name: string;
  service: string | null;
  fields: TemplateField[];
  stage: TemplateStage;
  /** Needed when it goes live (DIAAT-347). */
  sign_off?: { service_lead: string; confirmed: true } | null;
  version: string;
}

/** A refusal with the API's list of what is missing (each box or field named). */
export class TemplateRefusedError extends Error {
  readonly problems: string[];
  readonly status?: number;

  constructor(message: string, problems: string[] = [], status?: number) {
    super(message);
    this.name = "TemplateRefusedError";
    this.problems = problems;
    this.status = status;
  }
}

async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await apiClient.request<T>(endpoint, options);
  if (response.error)
    throw new TemplateRefusedError(
      response.error,
      response.problems,
      response.status
    );
  return response.data as T;
}

const base = (code: string) =>
  `/admin/jurisdictions/${encodeURIComponent(code)}/templates`;

export function fetchTemplates(code: string): Promise<AdminTemplate[]> {
  return request(base(code));
}

export const UPLOAD_CONTENT_TYPE = "application/octet-stream";

/** Upload a template, or (``replace``) a new file for one. */
export function uploadTemplate(
  code: string,
  file: File,
  replace?: { id: string; version: string }
): Promise<AdminTemplate> {
  const query = replace
    ? `?${new URLSearchParams({ replace: replace.id, version: replace.version })}`
    : "";
  return request(`${base(code)}${query}`, {
    method: "POST",
    body: file,
    headers: {
      "Content-Type": UPLOAD_CONTENT_TYPE,
      "X-Upload-Filename": encodeURIComponent(file.name),
    },
  });
}

export function saveTemplate(
  code: string,
  id: string,
  body: TemplateSave
): Promise<AdminTemplate> {
  return request(`${base(code)}/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function deleteTemplate(code: string, id: string): Promise<void> {
  return request(`${base(code)}/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

// The judge's side --------------------------------------------------------------------

export interface TemplateOption {
  value: string;
  label: string;
}

/** One field of the Hearing Details form built from a template. */
export interface TemplateFormField {
  tag: string;
  label: string;
  type: Exclude<TemplateFieldType, "benchnotes" | "dictated">;
  required: boolean;
  options: TemplateOption[];
}

export interface AvailableTemplate {
  id: string;
  name: string;
  service: string | null;
  fields: TemplateFormField[];
}

export type TemplateValue = string | boolean | string[];
export type TemplateValues = Record<string, TemplateValue | undefined>;

/** The templates the tab's jurisdiction's judges can choose. */
export function fetchAvailableTemplates(): Promise<AvailableTemplate[]> {
  return request("/jurisdictions/templates");
}

/**
 * A value by box tag, its own only. Tags are whatever the template's author typed in
 * Word, so one can be "__proto__" or "constructor": a plain lookup would find
 * Object.prototype's instead. Maps of tags are built with Object.fromEntries or
 * computed keys, which always make own properties.
 */
export function ownValue<T>(
  record: Readonly<Record<string, T>>,
  key: string
): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function isEmpty(value: TemplateValue | undefined): boolean {
  return (
    value === undefined ||
    (typeof value === "string" && !value.trim()) ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** Whether the judge has answered anything: answers are not kept in the draft. */
export function hasAnswers(values: TemplateValues): boolean {
  return Object.values(values).some((value) => !isEmpty(value));
}

/** Each required field left empty, by tag: the message to show beside it. */
export function missingValues(
  template: AvailableTemplate,
  values: TemplateValues
): Record<string, string> {
  return Object.fromEntries(
    template.fields
      .filter((field) => field.required && isEmpty(ownValue(values, field.tag)))
      .map((field) => [field.tag, `${field.label} is required`])
  );
}

/** The values to send: the template's fields only, empty ones left out. */
export function valuesToSend(
  template: AvailableTemplate,
  values: TemplateValues
): Record<string, TemplateValue> {
  return Object.fromEntries(
    template.fields.flatMap((field) => {
      const value = ownValue(values, field.tag);
      return isEmpty(value) ? [] : [[field.tag, value as TemplateValue]];
    })
  );
}

// The admin's preview (DIAAT-346) ------------------------------------------------------

const templatePath = (code: string, id: string) =>
  `${base(code)}/${encodeURIComponent(id)}`;

function localDate(day: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

/** Sample details to start the preview from: something in every field, which the
 * admin can change. */
export function sampleValues(
  template: AvailableTemplate,
  today: Date = new Date()
): TemplateValues {
  return Object.fromEntries(
    template.fields.map((field): [string, TemplateValue | undefined] => {
      const first = field.options[0]?.value;
      switch (field.type) {
        case "date":
          return [field.tag, localDate(today)];
        case "number":
          return [field.tag, "1"];
        case "yes_no":
          return [field.tag, true];
        case "dropdown":
          return [field.tag, first];
        case "multi_select":
        case "legal_issues":
          return [field.tag, first === undefined ? [] : [first]];
        default:
          return [field.tag, `Sample ${field.label}`];
      }
    })
  );
}

/** A real calendar date written YYYY-MM-DD, as the date picker and the API take it:
 * not 2026-02-31. */
function isCalendarDate(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * A sample answer kept from before a save, as it fits the field now (the admin may
 * have changed its type or options since): only the choices still offered, and null
 * when the field's control could not show it or the API would refuse it, so a new
 * sample is used instead. An unanswered field (undefined) stays unanswered.
 */
export function fittingValue(
  field: TemplateFormField,
  value: TemplateValue | undefined
): TemplateValue | undefined | null {
  if (value === undefined) return undefined;
  const offered = new Set(field.options.map((option) => option.value));
  switch (field.type) {
    case "yes_no":
      return typeof value === "boolean" ? value : null;
    case "multi_select":
    case "legal_issues": {
      if (!Array.isArray(value)) return null;
      const kept = value.filter((choice) => offered.has(choice));
      return kept.length === 0 && value.length > 0 ? null : kept;
    }
    case "dropdown":
      return typeof value === "string" && (!value || offered.has(value))
        ? value
        : null;
    case "date": {
      if (typeof value !== "string") return null;
      const text = value.trim();
      return !text || isCalendarDate(text) ? text : null;
    }
    case "number": {
      if (typeof value !== "string") return null;
      const text = value.trim();
      return !text || Number.isFinite(Number(text)) ? text : null;
    }
    default:
      return typeof value === "string" ? value : null;
  }
}

/**
 * A failure of the preview, in plain words (TemplateRefusedError, with ``problems``
 * when the API lists them), also when it is not the API's own: a network error, or a
 * page from the firewall.
 */
function previewFailure(response: {
  error?: string;
  problems?: string[];
  status?: number;
}): TemplateRefusedError {
  // Not the API's own words: a page it did not write ("HTTP error!"), or a 405, which
  // the client words for developers before reading any body.
  const own =
    response.status !== undefined &&
    response.status !== 405 &&
    !/^HTTP error!/.test(response.error ?? "");
  return new TemplateRefusedError(
    own
      ? (response.error ?? "")
      : response.status === undefined
        ? "BenchNotes could not be reached to make the preview. Check your connection and try again."
        : `BenchNotes could not make the preview (error ${response.status}). Try again, and if it keeps failing, contact the BenchNotes team.`,
    response.problems,
    response.status
  );
}

/** The template's Hearing Details form as its judges will get it, whether or not
 * they can choose it yet. */
export async function fetchTemplateForm(
  code: string,
  id: string
): Promise<AvailableTemplate> {
  const response = await apiClient.request<AvailableTemplate>(
    `${templatePath(code, id)}/form`
  );
  if (response.error) throw previewFailure(response);
  return response.data as AvailableTemplate;
}

/** The template filled with ``values`` as a judge's submission fills it: the .docx a
 * judge would get, with sample text where the dictation goes. */
export async function previewTemplate(
  code: string,
  id: string,
  body: { values: Record<string, TemplateValue>; version: string }
): Promise<Blob> {
  const response = await apiClient.request<Blob>(
    `${templatePath(code, id)}/preview`,
    { method: "POST", body: JSON.stringify(body) },
    { as: "blob" }
  );
  if (response.error) throw previewFailure(response);
  return response.data as Blob;
}
