import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HearingDetailView } from "@/components/recording/transcript/hearing-detail-view";
import type { TranscriptionJob } from "@/lib/recording/types";
import { hearingOf, oneDayHearing } from "../hearing-fixtures";

// DIAAT-428: a hearing's page shows every day of it, each transcribed on its
// own. Adding, deleting and redating days are behind multi_day_hearings.

let multiDay = false;
vi.mock("@/providers/runtime-flags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/runtime-flags")>()),
  useMultiDayHearings: () => multiDay,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/recording/audio-duration", () => ({
  readAudioDurationSeconds: vi.fn().mockResolvedValue(undefined),
}));

function job(
  id: string,
  overrides: Partial<TranscriptionJob> = {}
): TranscriptionJob {
  return {
    id,
    caseReference: "PA/00001/2026",
    tribunal: "First-tier Tribunal",
    audioFileName: `${id}.mp3`,
    uploadedAt: "2026-11-10T09:00:00Z",
    status: "COMPLETED",
    segments: [
      {
        id: `${id}-s1`,
        speaker: "Judge",
        speakerColor: "#000000",
        text: `Said on ${id}.`,
        startTime: 3,
        duration: 5,
      },
    ],
    accuracy: {
      confidenceScore: 90,
      wordsTranscribed: 100,
      lowConfidenceCount: 0,
      confidenceThreshold: 85,
      hasCorrections: false,
      hasBaseline: false,
    },
    ...overrides,
  };
}

const TWO_DAYS = () => hearingOf([job("day-1"), job("day-2")]);

function ok(body: unknown, status = 200) {
  return { ok: true, status, json: () => Promise.resolve(body) };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  multiDay = false;
  fetchMock = vi.fn().mockResolvedValue(ok({}));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function daySection(n: number): HTMLElement {
  return screen.getByRole("region", { name: `Day ${n}` });
}

describe("a hearing of several days", () => {
  it("shows each day under a heading with its date, file and status", () => {
    render(
      <HearingDetailView
        initialHearing={hearingOf([
          job("day-1"),
          job("day-2", {
            status: "FAILED",
            segments: undefined,
            errorMessage: "Speech failed",
          }),
        ])}
      />
    );

    const first = daySection(1);
    expect(within(first).getByText("10 November 2026")).toBeDefined();
    expect(within(first).getByText("day-1.mp3")).toBeDefined();
    expect(within(first).getByText("Completed")).toBeDefined();
    expect(within(first).getByText("Said on day-1.")).toBeDefined();

    const second = daySection(2);
    expect(within(second).getByText("11 November 2026")).toBeDefined();
    expect(within(second).getByText("Failed")).toBeDefined();
    expect(within(second).getByText("Speech failed")).toBeDefined();
  });

  it("changes a segment through its own day's job", async () => {
    fetchMock.mockResolvedValue(ok({ job: job("day-2") }));
    render(<HearingDetailView initialHearing={TWO_DAYS()} />);

    const day2 = daySection(2);
    await userEvent.click(
      within(day2).getByRole("button", { name: "Rename speaker Judge" })
    );
    const input = within(day2).getByLabelText("New name for Judge");
    await userEvent.clear(input);
    await userEvent.type(input, "Counsel");
    await userEvent.click(
      within(day2).getByRole("button", { name: "Replace one" })
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/jobs/day-2/segments/day-2-s1/speaker"
    );
  });

  it("plays one day at a time: a segment of another day puts the player and the sidebar on that day", () => {
    const { container } = render(
      <HearingDetailView initialHearing={TWO_DAYS()} />
    );
    const audio = () => container.querySelector("audio") as HTMLAudioElement;
    expect(audio().getAttribute("src")).toBe("/api/audio/day-1");
    expect(screen.getByText("Day 1", { selector: "aside p" })).toBeDefined();

    fireEvent.click(
      within(daySection(2)).getByRole("button", { name: "0:03" })
    );

    expect(audio().getAttribute("src")).toBe("/api/audio/day-2");
    expect(screen.getByText("Day 2", { selector: "aside p" })).toBeDefined();
    // The seek waits for the day's audio to load.
    Object.defineProperty(audio(), "duration", {
      value: 60,
      configurable: true,
    });
    fireEvent(audio(), new Event("loadedmetadata"));
    expect(audio().currentTime).toBe(3);
  });

  it("says which day's audio cannot be played", () => {
    const { container } = render(
      <HearingDetailView initialHearing={TWO_DAYS()} />
    );
    fireEvent.click(
      within(daySection(2)).getByRole("button", { name: "Listen to this day" })
    );
    fireEvent(
      container.querySelector("audio") as HTMLAudioElement,
      new Event("error")
    );

    expect(
      screen.getByText("Audio playback is unavailable for day 2.")
    ).toBeDefined();
  });

  it("asks only for the days still in progress, on their own", async () => {
    vi.useFakeTimers();
    const hearing = hearingOf([
      job("day-1"),
      job("day-2", { status: "PROCESSING", segments: undefined }),
    ]);
    fetchMock.mockResolvedValue(ok({ job: job("day-2") }));
    render(<HearingDetailView initialHearing={hearing} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/jobs/day-2",
    ]);
    vi.useRealTimers();
    expect(
      await within(daySection(2)).findByText("Said on day-2.")
    ).toBeDefined();
  });
});

describe("with multi_day_hearings off", () => {
  it("offers no way to add, delete or redate days", () => {
    render(<HearingDetailView initialHearing={TWO_DAYS()} />);
    expect(screen.queryByText("Add audio to this hearing")).toBeNull();
    expect(screen.queryByRole("button", { name: /delete day/i })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /change the date/i })
    ).toBeNull();
  });

  it("shows a one-day hearing as a recording, with no day heading or date", () => {
    render(<HearingDetailView initialHearing={oneDayHearing(job("day-1"))} />);
    expect(screen.queryByRole("heading", { name: "Day 1" })).toBeNull();
    expect(screen.queryByText(/Date of the hearing/)).toBeNull();
    expect(screen.getByText("Said on day-1.")).toBeDefined();
  });
});

describe("with multi_day_hearings on", () => {
  beforeEach(() => {
    multiDay = true;
  });

  it("adds a recording to the hearing through /api/upload, as a new day in its place", async () => {
    fetchMock.mockResolvedValue(
      ok(
        {
          job: job("day-3", {
            status: "PENDING",
            segments: undefined,
            hearingId: "day-1",
            hearingDate: "2026-11-10",
            uploadedAt: "2026-11-12T09:00:00Z",
          }),
        },
        201
      )
    );
    const user = userEvent.setup();
    render(<HearingDetailView initialHearing={TWO_DAYS()} />);

    const panel = screen.getByRole("region", {
      name: "Add audio to this hearing",
    });
    await user.upload(
      within(panel).getByLabelText("Audio file input"),
      new File(["bytes"], "day3.mp3", { type: "audio/mpeg" })
    );
    fireEvent.change(within(panel).getByLabelText("Date of the hearing"), {
      target: { value: "2026-11-10" },
    });
    await user.click(
      within(panel).getByRole("button", { name: "Add to this hearing" })
    );

    await waitFor(() =>
      expect(screen.getByRole("region", { name: "Day 3" })).toBeDefined()
    );
    const [url, init] = fetchMock.mock.calls.find(
      ([, i]) => i?.method === "POST"
    ) as [string, RequestInit];
    expect(url).toBe("/api/upload");
    expect(init.headers).toMatchObject({
      "X-Hearing-Id": "day-1",
      "X-Hearing-Date": "2026-11-10",
    });
    // Same date as day 1, uploaded after it: day 2 of 3.
    expect(within(daySection(2)).getByText("day-3.mp3")).toBeDefined();
  });

  it("turns a one-day hearing into one of two days when a recording is added", async () => {
    fetchMock.mockResolvedValue(
      ok(
        {
          job: job("day-2", {
            status: "PENDING",
            segments: undefined,
            hearingId: "day-1",
            hearingDate: "2026-11-11",
          }),
        },
        201
      )
    );
    const user = userEvent.setup();
    render(<HearingDetailView initialHearing={oneDayHearing(job("day-1"))} />);

    const panel = screen.getByRole("region", {
      name: "Add audio to this hearing",
    });
    await user.upload(
      within(panel).getByLabelText("Audio file input"),
      new File(["bytes"], "day2.mp3", { type: "audio/mpeg" })
    );
    await user.click(
      within(panel).getByRole("button", { name: "Add to this hearing" })
    );

    expect(await screen.findByRole("heading", { name: "Day 2" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Day 1" })).toBeDefined();
  });

  it("offers adding audio while the only day is still being transcribed", () => {
    render(
      <HearingDetailView
        initialHearing={oneDayHearing(
          job("day-1", { status: "PROCESSING", segments: undefined })
        )}
      />
    );
    expect(screen.getByText(/still in progress/i)).toBeDefined();
    expect(
      screen.getByRole("region", { name: "Add audio to this hearing" })
    ).toBeDefined();
  });

  it("deletes one day, keeping the others, and numbers them again", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 204,
      json: () => Promise.reject(),
    });
    const user = userEvent.setup();
    render(
      <HearingDetailView
        initialHearing={hearingOf([job("day-1"), job("day-2"), job("day-3")])}
      />
    );

    await user.click(screen.getByRole("button", { name: "Delete day 1" }));
    await user.click(screen.getByRole("button", { name: /^delete$/i }));

    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Day 3" })).toBeNull()
    );
    const deleted = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "DELETE"
    );
    expect(deleted?.[0]).toBe("/api/jobs/day-1");
    expect(within(daySection(1)).getByText("day-2.mp3")).toBeDefined();
    expect(screen.queryByText("Said on day-1.")).toBeNull();
  });

  it("keeps the day, and says so, when it cannot be deleted", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: () =>
        Promise.resolve({ error: "This day cannot be deleted at the moment." }),
    });
    const user = userEvent.setup();
    render(<HearingDetailView initialHearing={TWO_DAYS()} />);

    await user.click(screen.getByRole("button", { name: "Delete day 2" }));
    await user.click(screen.getByRole("button", { name: /^delete$/i }));

    expect(
      await screen.findByText("This day cannot be deleted at the moment.")
    ).toBeDefined();
    expect(screen.getByText("Said on day-2.")).toBeDefined();
  });

  it("does not offer to delete the only day of a hearing", () => {
    render(<HearingDetailView initialHearing={oneDayHearing(job("day-1"))} />);
    expect(screen.queryByRole("button", { name: /delete day/i })).toBeNull();
  });

  it("changes a day's date and puts the days in the new order", async () => {
    fetchMock.mockResolvedValue(
      ok({
        hearing: {
          id: "day-1",
          caseReference: "PA/00001/2026",
          tribunal: "First-tier Tribunal",
          status: "completed",
          dayCount: 2,
          daysComplete: 2,
          daysFailed: 0,
          days: [
            { jobId: "day-2", dayNumber: 1, hearingDate: "2026-11-11" },
            { jobId: "day-1", dayNumber: 2, hearingDate: "2026-11-12" },
          ],
        },
      })
    );
    const user = userEvent.setup();
    render(<HearingDetailView initialHearing={TWO_DAYS()} />);

    await user.click(
      screen.getByRole("button", { name: "Change the date of day 1" })
    );
    const input = within(daySection(1)).getByDisplayValue("2026-11-10");
    fireEvent.change(input, { target: { value: "2026-11-12" } });
    await user.click(
      within(daySection(1)).getByRole("button", { name: "Save" })
    );

    await waitFor(() =>
      expect(within(daySection(2)).getByText("day-1.mp3")).toBeDefined()
    );
    expect(within(daySection(2)).getByText("12 November 2026")).toBeDefined();
    const [url, init] = fetchMock.mock.calls.find(
      ([, i]) => i?.method === "PATCH"
    ) as [string, RequestInit & { body: string }];
    expect(url).toBe("/api/jobs/day-1/hearing-date");
    expect(JSON.parse(init.body)).toEqual({ hearingDate: "2026-11-12" });
  });

  it("shows and changes the date of a one-day hearing", async () => {
    fetchMock.mockResolvedValue(
      ok({
        hearing: {
          id: "day-1",
          status: "completed",
          days: [{ jobId: "day-1", dayNumber: 1, hearingDate: "2026-11-01" }],
        },
      })
    );
    const user = userEvent.setup();
    render(<HearingDetailView initialHearing={oneDayHearing(job("day-1"))} />);

    expect(screen.getByText("10 November 2026")).toBeDefined();
    await user.click(
      screen.getByRole("button", { name: "Change the date of day 1" })
    );
    fireEvent.change(screen.getByDisplayValue("2026-11-10"), {
      target: { value: "2026-11-01" },
    });
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("1 November 2026")).toBeDefined();
  });

  it("says why a date was not changed", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: () =>
        Promise.resolve({ error: "The date cannot be changed at the moment." }),
    });
    const user = userEvent.setup();
    render(<HearingDetailView initialHearing={TWO_DAYS()} />);

    await user.click(
      screen.getByRole("button", { name: "Change the date of day 2" })
    );
    await user.click(
      within(daySection(2)).getByRole("button", { name: "Save" })
    );

    expect(
      await within(daySection(2)).findByText(
        "The date cannot be changed at the moment."
      )
    ).toBeDefined();
  });
});

describe("a hearing whose first day is still being transcribed", () => {
  it("plays the first day that has a transcript", () => {
    const { container } = render(
      <HearingDetailView
        initialHearing={hearingOf([
          job("day-1", { status: "PROCESSING", segments: undefined }),
          job("day-2"),
        ])}
      />
    );
    expect(container.querySelector("audio")?.getAttribute("src")).toBe(
      "/api/audio/day-2"
    );
  });
});
