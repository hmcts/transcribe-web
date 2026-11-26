import { describe, expect, it } from "vitest";
import {
  dayStatusNotes,
  hasTranscript,
  hearingRow,
  isInFlight,
  transcriptRow,
} from "@/lib/recording/hearing-rows";
import type { HearingDaySummary, HearingSummary } from "@/lib/recording/types";

function day(overrides: Partial<HearingDaySummary> = {}): HearingDaySummary {
  return {
    jobId: "job-1",
    dayNumber: 1,
    hearingDate: "2026-11-10",
    audioFileName: "day1.mp3",
    status: "COMPLETED",
    progressPercent: 100,
    uploadedAt: "2026-11-10T09:00:00Z",
    audioDurationSeconds: 60,
    transcriptionDurationSeconds: 10,
    modelDisplayName: "Base model",
    ...overrides,
  };
}

function hearing(
  days: HearingDaySummary[],
  overrides: Partial<HearingSummary> = {}
): HearingSummary {
  return {
    id: "hearing-1",
    caseReference: "PA/00001/2026",
    tribunal: "First-tier Tribunal",
    status: "completed",
    dayCount: days.length,
    daysComplete: days.filter((d) => d.status === "COMPLETED").length,
    daysFailed: days.filter((d) => d.status === "FAILED").length,
    days,
    ...overrides,
  };
}

describe("hearingRow of a one-day hearing", () => {
  it("is the recording, as the list showed it before hearings", () => {
    const only = day({
      status: "FAILED",
      errorMessage: "Speech failed",
      modelIdentifier: "m",
    });
    expect(hearingRow(hearing([only], { status: "failed" }))).toEqual({
      id: "hearing-1",
      caseReference: "PA/00001/2026",
      tribunal: "First-tier Tribunal",
      audioFileName: "day1.mp3",
      uploadedAt: "2026-11-10T09:00:00Z",
      status: "FAILED",
      progressPercent: 100,
      errorMessage: "Speech failed",
      audioDurationSeconds: 60,
      transcriptionDurationSeconds: 10,
      modelIdentifier: "m",
      modelDisplayName: "Base model",
    });
  });

  it("keeps a pending recording pending", () => {
    const row = hearingRow(
      hearing([day({ status: "PENDING", progressPercent: 0 })], {
        status: "processing",
      })
    );
    expect(row.status).toBe("PENDING");
  });
});

describe("hearingRow of a hearing of several days", () => {
  const day2 = day({
    jobId: "job-2",
    dayNumber: 2,
    hearingDate: "2026-11-11",
    audioFileName: "day2.mp3",
    uploadedAt: "2026-11-11T09:00:00Z",
  });

  it("is processing while any day is, with that day's progress", () => {
    const running = {
      ...day2,
      status: "PROCESSING" as const,
      progressPercent: 60,
      audioDurationSeconds: 3600,
    };
    const row = hearingRow(hearing([day(), running], { status: "processing" }));
    expect(row).toMatchObject({
      id: "hearing-1",
      status: "PROCESSING",
      progressPercent: 60,
      audioFileName: "day1.mp3",
      uploadedAt: "2026-11-11T09:00:00Z",
    });
    // Day 2's length is not day 1's file's: only the progress has it.
    expect(row.audioDurationSeconds).toBeUndefined();
    expect(row.inFlightDay?.audioDurationSeconds).toBe(3600);
  });

  it("takes its progress from a day being transcribed before one still being prepared", () => {
    const pending = {
      ...day({
        jobId: "job-0",
        hearingDate: "2026-11-01",
        uploadedAt: "2026-11-12T09:00:00Z",
      }),
      status: "PENDING" as const,
      progressPercent: 0,
      audioDurationSeconds: 10,
    };
    const running = {
      ...day2,
      status: "PROCESSING" as const,
      progressPercent: 60,
      audioDurationSeconds: 3600,
    };
    const row = hearingRow(
      hearing([pending, day(), running], { status: "processing" })
    );
    expect(row.status).toBe("PROCESSING");
    expect(row.progressPercent).toBe(60);
    // The list shows the latest upload; the progress counts from the running day's.
    expect(row.uploadedAt).toBe("2026-11-12T09:00:00Z");
    expect(row.inFlightDay).toMatchObject({
      id: "job-2",
      uploadedAt: "2026-11-11T09:00:00Z",
      audioDurationSeconds: 3600,
      status: "PROCESSING",
    });
  });

  it("is completed once every day is, uploaded when the latest day was", () => {
    const row = hearingRow(hearing([day(), day2]));
    expect(row.status).toBe("COMPLETED");
    expect(row.uploadedAt).toBe("2026-11-11T09:00:00Z");
  });

  it("has no single run's details to show", () => {
    const row = hearingRow(hearing([day(), day2]));
    expect(row.modelDisplayName).toBeUndefined();
    expect(row.audioDurationSeconds).toBeUndefined();
    expect(row.transcriptionDurationSeconds).toBeUndefined();
  });

  it("is failed when every day failed", () => {
    const failed = { status: "FAILED" as const };
    const row = hearingRow(
      hearing([day(failed), { ...day2, ...failed }], { status: "failed" })
    );
    expect(row.status).toBe("FAILED");
  });

  it("has a transcript to open when some days completed and the rest failed", () => {
    const row = hearingRow(
      hearing([day(), { ...day2, status: "FAILED" }], { status: "partial" })
    );
    expect(row.status).toBe("COMPLETED");
  });
});

// DIAAT-430: what the lists say about a hearing's days.
describe("the days of a hearing row", () => {
  const day2 = day({
    jobId: "job-2",
    dayNumber: 2,
    hearingDate: "2026-11-11",
    audioFileName: "day2.mp3",
  });
  const day3 = day({
    jobId: "job-3",
    dayNumber: 3,
    hearingDate: "2026-11-12",
    audioFileName: "day3.mp3",
  });
  const processing = { status: "PROCESSING" as const, progressPercent: 40 };
  const failed = { status: "FAILED" as const };

  it("lists each day of a hearing of several days", () => {
    const row = hearingRow(hearing([day(), day2]));
    expect(row.days?.map((d) => d.audioFileName)).toEqual([
      "day1.mp3",
      "day2.mp3",
    ]);
  });

  it("gives a one-day hearing no list of days", () => {
    expect(hearingRow(hearing([day()])).days).toBeUndefined();
  });

  describe("hasTranscript", () => {
    it("is true of a completed one-day hearing only", () => {
      expect(hasTranscript(hearingRow(hearing([day()])))).toBe(true);
      expect(hasTranscript(hearingRow(hearing([day(processing)])))).toBe(false);
      expect(hasTranscript(hearingRow(hearing([day(failed)])))).toBe(false);
    });

    it("is true of a hearing of several days once any day is complete", () => {
      const row = hearingRow(hearing([day(), { ...day2, ...processing }]));
      expect(hasTranscript(row)).toBe(true);
    });

    it("is false of a hearing of several days with no day complete", () => {
      const row = hearingRow(
        hearing([day(failed), { ...day2, ...processing }])
      );
      expect(hasTranscript(row)).toBe(false);
    });
  });

  describe("transcriptRow", () => {
    it("is a transcript to open while other days are still processing", () => {
      const row = hearingRow(hearing([day(), { ...day2, ...processing }]));
      expect(row.status).toBe("PROCESSING");
      expect(transcriptRow(row).status).toBe("COMPLETED");
    });

    it("leaves a one-day hearing as it is", () => {
      const row = hearingRow(hearing([day()]));
      expect(transcriptRow(row)).toBe(row);
    });
  });

  describe("dayStatusNotes", () => {
    it("says nothing of a one-day hearing", () => {
      expect(dayStatusNotes(hearingRow(hearing([day(failed)])))).toEqual([]);
    });

    it("says nothing more once every day is complete", () => {
      expect(dayStatusNotes(hearingRow(hearing([day(), day2])))).toEqual([]);
    });

    it("counts the days complete while others are processing", () => {
      const row = hearingRow(
        hearing([day(), day2, { ...day3, ...processing }])
      );
      expect(dayStatusNotes(row)).toEqual([
        { text: "2 of 3 days complete", tone: "neutral" },
      ]);
    });

    it("counts the failed days of a partial hearing", () => {
      const row = hearingRow(
        hearing([day(), { ...day2, ...failed }, day3], { status: "partial" })
      );
      expect(dayStatusNotes(row)).toEqual([
        { text: "2 of 3 days complete", tone: "neutral" },
        { text: "1 day failed", tone: "error" },
      ]);
    });

    it("says how many days failed when none completed", () => {
      const row = hearingRow(
        hearing([day(failed), { ...day2, ...failed }], { status: "failed" })
      );
      expect(dayStatusNotes(row)).toEqual([
        { text: "2 days failed", tone: "error" },
      ]);
    });
  });

  describe("isInFlight", () => {
    it("is true while any day is pending or processing", () => {
      expect(
        isInFlight(hearingRow(hearing([day(), { ...day2, ...processing }])))
      ).toBe(true);
      expect(
        isInFlight(hearingRow(hearing([day(), { ...day2, status: "PENDING" }])))
      ).toBe(true);
    });

    it("is false once every day has finished, failed or not", () => {
      expect(
        isInFlight(hearingRow(hearing([day(), { ...day2, ...failed }])))
      ).toBe(false);
    });
  });
});
