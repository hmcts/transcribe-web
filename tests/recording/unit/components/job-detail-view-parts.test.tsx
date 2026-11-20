import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JobDetailView } from "@/components/recording/transcript/job-detail-view";
import { colorForSpeaker } from "@/lib/recording/api-client";
import type {
  TranscriptionJob,
  TranscriptSegment,
} from "@/lib/recording/types";

// DIAAT-408: a recording of over 240 minutes is transcribed in parts, and the
// API labels each part's speakers with their part ("Part 2 · Speaker 1"):
// diarization is per file, so a speaker of one part is not known to be a
// speaker of another. The existing speaker editor (rename one section, or
// every section by that speaker) is what maps them onto roles: renaming
// several to the same name makes them one speaker.

const segment = (
  id: string,
  speaker: string,
  startTime: number
): TranscriptSegment => ({
  id,
  speaker,
  speakerColor: colorForSpeaker(speaker),
  text: `Said by ${speaker}.`,
  startTime,
  duration: 5,
  confidence: 0.95,
});

const job = (speakers: string[]): TranscriptionJob => ({
  id: "job-parts",
  caseReference: "PA/00001/2025",
  tribunal: "First-tier Tribunal",
  audioFileName: "long-hearing.mp3",
  uploadedAt: new Date().toISOString(),
  status: "COMPLETED",
  segments: speakers.map((speaker, i) => segment(`s${i + 1}`, speaker, i * 10)),
});

const PARTS = [
  "Part 1 · Speaker 0",
  "Part 1 · Speaker 1",
  "Part 2 · Speaker 0",
  "Part 2 · Speaker 1",
];

function reply(next: TranscriptionJob) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ job: next }),
  });
}

describe("a transcript in parts in the speaker editor", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows each part's speakers apart, with the part in the name and in the rename control", () => {
    render(<JobDetailView jobId="job-parts" initialJob={job(PARTS)} />);
    for (const speaker of PARTS) {
      expect(screen.getByText(speaker)).toBeDefined();
      expect(
        screen.getByRole("button", { name: `Rename speaker ${speaker}` })
      ).toBeDefined();
    }
    // A colour per speaker: the same name in two parts is two speakers until the clerk says otherwise.
    expect(colorForSpeaker("Part 1 · Speaker 0")).not.toBe(
      colorForSpeaker("Part 2 · Speaker 0")
    );
  });

  it("renames a speaker of one part for every section of that speaker in that part", async () => {
    const fetchMock = reply(
      job([
        "Part 1 · Speaker 0",
        "Part 1 · Speaker 1",
        "Judge",
        "Part 2 · Speaker 1",
      ])
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<JobDetailView jobId="job-parts" initialJob={job(PARTS)} />);

    await userEvent.click(
      screen.getByRole("button", { name: "Rename speaker Part 2 · Speaker 0" })
    );
    const input = screen.getByLabelText("New name for Part 2 · Speaker 0");
    await userEvent.clear(input);
    await userEvent.type(input, "Judge");
    await userEvent.click(screen.getByRole("button", { name: "Replace all" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/jobs/job-parts/segments/s3/speaker");
    expect(JSON.parse(init.body)).toEqual({
      speaker: "Judge",
      applyToAll: true,
    });
    expect(await screen.findByText("Judge")).toBeDefined();
    // The other parts' speakers are untouched.
    expect(screen.getByText("Part 1 · Speaker 0")).toBeDefined();
  });

  it("merges the same person across parts by giving them the same name", async () => {
    // First rename: part 1's Speaker 0 becomes the judge.
    const afterFirst = job([
      "Judge",
      "Part 1 · Speaker 1",
      "Part 2 · Speaker 0",
      "Part 2 · Speaker 1",
    ]);
    const afterSecond = job([
      "Judge",
      "Part 1 · Speaker 1",
      "Judge",
      "Part 2 · Speaker 1",
    ]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ job: afterFirst }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ job: afterSecond }),
      });
    vi.stubGlobal("fetch", fetchMock);
    render(<JobDetailView jobId="job-parts" initialJob={job(PARTS)} />);

    for (const from of ["Part 1 · Speaker 0", "Part 2 · Speaker 0"]) {
      await userEvent.click(
        screen.getByRole("button", { name: `Rename speaker ${from}` })
      );
      const input = screen.getByLabelText(`New name for ${from}`);
      await userEvent.clear(input);
      await userEvent.type(input, "Judge");
      await userEvent.click(
        screen.getByRole("button", { name: "Replace all" })
      );
      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledTimes(
          from.startsWith("Part 1") ? 1 : 2
        )
      );
    }

    // Two sections now carry the same name, and so the same colour: one speaker.
    expect(await screen.findAllByText("Judge")).toHaveLength(2);
    expect(colorForSpeaker("Judge")).toBe(colorForSpeaker("Judge"));
    expect(
      screen.getAllByRole("button", { name: "Rename speaker Judge" })
    ).toHaveLength(2);
  });
});

describe("a recording that is still being prepared", () => {
  afterEach(() => vi.unstubAllGlobals());

  // DIAAT-408: with background preparation a job is PENDING until the worker
  // has converted (and, over 240 minutes, split) the recording and sent it to
  // be transcribed. The page says so, shows no player, and asks for no audio.
  const pending = (): TranscriptionJob => ({
    ...job([]),
    id: "job-pending",
    status: "PENDING",
    segments: undefined,
    audioDurationSeconds: 28_800,
  });

  it("says the recording is being prepared, with no audio player and no audio request", () => {
    const fetchMock = vi.fn().mockReturnValue(new Promise(() => undefined));
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(
      <JobDetailView jobId="job-pending" initialJob={pending()} />
    );

    expect(screen.getByText(/being prepared for transcription/i)).toBeDefined();
    expect(screen.getByText("Pending")).toBeDefined();
    expect(container.querySelector("audio")).toBeNull();
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes("/audio"))
    ).toHaveLength(0);
  });

  it("keeps the in-progress wording for a job that has been sent to be transcribed", () => {
    render(
      <JobDetailView
        jobId="job-pending"
        initialJob={{ ...pending(), status: "PROCESSING" }}
      />
    );
    expect(
      screen.getByText(/transcription is still in progress/i)
    ).toBeDefined();
  });
});
