import { act, renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/database", () => ({
  getCurrentUser: vi.fn(),
  updateCurrentUser: vi.fn(),
}));

import { getCurrentUser, updateCurrentUser } from "@/lib/database";
import {
  UserSettingsProvider,
  useUserSettings,
} from "@/providers/user-settings";

function wrapper({ children }: { children: React.ReactNode }) {
  return <UserSettingsProvider>{children}</UserSettingsProvider>;
}

describe("useUserSettings", () => {
  it("throws when used outside UserSettingsProvider", () => {
    expect(() => renderHook(() => useUserSettings())).toThrow(
      "useUserSettings must be used within a UserSettingsProvider"
    );
  });
});

describe("UserSettingsProvider", () => {
  it("starts with loading true and null user", () => {
    vi.mocked(getCurrentUser).mockReturnValue(
      new Promise((_resolve) => {
        /* never resolves */
      })
    );
    const { result } = renderHook(() => useUserSettings(), { wrapper });
    expect(result.current.loading).toBe(true);
    expect(result.current.user).toBeNull();
  });

  it("loads user on mount and sets loading false", async () => {
    const user = { id: "u1", email: "test@example.com" } as any;
    vi.mocked(getCurrentUser).mockResolvedValue(user);

    const { result } = renderHook(() => useUserSettings(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toEqual(user);
  });

  it("handles null user when getCurrentUser returns null", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);

    const { result } = renderHook(() => useUserSettings(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toBeNull();
  });

  it("updateUserSettings calls API and updates user state", async () => {
    const initial = { id: "u1", email: "old@example.com" } as any;
    const updated = { id: "u1", email: "new@example.com" } as any;
    vi.mocked(getCurrentUser).mockResolvedValue(initial);
    vi.mocked(updateCurrentUser).mockResolvedValue(updated);

    const { result } = renderHook(() => useUserSettings(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateUserSettings({ email: "new@example.com" });
    });

    expect(updateCurrentUser).toHaveBeenCalledWith({
      email: "new@example.com",
    });
    expect(result.current.user).toEqual(updated);
  });
});
