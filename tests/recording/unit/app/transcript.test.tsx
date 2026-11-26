import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TranscriptPage from "@/app/recording/jobs/[jobId]/page";
import { setTabContext } from "@/lib/jurisdiction-session";

// The page loads its job in the browser, in the tab's jurisdiction (DIAAT-334).

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

const COMPLETED_JOB = {
  id: "job-pa05217-2025",
  caseReference: "PA/05217/2025",
  tribunal: "First-tier Tribunal — Immigration and Asylum Chamber",
  audioFileName: "hearing.wav",
  status: "COMPLETED" as const,
  progressPercent: 100,
  uploadedAt: "2026-01-15T10:00:00Z",
  segments: [
    {
      id: "seg-0",
      speaker: "Judge",
      speakerColor: "#4A90D9",
      text: "This hearing is now in session.",
      startTime: 0,
      duration: 3.5,
    },
  ],
};

let fetchMock: ReturnType<typeof vi.fn>;

function serve(status: number, job?: unknown) {
  fetchMock.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ job }),
  });
}

async function renderPage(jobId = COMPLETED_JOB.id) {
  render(await TranscriptPage({ params: Promise.resolve({ jobId }) }));
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  serve(200, COMPLETED_JOB);
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

describe("TranscriptPage", () => {
  it("renders case reference for known job", async () => {
    await renderPage();
    expect(await screen.findByText("PA/05217/2025")).toBeDefined();
  });

  it("renders tribunal name", async () => {
    await renderPage();
    expect(
      await screen.findByText("First-tier Tribunal — Immigration and Asylum Chamber")
    ).toBeDefined();
  });

  it("renders transcript segments", async () => {
    await renderPage();
    expect((await screen.findAllByText("Judge")).length).toBeGreaterThan(0);
  });

  it("asks for the job in the tab's jurisdiction", async () => {
    setTabContext({ jurisdiction: "IAC", role: "Judge" });
    await renderPage();
    await screen.findByText("PA/05217/2025");
    expect(fetchMock.mock.calls[0][1].headers["X-Jurisdiction"]).toBe("IAC");
  });

  it("shows not found for an unknown job, or one of another jurisdiction", async () => {
    serve(404);
    await renderPage("unknown");
    expect(await screen.findByRole("heading", { name: "Transcript not found" })).toBeDefined();
    expect(screen.queryByText("PA/05217/2025")).toBeNull();
  });

  it("offers to try again when the job cannot be loaded", async () => {
    serve(502);
    await renderPage();
    expect(await screen.findByRole("button", { name: "Try again" })).toBeDefined();
  });

  it("shows a fallback message when a completed job has no transcript segments", async () => {
    serve(200, { ...COMPLETED_JOB, segments: undefined });
    await renderPage();
    expect(await screen.findByText(/no content to display/i)).toBeDefined();
  });

  it("shows an in-progress message and does not 404 for a processing job", async () => {
    serve(200, {
      ...COMPLETED_JOB,
      status: "PROCESSING",
      // Recently submitted with a known audio duration -> the time-based
      // progress bar renders (an early, non-overrun percentage).
      uploadedAt: new Date().toISOString(),
      audioDurationSeconds: 9360,
      segments: undefined,
    });
    await renderPage();
    expect(await screen.findByText(/still in progress/i)).toBeDefined();
    expect(screen.getByRole("progressbar")).toBeDefined();
  });

  it("shows the error message and does not 404 for a failed job", async () => {
    serve(200, {
      ...COMPLETED_JOB,
      status: "FAILED",
      segments: undefined,
      errorMessage: "Azure batch transcription submission failed",
    });
    await renderPage();
    expect(await screen.findByText(/transcription failed/i)).toBeDefined();
    expect(
      screen.getByText("Azure batch transcription submission failed")
    ).toBeDefined();
  });
});
