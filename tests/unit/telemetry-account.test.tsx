import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// DIAAT-205: the relay sends telemetry only for the account signed in now, asked of
// the API on load and whenever the page is shown again (another tab may have signed
// someone else in on the shared session).

vi.mock("@/lib/database", () => ({
  getCurrentUser: vi.fn(),
  updateCurrentUser: vi.fn(),
}));

import { getCurrentUser } from "@/lib/database";
import { confirmTelemetryAccount } from "@/lib/telemetry-account";
import { telemetryRelay } from "@/lib/telemetry-relay";
import { UserSettingsProvider } from "@/providers/user-settings";

function setVisibility(state: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => {
  Reflect.deleteProperty(document, "visibilityState");
  vi.restoreAllMocks();
});

describe("confirming the telemetry account", () => {
  it("is who the API says is signed in, or no one", async () => {
    const relay = { setAccount: vi.fn() };
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "b-1" } as never);
    await confirmTelemetryAccount(relay as never);
    expect(relay.setAccount).toHaveBeenLastCalledWith("b-1");

    vi.mocked(getCurrentUser).mockResolvedValueOnce(null);
    await confirmTelemetryAccount(relay as never);
    expect(relay.setAccount).toHaveBeenLastCalledWith(null);
  });

  it("is asked again when the page is shown", async () => {
    const setAccount = vi.spyOn(telemetryRelay, "setAccount");
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "a-1" } as never);
    render(
      <UserSettingsProvider>
        <div />
      </UserSettingsProvider>
    );
    await waitFor(() => expect(setAccount).toHaveBeenLastCalledWith("a-1"));
    const calls = vi.mocked(getCurrentUser).mock.calls.length;

    vi.mocked(getCurrentUser).mockResolvedValue({ id: "b-1" } as never);
    setVisibility("hidden");
    setVisibility("visible");

    await waitFor(() => expect(setAccount).toHaveBeenLastCalledWith("b-1"));
    expect(vi.mocked(getCurrentUser).mock.calls.length).toBe(calls + 1);
  });
});
