import { renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MeResponse } from "@/lib/access/types";
import { ME } from "../access-helpers";

// The user's settings (`GET /api/users/me`) need app.access. A user known not to
// have it (a system administrator with no roles, or someone with no access yet)
// must not be sent to the API for them: it would only answer 403.

vi.mock("@/lib/database", () => ({
  getCurrentUser: vi.fn(),
  updateCurrentUser: vi.fn(),
}));
let persona: MeResponse | null = ME.judge;
vi.mock("@/providers/access", async () => {
  const helpers = await import("../access-helpers");
  return {
    useAccess: () =>
      persona
        ? helpers.accessValue(persona)
        : { ...helpers.accessValue(ME.judge), me: null, can: () => false, status: "loading" },
  };
});

import { getCurrentUser } from "@/lib/database";
import { UserSettingsProvider, useUserSettings } from "@/providers/user-settings";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <UserSettingsProvider>{children}</UserSettingsProvider>
);

beforeEach(() => {
  persona = ME.judge;
  vi.mocked(getCurrentUser).mockReset();
  vi.mocked(getCurrentUser).mockResolvedValue({ id: "u1", email: "j@example.test" } as never);
});

describe("UserSettingsProvider and app.access", () => {
  it("loads the settings of a user who has app.access", async () => {
    const { result } = renderHook(() => useUserSettings(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getCurrentUser).toHaveBeenCalledTimes(1);
    expect(result.current.user).toEqual({ id: "u1", email: "j@example.test" });
  });

  it.each([
    ["a system administrator with no roles", ME.sysadminOnly],
    ["a user with no access yet", ME.noAccess],
  ])("does not call /users/me for %s", async (_, me) => {
    persona = me;
    const { result } = renderHook(() => useUserSettings(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getCurrentUser).not.toHaveBeenCalled();
    expect(result.current.user).toBeNull();
  });

  it("still loads when it does not yet know who the user is, as it always did", async () => {
    persona = null;
    const { result } = renderHook(() => useUserSettings(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getCurrentUser).toHaveBeenCalledTimes(1);
  });

  it("loads once access arrives (a request approved, then checked again)", async () => {
    persona = ME.noAccess;
    const { result, rerender } = renderHook(() => useUserSettings(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getCurrentUser).not.toHaveBeenCalled();

    persona = ME.judge;
    rerender();
    await waitFor(() => expect(result.current.user).toEqual({ id: "u1", email: "j@example.test" }));
    expect(getCurrentUser).toHaveBeenCalledTimes(1);
  });
});
