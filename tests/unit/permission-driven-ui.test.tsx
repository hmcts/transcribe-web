import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MeResponse } from "@/lib/access/types";
import { ME } from "../access-helpers";

// DIAAT-384: what the home page and the help page show follows the permissions
// the API returned for the active context, for each persona.

let mockPersona: MeResponse = ME.judge;
vi.mock("@/providers/access", async () =>
  (await import("../access-helpers")).mockAccessModule(() => mockPersona)
);
vi.mock("@/providers/jurisdiction", async () =>
  (await import("../jurisdiction-helpers")).mockJurisdictionModule("IAC")
);
const replace = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/providers/transcripts", () => ({
  useTranscripts: () => ({
    isLoading: false,
    transcriptsMetadata: [{ id: "t-1" }],
  }),
}));
vi.mock("@/providers/user-settings", () => ({
  useUserSettings: () => ({ user: { email: "test@example.com" } }),
}));
vi.mock("@/hooks/use-media-query", () => ({ default: () => false }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/components/meetings-list", () => ({
  default: () => <p>Your recent dictations</p>,
}));
vi.mock("@/components/audio/upload/backup-recovery", () => ({
  default: () => <p>Recordings to recover</p>,
}));
vi.mock("@/components/audio/upload/backup-uploader", () => ({ default: () => null }));
vi.mock("@/hooks/use-browser-navigation", () => ({
  default: () => ({ currentParams: new URLSearchParams() }),
}));
vi.mock("@/lib/api-client", () => ({
  apiClient: {
    request: vi.fn().mockResolvedValue({
      data: { should_show_onboarding: false },
      status: 200,
    }),
  },
}));

import HelpPage from "@/app/help/page";
import MainParentComponent from "@/components/main-component";
import WelcomePage from "@/components/welcome-page";
import { apiClient } from "@/lib/api-client";

afterEach(() => {
  mockPersona = ME.judge;
  replace.mockReset();
  vi.mocked(apiClient.request).mockClear();
});

const PERSONAS: [string, MeResponse][] = [
  ["a legal text manager", ME.legalTextManager],
  ["a jurisdiction administrator", ME.jurisdictionAdministrator],
  ["a jurisdiction super administrator", ME.jurisdictionSuperAdministrator],
];

describe("the home page", () => {
  it("offers a judge dictation, hearing recordings and their own dictations", () => {
    render(<WelcomePage />);

    expect(screen.getByRole("button", { name: "Write a decision" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Transcribe a recording" })).toBeTruthy();
    expect(screen.getByText("Your recent dictations")).toBeTruthy();
    expect(screen.getByText("Recordings to recover")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Admin" })).toBeNull();
  });

  it.each(PERSONAS)("offers %s Admin, and no dictation or recording of any kind", (_n, persona) => {
    mockPersona = persona;
    render(<WelcomePage />);

    expect(screen.getByRole("link", { name: "Admin" }).getAttribute("href")).toBe("/admin");
    expect(screen.queryByRole("button", { name: "Write a decision" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Transcribe a recording" })).toBeNull();
    expect(screen.queryByText("Your recent dictations")).toBeNull();
    expect(screen.queryByText("Recordings to recover")).toBeNull();
    // What anyone can do: ask for support.
    expect(screen.getByRole("link", { name: "Contact us via email" })).toBeTruthy();
  });

  it("offers a judge dictation but not Admin, when the API grants no admin access", () => {
    mockPersona = { ...ME.judge, permissions: ME.judge.permissions.filter((p) => p !== "recording.own") };
    render(<WelcomePage />);

    expect(screen.getByRole("button", { name: "Write a decision" })).toBeTruthy();
    // Hearing recordings need `recording.own`, whatever the jurisdiction uses.
    expect(screen.queryByRole("link", { name: "Transcribe a recording" })).toBeNull();
  });
});

describe("the home page of a system administrator with no jurisdiction", () => {
  it("goes to Admin, without asking about onboarding, which is about using the app", async () => {
    mockPersona = ME.sysadminOnly;
    const { container } = render(<MainParentComponent />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/admin"));
    expect(container.textContent).toBe("");
    expect(apiClient.request).not.toHaveBeenCalled();
  });

  it("is not redirected when the context has app.access", async () => {
    render(<MainParentComponent />);

    await screen.findByRole("button", { name: "Write a decision" });
    expect(replace).not.toHaveBeenCalled();
    expect(apiClient.request).toHaveBeenCalledWith("/user/onboarding-status");
  });
});

describe("the help page", () => {
  it("guides a judge through dictation", () => {
    render(<HelpPage />);

    expect(screen.getByText("Quick Start Guide")).toBeTruthy();
    expect(screen.getByText("Features overview")).toBeTruthy();
    expect(screen.getByText("Troubleshooting")).toBeTruthy();
    expect(screen.getByText("Microphone not working")).toBeTruthy();
  });

  it.each(PERSONAS)("leaves dictation and recording guidance out for %s", (_n, persona) => {
    mockPersona = persona;
    render(<HelpPage />);

    for (const heading of ["Quick Start Guide", "Features overview", "Live Transcription", "Troubleshooting"]) {
      expect(screen.queryByText(heading), heading).toBeNull();
    }
    expect(screen.queryByText("Microphone not working")).toBeNull();
    // What anyone needs: privacy and how to reach support.
    expect(screen.getByText("Privacy")).toBeTruthy();
    expect(screen.getAllByText(/support/i).length).toBeGreaterThan(0);
  });
});
