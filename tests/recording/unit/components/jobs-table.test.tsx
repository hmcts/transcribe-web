import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { JobsTable } from "@/components/recording/jobs-table/jobs-table";
import type { HearingRow } from "@/lib/recording/hearing-rows";
import { MOCK_JOBS } from "@/lib/recording/mock-data";
import type { HearingDaySummary } from "@/lib/recording/types";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/recording/base-path", () => ({
  apiPath: (p: string) => `http://localhost${p}`,
}));

describe("JobsTable", () => {
  it("shows empty state message when no jobs", () => {
    render(<JobsTable jobs={[]} />);
    expect(screen.getByText(/no transcription jobs yet/i)).toBeDefined();
  });

  it("renders a row for each job", () => {
    render(<JobsTable jobs={MOCK_JOBS} />);
    for (const job of MOCK_JOBS) {
      expect(screen.getByText(job.caseReference)).toBeDefined();
    }
  });

  it("shows transcript link for COMPLETED jobs", () => {
    const completedJobs = MOCK_JOBS.filter((j) => j.status === "COMPLETED");
    render(<JobsTable jobs={completedJobs} />);
    expect(screen.getAllByText(/view transcript/i).length).toBe(
      completedJobs.length
    );
  });

  it("shows a details link for non-completed jobs", () => {
    const failedJobs = MOCK_JOBS.filter((j) => j.status === "FAILED");
    render(<JobsTable jobs={failedJobs} />);
    expect(screen.getAllByText(/view details/i).length).toBe(failedJobs.length);
  });

  it("shows a time-derived percentage alongside the progress bar for processing jobs", () => {
    // Just submitted with a known audio duration, so the bar is early (a low,
    // non-overrun percentage) and derived from the Azure 5x model, not a static
    // status placeholder.
    const processingJob = {
      ...MOCK_JOBS[0],
      id: "job-processing-test",
      status: "PROCESSING" as const,
      uploadedAt: new Date().toISOString(),
      audioDurationSeconds: 9360,
    };
    render(<JobsTable jobs={[processingJob]} />);
    expect(screen.getByRole("progressbar")).toBeDefined();
    expect(screen.getByText(/^\d{1,2}%$/)).toBeDefined();
  });

  it("gives each row a real, keyboard/screen-reader accessible link", () => {
    const completedJob = { ...MOCK_JOBS[0], status: "COMPLETED" as const };
    render(<JobsTable jobs={[completedJob]} />);
    const link = screen.getByRole("link", { name: /view transcript/i });
    // The transcript page lives under app/recording/ — a bare /jobs/<id>
    // has no page and 404s.
    expect(link.getAttribute("href")).toBe(
      `/recording/jobs/${completedJob.id}`
    );
  });

  it("navigates to the job's transcript page under /recording when a row is clicked", async () => {
    push.mockClear();
    const completedJob = { ...MOCK_JOBS[0], status: "COMPLETED" as const };
    render(<JobsTable jobs={[completedJob]} />);

    await userEvent.click(screen.getByText(completedJob.caseReference));

    expect(push).toHaveBeenCalledWith(`/recording/jobs/${completedJob.id}`);
  });

  it("keeps rows queryable by their table row role", () => {
    render(<JobsTable jobs={[MOCK_JOBS[0]]} />);
    expect(screen.getAllByRole("row").length).toBeGreaterThan(0);
  });

  it("renders a delete button for each job", () => {
    render(<JobsTable jobs={MOCK_JOBS} onDelete={vi.fn()} />);
    expect(screen.getAllByRole("button", { name: /delete/i }).length).toBe(
      MOCK_JOBS.length
    );
  });

  it("calls onDelete after a confirmed deletion", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 204 })
    );

    const oneJob = [MOCK_JOBS[0]];
    render(<JobsTable jobs={oneJob} onDelete={onDelete} />);

    await user.click(screen.getByRole("button", { name: /delete/i }));
    await user.click(screen.getByRole("button", { name: /^delete$/i }));

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(oneJob[0].id));
    vi.unstubAllGlobals();
  });
});

describe("JobsTable run metadata popover", () => {
  const jobWithMetadata = MOCK_JOBS[0];

  it("reveals audio length, transcription time, and model on file name click", async () => {
    const user = userEvent.setup();
    render(<JobsTable jobs={[jobWithMetadata]} />);

    const trigger = screen.getByRole("button", {
      name: new RegExp(
        `transcription run details for ${jobWithMetadata.audioFileName}`,
        "i"
      ),
    });

    // Not visible until opened.
    expect(screen.queryByText(/audio length/i)).toBeNull();

    await user.click(trigger);

    expect(screen.getByText(/audio length/i)).toBeDefined();
    expect(screen.getByText(/transcription time/i)).toBeDefined();
    expect(screen.getByText(/^model$/i)).toBeDefined();
    // Prefers the server-resolved friendly name over the raw self URL.
    expect(
      screen.getByText(jobWithMetadata.modelDisplayName as string)
    ).toBeDefined();
  });

  it("prefers the resolved friendly name and links to public Speech docs", async () => {
    const job = {
      ...MOCK_JOBS[0],
      modelIdentifier:
        "https://uksouth.cognitiveservices.azure.com/speechtotext/v3.2/models/base/guid",
      modelDisplayName: "Base model — en-GB",
    };
    const user = userEvent.setup();
    render(<JobsTable jobs={[job]} />);

    await user.click(
      screen.getByRole("button", { name: /transcription run details/i })
    );

    expect(screen.getByText("Base model — en-GB")).toBeDefined();
    // The raw self URL is never rendered as visible text.
    expect(screen.queryByText(job.modelIdentifier as string)).toBeNull();
    const docsLink = screen.getByRole("link", { name: /about speech models/i });
    expect(docsLink.getAttribute("href")).toContain("learn.microsoft.com");
  });

  it("falls back to the raw model identifier when no friendly name is resolved", async () => {
    const job = {
      ...MOCK_JOBS[0],
      modelIdentifier: "azure-speech-batch-transcription (en-GB)",
      modelDisplayName: undefined,
    };
    const user = userEvent.setup();
    render(<JobsTable jobs={[job]} />);

    await user.click(
      screen.getByRole("button", { name: /transcription run details/i })
    );

    expect(
      screen.getByText("azure-speech-batch-transcription (en-GB)")
    ).toBeDefined();
    // No public-docs link when we only have the raw identifier.
    expect(
      screen.queryByRole("link", { name: /about speech models/i })
    ).toBeNull();
  });

  it("never renders the raw self URL when resolution failed on a URL identifier", async () => {
    const rawSelfUrl =
      "https://uksouth.cognitiveservices.azure.com/speechtotext/v3.2/models/base/guid";
    const job = {
      ...MOCK_JOBS[0],
      modelIdentifier: rawSelfUrl,
      modelDisplayName: undefined,
    };
    const user = userEvent.setup();
    render(<JobsTable jobs={[job]} />);

    await user.click(
      screen.getByRole("button", { name: /transcription run details/i })
    );

    // A neutral label is shown; the raw authenticated URL never appears as
    // visible text nor in the tooltip (title attribute).
    expect(screen.getByText("Azure Speech model")).toBeDefined();
    expect(screen.queryByText(rawSelfUrl)).toBeNull();
    expect(screen.queryByTitle(rawSelfUrl)).toBeNull();
    // No public-docs link without a resolved friendly name.
    expect(
      screen.queryByRole("link", { name: /about speech models/i })
    ).toBeNull();
  });

  it("does not navigate to the transcript when the file name is clicked", async () => {
    const user = userEvent.setup();
    render(<JobsTable jobs={[jobWithMetadata]} />);

    const trigger = screen.getByRole("button", {
      name: new RegExp(
        `transcription run details for ${jobWithMetadata.audioFileName}`,
        "i"
      ),
    });
    await user.click(trigger);

    expect(push).not.toHaveBeenCalled();
  });

  it("shows the file name as plain text when no run metadata is available", () => {
    const jobWithoutMetadata = {
      ...MOCK_JOBS[2],
      audioDurationSeconds: undefined,
      transcriptionDurationSeconds: undefined,
      modelIdentifier: undefined,
    };
    render(<JobsTable jobs={[jobWithoutMetadata]} />);

    expect(
      screen.queryByRole("button", { name: /transcription run details/i })
    ).toBeNull();
    expect(screen.getByText(jobWithoutMetadata.audioFileName)).toBeDefined();
  });

  it("gives the metadata dialog an accessible name", async () => {
    const user = userEvent.setup();
    render(<JobsTable jobs={[jobWithMetadata]} />);

    await user.click(
      screen.getByRole("button", {
        name: new RegExp(
          `transcription run details for ${jobWithMetadata.audioFileName}`,
          "i"
        ),
      })
    );

    const dialog = screen.getByRole("dialog", {
      name: new RegExp(
        `transcription run details for ${jobWithMetadata.audioFileName}`,
        "i"
      ),
    });
    expect(dialog).toBeDefined();
  });

  it("shows a terminal placeholder (not 'In progress…') for a FAILED job missing run details", async () => {
    const failedJob = {
      ...MOCK_JOBS[2], // FAILED
      audioDurationSeconds: 2401,
      transcriptionDurationSeconds: undefined,
      modelIdentifier: undefined,
      modelDisplayName: undefined,
    };
    const user = userEvent.setup();
    render(<JobsTable jobs={[failedJob]} />);

    await user.click(
      screen.getByRole("button", { name: /transcription run details/i })
    );

    expect(screen.queryByText(/in progress/i)).toBeNull();
    // Audio length is still known; the two unknown terminal values render "—".
    expect(screen.getAllByText("—").length).toBe(2);
  });

  it("shows 'In progress…' for a still-processing job missing run details", async () => {
    const processingJob = {
      ...MOCK_JOBS[0],
      status: "PROCESSING" as const,
      audioDurationSeconds: 1200,
      transcriptionDurationSeconds: undefined,
      modelIdentifier: undefined,
      modelDisplayName: undefined,
    };
    const user = userEvent.setup();
    render(<JobsTable jobs={[processingJob]} />);

    await user.click(
      screen.getByRole("button", { name: /transcription run details/i })
    );

    expect(screen.getAllByText(/in progress/i).length).toBe(2);
  });
});

// DIAAT-430: a hearing of several days is one row that lists its days.
describe("JobsTable with a hearing of several days", () => {
  const base = MOCK_JOBS[0];
  function dayOf(
    n: number,
    overrides: Partial<HearingDaySummary> = {}
  ): HearingDaySummary {
    return {
      jobId: n === 1 ? "hearing-1" : `job-${n}`,
      dayNumber: n,
      hearingDate: `2026-11-1${n - 1}`,
      audioFileName: `day${n}.mp3`,
      status: "COMPLETED",
      progressPercent: 100,
      uploadedAt: `2026-11-1${n - 1}T09:00:00Z`,
      audioDurationSeconds: 3600,
      transcriptionDurationSeconds: 600,
      modelDisplayName: "Base model — en-GB",
      ...overrides,
    };
  }
  function severalDays(
    days: HearingDaySummary[],
    overrides: Partial<HearingRow> = {}
  ): HearingRow {
    return {
      ...base,
      id: "hearing-1",
      caseReference: "PA/00001/2026",
      audioFileName: days[0].audioFileName,
      audioDurationSeconds: undefined,
      transcriptionDurationSeconds: undefined,
      modelIdentifier: undefined,
      modelDisplayName: undefined,
      status: "COMPLETED",
      days,
      ...overrides,
    };
  }

  it("shows the number of days instead of one file name", () => {
    render(<JobsTable jobs={[severalDays([dayOf(1), dayOf(2), dayOf(3)])]} />);
    expect(screen.getByText("3 days")).toBeDefined();
    expect(screen.queryByText("day1.mp3")).toBeNull();
  });

  it("lists each day's date, file name and run details in the popover", async () => {
    push.mockClear();
    const user = userEvent.setup();
    render(
      <JobsTable
        jobs={[
          severalDays([
            dayOf(1),
            dayOf(2, {
              status: "FAILED",
              transcriptionDurationSeconds: undefined,
              modelDisplayName: undefined,
            }),
          ]),
        ]}
      />
    );

    await user.click(
      screen.getByRole("button", {
        name: /recording days for PA\/00001\/2026/i,
      })
    );

    const dialog = screen.getByRole("dialog", {
      name: /recording days for PA\/00001\/2026/i,
    });
    const items = within(dialog).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText(/day 1/i)).toBeDefined();
    expect(within(items[0]).getByText(/10 November 2026/)).toBeDefined();
    expect(within(items[0]).getByText("day1.mp3")).toBeDefined();
    expect(within(items[0]).getByText("1h 0m 0s")).toBeDefined();
    expect(within(items[0]).getByText("Base model — en-GB")).toBeDefined();
    expect(within(items[1]).getByText(/11 November 2026/)).toBeDefined();
    expect(within(items[1]).getByText("day2.mp3")).toBeDefined();
    expect(within(items[1]).getByText(/failed/i)).toBeDefined();
    expect(push).not.toHaveBeenCalled();
  });

  it("never shows a day's raw model URL", async () => {
    const rawSelfUrl =
      "https://uksouth.cognitiveservices.azure.com/speechtotext/v3.2/models/base/guid";
    const user = userEvent.setup();
    render(
      <JobsTable
        jobs={[
          severalDays([
            dayOf(1, {
              modelDisplayName: undefined,
              modelIdentifier: rawSelfUrl,
            }),
            dayOf(2),
          ]),
        ]}
      />
    );

    await user.click(screen.getByRole("button", { name: /recording days/i }));

    expect(screen.getByText("Azure Speech model")).toBeDefined();
    expect(screen.queryByText(rawSelfUrl)).toBeNull();
    expect(screen.queryByTitle(rawSelfUrl)).toBeNull();
  });

  it("says how many days are complete and how many failed", () => {
    render(
      <JobsTable
        jobs={[
          severalDays([dayOf(1), dayOf(2), dayOf(3, { status: "FAILED" })]),
        ]}
      />
    );
    expect(screen.getByText("Completed")).toBeDefined();
    expect(screen.getByText("2 of 3 days complete")).toBeDefined();
    expect(screen.getByText("1 day failed")).toBeDefined();
    expect(
      screen.getByRole("link", { name: /view transcript/i })
    ).toBeDefined();
  });

  it("shows the progress of the day being transcribed while processing", () => {
    const running = dayOf(2, {
      status: "PROCESSING",
      progressPercent: 30,
      uploadedAt: new Date().toISOString(),
    });
    render(
      <JobsTable
        jobs={[
          severalDays([dayOf(1), running], {
            status: "PROCESSING",
            inFlightDay: {
              ...base,
              id: running.jobId,
              audioFileName: running.audioFileName,
              uploadedAt: running.uploadedAt,
              status: "PROCESSING",
              progressPercent: 30,
              audioDurationSeconds: 3600,
            },
          }),
        ]}
      />
    );
    expect(screen.getByText("Processing…")).toBeDefined();
    expect(screen.getByRole("progressbar")).toBeDefined();
    expect(screen.getByText("1 of 2 days complete")).toBeDefined();
  });

  it("warns that deleting the row deletes every day", async () => {
    const user = userEvent.setup();
    render(
      <JobsTable
        jobs={[severalDays([dayOf(1), dayOf(2)])]}
        onDelete={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: /delete/i }));

    expect(
      await screen.findByText(/all 2 days of audio and their transcripts/i)
    ).toBeDefined();
  });
});
