import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
