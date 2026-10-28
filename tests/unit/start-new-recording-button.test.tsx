import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import StartNewRecordingButton from "@/components/ui/start-new-recording-button";

describe("StartNewRecordingButton", () => {
  it("is labelled Dictation and calls onClick", () => {
    const onClick = vi.fn();
    render(<StartNewRecordingButton onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "Dictation" }));
    expect(onClick).toHaveBeenCalled();
  });
});
