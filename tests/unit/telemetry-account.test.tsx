import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// DIAAT-205: the relay sends telemetry only for the account signed in now, asked of
// the API on load and whenever the page is shown again (another tab may have signed
// someone else in on the shared session). Only the latest lookup counts.

vi.mock("@/lib/database", () => ({
  getCurrentUser: vi.fn(),
  updateCurrentUser: vi.fn(),
}));

import { getCurrentUser } from "@/lib/database";
import { confirmTelemetryAccount } from "@/lib/telemetry-account";
import { TelemetryRelay, telemetryRelay } from "@/lib/telemetry-relay";
import { UserSettingsProvider } from "@/providers/user-settings";

function setVisibility(state: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

/** A lookup whose answer the test gives when it chooses. */
function pendingUser() {
  let answer: (user: { id: string } | null) => void = () => undefined;
  const promise = new Promise<{ id: string } | null>((resolve) => {
    answer = resolve;
  });
  return { promise, answer };
}

afterEach(() => {
  Reflect.deleteProperty(document, "visibilityState");
  vi.restoreAllMocks();
});

describe("confirming the telemetry account", () => {
  it("is who the API says is signed in", async () => {
    const relay = new TelemetryRelay({ confirmAccount: true });
    const setAccount = vi.spyOn(relay, "setAccount");
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "b-1" } as never);
    await confirmTelemetryAccount(relay);
    expect(setAccount).toHaveBeenLastCalledWith("b-1");
  });

  it("ignores an older lookup that answers after a newer one", async () => {
    const relay = new TelemetryRelay({ confirmAccount: true });
    const setAccount = vi.spyOn(relay, "setAccount");
    const older = pendingUser();
    const newer = pendingUser();
    vi.mocked(getCurrentUser)
      .mockReturnValueOnce(older.promise as never)
      .mockReturnValueOnce(newer.promise as never);

    const first = confirmTelemetryAccount(relay);
    const second = confirmTelemetryAccount(relay);
    newer.answer({ id: "b-1" });
    await second;
    older.answer({ id: "a-1" }); // stale: A signed out, B signed in meanwhile
    await first;

    expect(setAccount.mock.calls).toEqual([["b-1"]]);
  });

  it("is asked again when the page is shown, numbered with the first lookup", async () => {
    const setAccount = vi.spyOn(telemetryRelay, "setAccount");
    const first = pendingUser();
    vi.mocked(getCurrentUser).mockReturnValueOnce(first.promise as never);
    render(
      <UserSettingsProvider>
        <div />
      </UserSettingsProvider>
    );

    vi.mocked(getCurrentUser).mockResolvedValue({ id: "b-1" } as never);
    setVisibility("hidden");
    setVisibility("visible");
    await waitFor(() => expect(setAccount).toHaveBeenLastCalledWith("b-1"));
    first.answer({ id: "a-1" }); // the page's first lookup answers late
    await Promise.resolve();
    await Promise.resolve();

    expect(setAccount.mock.calls).toEqual([["b-1"]]);
  });
});
