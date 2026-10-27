import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DashboardPage from "@/app/recording/page";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

const { mockReadAudioDurationSeconds } = vi.hoisted(() => ({
  mockReadAudioDurationSeconds: vi.fn(),
}));

vi.mock("@/lib/recording/audio-duration", () => ({
  readAudioDurationSeconds: mockReadAudioDurationSeconds,
}));

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ jobs: [] }),
      })
    );
  });
  it("renders page heading", () => {
    render(<DashboardPage />);
    expect(screen.getByText("Batch Audio Transcription")).toBeDefined();
  });

  it("renders upload section", () => {
    render(<DashboardPage />);
    expect(screen.getByText(/drag and drop an audio file/i)).toBeDefined();
  });

  it("renders exactly the transcripts and uploads sections", () => {
    render(<DashboardPage />);
    expect(screen.getByText(/^transcripts/i)).toBeDefined();
    expect(screen.getByText(/^uploads/i)).toBeDefined();
  });

  it("shows jobs returned by the API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            jobs: [
              {
                id: "job-1",
                caseReference: "PA/05217/2025",
                tribunal: "First-tier Tribunal",
                audioFileName: "hearing1.wav",
                status: "COMPLETED",
                progressPercent: 100,
              },
              {
                id: "job-2",
                caseReference: "EA/11042/2025",
                tribunal: "First-tier Tribunal",
                audioFileName: "hearing2.wav",
                status: "COMPLETED",
                progressPercent: 100,
              },
            ],
          }),
      })
    );

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getAllByText("PA/05217/2025").length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText("EA/11042/2025").length).toBeGreaterThan(0);
  });

  it("removes a job from the list after it is deleted", async () => {
    const job = {
      id: "job-1",
      caseReference: "PA/00001/2026",
      tribunal: "First-tier Tribunal — Immigration and Asylum Chamber",
      audioFileName: "hearing.wav",
      uploadedAt: "2026-07-01T09:00:00Z",
      status: "COMPLETED",
      progressPercent: 100,
    };
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        return Promise.resolve({ ok: true, status: 204 });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ jobs: [job] }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<DashboardPage />);
    // Case reference appears in both the Transcripts and Uploads sections.
    await waitFor(() =>
      expect(screen.getAllByText("PA/00001/2026").length).toBeGreaterThan(0)
    );

    await user.click(screen.getAllByRole("button", { name: /delete/i })[0]);
    await user.click(screen.getByRole("button", { name: /^delete$/i }));

    await waitFor(() => expect(screen.queryByText("PA/00001/2026")).toBeNull());
  });

  describe("uploading a recording", () => {
    // Front Door's WAF (DRS 2.1) blocks multipart/form-data bodies from the
    // browser, so the file goes as the raw request body with its metadata in
    // headers; the route handler builds the multipart request in-cluster.
    async function uploadThroughPage(
      file: File,
      uploadResponse: {
        ok: boolean;
        status: number;
        json: () => Promise<unknown>;
      } = {
        ok: true,
        status: 201,
        json: () => Promise.resolve({ job: { id: "job-1" } }),
      }
    ) {
      const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          return Promise.resolve(uploadResponse);
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ jobs: [] }),
        });
      });
      vi.stubGlobal("fetch", fetchMock);
      const user = userEvent.setup();

      render(<DashboardPage />);
      await user.upload(screen.getByLabelText("Audio file input"), file);
      await user.click(
        screen.getByRole("button", { name: /upload for transcription/i })
      );

      await waitFor(() =>
        expect(
          fetchMock.mock.calls.some(([, init]) => init?.method === "POST")
        ).toBe(true)
      );
      const [url, init] = fetchMock.mock.calls.find(
        ([, init]) => init?.method === "POST"
      ) as [string, RequestInit];
      return { url, init };
    }

    it("sends the file as the raw body, not multipart, to /api/upload", async () => {
      mockReadAudioDurationSeconds.mockResolvedValue(9360.5);
      const name = "PA_05217_2025 R v O'Brien.wav";
      const file = new File(["RIFF-audio-bytes"], name, { type: "audio/wav" });

      const { url, init } = await uploadThroughPage(file);

      expect(url).toBe("/api/upload");
      expect(init.body).toBe(file);
      expect(init.body).not.toBeInstanceOf(FormData);
      // Exactly application/octet-stream, no parameters: the only content
      // type Front Door's WAF exemption for this path lets through. The
      // file's own type travels in X-Upload-Content-Type instead.
      expect(init.headers).toEqual({
        "Content-Type": "application/octet-stream",
        "X-Upload-Content-Type": "audio/wav",
        "X-Upload-Filename": encodeURIComponent(name),
        "X-Upload-Size": String(file.size),
        "X-Audio-Duration-Seconds": "9360.5",
      });
    });

    it("omits the duration header when the duration can't be read", async () => {
      mockReadAudioDurationSeconds.mockResolvedValue(undefined);
      const file = new File(["bytes"], "hearing.mp3", { type: "audio/mpeg" });

      const { init } = await uploadThroughPage(file);

      expect(init.headers).toEqual({
        "Content-Type": "application/octet-stream",
        "X-Upload-Content-Type": "audio/mpeg",
        "X-Upload-Filename": "hearing.mp3",
        "X-Upload-Size": String(file.size),
      });
    });

    describe("when the upload fails", () => {
      const file = new File(["bytes"], "hearing.mp3", { type: "audio/mpeg" });

      beforeEach(() => {
        vi.mocked(toast.error).mockClear();
      });

      it("shows the route's error message", async () => {
        mockReadAudioDurationSeconds.mockResolvedValue(undefined);

        await uploadThroughPage(file, {
          ok: false,
          status: 503,
          json: () =>
            Promise.resolve({
              error: "The route's own message.",
              request_id: "req-1",
            }),
        });

        await waitFor(() =>
          expect(toast.error).toHaveBeenCalledWith("The route's own message.")
        );
      });

      // A 503 that never reached the route (Front Door's own error page, say)
      // has no JSON message.
      it("says the service is unavailable for a 503 without a message", async () => {
        mockReadAudioDurationSeconds.mockResolvedValue(undefined);

        await uploadThroughPage(file, {
          ok: false,
          status: 503,
          json: () => Promise.reject(new SyntaxError("not JSON")),
        });

        await waitFor(() =>
          expect(toast.error).toHaveBeenCalledWith(
            "The transcription service is temporarily unavailable. Please try again."
          )
        );
      });

      it("gives the status for any other failure without a message", async () => {
        mockReadAudioDurationSeconds.mockResolvedValue(undefined);

        await uploadThroughPage(file, {
          ok: false,
          status: 502,
          json: () => Promise.reject(new SyntaxError("not JSON")),
        });

        await waitFor(() =>
          expect(toast.error).toHaveBeenCalledWith("Upload failed: 502")
        );
      });
    });

    it("declares the type react-dropzone gives a file the browser has no type for", async () => {
      // file-selector fills File.type in from the extension (audio/x-flac
      // here); the route's allowlist (lib/recording/upload-contract.ts) has
      // to accept what it gives for every audio extension.
      mockReadAudioDurationSeconds.mockResolvedValue(undefined);
      const file = new File(["bytes"], "hearing.flac");

      const { init } = await uploadThroughPage(file);

      expect(init.headers).toEqual({
        "Content-Type": "application/octet-stream",
        "X-Upload-Content-Type": "audio/x-flac",
        "X-Upload-Filename": "hearing.flac",
        "X-Upload-Size": String(file.size),
      });
    });
  });
});
