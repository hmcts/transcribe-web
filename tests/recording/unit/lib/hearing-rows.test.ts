import { describe, expect, it } from "vitest";
import { hearingRow } from "@/lib/recording/hearing-rows";
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
      audioDurationSeconds: 3600,
      audioFileName: "day1.mp3",
      uploadedAt: "2026-11-11T09:00:00Z",
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
