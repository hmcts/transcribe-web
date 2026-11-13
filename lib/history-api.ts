/**
 * Who changed a jurisdiction's settings or a template, when, and what it was before;
 * going back to an earlier version (DIAAT-348).
 *
 * Every save is kept as a version, numbered from 1. Going back saves an earlier
 * version's content again, as a new version; who sees it (its stage, whether it is on,
 * its sign-off) stays as it is. Like a save, it names the version edited, so a change
 * made meanwhile is refused, not undone.
 */

import { AdminApiError } from "@/lib/admin-api";
import type { AdminJurisdiction } from "@/lib/admin-jurisdictions-api";
import { apiClient } from "@/lib/api-client";
import type { AdminTemplate } from "@/lib/templates-api";
import { TemplateRefusedError } from "@/lib/templates-api";

export interface HistoryChange {
  /** What changed: "name", "settings.wording.home.intro", "fields.Party1.label", "file"... */
  setting: string;
  before: unknown;
  after: unknown;
}

export interface HistoryVersion {
  number: number;
  saved_at: string;
  /** null: no user saved it (the command line, or a change found at the next save). */
  saved_by: { id: string; email: string; name: string | null } | null;
  /** The version whose content it put back, when it was saved by going back. */
  restored_from: number | null;
  /** The first version kept: nothing before it to compare with. */
  first: boolean;
  /** Going back to it would change nothing. */
  content_as_now: boolean;
  changes: HistoryChange[];
}

const jurisdiction = (code: string) =>
  `/admin/jurisdictions/${encodeURIComponent(code)}`;
const template = (code: string, id: string) =>
  `${jurisdiction(code)}/templates/${encodeURIComponent(id)}`;

const restoreBody = (version: string): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ version }),
});

async function jurisdictionRequest<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const response = await apiClient.request<T>(endpoint, options);
  if (response.error)
    throw new AdminApiError(response.error, response.status, response.code);
  return response.data as T;
}

async function templateRequest<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const response = await apiClient.request<T>(endpoint, options);
  if (response.error)
    throw new TemplateRefusedError(
      response.error,
      response.problems,
      response.status
    );
  return response.data as T;
}

/** Newest first. */
export async function fetchJurisdictionHistory(
  code: string
): Promise<HistoryVersion[]> {
  return (
    await jurisdictionRequest<{ versions: HistoryVersion[] }>(
      `${jurisdiction(code)}/history`,
      { cache: "no-store" }
    )
  ).versions;
}

export function restoreJurisdiction(
  code: string,
  number: number,
  version: string
): Promise<AdminJurisdiction> {
  return jurisdictionRequest(
    `${jurisdiction(code)}/history/${number}/restore`,
    restoreBody(version)
  );
}

/** Newest first. */
export async function fetchTemplateHistory(
  code: string,
  id: string
): Promise<HistoryVersion[]> {
  return (
    await templateRequest<{ versions: HistoryVersion[] }>(
      `${template(code, id)}/history`,
      { cache: "no-store" }
    )
  ).versions;
}

export function restoreTemplate(
  code: string,
  id: string,
  number: number,
  version: string
): Promise<AdminTemplate> {
  return templateRequest(
    `${template(code, id)}/history/${number}/restore`,
    restoreBody(version)
  );
}

const FIELD_PARTS: Record<string, string> = {
  label: "question",
  type: "type",
  required: "required",
  options: "list",
  source: "filled by BenchNotes with",
};

const SETTINGS: Record<string, string> = {
  name: "Name",
  display_name: "Display name",
  service: "Service",
  stage: "Who sees it",
  signed_off_by: "Signed off by",
  enabled: "Enabled",
  file: "File",
  field_order: "Order of the fields",
  "settings.template": "Template",
  "settings.features.hearing_recordings": "Uses hearing recordings",
};

/** A setting in words: the wording's purpose from `wordingKeys`, a field by its box. */
export function settingName(
  setting: string,
  wordingKeys: Record<string, string> = {}
): string {
  if (Object.hasOwn(SETTINGS, setting)) return SETTINGS[setting];
  const wording = setting.match(/^settings\.wording\.(.+)$/);
  if (wording)
    return `Screen text: ${Object.hasOwn(wordingKeys, wording[1]) ? wordingKeys[wording[1]] : wording[1]}`;
  const field = setting.match(/^fields\.(.+)\.([^.]+)$/);
  if (field)
    return `Field ${field[1]}: ${Object.hasOwn(FIELD_PARTS, field[2]) ? FIELD_PARTS[field[2]] : field[2]}`;
  return setting;
}

/** A value in words: none, yes or no, a list, or the text itself. */
export function valueText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "(none)";
  if (value === true) return "Yes";
  if (value === false) return "No";
  if (Array.isArray(value))
    return value.length ? value.map(valueText).join(", ") : "(none)";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
