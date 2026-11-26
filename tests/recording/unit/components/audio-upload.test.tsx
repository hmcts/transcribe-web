import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioUpload } from "@/components/recording/audio-upload/audio-upload";

describe("AudioUpload dropzone", () => {
  it("tells the user the longest recording and which formats suit long ones", () => {
    render(<AudioUpload onUpload={vi.fn()} uploading={false} />);

    expect(screen.getByText(/up to 4 hours/i)).toBeDefined();
    expect(
      screen.getByText(/MP3 or M4A files are much smaller than WAV/i)
    ).toBeDefined();
  });

  it("still lists the supported formats", () => {
    render(<AudioUpload onUpload={vi.fn()} uploading={false} />);

    expect(
      screen.getByText(/MP3, WAV, MP4, M4A, OGG, FLAC supported/)
    ).toBeDefined();
  });
});

// DIAAT-428: the date of the hearing day the recording is of.
describe("AudioUpload hearing date", () => {
  const file = () => new File(["bytes"], "day2.mp3", { type: "audio/mpeg" });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not ask for a date unless told to, and sends none", async () => {
    const onUpload = vi.fn();
    const user = userEvent.setup();
    render(<AudioUpload onUpload={onUpload} />);

    expect(screen.queryByLabelText("Date of the hearing")).toBeNull();
    await user.upload(screen.getByLabelText("Audio file input"), file());
    await user.click(
      screen.getByRole("button", { name: "Transcribe a recording" })
    );

    expect(onUpload).toHaveBeenCalledWith(expect.any(File));
    expect(onUpload.mock.calls[0]).toHaveLength(1);
  });

  it("asks for the date, today in London unless changed, and sends it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-01T23:30:00Z"));
    const onUpload = vi.fn();
    const user = userEvent.setup();
    render(
      <AudioUpload
        onUpload={onUpload}
        askHearingDate
        submitLabel="Add to this hearing"
      />
    );

    const date = screen.getByLabelText(
      "Date of the hearing"
    ) as HTMLInputElement;
    expect(date.value).toBe("2026-07-02");
    await user.upload(screen.getByLabelText("Audio file input"), file());
    await user.click(
      screen.getByRole("button", { name: "Add to this hearing" })
    );
    expect(onUpload).toHaveBeenLastCalledWith(expect.any(File), "2026-07-02");

    fireEvent.change(date, { target: { value: "2026-06-30" } });
    await user.click(
      screen.getByRole("button", { name: "Add to this hearing" })
    );
    expect(onUpload).toHaveBeenLastCalledWith(expect.any(File), "2026-06-30");
  });

  it("does not send without a date", async () => {
    const onUpload = vi.fn();
    const user = userEvent.setup();
    render(<AudioUpload onUpload={onUpload} askHearingDate />);

    fireEvent.change(screen.getByLabelText("Date of the hearing"), {
      target: { value: "" },
    });
    await user.upload(screen.getByLabelText("Audio file input"), file());
    await user.click(
      screen.getByRole("button", { name: "Transcribe a recording" })
    );

    expect(onUpload).not.toHaveBeenCalled();
  });
});
