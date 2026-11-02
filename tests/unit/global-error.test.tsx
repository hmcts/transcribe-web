/**
 * PR review: the global error page replaces the root layout, so TelemetryBootstrap
 * may never mount. The page installs the relay's page-hide flush itself and sends the
 * report at once.
 */
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const relay = vi.hoisted(() => ({
  installRelayLifecycle: vi.fn(),
  flush: vi.fn(async () => undefined),
  clientError: vi.fn(),
}));
vi.mock("@/lib/telemetry-relay", () => ({
  installRelayLifecycle: relay.installRelayLifecycle,
  telemetryRelay: { flush: relay.flush },
}));
vi.mock("@/lib/browser-failures", () => ({
  browserFailures: { clientError: relay.clientError },
}));
vi.mock("next/error", () => ({ default: () => null }));

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
});
