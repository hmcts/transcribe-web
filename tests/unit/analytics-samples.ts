/**
 * One representative call per analytics event, from real call-site values: the
 * source of tests/fixtures/analytics-events.json (analytics-contract.test.ts) and
 * of the consent-class check (telemetry-contract.test.ts).
 */
import type { AnalyticsEventName, EventPropertiesMap } from "@/lib/analytics";

const TID = "6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f";

// Typed: adding an event to EventPropertiesMap without a sample fails type-checking.
export const SAMPLES: { [E in AnalyticsEventName]: EventPropertiesMap[E] } = {
  $pageview: { $current_url: `/transcriptions/${TID}` },
  transcription_started: {
    file_type: "video/webm;codecs=vp9,opus",
    source: "backup_retry",
    retry_attempt: 2,
    blob_path: "user-uploads/oid/x.webm",
  },
  in_person_recording_completed: {
    duration_seconds: 61.6,
    file_size_bytes: 1_234_567,
  },
  virtual_meeting_recording_started: { mime_type: "video/webm;codecs=vp9" },
  virtual_meeting_recording_completed: {
    duration_seconds: 120.2,
    file_size_bytes: 9_999_999,
    mime_type: "audio/x-m4a",
  },
  virtual_meeting_recording_failed: { duration_seconds: 3.4 },
  opened_existing_transcript: { transcriptId: TID },
  deleted_transcript: { transcriptId: TID },
  renamed_transcript: { transcriptId: TID },
  marked_transcript_done: { transcriptId: TID },
  unmarked_transcript_done: { transcriptId: TID },
  citation_clicked: { citationIndex: 3 },
  speaker_name_edited_in_transcript: {
    old_name: "A",
    new_name: "B",
    update_type: "single_occurrence",
    entry_index: 2,
  },
  minutes_manual_edit_saved: { version_id: TID },
  generate_ai_minutes_started: { style: "General" },
  generate_ai_minutes_completed: { style: "Crissa", duration_ms: 12_345 },
  generate_ai_minutes_failed: {
    style: "General",
    duration_ms: 99,
    error_type: "unknown_error",
  },
  ai_edit_started: { style: "Crissa" },
  ai_edit_completed: { style: "General", duration_ms: 4_000 },
  ai_edit_failed: {
    style: "Crissa",
    duration_ms: 50,
    error_type: "AbortError",
  },
  minutes_rating_submitted: { version_id: TID, rating: 5, comment: "text" },
  minutes_copied: { contentLength: 2_048 },
  onboarding_step_viewed: { step: 2, step_name: "transcribe" },
  onboarding_completed: { completed_via: "get_started" },
  onboarding_license_check_failed: { step: 1, reason: "auth_request_failed" },
  file_upload_selected: { file_type: "", file_size_bytes: 3_000_000_000 },
  file_upload_validation_failed: {
    reason: "file_too_large",
    file_type: "audio/mpeg",
    file_size_bytes: 3_000_000_000,
  },
  error_report_copied: { request_id: "0123456789abcdef0123456789abcdef" },
  error_report_downloaded: { request_id: null },
  start_new_recording_clicked: { mode: "upload" },
  speaker_name_edited_in_sample_editor: { old_name: "A", new_name: "B" },
  speaker_audio_sample_played: {
    speaker: "Guest-1",
    segment_duration: 3.25,
    start_time: 10,
  },
};
