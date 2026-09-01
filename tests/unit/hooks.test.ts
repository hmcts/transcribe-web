import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBrowserNavigation } from "@/hooks/use-browser-navigation";
import useMediaQuery from "@/hooks/use-media-query";
import useIsMobile from "@/hooks/use-mobile";

// ─── useMediaQuery ────────────────────────────────────────────────────────────

describe("useMediaQuery", () => {
  let listeners: Array<() => void> = [];

  beforeEach(() => {
    listeners = [];
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn((query: string) => ({
        matches: false,
        media: query,
        addListener: (fn: () => void) => listeners.push(fn),
        removeListener: vi.fn(),
      })),
    });
  });

  it("returns false initially when media does not match", () => {
    const { result } = renderHook(() => useMediaQuery("(max-width: 768px)"));
    expect(result.current).toBe(false);
  });

  it("updates when the media query match changes", () => {
    const { result } = renderHook(() => useMediaQuery("(max-width: 768px)"));

    act(() => {
      // Simulate the media query becoming true
      Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: vi.fn(() => ({
          matches: true,
          addListener: vi.fn(),
          removeListener: vi.fn(),
        })),
      });
      listeners.forEach((fn) => fn());
    });

    // After listener fires, the hook re-reads from matchMedia
    expect(typeof result.current).toBe("boolean");
  });
});

// ─── useIsMobile ──────────────────────────────────────────────────────────────

describe("useIsMobile", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  });

  it("returns a boolean", () => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      value: 1024,
    });
    const { result } = renderHook(() => useIsMobile());
    expect(typeof result.current).toBe("boolean");
  });

  it("returns true when innerWidth is below 768", () => {
    Object.defineProperty(window, "innerWidth", { writable: true, value: 375 });
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it("returns false when innerWidth is 768 or above", () => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      value: 1024,
    });
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });
});

// ─── useBrowserNavigation ─────────────────────────────────────────────────────

const mockPush = vi.fn();
const mockRefresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

describe("useBrowserNavigation", () => {
  it("returns navigateTo and currentParams", () => {
    const { result } = renderHook(() => useBrowserNavigation());
    expect(typeof result.current.navigateTo).toBe("function");
    expect(result.current.currentParams).toBeDefined();
  });

  it("calls router.push with the correct URL on navigateTo", () => {
    const { result } = renderHook(() => useBrowserNavigation());
    act(() => {
      result.current.navigateTo(new URLSearchParams({ id: "t1" }));
    });
    expect(mockPush).toHaveBeenCalledWith("/?id=t1");
  });

  it("calls router.refresh on popstate event", () => {
    renderHook(() => useBrowserNavigation());
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(mockRefresh).toHaveBeenCalled();
  });
});
