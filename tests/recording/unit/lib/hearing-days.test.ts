import { describe, expect, it } from "vitest";
import {
  hasTranscript,
  isInFlight,
  withJob,
  withNewDay,
  withoutDay,
  withSummaryDates,
} from "@/lib/recording/hearing-days";
import type {
  Hearing,
  HearingDay,
  HearingSummary,
} from "@/lib/recording/types";

function day(
  id: string,
  dayNumber: number,
  hearingDate: string,
  uploadedAt = `${hearingDate}T09:00:00Z`
): HearingDay {
  return {
    id,
    hearingId: "h",
    dayNumber,
    hearingDate,
    caseReference: "PA/1",
    tribunal: "T",
    audioFileName: `${id}.mp3`,
    uploadedAt,
    status: "COMPLETED",
    segments: [],
  };
}

const HEARING: Hearing = {
  id: "h",
  caseReference: "PA/1",
  tribunal: "T",
  status: "completed",
  days: [day("a", 1, "2026-11-10"), day("b", 2, "2026-11-12")],
};

const order = (hearing: Hearing) =>
  hearing.days.map((d) => [d.id, d.dayNumber, d.hearingDate]);

describe("day states", () => {
  it("is in flight while pending or processing", () => {
    expect(isInFlight({ ...day("a", 1, "x"), status: "PENDING" })).toBe(true);
    expect(isInFlight({ ...day("a", 1, "x"), status: "PROCESSING" })).toBe(
      true
    );
    expect(isInFlight(day("a", 1, "x"))).toBe(false);
  });

  it("has a transcript once completed with segments", () => {
    expect(hasTranscript(day("a", 1, "x"))).toBe(true);
    expect(hasTranscript({ ...day("a", 1, "x"), segments: undefined })).toBe(
      false
    );
    expect(hasTranscript({ ...day("a", 1, "x"), status: "FAILED" })).toBe(
      false
    );
  });
});

describe("withJob", () => {
  it("puts the job in its day's place, keeping the day's number and date", () => {
    const next = withJob(HEARING, {
      ...day("b", 9, "1999-01-01"),
      status: "FAILED",
    });
    expect(order(next)).toEqual(order(HEARING));
    expect(next.days[1].status).toBe("FAILED");
  });
});

describe("withNewDay", () => {
  it("puts the new day in date order and numbers the days again", () => {
    const next = withNewDay(HEARING, {
      ...day("c", 0, "2026-11-11"),
      status: "PENDING",
      segments: undefined,
    });
    expect(order(next)).toEqual([
      ["a", 1, "2026-11-10"],
      ["c", 2, "2026-11-11"],
      ["b", 3, "2026-11-12"],
    ]);
    expect(next.days[1].hearingId).toBe("h");
  });

  it("puts a day of the same date after the ones uploaded before it", () => {
    const next = withNewDay(
      HEARING,
      day("c", 0, "2026-11-10", "2026-11-13T09:00:00Z")
    );
    expect(next.days.map((d) => d.id)).toEqual(["a", "c", "b"]);
  });
});

describe("withoutDay", () => {
  it("numbers the days left again", () => {
    expect(order(withoutDay(HEARING, "a"))).toEqual([["b", 1, "2026-11-12"]]);
  });
});

describe("withSummaryDates", () => {
  const summary = (days: [string, number, string][]): HearingSummary => ({
    id: "h",
    caseReference: "PA/1",
    tribunal: "T",
    status: "completed",
    dayCount: days.length,
    daysComplete: days.length,
    daysFailed: 0,
    days: days.map(([jobId, dayNumber, hearingDate]) => ({
      jobId,
      dayNumber,
      hearingDate,
      audioFileName: "x",
      status: "COMPLETED",
      progressPercent: 100,
      uploadedAt: "2026-11-10T09:00:00Z",
    })),
  });

  it("takes the API's order and dates, keeping each day's transcript", () => {
    const next = withSummaryDates(
      HEARING,
      summary([
        ["b", 1, "2026-11-01"],
        ["a", 2, "2026-11-10"],
      ])
    );
    expect(next && order(next)).toEqual([
      ["b", 1, "2026-11-01"],
      ["a", 2, "2026-11-10"],
    ]);
    expect(next?.days[0].segments).toEqual([]);
  });

  it("is null when the API has a day the page has not loaded", () => {
    expect(
      withSummaryDates(
        HEARING,
        summary([
          ["a", 1, "2026-11-10"],
          ["b", 2, "2026-11-12"],
          ["c", 3, "2026-11-13"],
        ])
      )
    ).toBeNull();
  });
});
