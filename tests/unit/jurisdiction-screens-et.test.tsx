import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// DIAAT-330: an ET judge sees no IAC wording and nothing the ET does not use.

vi.mock("@/providers/jurisdiction", async () =>
  (await import("../jurisdiction-helpers")).mockJurisdictionModule("ET")
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
vi.mock("@/lib/admin-access", () => ({
  getAdminAccessStatus: vi.fn().mockResolvedValue("unauthorised"),
}));
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

import RecordingLayout from "@/app/recording/layout";
import Header from "@/components/layout/header";
import { MeetingsDataTable } from "@/components/meetings-table/data-table";
import WelcomePage from "@/components/welcome-page";

const IAC_WORDS = /hearing|immigration|asylum|tribunal|appeal/i;

describe("as an ET judge", () => {
  it("the header has no hearing recordings link", () => {
    render(<Header />);
    expect(
      screen.getAllByRole("link", { name: /go to dictation/i }).length
    ).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: /recordings/i })).toBeNull();
    expect(document.body.textContent).not.toMatch(IAC_WORDS);
  });

  it("the home page has no IAC wording and no hearing recordings button", () => {
    render(<WelcomePage />);
    expect(
      screen.getByText(/so you can focus on the proceedings/)
    ).toBeTruthy();
    expect(screen.queryByRole("link", { name: /recordings/i })).toBeNull();
    expect(document.body.textContent).not.toMatch(IAC_WORDS);
  });

  it("the documents list uses neutral wording", () => {
    render(
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
    expect(screen.getByPlaceholderText("Search titles or dates")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(IAC_WORDS);
  });
});

describe("the hearing recordings area, as an ET judge", () => {
  it("is not shown, even from a typed address", () => {
    render(
      <RecordingLayout>
        <p>jobs table</p>
      </RecordingLayout>
    );
    expect(screen.queryByText("jobs table")).toBeNull();
    expect(
      screen.getByRole("heading", {
        name: "This is not available in your jurisdiction",
      })
    ).toBeTruthy();
  });
});
