import type {
  HearingDaySummary,
  HearingSummary,
  JobStatus,
  TranscriptionJob,
} from "./types";

// DIAAT-428: the recording lists show one row per hearing. A one-day hearing
// is its recording, exactly as the lists showed it before hearings. A hearing
// of several days has no one file, run or progress of its own, so its row
// takes those from the day in progress, if any.

function isInFlight(day: HearingDaySummary): boolean {
  return day.status === "PENDING" || day.status === "PROCESSING";
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
export function hearingRow(hearing: HearingSummary): TranscriptionJob {
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
  const inFlight = hearing.days.find(isInFlight);
  return {
    ...identity,
    audioFileName: first.audioFileName,
    uploadedAt: latestUpload(hearing.days),
    status: severalDaysStatus(hearing),
    progressPercent: inFlight?.progressPercent ?? 100,
    audioDurationSeconds: inFlight?.audioDurationSeconds,
  };
}
