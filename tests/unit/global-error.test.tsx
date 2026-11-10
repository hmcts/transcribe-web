/**
 * PR review: the global error page replaces the root layout, so TelemetryBootstrap
 * may never mount. The page installs the relay's page-hide flush itself and sends the
 * report at once.
 */
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const relay = vi.hoisted(() => ({
  installRelayLifecycle: vi.fn(),
  flush: vi.fn(async () => undefined),
  clientError: vi.fn(),
  confirmTelemetryAccount: vi.fn(async () => undefined),
}));
vi.mock("@/lib/telemetry-relay", () => ({
  installRelayLifecycle: relay.installRelayLifecycle,
  telemetryRelay: { flush: relay.flush },
}));
vi.mock("@/lib/browser-failures", () => ({
  browserFailures: { clientError: relay.clientError },
}));
vi.mock("next/error", () => ({ default: () => null }));
vi.mock("@/lib/telemetry-account", () => ({
  confirmTelemetryAccount: relay.confirmTelemetryAccount,
}));

import GlobalError from "@/app/global-error";

describe("global error page", () => {
  it("installs the relay lifecycle before reporting, then sends at once", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = Object.assign(new TypeError("the appellant said"), {
      digest: "123",
    });
    render(<GlobalError error={error} />);

    expect(relay.installRelayLifecycle).toHaveBeenCalledTimes(1);
    expect(relay.clientError).toHaveBeenCalledWith(error, "render", "123");
    const order = (fn: { mock: { invocationCallOrder: number[] } }) =>
      fn.mock.invocationCallOrder[0];
    expect(order(relay.installRelayLifecycle)).toBeLessThan(
      order(relay.clientError)
    );
    expect(order(relay.clientError)).toBeLessThan(order(relay.flush));
  });

  it("sends again once it knows who is signed in, which the relay waits for", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    relay.flush.mockClear();
    render(<GlobalError error={new Error("x")} />);

    expect(relay.confirmTelemetryAccount).toHaveBeenCalled();
    await waitFor(() => expect(relay.flush).toHaveBeenCalledTimes(2));
  });

  it("looks the account up again and sends when the page is shown again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<GlobalError error={new Error("x")} />);
    await waitFor(() => expect(relay.flush).toHaveBeenCalled());
    relay.confirmTelemetryAccount.mockClear();
    relay.flush.mockClear();

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    Reflect.deleteProperty(document, "visibilityState");

    expect(relay.confirmTelemetryAccount).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(relay.flush).toHaveBeenCalledTimes(1));
  });
});
