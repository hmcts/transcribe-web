import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let mockJurisdiction: "IAC" | "ET" = "IAC";

// DIAAT-373: as a judge, the role whose permissions these screens are for.
vi.mock("@/providers/access", async () =>
  (await import("../access-helpers")).mockAccessModule(
    (await import("../access-helpers")).ME.judge
  )
);

vi.mock("@/providers/jurisdiction", async () =>
  (await import("../jurisdiction-helpers")).mockJurisdictionModule(
    () => mockJurisdiction
  )
);

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/providers/transcripts", () => ({
  useTranscripts: () => ({ isLoading: false, transcriptsMetadata: [] }),
}));

vi.mock("@/providers/user-settings", () => ({
  useUserSettings: () => ({ user: { email: "test@example.com" } }),
}));

vi.mock("@/hooks/use-media-query", () => ({
  default: () => false,
}));

vi.mock("@/lib/analytics", () => ({
  track: vi.fn(),
}));

vi.mock("@/components/meetings-list", () => ({
  default: () => null,
}));

vi.mock("@/components/audio/upload/backup-recovery", () => ({
  default: () => null,
}));

vi.mock("@/components/audio/upload/backup-uploader", () => ({
  default: () => null,
}));

import WelcomePage from "@/components/welcome-page";

describe("WelcomePage Dictation button (DIAAT-366)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    mockJurisdiction = "IAC";
  });

  it("offers Dictation when the flag is on", () => {
    vi.stubEnv("NEXT_PUBLIC_DICTATION_ENABLED", "true");
    render(<WelcomePage />);
    expect(screen.getByRole("button", { name: "Dictation" })).toBeTruthy();
  });

  it("hides Dictation but keeps hearing recordings when the flag is off", () => {
    vi.stubEnv("NEXT_PUBLIC_DICTATION_ENABLED", "false");
    render(<WelcomePage />);
    expect(screen.queryByRole("button", { name: "Dictation" })).toBeNull();
    expect(
      screen
        .getByRole("link", { name: "Hearing recordings" })
        .getAttribute("href")
    ).toBe("/recording");
  });

  it("leaves no empty button row when there is nothing to start", () => {
    vi.stubEnv("NEXT_PUBLIC_DICTATION_ENABLED", "false");
    mockJurisdiction = "ET";
    const { container } = render(<WelcomePage />);
    expect(container.querySelector(".mt-12")).toBeNull();
  });
});
