import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  getEnv: vi.fn(),
}));

import { getEnv } from "@/lib/env";
import {
  formatRemainingTime,
  getMaxRecordingDuration,
  getRemainingTime,
  getWarningThreshold,
  hasReachedMaxDuration,
  shouldShowWarning,
} from "@/lib/recording-config";

const DEFAULT_MAX_SECONDS = 115 * 60; // 6900

describe("getMaxRecordingDuration", () => {
  afterEach(() => {
    vi.mocked(getEnv).mockReturnValue(undefined);
  });

  it("returns the default (115 min → 6900 s) when env is not set", () => {
    vi.mocked(getEnv).mockReturnValue(undefined);
    expect(getMaxRecordingDuration()).toBe(DEFAULT_MAX_SECONDS);
  });

  it("converts a valid env value from minutes to seconds", () => {
    vi.mocked(getEnv).mockReturnValue("60");
    expect(getMaxRecordingDuration()).toBe(60 * 60);
  });

  it("falls back to default for a non-numeric env value", () => {
    vi.mocked(getEnv).mockReturnValue("not-a-number");
    expect(getMaxRecordingDuration()).toBe(DEFAULT_MAX_SECONDS);
  });

  it("falls back to default when env value is 0", () => {
    vi.mocked(getEnv).mockReturnValue("0");
    expect(getMaxRecordingDuration()).toBe(DEFAULT_MAX_SECONDS);
  });

  it("falls back to default when env value is negative", () => {
    vi.mocked(getEnv).mockReturnValue("-10");
    expect(getMaxRecordingDuration()).toBe(DEFAULT_MAX_SECONDS);
  });
});

describe("getWarningThreshold", () => {
  beforeEach(() => {
    vi.mocked(getEnv).mockReturnValue(undefined);
  });

  it("is 5 minutes less than the max duration", () => {
    expect(getWarningThreshold()).toBe(DEFAULT_MAX_SECONDS - 5 * 60);
  });
});

describe("shouldShowWarning", () => {
  beforeEach(() => {
    vi.mocked(getEnv).mockReturnValue(undefined);
  });

  const threshold = DEFAULT_MAX_SECONDS - 5 * 60;

  it("returns false when well below the warning threshold", () => {
    expect(shouldShowWarning(0)).toBe(false);
  });

  it("returns false just below the threshold", () => {
    expect(shouldShowWarning(threshold - 1)).toBe(false);
  });

  it("returns true at exactly the warning threshold", () => {
    expect(shouldShowWarning(threshold)).toBe(true);
  });

  it("returns true between threshold and max duration", () => {
    expect(shouldShowWarning(threshold + 30)).toBe(true);
  });

  it("returns false at exactly the max duration", () => {
    expect(shouldShowWarning(DEFAULT_MAX_SECONDS)).toBe(false);
  });

  it("returns false beyond the max duration", () => {
    expect(shouldShowWarning(DEFAULT_MAX_SECONDS + 60)).toBe(false);
  });
});

describe("hasReachedMaxDuration", () => {
  beforeEach(() => {
    vi.mocked(getEnv).mockReturnValue(undefined);
  });

  it("returns false when below max", () => {
    expect(hasReachedMaxDuration(DEFAULT_MAX_SECONDS - 1)).toBe(false);
  });

  it("returns true at exactly max", () => {
    expect(hasReachedMaxDuration(DEFAULT_MAX_SECONDS)).toBe(true);
  });

  it("returns true beyond max", () => {
    expect(hasReachedMaxDuration(DEFAULT_MAX_SECONDS + 100)).toBe(true);
  });
});

describe("getRemainingTime", () => {
  beforeEach(() => {
    vi.mocked(getEnv).mockReturnValue(undefined);
  });

  it("returns max duration when no time has elapsed", () => {
    expect(getRemainingTime(0)).toBe(DEFAULT_MAX_SECONDS);
  });

  it("returns the correct remaining time mid-recording", () => {
    expect(getRemainingTime(60)).toBe(DEFAULT_MAX_SECONDS - 60);
  });

  it("returns 0 when elapsed equals max", () => {
    expect(getRemainingTime(DEFAULT_MAX_SECONDS)).toBe(0);
  });

  it("returns 0 when elapsed exceeds max (no negatives)", () => {
    expect(getRemainingTime(DEFAULT_MAX_SECONDS + 100)).toBe(0);
  });
});

describe("formatRemainingTime", () => {
  it("formats 0 s as 0:00", () => {
    expect(formatRemainingTime(0)).toBe("0:00");
  });

  it("formats 59 s as 0:59", () => {
    expect(formatRemainingTime(59)).toBe("0:59");
  });

  it("formats 60 s as 1:00", () => {
    expect(formatRemainingTime(60)).toBe("1:00");
  });

  it("pads single-digit seconds with a leading zero", () => {
    expect(formatRemainingTime(65)).toBe("1:05");
  });

  it("formats 90 s as 1:30", () => {
    expect(formatRemainingTime(90)).toBe("1:30");
  });

  it("formats large values correctly (61 min 1 s)", () => {
    expect(formatRemainingTime(61 * 60 + 1)).toBe("61:01");
  });
});
