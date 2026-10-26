import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import RecordAlertBanner from "@/components/audio/recording/record-alert-banner";
import { describeSpeechAlert } from "@/lib/speech-alerts";

const failedAlert = describeSpeechAlert({
  health: "failed",
  totalCollapses: 37,
  hasCapturedSpeech: false,
  noSpeechWarning: true,
  noSpeechThresholdSeconds: 90,
});

const interruptedAlert = describeSpeechAlert({
  health: "healthy",
  totalCollapses: 2,
  hasCapturedSpeech: true,
  noSpeechWarning: false,
  noSpeechThresholdSeconds: 90,
});

describe("RecordAlertBanner", () => {
  it("renders nothing when there is no alert", () => {
    const { container } = render(<RecordAlertBanner alert={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("announces a failed session assertively as an alert", () => {
    render(<RecordAlertBanner alert={failedAlert} />);

    const banner = screen.getByRole("alert");
    expect(banner.getAttribute("aria-live")).toBe("assertive");
    expect(banner.getAttribute("data-kind")).toBe("speech-failed");
    expect(
      screen.getByText(/Your dictation is not being recorded/i)
    ).toBeTruthy();
  });

  it("shows the guidance so the user knows what to do next", () => {
    render(<RecordAlertBanner alert={failedAlert} />);
    expect(screen.getByText(/record this decision in another way/i)).toBeTruthy();
  });

  it("offers no way to dismiss a message about speech being lost", () => {
    const onDismiss = vi.fn();
    render(
      <RecordAlertBanner alert={failedAlert} onDismiss={onDismiss} />
    );

    expect(screen.queryByRole("button", { name: /dismiss/i })).toBeNull();
  });

  it("announces the recovered-with-gap notice politely and allows dismissal", async () => {
    const onDismiss = vi.fn();
    render(
      <RecordAlertBanner alert={interruptedAlert} onDismiss={onDismiss} />
    );

    const banner = screen.getByRole("status");
    expect(banner.getAttribute("aria-live")).toBe("polite");
    expect(banner.getAttribute("data-kind")).toBe("speech-interrupted");

    await userEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
