import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));
vi.mock("@/providers/transcripts", () => ({
  useTranscripts: () => ({
    isLoading: false,
    transcriptsMetadata: [{ id: "t-1" }],
  }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/components/meetings-list", () => ({
  default: () => <div data-testid="meetings-list" />,
}));
vi.mock("@/components/audio/upload/backup-recovery", () => ({
  default: () => <div data-testid="backup-recovery" />,
}));
vi.mock("@/components/audio/upload/backup-uploader", () => ({
  default: () => null,
}));

import DecisionsPage from "@/app/decisions/page";

describe("the Decisions page (DIAAT-400)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    push.mockReset();
  });

  it("lists the decisions, with a button that starts a new one", () => {
    vi.stubEnv("NEXT_PUBLIC_DICTATION_ENABLED", "true");
    render(<DecisionsPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Decisions" })).toBeTruthy();
    expect(screen.getByTestId("meetings-list")).toBeTruthy();
    expect(screen.getByTestId("backup-recovery")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Record a decision" }));
    expect(push).toHaveBeenCalledWith("/record?mode=mic");
  });

  it("offers neither the list nor a new decision with dictation off: the API refuses both", () => {
    vi.stubEnv("NEXT_PUBLIC_DICTATION_ENABLED", "false");
    render(<DecisionsPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Decisions" })).toBeTruthy();
    expect(screen.queryByTestId("meetings-list")).toBeNull();
    expect(screen.queryByRole("button", { name: "Record a decision" })).toBeNull();
  });
});
