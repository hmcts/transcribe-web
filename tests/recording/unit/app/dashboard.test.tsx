import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DashboardPage from "@/app/recording/page";
import { prepareForJurisdictionSwitch } from "@/lib/jurisdiction-switch";
import type { HearingDaySummary, HearingSummary } from "@/lib/recording/types";

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

function day(
  jobId: string,
  audioFileName: string,
  overrides: Partial<HearingDaySummary> = {}
): HearingDaySummary {
  return {
    jobId,
    dayNumber: 1,
    hearingDate: "2026-07-01",
    audioFileName,
    status: "COMPLETED",
    progressPercent: 100,
    uploadedAt: "2026-07-01T09:00:00Z",
    ...overrides,
  };
}

function hearing(
  id: string,
  caseReference: string,
  days: HearingDaySummary[]
): HearingSummary {
  return {
    id,
    caseReference,
    tribunal: "First-tier Tribunal",
    status: "completed",
    dayCount: days.length,
    daysComplete: days.length,
    daysFailed: 0,
    days,
  };
}

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ hearings: [] }),
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

  it("shows the hearings returned by the API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            hearings: [
              hearing("hearing-1", "PA/05217/2025", [
                day("hearing-1", "hearing1.wav"),
              ]),
              hearing("hearing-2", "EA/11042/2025", [
                day("hearing-2", "hearing2.wav"),
              ]),
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

  // DIAAT-428: a hearing of several days is one row, in each list.
  it("shows a hearing of several days as one row, read from /api/hearings", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          hearings: [
            hearing("hearing-1", "PA/00001/2026", [
              day("hearing-1", "day1.wav"),
              day("job-2", "day2.wav", { dayNumber: 2 }),
            ]),
          ],
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<DashboardPage />);

    await waitFor(() =>
      expect(screen.getAllByText("PA/00001/2026")).toHaveLength(2)
    );
    expect(fetchMock.mock.calls.map(([url]) => url)).toContain("/api/hearings");
    expect(
      screen
        .getAllByRole("link", { name: /view transcript/i })[0]
        .getAttribute("href")
    ).toBe("/recording/jobs/hearing-1");
  });

  // DIAAT-430: a hearing is in Transcripts as soon as one day is complete.
  it("lists a hearing with a day still processing in both lists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            hearings: [
              {
                ...hearing("hearing-1", "PA/00001/2026", [
                  day("hearing-1", "day1.wav"),
                  day("job-2", "day2.wav", {
                    dayNumber: 2,
                    status: "PROCESSING",
                    progressPercent: 20,
                  }),
                ]),
                status: "processing",
                daysComplete: 1,
              },
            ],
          }),
      })
    );

    render(<DashboardPage />);

    await waitFor(() =>
      expect(screen.getAllByText("PA/00001/2026")).toHaveLength(2)
    );
    const [transcripts, uploads] = screen.getAllByRole("table");
    expect(within(transcripts).getByText("Completed")).toBeDefined();
    expect(
      within(transcripts).getByRole("link", { name: /view transcript/i })
    ).toBeDefined();
    expect(within(uploads).getByText("Processing…")).toBeDefined();
    expect(screen.getAllByText("1 of 2 days complete")).toHaveLength(2);
  });

  it("leaves a hearing with no day complete out of Transcripts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            hearings: [
              {
                ...hearing("hearing-1", "PA/00001/2026", [
                  day("hearing-1", "day1.wav", { status: "FAILED" }),
                  day("job-2", "day2.wav", { dayNumber: 2, status: "FAILED" }),
                ]),
                status: "failed",
                daysComplete: 0,
                daysFailed: 2,
              },
            ],
          }),
      })
    );

    render(<DashboardPage />);

    await waitFor(() =>
      expect(screen.getAllByText("PA/00001/2026")).toHaveLength(1)
    );
    expect(screen.getByText("Transcripts (0)")).toBeDefined();
    expect(screen.getByText("2 days failed")).toBeDefined();
  });

  describe("polling", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    const hearingsCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
      fetchMock.mock.calls.filter(([url]) => url === "/api/hearings").length;

    function hearingsWithDay2(status: HearingDaySummary["status"]) {
      return {
        ok: true,
        json: () =>
          Promise.resolve({
            hearings: [
              hearing("hearing-1", "PA/00001/2026", [
                day("hearing-1", "day1.wav"),
                day("job-2", "day2.wav", { dayNumber: 2, status }),
              ]),
            ],
          }),
      };
    }

    it("refetches while a day of a hearing is still processing", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const fetchMock = vi
        .fn()
        .mockResolvedValue(hearingsWithDay2("PROCESSING"));
      vi.stubGlobal("fetch", fetchMock);

      render(<DashboardPage />);
      await waitFor(() => expect(hearingsCalls(fetchMock)).toBe(1));
      await act(() => vi.advanceTimersByTimeAsync(5000));

      expect(hearingsCalls(fetchMock)).toBe(2);
    });

    it("stops once no day is processing, even with a failed day", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const fetchMock = vi.fn().mockResolvedValue(hearingsWithDay2("FAILED"));
      vi.stubGlobal("fetch", fetchMock);

      render(<DashboardPage />);
      await waitFor(() =>
        expect(screen.getAllByText("PA/00001/2026")).toHaveLength(2)
      );
      await act(() => vi.advanceTimersByTimeAsync(5000));

      expect(hearingsCalls(fetchMock)).toBe(1);
    });
  });

  it("removes a hearing from the list after it is deleted", async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        return Promise.resolve({ ok: true, status: 204 });
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            hearings: [
              hearing("hearing-1", "PA/00001/2026", [
                day("hearing-1", "hearing.wav"),
              ]),
            ],
          }),
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
    const deleted = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "DELETE"
    );
    expect(deleted?.[0]).toBe("/api/hearings/hearing-1");
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
          json: () => Promise.resolve({ hearings: [] }),
        });
      });
      vi.stubGlobal("fetch", fetchMock);
      const user = userEvent.setup();

      render(<DashboardPage />);
      await user.upload(screen.getByLabelText("Audio file input"), file);
      await user.click(
        screen.getByRole("button", { name: /transcribe a recording/i })
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

    it("stops a jurisdiction switch while the upload is in progress (DIAAT-332)", async () => {
      mockReadAudioDurationSeconds.mockResolvedValue(undefined);
      let finish: (value: unknown) => void = () => undefined;
      const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
        init?.method === "POST"
          ? new Promise((resolve) => {
              finish = resolve;
            })
          : Promise.resolve({
              ok: true,
              json: () => Promise.resolve({ hearings: [] }),
            })
      );
      vi.stubGlobal("fetch", fetchMock);
      const user = userEvent.setup();
      render(<DashboardPage />);
      await expect(prepareForJurisdictionSwitch()).resolves.toBeUndefined();

      await user.upload(
        screen.getByLabelText("Audio file input"),
        new File(["bytes"], "hearing.mp3", { type: "audio/mpeg" })
      );
      await user.click(
        screen.getByRole("button", { name: /transcribe a recording/i })
      );
      await waitFor(() =>
        expect(
          fetchMock.mock.calls.some(([, init]) => init?.method === "POST")
        ).toBe(true)
      );

      await expect(prepareForJurisdictionSwitch()).rejects.toMatchObject({
        step: "busy",
      });
      finish({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ job: { id: "job-1" } }),
      });
      await waitFor(() => expect(toast.success).toHaveBeenCalled());
      await expect(prepareForJurisdictionSwitch()).resolves.toBeUndefined();
    });

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
