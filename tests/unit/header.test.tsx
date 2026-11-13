import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
      expect(nav.queryByRole("link", { name: "Go to decisions" })).toBeNull();
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
      expect(menu.queryByRole("link", { name: "Decisions" })).toBeNull();
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
      dictation: "Go to decisions",
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
        { admin: true, wording: false, dictation: false, recordings: false, help: true },
      ],
      [
        // DIAAT-406: screen wording is changed in Admin, Jurisdictions only.
        "a jurisdiction super administrator",
        ME.jurisdictionSuperAdministrator,
        { admin: true, wording: false, dictation: false, recordings: false, help: true },
      ],
      [
        "a system administrator with no jurisdiction",
        ME.sysadminOnly,
        { admin: true, wording: false, dictation: false, recordings: false, help: true },
      ],
      [
        // DIAAT-403: holds super administrator and system administrator too, and sees none of it.
        "a system administrator acting as a judge",
        ME.sysadminMultiAsJudge,
        { admin: false, wording: false, dictation: true, recordings: true, help: true },
      ],
      [
        "the same user acting as system administrator",
        ME.sysadminMultiAsSystem,
        { admin: true, wording: false, dictation: false, recordings: false, help: true },
      ],
    ])("for %s", (_, persona, expected) => {
      expect(shown(persona)).toEqual(expected);
    });

    it("has no Wording link even with jurisdiction.wording.edit in a jurisdiction (DIAAT-406)", () => {
      mockPersona = {
        ...ME.jurisdictionAdministrator,
        permissions: [...ME.jurisdictionAdministrator.permissions, "jurisdiction.wording.edit"],
      };
      const { queryByRole } = render(<Header />);
      expect(queryByRole("link", { name: /Wording/ })).toBeNull();
    });

    it("leaves dictation and recordings out of the mobile menu for any other role", () => {
      mockPersona = ME.legalTextManager;
      render(<Header />);
      fireEvent.click(
        screen.getByRole("button", { name: "Open navigation menu" })
      );
      const menu = within(screen.getByRole("dialog"));
      expect(menu.queryByRole("link", { name: "Decisions" })).toBeNull();
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

  describe("the context switcher (DIAAT-390, DIAAT-406)", () => {
    it("shows the jurisdiction and the role the user works as, in two labelled controls", () => {
      mockPersona = ME.multiAsAdministrator;
      const nav = within(render(<Header />).getByRole("navigation"));
      const jurisdiction = nav.getByLabelText("Jurisdiction") as HTMLSelectElement;
      const role = nav.getByLabelText("Role") as HTMLSelectElement;
      expect(jurisdiction.value).toBe("IAC");
      expect([...jurisdiction.options].map((o) => o.textContent)).toEqual([
        "Employment Tribunal",
        "Immigration and Asylum Chamber",
      ]);
      expect([...role.options].map((o) => o.textContent)).toEqual(["Jurisdiction administrator"]);
    });

    it("is in the narrow-screen menu too, with visible labels", () => {
      mockPersona = ME.manyJurisdictions;
      render(<Header />);
      fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
      const menu = within(screen.getByRole("dialog"));
      expect((menu.getByLabelText("Jurisdiction") as HTMLSelectElement).value).toBe("ET");
      expect(menu.getByText("Jurisdiction").className).not.toContain("sr-only");
      expect(
        [...(menu.getByLabelText("Role") as HTMLSelectElement).options].map((o) => o.textContent)
      ).toEqual(["Judge", "Legal text manager"]);
    });

    it("closes the narrow-screen menu when Request access is chosen, so the page is not behind it", async () => {
      mockPersona = ME.manyJurisdictions;
      render(<Header />);
      fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
      const menu = within(screen.getByRole("dialog"));
      fireEvent.pointerDown(menu.getByRole("button", { name: /Your access/ }), {
        button: 0,
        ctrlKey: false,
      });
      const link = (await screen.findByText("Request access")).closest("a") as HTMLAnchorElement;
      expect(link.getAttribute("href")).toBe("/request-access");
      fireEvent.click(link);

      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });

    it("is not shown to a user with no role", () => {
      mockPersona = ME.noAccess;
      render(<Header />);
      expect(screen.queryByLabelText("Jurisdiction")).toBeNull();
      expect(screen.queryByRole("button", { name: /Your access/ })).toBeNull();
    });

    it("has no persona picker outside local development", () => {
      render(<Header />);
      expect(screen.queryByTestId("dev-persona-picker")).toBeNull();
    });
  });

  it("renders the BenchNotes text", () => {
    const { getByText } = render(<Header />);
    expect(getByText("BenchNotes")).toBeTruthy();
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
    const link = getByText("BenchNotes").closest("a");
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
  ])("hides Help, Decisions and Hearing recordings when %s", (_, arrange) => {
    arrange();
    const { getByRole } = render(<Header />);
    const nav = within(getByRole("navigation"));
    for (const name of [
      "Go to help",
      "Go to decisions",
      "Go to hearing recordings",
    ]) {
      expect(nav.queryByRole("link", { name })).toBeNull();
    }
  });

  it("lists Decisions and Hearing recordings in the mobile menu", () => {
    render(<Header />);
    fireEvent.click(
      screen.getByRole("button", { name: "Open navigation menu" })
    );
    const menu = within(screen.getByRole("dialog"));
    expect(
      menu.getByRole("link", { name: "Decisions" }).getAttribute("href")
    ).toBe("/decisions");
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
    for (const name of ["Decisions", "Hearing recordings", "Help"]) {
      expect(menu.queryByRole("link", { name })).toBeNull();
    }
  });

  it("shows the feature links again once dictation stops", () => {
    mockPathname = "/record";
    mockIsRecording = false;
    const { getByRole } = render(<Header />);
    const nav = within(getByRole("navigation"));
    expect(nav.getByRole("link", { name: "Go to decisions" })).toBeTruthy();
    expect(
      nav.getByRole("link", { name: "Go to hearing recordings" })
    ).toBeTruthy();
  });

  it("links to decisions and hearing recordings as separate entries", () => {
    const { getByRole } = render(<Header />);
    const nav = within(getByRole("navigation"));
    expect(
      nav.getByRole("link", { name: "Go to decisions" }).getAttribute("href")
    ).toBe("/decisions");
    expect(
      nav
        .getByRole("link", { name: "Go to hearing recordings" })
        .getAttribute("href")
    ).toBe("/recording");
    expect(nav.getByText("Decisions")).toBeTruthy();
    expect(nav.getByText("Hearing recordings")).toBeTruthy();
    expect(nav.queryByText("Recordings")).toBeNull();
  });

  it.each([
    ["/decisions", "Go to decisions", "Go to hearing recordings"],
    ["/record", "Go to decisions", "Go to hearing recordings"],
    ["/recording", "Go to hearing recordings", "Go to decisions"],
    ["/recording/jobs/abc", "Go to hearing recordings", "Go to decisions"],
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
    for (const name of ["Go to decisions", "Go to hearing recordings"]) {
      expect(
        nav.getByRole("link", { name }).getAttribute("aria-current")
      ).toBeNull();
    }
  });
});
