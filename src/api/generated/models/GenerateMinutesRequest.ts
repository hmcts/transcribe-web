/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TemplateMetadata } from "./TemplateMetadata";
export type GenerateMinutesRequest = {
  transcription_id: string;
  template: TemplateMetadata;
  edit_instructions?: string | null;
  current_minute_version_id?: string | null;
  action_type: GenerateMinutesRequest.action_type;
};
export namespace GenerateMinutesRequest {
  export enum action_type {
    GENERATE = "generate",
    EDIT = "edit",
  }
}
