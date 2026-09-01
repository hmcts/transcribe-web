import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    request: vi.fn(),
  },
}));

import { apiClient } from "@/lib/api-client";
import AccessGate from "@/providers/access-gate";

describe("AccessGate", () => {
  it("shows access verification loading state initially", () => {
    vi.mocked(apiClient.request).mockReturnValue(
      new Promise((_resolve) => {
        /* never resolves */
      })
    );
    render(
      <AccessGate>
        <div>content</div>
      </AccessGate>
    );
    expect(screen.getByText("Access Verification")).toBeTruthy();
    expect(screen.queryByText("content")).toBeNull();
  });

  it("renders children when access is allowed", async () => {
    vi.mocked(apiClient.request).mockResolvedValue({
      data: {
        should_show_coming_soon: false,
        should_show_onboarding: false,
      },
    });

    render(
      <AccessGate>
        <div>protected content</div>
      </AccessGate>
    );
    await waitFor(() =>
      expect(screen.getByText("protected content")).toBeTruthy()
    );
  });

  it("shows redirecting state when coming-soon redirect is triggered", async () => {
    vi.mocked(apiClient.request).mockResolvedValue({
      data: {
        should_show_coming_soon: true,
        should_show_onboarding: false,
      },
    });

    // Simulate not being on /coming-soon
    Object.defineProperty(window, "location", {
      value: { pathname: "/", search: "", href: "/" },
      writable: true,
    });

    render(
      <AccessGate>
        <div>content</div>
      </AccessGate>
    );
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Redirecting" })).toBeTruthy()
    );
  });

  it("renders children on API error when already on coming-soon page", async () => {
    vi.mocked(apiClient.request).mockRejectedValue(new Error("Network error"));

    Object.defineProperty(window, "location", {
      value: { pathname: "/coming-soon", search: "", href: "/coming-soon" },
      writable: true,
    });

    render(
      <AccessGate>
        <div>fallback content</div>
      </AccessGate>
    );
    await waitFor(() =>
      expect(screen.getByText("fallback content")).toBeTruthy()
    );
  });
});
