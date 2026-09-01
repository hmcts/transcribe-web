import posthog from "posthog-js";

type RecordingMode = "mic" | "screen" | "upload";

type EventPropertiesMap = {
  $pageview: { $current_url: string };
  transcription_started: {
    file_type: string;
    source: "upload" | "recording" | "backup_retry";
    retry_attempt?: number;
    blob_path?: string;
  };
  in_person_recording_completed: {
    duration_seconds: number;
    file_size_bytes: number;
  };
  virtual_meeting_recording_started: {
    mime_type: string;
  };
  virtual_meeting_recording_completed: {
    duration_seconds: number;
    file_size_bytes: number;
    mime_type: string;
  };
  virtual_meeting_recording_failed: {
    duration_seconds: number;
  };
  opened_existing_transcript: {
    transcriptId: string;
  };
  deleted_transcript: {
    transcriptId: string;
  };
  renamed_transcript: {
    transcriptId: string;
  };
  citation_clicked: {
    citationIndex: number;
  };
  speaker_name_edited_in_transcript: {
    old_name: string;
    new_name: string;
    update_type: "all_occurrences" | "single_occurrence";
    entry_index: number;
  };
  minutes_manual_edit_saved: {
    version_id?: string;
  };
  generate_ai_minutes_started: {
    style: string;
  };
  generate_ai_minutes_completed: {
    style: string;
    duration_ms: number;
  };
  generate_ai_minutes_failed: {
    style: string;
    duration_ms: number;
    error_type: string;
  };
  ai_edit_started: {
    style: string;
  };
  ai_edit_completed: {
    style: string;
    duration_ms: number;
  };
  ai_edit_failed: {
    style: string;
    duration_ms: number;
    error_type: string;
  };
  minutes_rating_submitted: {
    version_id?: string;
    rating: number;
    comment: string | null;
  };
  minutes_copied: {
    contentLength: number;
  };
  onboarding_step_viewed: {
    step: number;
    step_name: string;
  };
  onboarding_completed: {
    completed_via: "get_started";
  };
  onboarding_license_check_failed: {
    step: number;
    reason: "missing_auth" | "auth_request_failed";
  };
  hearing_submitted: {
    mode: string;
  };
  hearing_submission_failed: {
    mode: string;
    error_type: string;
  };
  dictation_recording_toggled: {
    action: "start" | "pause";
    mode: string;
  };
  file_upload_selected: {
    file_type: string;
    file_size_bytes: number;
  };
  file_upload_validation_failed: {
    reason: "unsupported_mime_type" | "file_too_large";
    file_type: string;
    file_size_bytes: number;
  };
  error_report_copied: {
    request_id: string | null;
  };
  error_report_downloaded: {
    request_id: string | null;
  };
  start_new_recording_clicked: {
    mode: RecordingMode;
  };
  speaker_name_edited_in_sample_editor: {
    old_name: string;
    new_name: string;
  };
  speaker_audio_sample_played: {
    speaker: string;
    segment_duration: number;
    start_time: number;
  };
};

export type AnalyticsEventName = keyof EventPropertiesMap;

export function track<E extends AnalyticsEventName>(
  eventName: E,
  properties?: EventPropertiesMap[E]
): void;
export function track(
  eventName: string,
  properties?: Record<string, unknown>
): void;
export function track(
  eventName: string,
  properties?: Record<string, unknown>
): void {
  posthog.capture(eventName, properties);
}

export function identifyUser(
  distinctId: string,
  properties: {
    email: string;
    has_completed_onboarding?: boolean;
    environment?: string;
  }
): void {
  posthog.identify(distinctId, properties, {
    $set_once: {
      first_seen_at: new Date().toISOString(),
    },
  });
}

export function getDistinctId(): string | null {
  return posthog.get_distinct_id?.() ?? null;
}
