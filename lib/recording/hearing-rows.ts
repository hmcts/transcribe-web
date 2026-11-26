import type {
  HearingDaySummary,
  HearingSummary,
  JobStatus,
  TranscriptionJob,
} from "./types";

// DIAAT-428: the recording lists show one row per hearing. A one-day hearing
// is its recording, exactly as the lists showed it before hearings. A hearing
// of several days has no one file, run or progress of its own: its progress is
// that of the day in progress, if any (inFlightDay).

export interface HearingRow extends TranscriptionJob {
  inFlightDay?: TranscriptionJob;
}

// The day the row's status is about: one being transcribed before one still
// being prepared, as severalDaysStatus decides.
function dayInFlight(days: HearingDaySummary[]): HearingDaySummary | undefined {
  return (
    days.find((day) => day.status === "PROCESSING") ??
    days.find((day) => day.status === "PENDING")
  );
}

function severalDaysStatus(hearing: HearingSummary): JobStatus {
  if (hearing.days.some((day) => day.status === "PROCESSING")) {
    return "PROCESSING";
  }
  if (hearing.days.some((day) => day.status === "PENDING")) return "PENDING";
  // A partial hearing (some days failed) still has a transcript to open.
  return hearing.status === "failed" ? "FAILED" : "COMPLETED";
}

function latestUpload(days: HearingDaySummary[]): string {
  return days.reduce(
    (latest, day) =>
      new Date(day.uploadedAt).getTime() > new Date(latest).getTime()
        ? day.uploadedAt
        : latest,
    days[0].uploadedAt
  );
}

/** The row for a hearing with at least one day. */
export function hearingRow(hearing: HearingSummary): HearingRow {
  const [first] = hearing.days;
  const identity = {
    id: hearing.id,
    caseReference: hearing.caseReference,
    tribunal: hearing.tribunal,
  };
  if (hearing.days.length === 1) {
    return {
      ...identity,
      audioFileName: first.audioFileName,
      uploadedAt: first.uploadedAt,
      status: first.status,
      progressPercent: first.progressPercent,
      errorMessage: first.errorMessage,
      audioDurationSeconds: first.audioDurationSeconds,
      transcriptionDurationSeconds: first.transcriptionDurationSeconds,
      modelIdentifier: first.modelIdentifier,
      modelDisplayName: first.modelDisplayName,
    };
  }
  const inFlight = dayInFlight(hearing.days);
  return {
    ...identity,
    audioFileName: first.audioFileName,
    uploadedAt: latestUpload(hearing.days),
    status: severalDaysStatus(hearing),
    progressPercent: inFlight?.progressPercent ?? 100,
    inFlightDay: inFlight && {
      ...identity,
      id: inFlight.jobId,
      audioFileName: inFlight.audioFileName,
      uploadedAt: inFlight.uploadedAt,
      status: inFlight.status,
      progressPercent: inFlight.progressPercent,
      audioDurationSeconds: inFlight.audioDurationSeconds,
    },
  };
}
