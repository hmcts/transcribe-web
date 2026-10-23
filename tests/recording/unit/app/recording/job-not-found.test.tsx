import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import NotFound from "@/app/recording/jobs/[jobId]/not-found";

describe("recording job not-found page", () => {
  it("links back to the recording list, not the dictation home page", () => {
    render(<NotFound />);
    const link = screen.getByRole("link", { name: /back to/i });
    expect(link.getAttribute("href")).toBe("/recording");
  });
});
