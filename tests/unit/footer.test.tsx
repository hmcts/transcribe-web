import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import Footer from "@/components/layout/footer";

describe("Footer", () => {
  it("renders Privacy and Support nav links", () => {
    render(<Footer />);
    expect(screen.getByRole("link", { name: "Privacy" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Support" })).toBeTruthy();
  });

  it("Privacy link points to /privacy", () => {
    render(<Footer />);
    const link = screen.getByRole("link", {
      name: "Privacy",
    }) as HTMLAnchorElement;
    expect(link.href).toContain("/privacy");
  });

  it("Support link points to /support", () => {
    render(<Footer />);
    const link = screen.getByRole("link", {
      name: "Support",
    }) as HTMLAnchorElement;
    expect(link.href).toContain("/support");
  });

  it("renders feedback link opening in a new tab", () => {
    render(<Footer />);
    const link = screen.getByRole("link", {
      name: "feedback",
    }) as HTMLAnchorElement;
    expect(link.target).toBe("_blank");
    expect(link.rel).toContain("noopener");
  });

  it("applies a custom className to the footer element", () => {
    const { container } = render(<Footer className="custom-class" />);
    const footer = container.querySelector("footer");
    expect(footer?.className).toContain("custom-class");
  });
});
