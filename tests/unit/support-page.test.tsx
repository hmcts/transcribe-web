import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import SupportPage from "@/app/support/page";

describe("SupportPage contact link", () => {
  it("uses the shared support mailbox, not a personal address", () => {
    render(<SupportPage />);
    const link = screen.getByRole("link", {
      name: /transcribe@justice\.gov\.uk/i,
    });
    expect(link.getAttribute("href")).toBe("mailto:transcribe@justice.gov.uk");
  });
});
