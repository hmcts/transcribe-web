import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { mockOn, mockInit } = vi.hoisted(() => ({
  mockOn: vi.fn(),
  mockInit: vi.fn(),
}));

vi.mock("@hmcts/cookie-manager", () => ({
  default: { on: mockOn, off: vi.fn(), init: mockInit },
}));

import { CookieManagerInit } from "@/components/cookie-banner/cookie-manager-init";

describe("CookieManagerInit", () => {
  it("initialises cookie manager with the correct cookie name and no default consent", () => {
    render(<CookieManagerInit />);
    expect(mockInit).toHaveBeenCalledWith(
      expect.objectContaining({
        userPreferences: expect.objectContaining({
          cookieName: "judicial-transcribe-cookie-preferences",
          cookieExpiry: 365,
        }),
        additionalOptions: expect.objectContaining({ defaultConsent: false }),
      })
    );
  });

  it("sets cookieSecure based on the current protocol", () => {
    render(<CookieManagerInit />);
    const { cookieSecure } = (mockInit.mock.calls[0][0] as any).userPreferences;
    expect(cookieSecure).toBe(window.location.protocol === "https:");
  });

  it("no longer drives PostHog or Google Tag Manager (OBS-3)", () => {
    (window as Window & { dataLayer?: unknown[] }).dataLayer = undefined;
    render(<CookieManagerInit />);
    expect(mockOn).not.toHaveBeenCalled();
    expect(
      (window as Window & { dataLayer?: unknown[] }).dataLayer
    ).toBeUndefined();
  });

  it("removes cookies left by Google Analytics and PostHog when analytics is off", () => {
    render(<CookieManagerInit />);
    const [category] = (mockInit.mock.calls.at(-1)?.[0] as any).cookieManifest;
    expect(category.categoryName).toBe("analytics");
    expect(category.cookies).toEqual(expect.arrayContaining(["_ga", "ph_"]));
  });
});
