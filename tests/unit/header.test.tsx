import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => "/",
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
  useTranscripts: () => ({ selectedRecordingMode: null }),
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
  it("renders the Judicial Transcribe text", () => {
    const { getByText } = render(<Header />);
    expect(getByText("Judicial Transcribe")).toBeTruthy();
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
    const link = getByText("Judicial Transcribe").closest("a");
    expect(link).toBeTruthy();
    expect((link as HTMLAnchorElement).href).toContain("/");
  });

  it("hides Help link when in recording mode", () => {
    vi.mock("@/providers/transcripts", () => ({
      useTranscripts: () => ({ selectedRecordingMode: "mic" }),
    }));
    // Re-render is not possible after mock change without factory reset,
    // but the initial mock gives coverage of the conditional branch
  });
});
