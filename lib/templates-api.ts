/**
 * A jurisdiction's uploaded Word templates (DIAAT-344).
 *
 * In the admin area a SystemAdministrator uploads a template, gets a field for each of
 * its fill-in boxes and links them; judges then choose an enabled template on the
 * recording page and fill its Hearing Details form.
 *
 * The upload goes as the raw request body with Content-Type exactly
 * application/octet-stream and the file's name in X-Upload-Filename, never
 * multipart: Front Door's WAF blocks multipart bodies and lets this path through by
 * a custom Allow rule (see lib/recording/upload-contract.ts).
 */

import { apiClient } from "@/lib/api-client";

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
  enabled: boolean;
  boxes: TemplateBox[];
  fields: TemplateField[];
  /** What stops it being saved or enabled; empty when it is complete. */
  problems: string[];
  version: string;
}

export interface TemplateSave {
  name: string;
  service: string | null;
  fields: TemplateField[];
  enabled: boolean;
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

function isEmpty(value: TemplateValue | undefined): boolean {
  return (
    value === undefined ||
    (typeof value === "string" && !value.trim()) ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** Each required field left empty, by tag: the message to show beside it. */
export function missingValues(
  template: AvailableTemplate,
  values: TemplateValues
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of template.fields) {
    if (field.required && isEmpty(values[field.tag])) {
      errors[field.tag] = `${field.label} is required`;
    }
  }
  return errors;
}

/** The values to send: the template's fields only, empty ones left out. */
export function valuesToSend(
  template: AvailableTemplate,
  values: TemplateValues
): Record<string, TemplateValue> {
  const sent: Record<string, TemplateValue> = {};
  for (const field of template.fields) {
    const value = values[field.tag];
    if (!isEmpty(value)) sent[field.tag] = value as TemplateValue;
  }
  return sent;
}
