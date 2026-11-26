import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HearingDetailView } from "@/components/recording/transcript/hearing-detail-view";
import type { TranscriptionJob } from "@/lib/recording/types";
import { hearingOf, oneDayHearing } from "../hearing-fixtures";

// DIAAT-429: on a hearing of several days, a dropdown under "Transcript"
// expands one day (and plays it), every day, or none.

vi.mock("@/providers/runtime-flags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/runtime-flags")>()),
  useMultiDayHearings: () => true,
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

const THREE_DAYS = () => hearingOf([job("day-1"), job("day-2"), job("day-3")]);

// Ids of the elements scrolled to while shown: a browser cannot scroll to a
// hidden one.
let scrolledTo: string[];

beforeEach(() => {
  scrolledTo = [];
  Element.prototype.scrollIntoView = function (this: Element) {
    if (!this.closest("[hidden]")) scrolledTo.push(this.id);
  };
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const selector = () =>
  screen.getByRole("combobox", { name: "Show" }) as HTMLSelectElement;

const daySection = (n: number) =>
  screen.getByRole("region", { name: `Day ${n}` });

// A collapsed day keeps its heading; its transcript stays mounted but hidden.
const isExpanded = (n: number) =>
  !(
    within(daySection(n)).getByText(`Said on day-${n}.`).closest("[hidden]") !==
    null
  );

const audioSrc = (container: HTMLElement) =>
  container.querySelector("audio")?.getAttribute("src");

describe("the day selector", () => {
  it("is not shown for a hearing of one day", () => {
    render(<HearingDetailView initialHearing={oneDayHearing(job("day-1"))} />);

    expect(screen.queryByRole("combobox", { name: "Show" })).toBeNull();
  });

  it("lists All, None and every day, and starts on All with every day expanded", () => {
    render(<HearingDetailView initialHearing={THREE_DAYS()} />);

    expect(
      Array.from(selector().options).map((option) => option.textContent)
    ).toEqual([
      "All",
      "None",
      "Day 1, 10 November 2026 (day-1.mp3)",
      "Day 2, 11 November 2026 (day-2.mp3)",
      "Day 3, 12 November 2026 (day-3.mp3)",
    ]);
    expect(selector().selectedOptions[0].textContent).toBe("All");
    expect([1, 2, 3].map(isExpanded)).toEqual([true, true, true]);
  });

  it("sits directly below the Transcript heading", () => {
    render(<HearingDetailView initialHearing={THREE_DAYS()} />);

    const heading = screen.getByRole("heading", { name: "Transcript" });
    const following = heading.compareDocumentPosition(selector());
    expect(following & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      selector().compareDocumentPosition(daySection(1)) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("expands only the chosen day, keeps every day's heading, and plays that day", () => {
    const { container } = render(
      <HearingDetailView initialHearing={THREE_DAYS()} />
    );

    fireEvent.change(selector(), { target: { value: "day-2" } });

    expect([1, 2, 3].map(isExpanded)).toEqual([false, true, false]);
    expect(
      within(daySection(1)).getByRole("heading", { name: "Day 1" })
    ).toBeDefined();
    expect(audioSrc(container)).toBe("/api/audio/day-2");
    expect(screen.getByText("Day 2", { selector: "aside p" })).toBeDefined();
  });

  it("collapses every day for None and expands them all again for All", () => {
    render(<HearingDetailView initialHearing={THREE_DAYS()} />);

    fireEvent.change(selector(), { target: { value: "none" } });
    expect([1, 2, 3].map(isExpanded)).toEqual([false, false, false]);

    fireEvent.change(selector(), { target: { value: "all" } });
    expect([1, 2, 3].map(isExpanded)).toEqual([true, true, true]);
  });

  it("expands a day without a transcript but keeps playing the day that has one", () => {
    const { container } = render(
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

    fireEvent.change(selector(), { target: { value: "day-2" } });

    expect(
      within(daySection(2)).getByText("Speech failed").closest("[hidden]")
    ).toBeNull();
    expect(isExpanded(1)).toBe(false);
    expect(audioSrc(container)).toBe("/api/audio/day-1");
  });

  it("plays the day of a segment clicked while every day is shown", () => {
    const { container } = render(
      <HearingDetailView initialHearing={THREE_DAYS()} />
    );

    fireEvent.click(
      within(daySection(3)).getByRole("button", { name: "0:03" })
    );

    expect(audioSrc(container)).toBe("/api/audio/day-3");
    expect(selector().value).toBe("all");
  });

  it("moves to the day put in the player from its heading while one day is shown", () => {
    const { container } = render(
      <HearingDetailView initialHearing={THREE_DAYS()} />
    );
    fireEvent.change(selector(), { target: { value: "day-1" } });

    fireEvent.click(
      within(daySection(3)).getByRole("button", { name: "Listen to this day" })
    );

    expect(selector().value).toBe("day-3");
    expect([1, 2, 3].map(isExpanded)).toEqual([false, false, true]);
    expect(audioSrc(container)).toBe("/api/audio/day-3");
  });

  it("expands the day of a needs-review item jumped to while it is collapsed", () => {
    render(
      <HearingDetailView
        initialHearing={hearingOf([
          job("day-1", {
            lowConfidenceSegments: [
              {
                speaker: "Judge",
                speakerColor: "#000000",
                confidence: 50,
                startTime: 3,
                jobId: "day-1",
              },
            ],
          }),
          job("day-2"),
        ])}
      />
    );
    fireEvent.change(selector(), { target: { value: "none" } });

    fireEvent.click(
      within(screen.getByRole("complementary")).getByRole("button", {
        name: "0:03",
      })
    );

    expect(selector().value).toBe("day-1");
    expect(isExpanded(1)).toBe(true);
    expect(isExpanded(2)).toBe(false);
    expect(scrolledTo).toEqual(["day-1-s1"]);
  });

  it("goes back to All once the day shown is deleted", async () => {
    render(<HearingDetailView initialHearing={THREE_DAYS()} />);
    fireEvent.change(selector(), { target: { value: "day-2" } });

    fireEvent.click(
      within(daySection(2)).getByRole("button", { name: "Delete day 2" })
    );
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Day 3" })).toBeNull()
    );
    expect(selector().value).toBe("all");
    expect(selector().selectedOptions[0].textContent).toBe("All");
    for (const text of ["Said on day-1.", "Said on day-3."]) {
      expect(screen.getByText(text).closest("[hidden]")).toBeNull();
    }
  });
});
