import type {
  Hearing,
  HearingDay,
  TranscriptionJob,
} from "@/lib/recording/types";

/** A hearing of one day: a recording as the page showed it before hearings (DIAAT-428). */
export function oneDayHearing(job: TranscriptionJob): Hearing {
  return hearingOf([job]);
}

/** A hearing of these recordings, in this order, the first's id its own. */
export function hearingOf(
  jobs: TranscriptionJob[],
  dates: string[] = jobs.map(
    (_, i) => `2026-11-${String(10 + i).padStart(2, "0")}`
  )
): Hearing {
  const id = jobs[0].id;
  const days: HearingDay[] = jobs.map((job, i) => ({
    ...job,
    hearingId: id,
    hearingDate: dates[i],
    dayNumber: i + 1,
  }));
  return {
    id,
    caseReference: jobs[0].caseReference,
    tribunal: jobs[0].tribunal,
    status: "completed",
    days,
  };
}
