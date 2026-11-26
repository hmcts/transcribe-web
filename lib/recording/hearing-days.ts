import { formatHearingDate, todayInLondon } from "./hearing-date";
import type {
  Hearing,
  HearingDay,
  HearingSummary,
  TranscriptionJob,
  TranscriptSegment,
} from "./types";

// The days of a hearing on its page (DIAAT-428), kept in the API's order: by
// hearing date, then upload time, then id.

export function isInFlight(day: TranscriptionJob): boolean {
  return day.status === "PENDING" || day.status === "PROCESSING";
}

export function hasTranscript(
  day: HearingDay
): day is HearingDay & { segments: TranscriptSegment[] } {
  return day.status === "COMPLETED" && day.segments !== undefined;
}

function compareDays(a: HearingDay, b: HearingDay): number {
  if (a.hearingDate !== b.hearingDate) {
    return a.hearingDate < b.hearingDate ? -1 : 1;
  }
  const uploaded =
    new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime();
  if (uploaded !== 0) return uploaded;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function numbered(hearing: Hearing, days: HearingDay[]): Hearing {
  return {
    ...hearing,
    days: days.map((day, index) => ({ ...day, dayNumber: index + 1 })),
  };
}

/** The day's job as the API now has it, in the day's place. */
export function withJob(hearing: Hearing, job: TranscriptionJob): Hearing {
  return {
    ...hearing,
    days: hearing.days.map((day) =>
      day.id === job.id
        ? {
            ...job,
            hearingId: day.hearingId,
            hearingDate: day.hearingDate,
            dayNumber: day.dayNumber,
          }
        : day
    ),
  };
}

/** The hearing with a day just added to it, in its place. */
export function withNewDay(hearing: Hearing, job: TranscriptionJob): Hearing {
  const day: HearingDay = {
    ...job,
    hearingId: hearing.id,
    hearingDate: job.hearingDate ?? todayInLondon(),
    dayNumber: 0,
  };
  return numbered(
    hearing,
    [...hearing.days.filter((d) => d.id !== job.id), day].sort(compareDays)
  );
}

/** The hearing without a day just deleted, the others renumbered. */
export function withoutDay(hearing: Hearing, dayId: string): Hearing {
  return numbered(
    hearing,
    hearing.days.filter((day) => day.id !== dayId)
  );
}

/**
 * The days in the order and with the dates of the API's summary of the
 * hearing (as a date change answers), or null if it has a day this page has
 * not loaded (added elsewhere): the page must then load the hearing again.
 */
export function withSummaryDates(
  hearing: Hearing,
  summary: HearingSummary
): Hearing | null {
  const loaded = new Map(hearing.days.map((day) => [day.id, day]));
  const days: HearingDay[] = [];
  for (const entry of summary.days) {
    const day = loaded.get(entry.jobId);
    if (!day) return null;
    days.push({
      ...day,
      hearingDate: entry.hearingDate,
      dayNumber: entry.dayNumber,
    });
  }
  return { ...hearing, status: summary.status, days };
}

// Which days of a hearing of several days are expanded (DIAAT-429): every
// day, none, or the one with this id.
export const ALL_DAYS = "all";
export const NO_DAYS = "none";
export type DaySelection = typeof ALL_DAYS | typeof NO_DAYS | (string & {});

/** "Day 2, 11 November 2026 (day2.mp3)" */
export function dayOptionLabel(day: HearingDay): string {
  return `Day ${day.dayNumber}, ${formatHearingDate(day.hearingDate)} (${day.audioFileName})`;
}

/** The ids of the days expanded: every day once the one chosen has gone. */
export function shownDayIds(
  days: HearingDay[],
  selection: DaySelection
): Set<string> {
  if (selection === NO_DAYS) return new Set();
  if (selection !== ALL_DAYS && days.some((day) => day.id === selection)) {
    return new Set([selection]);
  }
  return new Set(days.map((day) => day.id));
}
