import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import FileUploadForm from "@/components/audio/upload/file-upload-form";

function makeFile(name: string, type: string, sizeBytes = 1024) {
  const file = new File(["x"], name, { type });
  if (sizeBytes !== 1024) {
    Object.defineProperty(file, "size", { value: sizeBytes });
  }
  return file;
}

function changeFileInput(input: HTMLInputElement, files: File[]) {
  fireEvent.change(input, { target: { files } });
}

describe("FileUploadForm", () => {
  it("renders the upload area", () => {
    render(<FileUploadForm disabled={false} onFileSelected={vi.fn()} />);
    expect(screen.getByText(/drag/i)).toBeTruthy();
  });

  it("calls onFileSelected when Upload & transcribe is clicked after file selection", async () => {
    const onFileSelected = vi.fn();
    render(<FileUploadForm disabled={false} onFileSelected={onFileSelected} />);

    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    const file = makeFile("recording.mp3", "audio/mpeg");

    changeFileInput(input, [file]);
    await waitFor(() => screen.getByText("Upload & transcribe"));
    fireEvent.click(screen.getByText("Upload & transcribe"));

    expect(onFileSelected).toHaveBeenCalledWith(file);
  });

  it("calls onFileSelected with a valid video file after clicking Upload", async () => {
    const onFileSelected = vi.fn();
    render(<FileUploadForm disabled={false} onFileSelected={onFileSelected} />);

    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    const file = makeFile("screen.mp4", "video/mp4");

    changeFileInput(input, [file]);
    await waitFor(() => screen.getByText("Upload & transcribe"));
    fireEvent.click(screen.getByText("Upload & transcribe"));

    expect(onFileSelected).toHaveBeenCalledWith(file);
  });

  it("shows error for unsupported file type", () => {
    render(<FileUploadForm disabled={false} onFileSelected={vi.fn()} />);

    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [makeFile("doc.pdf", "application/pdf")] },
    });

    expect(screen.getByText(/audio or video/i)).toBeTruthy();
  });

  it("shows error for files over 2GB", () => {
    render(<FileUploadForm disabled={false} onFileSelected={vi.fn()} />);

    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    const bigFile = makeFile(
      "big.mp3",
      "audio/mpeg",
      2 * 1024 * 1024 * 1024 + 1
    );

    fireEvent.change(input, { target: { files: [bigFile] } });
    expect(screen.getByText(/too large/i)).toBeTruthy();
  });

  it("does not call onFileSelected when disabled", () => {
    const onFileSelected = vi.fn();
    render(<FileUploadForm disabled={true} onFileSelected={onFileSelected} />);

    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [makeFile("recording.mp3", "audio/mpeg")] },
    });

    expect(onFileSelected).not.toHaveBeenCalled();
  });

  it("shows selected filename after valid selection", () => {
    render(<FileUploadForm disabled={false} onFileSelected={vi.fn()} />);

    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [makeFile("my-recording.mp3", "audio/mpeg", 2048)] },
    });

    expect(screen.getByText(/my-recording\.mp3/)).toBeTruthy();
  });
});
