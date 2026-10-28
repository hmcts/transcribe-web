import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockPush = vi.fn();
let mockPathname = "/";
let mockSelectedRecordingMode: string | null = null;
let mockIsRecording = false;

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

vi.mock("@/lib/admin-access", () => ({
  getAdminAccessStatus: vi.fn().mockResolvedValue("unauthorised"),
}));

import Header from "@/components/layout/header";

describe("Header", () => {
  afterEach(() => {
    mockPathname = "/";
    mockSelectedRecordingMode = null;
    mockIsRecording = false;
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
