import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mockSetTheme = vi.fn();

vi.mock("next-themes", () => ({
  useTheme: vi.fn(() => ({ theme: "light", setTheme: mockSetTheme })),
}));

import { useTheme } from "next-themes";
import { ThemeToggle } from "@/components/theme-toggle";

describe("ThemeToggle", () => {
  it("renders a button with accessible label when theme is light", () => {
    vi.mocked(useTheme).mockReturnValue({
      theme: "light",
      setTheme: mockSetTheme,
      themes: [],
      systemTheme: undefined,
      resolvedTheme: "light",
      forcedTheme: undefined,
    });
    render(<ThemeToggle />);
    expect(
      screen.getByRole("button", { name: "Switch to dark theme" })
    ).toBeTruthy();
  });

  it("calls setTheme with 'dark' when current resolvedTheme is light", async () => {
    vi.mocked(useTheme).mockReturnValue({
      theme: "light",
      setTheme: mockSetTheme,
      themes: [],
      systemTheme: undefined,
      resolvedTheme: "light",
      forcedTheme: undefined,
    });
    render(<ThemeToggle />);
    fireEvent.click(
      screen.getByRole("button", { name: "Switch to dark theme" })
    );
    expect(mockSetTheme).toHaveBeenCalledWith("dark");
  });

  it("calls setTheme with 'light' when current resolvedTheme is dark", async () => {
    vi.mocked(useTheme).mockReturnValue({
      theme: "dark",
      setTheme: mockSetTheme,
      themes: [],
      systemTheme: undefined,
      resolvedTheme: "dark",
      forcedTheme: undefined,
    });
    render(<ThemeToggle />);
    fireEvent.click(
      screen.getByRole("button", { name: "Switch to light theme" })
    );
    expect(mockSetTheme).toHaveBeenCalledWith("light");
  });
});
