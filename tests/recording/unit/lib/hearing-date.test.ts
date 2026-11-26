import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatHearingDate,
  isHearingDate,
  todayInLondon,
} from "@/lib/recording/hearing-date";

afterEach(() => {
  vi.useRealTimers();
});

describe("isHearingDate", () => {
  it.each(["2026-11-12", "2024-02-29", "1999-01-01"])("accepts %s", (value) => {
    expect(isHearingDate(value)).toBe(true);
  });

  it.each([
    "",
    "2026-11-1",
    "12/11/2026",
    "2026-02-30",
    "2025-02-29",
    "2026-13-01",
    " 2026-11-12",
  ])("refuses %j", (value) => {
    expect(isHearingDate(value)).toBe(false);
  });
});

describe("todayInLondon", () => {
  it("is the date in London, not in UTC, just after midnight in summer", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T23:30:00Z"));
    expect(todayInLondon()).toBe("2026-07-02");
  });

  it("is the UTC date in winter", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-12-01T23:30:00Z"));
    expect(todayInLondon()).toBe("2026-12-01");
  });
});

describe("formatHearingDate", () => {
  it("reads as a date, whatever the browser's time zone", () => {
    expect(formatHearingDate("2026-11-02")).toBe("2 November 2026");
  });

  it("shows a value that is not a date as it is", () => {
    expect(formatHearingDate("soon")).toBe("soon");
  });
});
