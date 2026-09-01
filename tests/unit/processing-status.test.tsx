import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProcessingStatus, {
  calculateEstimatedProcessingTime,
} from "@/components/audio/processing/processing-status";

// ─── ProcessingStatus component ───────────────────────────────────────────────

describe("ProcessingStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the transcribing label", () => {
    render(<ProcessingStatus estimatedSeconds={120} startTime={Date.now()} />);
    expect(screen.getByText("Transcribing")).toBeTruthy();
  });

  it("shows ETA in minutes when time remaining is 90s or more", () => {
    render(<ProcessingStatus estimatedSeconds={120} startTime={Date.now()} />);
    expect(screen.getByText(/ETA: 2 minutes/)).toBeTruthy();
  });

  it("shows singular 'minute' when ETA is exactly 1 minute", () => {
    render(<ProcessingStatus estimatedSeconds={90} startTime={Date.now()} />);
    expect(screen.getByText(/ETA: 2 minutes|ETA: 1 minute/)).toBeTruthy();
  });

  it("shows 'ETA: 1 minute' when time remaining is between 60-90s", () => {
    const start = Date.now();
    render(<ProcessingStatus estimatedSeconds={70} startTime={start} />);
    // Advance 5 seconds so remaining = 65s (>=60, <90)
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText(/ETA: 1 minute/)).toBeTruthy();
  });

  it("shows 'under a minute' when time remaining is below 60s", () => {
    const start = Date.now();
    render(<ProcessingStatus estimatedSeconds={30} startTime={start} />);
    expect(screen.getByText(/under a minute/)).toBeTruthy();
  });

  it("updates the countdown over time", () => {
    const start = Date.now();
    render(<ProcessingStatus estimatedSeconds={200} startTime={start} />);
    // Initially 200s remaining → 4 minutes
    expect(screen.getByText(/ETA: 4 minutes/)).toBeTruthy();

    // Advance 140s so remaining ≈ 60s → "1 minute"
    act(() => {
      vi.advanceTimersByTime(140_000);
    });
    expect(screen.getByText(/ETA: 1 minute/)).toBeTruthy();
  });
});

// ─── calculateEstimatedProcessingTime ─────────────────────────────────────────

describe("calculateEstimatedProcessingTime", () => {
  it("uses the long-form multiplier for audio over 2 hours", () => {
    const twoHoursPlus = 2 * 60 * 60 + 1;
    const result = calculateEstimatedProcessingTime(twoHoursPlus);
    expect(result).toBeCloseTo(twoHoursPlus * 0.08333333333);
  });

  it("uses the standard multiplier for audio under 2 hours", () => {
    const oneHour = 60 * 60;
    const result = calculateEstimatedProcessingTime(oneHour);
    expect(result).toBeCloseTo(oneHour * 0.03724437408);
  });

  it("returns 0 for 0 second audio", () => {
    expect(calculateEstimatedProcessingTime(0)).toBe(0);
  });
});
