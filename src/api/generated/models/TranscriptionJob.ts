/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DialogueEntry } from "./DialogueEntry";
export type TranscriptionJob = {
  id?: string;
  created_datetime?: string;
  updated_datetime?: string | null;
  transcription_id: string;
  dialogue_entries: Array<DialogueEntry>;
  error_message?: string | null;
  s3_audio_url?: string | null;
  needs_cleanup?: boolean;
  cleanup_failure_reason?: string | null;
};
