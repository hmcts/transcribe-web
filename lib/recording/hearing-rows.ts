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
  // Only a hearing of several days has its days listed (DIAAT-430).
  days?: HearingDaySummary[];
}

export interface DayStatusNote {
  text: string;
  tone: "neutral" | "error";
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
    days: hearing.days,
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

function countDays(row: HearingRow, status: JobStatus): number {
  return row.days?.filter((day) => day.status === status).length ?? 0;
}

/** True while the row will still change: some day is yet to finish. */
export function isInFlight(row: HearingRow): boolean {
  return row.status === "PENDING" || row.status === "PROCESSING";
}

/** True once the row has a transcript to open: any day of it is complete. */
export function hasTranscript(row: HearingRow): boolean {
  if (!row.days) return row.status === "COMPLETED";
  return countDays(row, "COMPLETED") > 0;
}

/**
 * The row as the Transcripts list shows it: a hearing of several days is a
 * transcript to open as soon as one day is, while its other days still run.
 */
export function transcriptRow(row: HearingRow): HearingRow {
  if (!row.days || row.status === "COMPLETED") return row;
  return { ...row, status: "COMPLETED", inFlightDay: undefined };
}

/** What a hearing of several days says under its status, if anything. */
export function dayStatusNotes(row: HearingRow): DayStatusNote[] {
  if (!row.days) return [];
  const total = row.days.length;
  const complete = countDays(row, "COMPLETED");
  const failed = countDays(row, "FAILED");
  const notes: DayStatusNote[] = [];
  if (complete > 0 && complete < total) {
    notes.push({
      text: `${complete} of ${total} days complete`,
      tone: "neutral",
    });
  }
  if (failed > 0) {
    notes.push({
      text: `${failed} ${failed === 1 ? "day" : "days"} failed`,
      tone: "error",
    });
  }
  return notes;
}
