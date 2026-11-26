import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HearingDetailView } from "@/components/recording/transcript/hearing-detail-view";
import { oneDayHearing } from "../hearing-fixtures";
import { RecordingHistory } from "@/components/recording/transcript/recording-history";
import type { MeResponse } from "@/lib/access/types";
import type { TranscriptionJob } from "@/lib/recording/types";
import { ME } from "../../../access-helpers";

// DIAAT-395: a "History" view on a recording for the context that holds
// recording.audit.read, beside (and not replacing) the per-segment history.

let persona: MeResponse = ME.judge;
vi.mock("@/providers/access", async () =>
  (await import("../../../access-helpers")).mockAccessModule(() => persona)
);

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const entry = (id: string, action: string, over: Record<string, unknown> = {}) => ({
  id,
  timestamp: "2026-11-05T10:30:00Z",
  action,
  actor_label: "A. Judge",
  actor_role: "Judge",
  outcome: "success",
  ...over,
});

const job: TranscriptionJob = {
  id: "job-1",
  caseReference: "PA/00001/2025",
  tribunal: "First-tier Tribunal",
  audioFileName: "hearing.mp3",
  uploadedAt: new Date().toISOString(),
  status: "COMPLETED",
  segments: [
    { id: "s1", speaker: "Judge", speakerColor: "#000", text: "SECRET TRANSCRIPT WORDS", startTime: 0, duration: 5 },
  ],
};

beforeEach(() => {
  persona = ME.judge;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("History is for recording.audit.read", () => {
  it.each([
    ["a legal text manager", ME.legalTextManager],
    ["a jurisdiction administrator", ME.jurisdictionAdministrator],
    ["a super administrator", ME.jurisdictionSuperAdministrator],
    ["a system administrator", ME.sysadminOnly],
  ])("is not shown to %s, and is never asked for", async (_, me) => {
    persona = me;
    render(<RecordingHistory hearingId="job-1" />);

    expect(screen.queryByRole("button", { name: /History/ })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is shown to a Judge, closed, and asks for nothing until it is opened", async () => {
    render(<RecordingHistory hearingId="job-1" />);

    const toggle = screen.getByRole("button", { name: /History/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the History view", () => {
  it("lists who did what, in which role and when, with the outcome, and no transcript text", async () => {
    fetchMock.mockResolvedValue(
      json({
        items: [
          entry("h-1", "transcript.edit"),
          entry("h-2", "audio.export", { actor_label: "Someone Else", actor_role: null }),
          entry("h-3", "transcript.view", { outcome: "denied" }),
          entry("h-4", "some.new.action"),
        ],
        total: 4,
      })
    );
    const user = userEvent.setup();
    render(<RecordingHistory hearingId="job-1" />);
    await user.click(screen.getByRole("button", { name: /History/ }));

    const table = await screen.findByRole("table");
    expect(within(table).getByText("Transcript edited")).toBeTruthy();
    expect(within(table).getByText("Audio exported")).toBeTruthy();
    expect(within(table).getByText("Transcript viewed")).toBeTruthy();
    expect(within(table).getByText("Denied")).toBeTruthy();
    expect(within(table).getByText("Someone Else")).toBeTruthy();
    expect(within(table).getAllByText("as judge").length).toBeGreaterThan(0);
    // An action this release does not know is shown as the API sent it.
    expect(within(table).getByText("some.new.action")).toBeTruthy();

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/hearings/job-1/history?page=1&page_size=20");
  });

  it("says so when nothing has been recorded", async () => {
    fetchMock.mockResolvedValue(json({ items: [], total: 0 }));
    const user = userEvent.setup();
    render(<RecordingHistory hearingId="job-1" />);
    await user.click(screen.getByRole("button", { name: /History/ }));

    expect(await screen.findByText(/Nothing has been recorded/)).toBeTruthy();
  });

  it("says the history is not available on a 404 (a recording that is not the caller's), and that it failed otherwise", async () => {
    fetchMock.mockResolvedValue(json({ error: "Job not found" }, 404));
    const user = userEvent.setup();
    const { unmount } = render(<RecordingHistory hearingId="job-1" />);
    await user.click(screen.getByRole("button", { name: /History/ }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/not available for this recording/);
    unmount();

    fetchMock.mockResolvedValue(json({ error: "x" }, 502));
    render(<RecordingHistory hearingId="job-1" />);
    await user.click(screen.getByRole("button", { name: /History/ }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/could not be loaded/);
  });

  it("pages through a long history", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const page = Number(new URL(url, "http://x").searchParams.get("page"));
      return json({ items: [entry(`h-${page}`, page === 1 ? "job.submit" : "job.delete")], total: 25 });
    });
    const user = userEvent.setup();
    render(<RecordingHistory hearingId="job-1" />);
    await user.click(screen.getByRole("button", { name: /History/ }));

    expect(await screen.findByText("Recording submitted")).toBeTruthy();
    expect(screen.getByText("Page 1 of 2")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByText("Recording deleted")).toBeTruthy();
    expect(screen.getByText("Page 2 of 2")).toBeTruthy();
  });
});

describe("on the recording page", () => {
  it("sits beside the per-segment modification history without disturbing it", async () => {
    fetchMock.mockResolvedValue(json({ items: [entry("h-1", "transcript.view")], total: 1 }));
    const user = userEvent.setup();
    render(<HearingDetailView initialHearing={oneDayHearing(job)} />);

    // Both are there, and each opens on its own.
    const modification = screen.getByRole("button", { name: /Modification history/ });
    const history = screen.getByRole("button", { name: /^History$/ });
    await user.click(modification);
    expect(screen.getByText(/No modifications have been made/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(history);
    expect(await screen.findByText("Transcript viewed")).toBeTruthy();
    expect(modification.getAttribute("aria-expanded")).toBe("true");
  });

  it("shows the modification history and no History to a role without recording.audit.read", async () => {
    persona = ME.legalTextManager;
    render(<HearingDetailView initialHearing={oneDayHearing(job)} />);

    expect(screen.getByRole("button", { name: /Modification history/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^History$/ })).toBeNull();
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
  });
});

// DIAAT-428: a hearing's history covers every day of it.
describe("the History of a hearing of several days", () => {
  it("says which day each row is about, and names the hearing's own actions", async () => {
    fetchMock.mockResolvedValue(
      json({
        items: [
          entry("h-1", "hearing.add_recording", { job_id: "job-2" }),
          entry("h-2", "hearing.edit", { job_id: "job-2" }),
          entry("h-3", "transcript.view", { job_id: null }),
          entry("h-4", "job.delete", { job_id: "job-gone" }),
        ],
        total: 4,
      })
    );
    const user = userEvent.setup();
    render(
      <RecordingHistory hearingId="job-1" dayLabels={{ "job-1": "Day 1", "job-2": "Day 2" }} />
    );
    await user.click(screen.getByRole("button", { name: /History/ }));

    const table = await screen.findByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Day" })).toBeTruthy();
    const rows = within(table).getAllByRole("row").slice(1);
    expect(within(rows[0]).getByText("Recording added")).toBeTruthy();
    expect(within(rows[0]).getByText("Day 2")).toBeTruthy();
    expect(within(rows[1]).getByText("Hearing date changed")).toBeTruthy();
    expect(within(rows[2]).queryByText(/^Day /)).toBeNull();
    expect(within(rows[3]).queryByText(/^Day /)).toBeNull();
  });

  it("has no Day column for a one-day hearing", async () => {
    fetchMock.mockResolvedValue(json({ items: [entry("h-1", "transcript.view")], total: 1 }));
    const user = userEvent.setup();
    render(<RecordingHistory hearingId="job-1" />);
    await user.click(screen.getByRole("button", { name: /History/ }));

    const table = await screen.findByRole("table");
    expect(within(table).queryByRole("columnheader", { name: "Day" })).toBeNull();
  });
});
