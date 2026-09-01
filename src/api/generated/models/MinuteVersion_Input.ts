/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TemplateMetadata } from "./TemplateMetadata";
export type MinuteVersion_Input = {
  id?: string;
  created_datetime?: string;
  updated_datetime?: string | null;
  html_content: string;
  template: TemplateMetadata;
  transcription_id: string;
  trace_id?: string | null;
  star_rating?: number | null;
  star_rating_comment?: string | null;
  is_generating?: boolean | null;
  error_message?: string | null;
};
