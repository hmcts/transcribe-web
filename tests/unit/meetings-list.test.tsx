import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/providers/transcripts", () => ({
  useTranscripts: vi.fn(),
}));
vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/lib/download", () => ({ downloadTranscriptDocument: vi.fn() }));
vi.mock("@/lib/database", () => ({
  addTagToTranscription: vi.fn(),
  getTranscriptionJobs: vi.fn().mockResolvedValue([]),
  removeTagFromTranscription: vi.fn(),
}));
vi.mock("@/lib/api-client", () => ({
  apiClient: { request: vi.fn().mockResolvedValue({ error: "not found" }) },
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import MeetingsList from "@/components/meetings-list";
import { useTranscripts } from "@/providers/transcripts";

const mockTranscripts = {
  deleteTranscription: vi.fn(),
  renameTranscription: vi.fn(),
  refreshMetadata: vi.fn(),
};

beforeEach(() => {
  vi.mocked(useTranscripts).mockReturnValue(mockTranscripts as any);
});

const MEETINGS = [
  {
    id: "m1",
    title: "Planning Meeting",
    created_datetime: new Date("2025-01-15T10:00:00Z").toISOString(),
    is_showable_in_ui: true,
    has_error: false,
    tags: [],
    document_url: null,
  },
  {
    id: "m2",
    title: "Review Session",
    created_datetime: new Date("2025-01-14T09:00:00Z").toISOString(),
    is_showable_in_ui: true,
    has_error: false,
    tags: ["urgent"],
    document_url: null,
  },
];

describe("MeetingsList", () => {
  it("shows loading state", () => {
    render(<MeetingsList isLoading={true} meetings={[]} />);
    expect(screen.getByText(/Loading your meetings/)).toBeTruthy();
  });

  it("shows empty state when no meetings", () => {
    render(<MeetingsList isLoading={false} meetings={[]} />);
    expect(screen.getByText(/don't have any recordings/)).toBeTruthy();
  });

  it("renders meeting titles", () => {
    render(<MeetingsList isLoading={false} meetings={MEETINGS} />);
    expect(screen.getByText("Planning Meeting")).toBeTruthy();
    expect(screen.getByText("Review Session")).toBeTruthy();
  });

  it("filters out meetings not showable in UI", () => {
    const hidden = {
      ...MEETINGS[0],
      id: "hidden",
      title: "Hidden",
      is_showable_in_ui: false,
    };
    render(<MeetingsList isLoading={false} meetings={[...MEETINGS, hidden]} />);
    expect(screen.queryByText("Hidden")).toBeNull();
  });

  it("renders tags on meetings that have them", () => {
    render(<MeetingsList isLoading={false} meetings={MEETINGS} />);
    expect(screen.getByText("urgent")).toBeTruthy();
  });
});
