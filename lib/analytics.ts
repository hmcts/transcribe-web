/**
 * Product analytics (OBS-3: replaces PostHog and Google Tag Manager).
 *
 * `track()` keeps its call-site API, but every event now goes to the first-party
 * telemetry relay (`lib/telemetry-relay`), mapped to a registered event with
 * only controlled attributes (transcribe-api `runtime/telemetry_schema.py`, product events):
 * no names, comments, file names, blob paths or URLs with IDs.
 *
 * Analytics events are sent only with analytics consent (the cookie banner's
 * preference), checked here and again by the relay. Failure events are
 * operational and always sent. No analytics cookies or identifiers are set.
 *
 * Dictation events (speech sessions, autosave, submission) are not tracked here:
 * they are operational and come from `lib/dictation-session` (OBS-4).
 */

import { hasAnalyticsConsent } from "@/lib/analytics-consent";
import {
  type RelayAttributeValue,
  type RelayEvent,
  telemetryRelay,
} from "@/lib/telemetry-relay";

type RecordingMode = "mic" | "screen" | "upload";

export type EventPropertiesMap = {
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
  marked_transcript_done: {
    transcriptId: string;
  };
  unmarked_transcript_done: {
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

interface MappedEvent {
  name: string;
  attributes?: Record<string, RelayAttributeValue | null | undefined>;
  durationMs?: number;
  /** Failure events say something is broken: sent without analytics consent. */
  operational?: boolean;
}

const UUID_OR_ID = /^([0-9a-f]{8}-[0-9a-f-]{27,}|[0-9a-f]{16,}|\d+)$/i;

/** A path with its IDs replaced, e.g. `/transcriptions/:id`; no query or fragment. */
export function normaliseRoute(url: string): string {
  let path: string;
  try {
    path = new URL(url, "https://placeholder.invalid").pathname;
  } catch {
    path = url.split(/[?#]/)[0];
  }
  const route = path
    .split("/")
    .map((segment) =>
      UUID_OR_ID.test(segment) ? ":id" : segment.toLowerCase()
    )
    .join("/")
    .replace(/[^a-z0-9/_:.-]/g, "")
    .slice(0, 100);
  return route.startsWith("/") ? route : `/${route}`;
}

/** The MIME type without parameters (`video/webm;codecs=vp9` -> `video/webm`). */
export function fileType(mime: string | undefined): string {
  const type = (mime ?? "").split(";")[0].trim().toLowerCase();
  return /^[a-z]+\/[a-z0-9.+-]{1,60}$/.test(type) ? type : "unknown";
}

/** error.name values ("TypeError") are controlled codes; anything else is not. */
function errorCode(errorType: string): string {
  return /^[A-Za-z0-9_.:-]{1,64}$/.test(errorType) ? errorType : "unknown";
}

// Every mapped event has `name` first (the backend contract test reads them).
const MAPPINGS: {
  [E in AnalyticsEventName]: (props: EventPropertiesMap[E]) => MappedEvent;
} = {
  $pageview: (p) => ({
    name: "page.viewed",
    attributes: { "page.route": normaliseRoute(p.$current_url) },
  }),
  transcription_started: (p) => ({
    name: "upload.transcription_started",
    attributes: {
      "upload.source": p.source,
      "file.type": fileType(p.file_type),
      "upload.retry_attempt": p.retry_attempt,
    },
  }),
  in_person_recording_completed: (p) => ({
    name: "recording.completed",
    attributes: {
      "recording.mode": "mic",
      "recording.duration_seconds": Math.round(p.duration_seconds),
      "file.size_bytes": p.file_size_bytes,
    },
  }),
  virtual_meeting_recording_started: (p) => ({
    name: "recording.started",
    attributes: {
      "recording.mode": "screen",
      "file.type": fileType(p.mime_type),
    },
  }),
  virtual_meeting_recording_completed: (p) => ({
    name: "recording.completed",
    attributes: {
      "recording.mode": "screen",
      "recording.duration_seconds": Math.round(p.duration_seconds),
      "file.size_bytes": p.file_size_bytes,
      "file.type": fileType(p.mime_type),
    },
  }),
  virtual_meeting_recording_failed: (p) => ({
    name: "recording.failed",
    attributes: {
      "recording.mode": "screen",
      "recording.duration_seconds": Math.round(p.duration_seconds),
    },
    operational: true,
  }),
  // No transcription ID: browser-sent IDs are unverifiable claims, and the
  // contract allows none on these events.
  opened_existing_transcript: () => ({ name: "transcript.opened" }),
  deleted_transcript: () => ({ name: "transcript.deleted" }),
  renamed_transcript: () => ({ name: "transcript.renamed" }),
  marked_transcript_done: () => ({ name: "transcript.marked_done" }),
  unmarked_transcript_done: () => ({ name: "transcript.unmarked_done" }),
  citation_clicked: (p) => ({
    name: "minutes.citation_clicked",
    attributes: { "minutes.citation_index": p.citationIndex },
  }),
  // Speaker names are personal data: only the scope of the change is kept.
  speaker_name_edited_in_transcript: (p) => ({
    name: "transcript.speaker_renamed",
    attributes: { "transcript.update_type": p.update_type },
  }),
  minutes_manual_edit_saved: () => ({ name: "minutes.manual_edit_saved" }),
  generate_ai_minutes_started: (p) => ({
    name: "minutes.generation_started",
    attributes: { "minutes.template": p.style },
  }),
  generate_ai_minutes_completed: (p) => ({
    name: "minutes.generation_completed",
    attributes: { "minutes.template": p.style },
    durationMs: p.duration_ms,
  }),
  generate_ai_minutes_failed: (p) => ({
    name: "minutes.generation_failed",
    attributes: {
      "minutes.template": p.style,
      "hmcts.outcome": "error",
      "hmcts.error.code": errorCode(p.error_type),
    },
    durationMs: p.duration_ms,
    operational: true,
  }),
  ai_edit_started: (p) => ({
    name: "minutes.ai_edit_started",
    attributes: { "minutes.template": p.style },
  }),
  ai_edit_completed: (p) => ({
    name: "minutes.ai_edit_completed",
    attributes: { "minutes.template": p.style },
    durationMs: p.duration_ms,
  }),
  ai_edit_failed: (p) => ({
    name: "minutes.ai_edit_failed",
    attributes: {
      "minutes.template": p.style,
      "hmcts.outcome": "error",
      "hmcts.error.code": errorCode(p.error_type),
    },
    durationMs: p.duration_ms,
    operational: true,
  }),
  // The free-text comment is not sent.
  minutes_rating_submitted: (p) => ({
    name: "minutes.rated",
    attributes: { "minutes.rating": p.rating },
  }),
  minutes_copied: (p) => ({
    name: "minutes.copied",
    attributes: { "minutes.content_length": p.contentLength },
  }),
  onboarding_step_viewed: (p) => ({
    name: "onboarding.step_viewed",
    attributes: {
      "onboarding.step": p.step,
      "onboarding.step_name": p.step_name,
    },
  }),
  onboarding_completed: () => ({ name: "onboarding.completed" }),
  onboarding_license_check_failed: (p) => ({
    name: "onboarding.licence_check_failed",
    attributes: {
      "onboarding.step": p.step,
      "hmcts.error.code": `onboarding.${p.reason}`,
    },
    operational: true,
  }),
  file_upload_selected: (p) => ({
    name: "upload.file_selected",
    attributes: {
      "file.type": fileType(p.file_type),
      "file.size_bytes": p.file_size_bytes,
    },
  }),
  // Not upload.validation_failed: that is the server's validation stage.
  file_upload_validation_failed: (p) => ({
    name: "upload.file_rejected",
    attributes: {
      "hmcts.error.code": `upload.${p.reason}`,
      "file.type": fileType(p.file_type),
      "file.size_bytes": p.file_size_bytes,
    },
    operational: true,
  }),
  error_report_copied: (p) => ({
    name: "support.error_report_copied",
    attributes: { "hmcts.request.id": p.request_id },
  }),
  error_report_downloaded: (p) => ({
    name: "support.error_report_downloaded",
    attributes: { "hmcts.request.id": p.request_id },
  }),
  start_new_recording_clicked: (p) => ({
    name: "recording.new_clicked",
    attributes: { "dictation.mode": p.mode },
  }),
  speaker_name_edited_in_sample_editor: () => ({
    name: "speakers.sample_renamed",
  }),
  speaker_audio_sample_played: (p) => ({
    name: "speakers.sample_played",
    attributes: { "speakers.segment_seconds": p.segment_duration },
  }),
};

export function track<E extends AnalyticsEventName>(
  eventName: E,
  properties: EventPropertiesMap[E]
): void {
  try {
    const mapping = MAPPINGS[eventName] as
      | ((props: EventPropertiesMap[E]) => MappedEvent)
      | undefined;
    if (!mapping) return;
    const mapped = mapping(properties);
    if (!mapped.operational && !hasAnalyticsConsent()) return;
    const event: RelayEvent = {
      name: mapped.name,
      attributes: mapped.attributes,
      durationMs: mapped.durationMs,
    };
    telemetryRelay.emit(event);
  } catch {
    // Analytics must never break the app.
  }
}
