import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import RecordStatusRow from "@/components/audio/recording/record-status-row";

describe("RecordStatusRow", () => {
  it("renders nothing when there is neither a capture nor a save state", () => {
    const { container } = render(
      <RecordStatusRow
        speechLabel={null}
        isCapturing={false}
        saveStatus={null}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("keeps the capture label under its established test id", () => {
    render(
      <RecordStatusRow
        speechLabel="Recording"
        isCapturing={true}
        saveStatus={null}
      />
    );
    expect(screen.getByTestId("speech-status-label").textContent).toMatch(
      /Recording/
    );
  });

  it("shows the last saved time beside the capture state", () => {
    render(
      <RecordStatusRow
        speechLabel="Recording"
        isCapturing={true}
        saveStatus={{ label: "Saved 14:32", tone: "ok" }}
      />
    );
    expect(screen.getByTestId("save-status-label").textContent).toBe(
      "Saved 14:32"
    );
  });

  it("shows the save state even when not recording, because a draft still exists", () => {
    render(
      <RecordStatusRow
        speechLabel={null}
        isCapturing={false}
        saveStatus={{ label: "Saved 14:32", tone: "ok" }}
      />
    );
    expect(screen.getByTestId("save-status-label")).toBeTruthy();
    expect(screen.queryByTestId("speech-status-label")).toBeNull();
  });

  it("is a single polite live region, not two competing ones", () => {
    render(
      <RecordStatusRow
        speechLabel="Recording"
        isCapturing={true}
        saveStatus={{ label: "Saved 14:32", tone: "ok" }}
      />
    );
    const regions = screen.getAllByRole("status");
    expect(regions).toHaveLength(1);
    expect(regions[0].getAttribute("aria-live")).toBe("polite");
    // Both halves live inside it, so a screen reader hears one coherent state.
    expect(regions[0].textContent).toContain("Recording");
    expect(regions[0].textContent).toContain("Saved 14:32");
  });

  it("marks a failing save state so it is not read as ordinary text", () => {
    render(
      <RecordStatusRow
        speechLabel={null}
        isCapturing={false}
        saveStatus={{ label: "Not saved", tone: "error" }}
      />
    );
    expect(
      screen.getByTestId("save-status-label").getAttribute("data-tone")
    ).toBe("error");
  });
});
