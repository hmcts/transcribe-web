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

import { ContactSupport } from "@/components/help/contact-support";

describe("ContactSupport", () => {
  it("links to the support email address", () => {
    render(<ContactSupport />);
    const link = screen.getByRole("link", {
      name: /contact us/i,
    }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(
      "mailto:JudicialTranscribe@justice.gov.uk"
    );
    expect(link.getAttribute("aria-label")).toBe("Contact us via email");
  });
});
