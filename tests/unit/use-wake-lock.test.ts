import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWakeLock } from "@/hooks/use-wake-lock";

describe("useWakeLock", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns requestWakeLock and releaseWakeLock functions", () => {
    const { result } = renderHook(() => useWakeLock());
    expect(typeof result.current.requestWakeLock).toBe("function");
    expect(typeof result.current.releaseWakeLock).toBe("function");
  });

  it("requests a wake lock when navigator.wakeLock is available", async () => {
    const mockRelease = vi.fn().mockResolvedValue(undefined);
    const mockLock = {
      released: false,
      release: mockRelease,
      addEventListener: vi.fn(),
    };
    const mockRequest = vi.fn().mockResolvedValue(mockLock);

    Object.defineProperty(navigator, "wakeLock", {
      value: { request: mockRequest },
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useWakeLock());

    await act(async () => {
      await result.current.requestWakeLock();
    });

    expect(mockRequest).toHaveBeenCalledWith("screen");
  });

  it("does nothing when navigator.wakeLock is not available", async () => {
    Object.defineProperty(navigator, "wakeLock", {
      value: undefined,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useWakeLock());

    await act(async () => {
      await result.current.requestWakeLock();
    });
    // No error thrown
  });

  it("releases the wake lock when releaseWakeLock is called", async () => {
    const mockRelease = vi.fn().mockResolvedValue(undefined);
    const mockLock = {
      released: false,
      release: mockRelease,
      addEventListener: vi.fn(),
    };
    Object.defineProperty(navigator, "wakeLock", {
      value: { request: vi.fn().mockResolvedValue(mockLock) },
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useWakeLock());

    await act(async () => {
      await result.current.requestWakeLock();
    });

    await act(async () => {
      await result.current.releaseWakeLock();
    });

    expect(mockRelease).toHaveBeenCalled();
  });

  it("does not call release if lock is already released", async () => {
    const mockRelease = vi.fn().mockResolvedValue(undefined);
    const mockLock = {
      released: true,
      release: mockRelease,
      addEventListener: vi.fn(),
    };
    Object.defineProperty(navigator, "wakeLock", {
      value: { request: vi.fn().mockResolvedValue(mockLock) },
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useWakeLock());

    await act(async () => {
      await result.current.requestWakeLock();
    });

    await act(async () => {
      await result.current.releaseWakeLock();
    });

    expect(mockRelease).not.toHaveBeenCalled();
  });

  it("calls releaseWakeLock on unmount", async () => {
    const mockRelease = vi.fn().mockResolvedValue(undefined);
    const mockLock = {
      released: false,
      release: mockRelease,
      addEventListener: vi.fn(),
    };
    Object.defineProperty(navigator, "wakeLock", {
      value: { request: vi.fn().mockResolvedValue(mockLock) },
      writable: true,
      configurable: true,
    });

    const { result, unmount } = renderHook(() => useWakeLock());

    await act(async () => {
      await result.current.requestWakeLock();
    });

    await act(async () => {
      unmount();
    });

    expect(mockRelease).toHaveBeenCalled();
  });

  it("handles errors gracefully during requestWakeLock", async () => {
    Object.defineProperty(navigator, "wakeLock", {
      value: { request: vi.fn().mockRejectedValue(new Error("Denied")) },
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useWakeLock());

    await act(async () => {
      await result.current.requestWakeLock();
    });
    // No error thrown
  });
});
