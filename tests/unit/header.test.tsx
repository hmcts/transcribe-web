import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MeResponse } from "@/lib/access/types";
import { ME } from "../access-helpers";

const mockPush = vi.fn();
let mockPathname = "/";
let mockSelectedRecordingMode: string | null = null;
let mockIsRecording = false;
let mockPersona: MeResponse = ME.judge;

// DIAAT-322: these screens as the IAC sees them.
vi.mock("@/providers/jurisdiction", async () =>
  (await import("../jurisdiction-helpers")).mockJurisdictionModule("IAC")
);

// DIAAT-373: and for whoever the API says the user is working as.
vi.mock("@/providers/access", async () =>
  (await import("../access-helpers")).mockAccessModule(() => mockPersona)
);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/image", () => ({
  default: ({ alt, ...props }: { alt: string; [key: string]: unknown }) => (
    // biome-ignore lint/performance/noImgElement: test mock of next/image
    <img alt={alt} {...props} />
  ),
}));

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

vi.mock("@/providers/transcripts", () => ({
  useTranscripts: () => ({
    isRecording: mockIsRecording,
    selectedRecordingMode: mockSelectedRecordingMode,
  }),
}));

vi.mock("@/components/theme-toggle", () => ({
  ThemeToggle: () => <button type="button">Toggle theme</button>,
}));

vi.mock("motion/react", () => ({
  motion: {
    header: ({
      children,
      ...props
    }: {
      children: React.ReactNode;
      [key: string]: unknown;
    }) => <header {...props}>{children}</header>,
  },
}));

import Header from "@/components/layout/header";

describe("Header", () => {
  afterEach(() => {
    mockPathname = "/";
    mockSelectedRecordingMode = null;
    mockIsRecording = false;
    mockPersona = ME.judge;
    vi.unstubAllEnvs();
  });

  describe("with Dictation switched off (DIAAT-366)", () => {
    it("leaves Dictation out of the desktop nav and keeps the rest", () => {
      vi.stubEnv("NEXT_PUBLIC_DICTATION_ENABLED", "false");
      const nav = within(render(<Header />).getByRole("navigation"));
      expect(nav.queryByRole("link", { name: "Go to dictation" })).toBeNull();
      expect(
        nav.getByRole("link", { name: "Go to hearing recordings" })
      ).toBeTruthy();
      expect(nav.getByRole("link", { name: "Go to help" })).toBeTruthy();
    });

    it("leaves Dictation out of the mobile menu and keeps the rest", () => {
      vi.stubEnv("NEXT_PUBLIC_DICTATION_ENABLED", "false");
      render(<Header />);
      fireEvent.click(
        screen.getByRole("button", { name: "Open navigation menu" })
      );
      const menu = within(screen.getByRole("dialog"));
      expect(menu.queryByRole("link", { name: "Dictation" })).toBeNull();
      expect(
        menu.getByRole("link", { name: "Hearing recordings" })
      ).toBeTruthy();
      expect(menu.getByRole("link", { name: "Help" })).toBeTruthy();
    });
  });

  describe("shows links only from the permissions the API returned (DIAAT-384)", () => {
    const LINKS = {
      admin: "Go to admin",
      wording: "Wording",
      dictation: "Go to dictation",
      recordings: "Go to hearing recordings",
      help: "Go to help",
    };

    function shown(persona: MeResponse) {
      mockPersona = persona;
      const nav = within(render(<Header />).getByRole("navigation"));
      return Object.fromEntries(
        Object.entries(LINKS).map(([key, name]) => [
          key,
          nav.queryByRole("link", { name: key === "wording" ? /Wording/ : name }) !== null,
        ])
      );
    }

    it.each([
      [
        "a judge",
        ME.judge,
        { admin: false, wording: false, dictation: true, recordings: true, help: true },
      ],
      [
        "a legal text manager",
        ME.legalTextManager,
        { admin: true, wording: false, dictation: false, recordings: false, help: true },
      ],
      [
        "a jurisdiction administrator",
        ME.jurisdictionAdministrator,
        { admin: true, wording: true, dictation: false, recordings: false, help: true },
      ],
      [
        // Holds the permission, but works in no one jurisdiction (the API answers
        // 403 no_jurisdiction): it changes wording from Admin, Jurisdictions.
        "a jurisdiction super administrator",
        ME.jurisdictionSuperAdministrator,
        { admin: true, wording: false, dictation: false, recordings: false, help: true },
      ],
      [
        "a system administrator with no jurisdiction",
        ME.sysadminOnly,
        { admin: true, wording: false, dictation: false, recordings: false, help: true },
      ],
    ])("for %s", (_, persona, expected) => {
      expect(shown(persona)).toEqual(expected);
    });

    it("links the wording editor to its page", () => {
      mockPersona = ME.jurisdictionAdministrator;
      const { getByRole } = render(<Header />);
      expect(getByRole("link", { name: /Wording/ }).getAttribute("href")).toBe(
        "/jurisdiction-wording"
      );
    });

    it("leaves dictation and recordings out of the mobile menu for any other role", () => {
      mockPersona = ME.legalTextManager;
      render(<Header />);
      fireEvent.click(
        screen.getByRole("button", { name: "Open navigation menu" })
      );
      const menu = within(screen.getByRole("dialog"));
      expect(menu.queryByRole("link", { name: "Dictation" })).toBeNull();
      expect(menu.queryByRole("link", { name: "Hearing recordings" })).toBeNull();
      expect(menu.getByRole("link", { name: "Admin" }).getAttribute("href")).toBe(
        "/admin"
      );
    });

    it("has no Legal wording link: the Admin link is how a legal text manager gets there", () => {
      mockPersona = ME.legalTextManager;
      const { queryByRole } = render(<Header />);
      expect(queryByRole("link", { name: "Legal wording" })).toBeNull();
    });
  });

  describe("the context switcher (DIAAT-390)", () => {
    it("names where and as what the user works, and offers the other pair", () => {
      mockPersona = ME.multiAsAdministrator;
      render(<Header />);
      const trigger = screen.getAllByRole("button", {
        name: /Working in Immigration and Asylum Chamber as jurisdiction administrator/i,
      })[0];
      expect(trigger).toBeTruthy();
    });

    it("is not shown to a user with no role", () => {
      mockPersona = ME.sysadminOnly;
      render(<Header />);
      expect(screen.queryByRole("button", { name: /Switch or leave/ })).toBeNull();
    });

    it("has no persona picker outside local development", () => {
      render(<Header />);
      expect(screen.queryByTestId("dev-persona-picker")).toBeNull();
    });
  });

  it("renders the Bench Notes text", () => {
    const { getByText } = render(<Header />);
    expect(getByText("Bench Notes")).toBeTruthy();
  });

  it("does not render the Justice AI logo image", () => {
    const { queryByAltText } = render(<Header />);
    expect(queryByAltText("Justice AI Unit logo")).toBeNull();
  });

  it("renders ThemeToggle", () => {
    const { getByText } = render(<Header />);
    expect(getByText("Toggle theme")).toBeTruthy();
  });

  it("has a home link wrapping the logo and title", () => {
    const { getByText } = render(<Header />);
    const link = getByText("Bench Notes").closest("a");
    expect(link).toBeTruthy();
    expect((link as HTMLAnchorElement).href).toContain("/");
  });

  it.each([
    [
      "a recording mode is selected",
      () => {
        mockSelectedRecordingMode = "mic";
      },
    ],
    [
      "live dictation is recording",
      () => {
        mockPathname = "/record";
        mockIsRecording = true;
      },
    ],
  ])("hides Help, Dictation and Hearing recordings when %s", (_, arrange) => {
    arrange();
    const { getByRole } = render(<Header />);
    const nav = within(getByRole("navigation"));
    for (const name of [
      "Go to help",
      "Go to dictation",
      "Go to hearing recordings",
    ]) {
      expect(nav.queryByRole("link", { name })).toBeNull();
    }
  });

  it("lists Dictation and Hearing recordings in the mobile menu", () => {
    render(<Header />);
    fireEvent.click(
      screen.getByRole("button", { name: "Open navigation menu" })
    );
    const menu = within(screen.getByRole("dialog"));
    expect(
      menu.getByRole("link", { name: "Dictation" }).getAttribute("href")
    ).toBe("/record?mode=mic");
    expect(
      menu
        .getByRole("link", { name: "Hearing recordings" })
        .getAttribute("href")
    ).toBe("/recording");
  });

  it("hides the mobile menu's feature links while dictation is recording", () => {
    mockPathname = "/record";
    mockIsRecording = true;
    render(<Header />);
    fireEvent.click(
      screen.getByRole("button", { name: "Open navigation menu" })
    );
    const menu = within(screen.getByRole("dialog"));
    expect(menu.getByRole("link", { name: "Home" })).toBeTruthy();
    for (const name of ["Dictation", "Hearing recordings", "Help"]) {
      expect(menu.queryByRole("link", { name })).toBeNull();
    }
  });

  it("shows the feature links again once dictation stops", () => {
    mockPathname = "/record";
    mockIsRecording = false;
    const { getByRole } = render(<Header />);
    const nav = within(getByRole("navigation"));
    expect(nav.getByRole("link", { name: "Go to dictation" })).toBeTruthy();
    expect(
      nav.getByRole("link", { name: "Go to hearing recordings" })
    ).toBeTruthy();
  });

  it("links to dictation and hearing recordings as separate entries", () => {
    const { getByRole } = render(<Header />);
    const nav = within(getByRole("navigation"));
    expect(
      nav.getByRole("link", { name: "Go to dictation" }).getAttribute("href")
    ).toBe("/record?mode=mic");
    expect(
      nav
        .getByRole("link", { name: "Go to hearing recordings" })
        .getAttribute("href")
    ).toBe("/recording");
    expect(nav.getByText("Dictation")).toBeTruthy();
    expect(nav.getByText("Hearing recordings")).toBeTruthy();
    expect(nav.queryByText("Recordings")).toBeNull();
  });

  it.each([
    ["/record", "Go to dictation", "Go to hearing recordings"],
    ["/recording", "Go to hearing recordings", "Go to dictation"],
    ["/recording/jobs/abc", "Go to hearing recordings", "Go to dictation"],
  ])("on %s marks only %s as the current page", (path, active, inactive) => {
    mockPathname = path;
    const { getByRole } = render(<Header />);
    const nav = within(getByRole("navigation"));
    expect(
      nav.getByRole("link", { name: active }).getAttribute("aria-current")
    ).toBe("page");
    expect(
      nav.getByRole("link", { name: inactive }).getAttribute("aria-current")
    ).toBeNull();
  });

  it("marks neither feature link as current on the home page", () => {
    const { getByRole } = render(<Header />);
    const nav = within(getByRole("navigation"));
    for (const name of ["Go to dictation", "Go to hearing recordings"]) {
      expect(
        nav.getByRole("link", { name }).getAttribute("aria-current")
      ).toBeNull();
    }
  });
});
