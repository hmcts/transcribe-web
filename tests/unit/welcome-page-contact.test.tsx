import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
  useUserSettings: () => ({
    user: { email: "test@example.com", name: "Test User" },
  }),
}));

vi.mock("@/hooks/use-media-query", () => ({
  default: () => false,
}));

vi.mock("@/lib/analytics", () => ({
  track: vi.fn(),
}));

vi.mock("@/components/meetings-list", () => ({
  default: () => <div>Meetings</div>,
}));

vi.mock("@/components/ui/start-new-recording-button", () => ({
  default: () => <button type="button">Start</button>,
}));

vi.mock("@/components/audio/upload/backup-recovery", () => ({
  default: () => null,
}));

vi.mock("@/components/audio/upload/backup-uploader", () => ({
  default: () => null,
}));

import WelcomePage from "@/components/welcome-page";

describe("WelcomePage contact link", () => {
  it("links to the support email address", () => {
    render(<WelcomePage />);
    const link = screen.getByRole("link", {
      name: /contact us/i,
    }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(
      "mailto:JudicialTranscribe@justice.gov.uk"
    );
    expect(link.getAttribute("aria-label")).toBe("Contact us via email");
  });
});
