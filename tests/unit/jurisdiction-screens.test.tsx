import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The shared screens in each jurisdiction. DIAAT-331: an IAC judge sees what they
// saw before jurisdictions (transcribe-web 00ff378). DIAAT-330: an ET judge sees no
// IAC wording and nothing the ET does not use.

let mockCode: "IAC" | "ET" = "IAC";
vi.mock("@/providers/jurisdiction", async () =>
  (await import("../jurisdiction-helpers")).mockJurisdictionModule(
    () => mockCode
  )
);
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("motion/react", () => ({
  motion: {
    header: ({ children, ...props }: { children: React.ReactNode }) => (
      <header {...props}>{children}</header>
    ),
  },
}));
vi.mock("@/providers/transcripts", () => ({
  useTranscripts: () => ({
    isLoading: false,
    transcriptsMetadata: [],
    isRecording: false,
    selectedRecordingMode: null,
  }),
}));
vi.mock("@/providers/user-settings", () => ({
  useUserSettings: () => ({ user: { email: "a@example.test" } }),
}));
vi.mock("@/components/theme-toggle", () => ({ ThemeToggle: () => null }));
// DIAAT-373: as a judge, the role whose permissions these screens are for.
vi.mock("@/providers/access", async () =>
  (await import("../access-helpers")).mockAccessModule(
    (await import("../access-helpers")).ME.judge
  )
);
vi.mock("@/hooks/use-media-query", () => ({ default: () => false }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/components/ui/start-new-recording-button", () => ({
  default: () => <button type="button">Start</button>,
}));
vi.mock("@/components/audio/upload/backup-recovery", () => ({
  default: () => null,
}));
vi.mock("@/components/audio/upload/backup-uploader", () => ({
  default: () => null,
}));

import HelpPage from "@/app/help/page";
import RecordingLayout from "@/app/recording/layout";
import { DecisionTemplateOnly } from "@/components/jurisdiction/jurisdiction-content";
import Header from "@/components/layout/header";
import { MeetingsDataTable } from "@/components/meetings-table/data-table";
import WelcomePage from "@/components/welcome-page";

function renderDocumentsList() {
  return render(
    <MeetingsDataTable
      data={[]}
      onOpenMeeting={vi.fn()}
      onRenameMeeting={vi.fn()}
      onDeleteMeeting={vi.fn()}
      onDownloadDocument={vi.fn()}
      onToggleDone={vi.fn()}
      onBulkDelete={vi.fn()}
      onBulkMarkDone={vi.fn()}
      isBulkDeleting={false}
      isBulkMarkingDone={false}
    />
  );
}

function renderTemplateContent() {
  return render(
    <DecisionTemplateOnly otherwise={<p>general section only</p>}>
      <p>hearing form help</p>
    </DecisionTemplateOnly>
  );
}

function renderRecordingsArea() {
  return render(
    <RecordingLayout>
      <p>jobs table</p>
    </RecordingLayout>
  );
}

afterEach(() => {
  mockCode = "IAC";
});

describe("as an IAC judge, nothing changes (DIAAT-331)", () => {
  it("the home page says what it said", () => {
    render(<WelcomePage />);
    expect(
      screen.getByText(
        "Supporting judicial work through live transcription and enablement of judges to focus on proceedings and engage with the parties."
      )
    ).toBeTruthy();
  });

  it("the documents list keeps its wording", () => {
    renderDocumentsList();
    expect(screen.getByPlaceholderText("Search hearings or dates")).toBeTruthy();
    expect(
      screen.getByText("Search recent recordings by hearing title or date.")
    ).toBeTruthy();
    expect(
      screen.getByLabelText("Filter recent recordings by hearing type")
    ).toBeTruthy();
    expect(
      screen.getByText("No hearings matched your current search or filters.")
    ).toBeTruthy();
    expect(screen.getAllByText("All hearing types").length).toBeGreaterThan(0);
    const headings = screen
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent?.trim());
    expect(headings).toEqual(expect.arrayContaining(["Hearing", "Hearing type"]));
  });

  it("the help page has its subtitle and the hearing form's help", () => {
    render(<HelpPage />);
    expect(
      screen.getByText(
        "Getting started with Bench Notes for the First-tier Tribunal Immigration and Asylum Chamber"
      )
    ).toBeTruthy();
    expect(screen.getByText("Hearing Details Form")).toBeTruthy();
  });

  it("the hearing form's help and the hearing recordings area are still there", () => {
    renderTemplateContent();
    expect(screen.getByText("hearing form help")).toBeTruthy();
    expect(screen.queryByText("general section only")).toBeNull();
    renderRecordingsArea();
    expect(screen.getByText("jobs table")).toBeTruthy();
  });
});

describe("as an ET judge (DIAAT-330)", () => {
  const IAC_WORDS = /hearing|immigration|asylum|tribunal|appeal/i;

  it("the header has no hearing recordings link", () => {
    mockCode = "ET";
    render(<Header />);
    expect(
      screen.getAllByRole("link", { name: /go to decisions/i }).length
    ).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: /recordings/i })).toBeNull();
    // The switcher names the jurisdiction the judge works in ("Employment
    // Tribunal"), so the check is for IAC wording other than that.
    expect(document.body.textContent).not.toMatch(
      /hearing|immigration|asylum|appeal/i
    );
  });

  it("the home page has no IAC wording and no hearing recordings button", () => {
    mockCode = "ET";
    render(<WelcomePage />);
    expect(screen.getByText(/so you can focus on the proceedings/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: /recordings/i })).toBeNull();
    expect(document.body.textContent).not.toMatch(IAC_WORDS);
  });

  it("the documents list uses neutral wording", () => {
    mockCode = "ET";
    renderDocumentsList();
    expect(screen.getByPlaceholderText("Search titles or dates")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(IAC_WORDS);
  });

  it("the help page has no IAC wording", () => {
    mockCode = "ET";
    render(<HelpPage />);
    // The page heading, and the subtitle in the neutral wording.
    expect(screen.getAllByText("Getting started with BenchNotes")).toHaveLength(2);
    expect(screen.queryByText("Hearing Details Form")).toBeNull();
    expect(document.body.textContent).not.toMatch(
      /immigration|asylum|appellant|tribunal/i
    );
  });

  it("gets the general content, not the IAC hearing form's", () => {
    mockCode = "ET";
    renderTemplateContent();
    expect(screen.getByText("general section only")).toBeTruthy();
    expect(screen.queryByText("hearing form help")).toBeNull();
  });

  it("cannot open the hearing recordings area, even from a typed address", () => {
    mockCode = "ET";
    renderRecordingsArea();
    expect(screen.queryByText("jobs table")).toBeNull();
    expect(
      screen.getByRole("heading", {
        name: "This is not available in your jurisdiction",
      })
    ).toBeTruthy();
  });
});
