import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DictationSwitchedOff } from "@/components/flags/dictation-switched-off";

// A dictation page that was already open when dictation was switched off keeps what the user has typed,
// and says that it can no longer be saved or submitted.

afterEach(() => vi.unstubAllEnvs());

describe("DictationSwitchedOff", () => {
  it("says so, as an alert, when dictation is off", () => {
    vi.stubEnv("NEXT_PUBLIC_DICTATION_ENABLED", "false");
    render(<DictationSwitchedOff />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/Dictation has been switched off/);
    expect(alert.textContent).toMatch(/copy it somewhere safe/);
  });

  it("shows nothing while dictation is on", () => {
    vi.stubEnv("NEXT_PUBLIC_DICTATION_ENABLED", "true");
    render(<DictationSwitchedOff />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
