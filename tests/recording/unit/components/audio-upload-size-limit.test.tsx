import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioUpload } from "@/components/recording/audio-upload/audio-upload";

// A file over the size limit is refused when it is chosen, before any of it is
// sent: the browser keeps sending a body after the server has answered 413, so
// a file over the limit used to be refused only once all of it was uploaded
// (about 15 minutes for 1.1 GB). The limit is GET /api/upload's.

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError } }));

const GIB = 1024 ** 3;

function limitIs(response: { ok: boolean; body?: unknown } | "unreachable") {
  const fetchMock = vi.fn(async (..._args: unknown[]) => {
    if (response === "unreachable") throw new TypeError("fetch failed");
    return { ok: response.ok, json: async () => response.body };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// A file of the given size without allocating it.
function fileOfSize(size: number, name = "hearing.mp3") {
  const file = new File(["x"], name, { type: "audio/mpeg" });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function choose(file: File) {
  const input = screen.getByLabelText("Audio file input");
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => {
  toastError.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the dropzone's size check", () => {
  it("asks the web server for the limit once", async () => {
    const fetchMock = limitIs({ ok: true, body: { max_upload_bytes: GIB } });
    render(<AudioUpload onUpload={vi.fn()} uploading={false} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/upload");
  });

  it("refuses a file over the limit when it is chosen, naming the limit, and never offers it for upload", async () => {
    const fetchMock = limitIs({ ok: true, body: { max_upload_bytes: GIB } });
    const onUpload = vi.fn();
    render(<AudioUpload onUpload={onUpload} uploading={false} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await screen.findByText(/recordings up to/i);
    // Let the limit land in the component.
    await waitFor(() => expect(fetchMock).toHaveReturned());
    await new Promise((resolve) => setTimeout(resolve));

    choose(fileOfSize(GIB + 1));

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastError.mock.calls[0]?.[0]).toMatch(/limit is 1 GB/);
    expect(screen.queryByText(/Selected:/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /transcribe/i }));
    expect(onUpload).not.toHaveBeenCalled();
  });

  it("takes a file at exactly the limit", async () => {
    const fetchMock = limitIs({ ok: true, body: { max_upload_bytes: GIB } });
    render(<AudioUpload onUpload={vi.fn()} uploading={false} />);
    await waitFor(() => expect(fetchMock).toHaveReturned());
    await new Promise((resolve) => setTimeout(resolve));

    choose(fileOfSize(GIB));

    expect(await screen.findByText(/Selected: hearing\.mp3/)).toBeTruthy();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("follows a limit other than 1 GiB (a web pod with MAX_UPLOAD_BYTES set)", async () => {
    const fetchMock = limitIs({
      ok: true,
      body: { max_upload_bytes: 512 * 1024 * 1024 },
    });
    render(<AudioUpload onUpload={vi.fn()} uploading={false} />);
    await waitFor(() => expect(fetchMock).toHaveReturned());
    await new Promise((resolve) => setTimeout(resolve));

    choose(fileOfSize(600 * 1024 * 1024));

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastError.mock.calls[0]?.[0]).toMatch(/limit is 512 MB/);
  });

  it("does not check a file when the limit could not be read (the server still refuses it)", async () => {
    for (const response of [
      "unreachable" as const,
      { ok: false },
      { ok: true, body: { max_upload_bytes: "big" } },
      { ok: true, body: { max_upload_bytes: 0 } },
      { ok: true, body: {} },
    ]) {
      toastError.mockReset();
      const fetchMock = limitIs(response);
      const { unmount } = render(
        <AudioUpload onUpload={vi.fn()} uploading={false} />
      );
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      await new Promise((resolve) => setTimeout(resolve));

      choose(fileOfSize(5 * GIB, "huge.mp3"));

      expect(await screen.findByText(/Selected: huge\.mp3/)).toBeTruthy();
      expect(toastError).not.toHaveBeenCalled();
      unmount();
    }
  });

  it("refuses at submit a file chosen before the limit was known", async () => {
    let answer: (value: unknown) => void = () => undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            answer = resolve;
          })
      )
    );
    const onUpload = vi.fn();
    render(<AudioUpload onUpload={onUpload} uploading={false} />);

    choose(fileOfSize(2 * GIB, "late.mp3"));
    expect(await screen.findByText(/Selected: late\.mp3/)).toBeTruthy();

    answer({ ok: true, json: async () => ({ max_upload_bytes: GIB }) });
    await new Promise((resolve) => setTimeout(resolve));
    fireEvent.click(screen.getByRole("button", { name: /transcribe/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(onUpload).not.toHaveBeenCalled();
    expect(screen.queryByText(/Selected:/)).toBeNull();
  });
});
