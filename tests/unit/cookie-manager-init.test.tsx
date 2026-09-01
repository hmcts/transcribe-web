import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockOptIn, mockOptOut, mockOn, mockOff, mockInit, registeredCallbacks } = vi.hoisted(
  () => {
    const registeredCallbacks: Record<string, (prefs: { analytics?: "on" | "off" }) => void> = {};
    const mockOn = vi.fn((event: string, cb: (prefs: { analytics?: "on" | "off" }) => void) => {
      registeredCallbacks[event] = cb;
      return `token-${event}`;
    });
    return {
      mockOptIn: vi.fn(),
      mockOptOut: vi.fn(),
      mockOn,
      mockOff: vi.fn(),
      mockInit: vi.fn(),
      registeredCallbacks,
    };
  }
);

vi.mock("posthog-js", () => ({
  default: { opt_in_capturing: mockOptIn, opt_out_capturing: mockOptOut },
}));

vi.mock("@hmcts/cookie-manager", () => ({
  default: { on: mockOn, off: mockOff, init: mockInit },
}));

import { CookieManagerInit } from "@/components/cookie-banner/cookie-manager-init";

describe("CookieManagerInit", () => {
  beforeEach(() => {
    (window as Window & { dataLayer?: unknown[] }).dataLayer = undefined;
  });

  it("registers callbacks for UserPreferencesLoaded and UserPreferencesSaved", () => {
    render(<CookieManagerInit />);
    expect(mockOn).toHaveBeenCalledWith("UserPreferencesLoaded", expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith("UserPreferencesSaved", expect.any(Function));
  });

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

  describe("applyAnalyticsConsent", () => {
    beforeEach(() => {
      render(<CookieManagerInit />);
    });

    it("opts out of PostHog when analytics is off", () => {
      registeredCallbacks.UserPreferencesLoaded({ analytics: "off" });
      expect(mockOptOut).toHaveBeenCalledOnce();
      expect(mockOptIn).not.toHaveBeenCalled();
    });

    it("opts in to PostHog when analytics is on", () => {
      registeredCallbacks.UserPreferencesLoaded({ analytics: "on" });
      expect(mockOptIn).toHaveBeenCalledOnce();
      expect(mockOptOut).not.toHaveBeenCalled();
    });

    it("opts out by default when analytics preference is absent", () => {
      registeredCallbacks.UserPreferencesLoaded({});
      expect(mockOptOut).toHaveBeenCalledOnce();
      expect(mockOptIn).not.toHaveBeenCalled();
    });

    it("pushes a Cookie Preferences event to the GTM dataLayer on opt-in", () => {
      const prefs = { analytics: "on" as const };
      registeredCallbacks.UserPreferencesSaved(prefs);
      const dataLayer = (window as Window & { dataLayer?: unknown[] }).dataLayer;
      expect(dataLayer).toContainEqual({ event: "Cookie Preferences", cookiePreferences: prefs });
    });

    it("pushes a Cookie Preferences event to the GTM dataLayer on opt-out", () => {
      const prefs = { analytics: "off" as const };
      registeredCallbacks.UserPreferencesSaved(prefs);
      const dataLayer = (window as Window & { dataLayer?: unknown[] }).dataLayer;
      expect(dataLayer).toContainEqual({ event: "Cookie Preferences", cookiePreferences: prefs });
    });

    it("applies the same logic for UserPreferencesSaved", () => {
      registeredCallbacks.UserPreferencesSaved({ analytics: "on" });
      expect(mockOptIn).toHaveBeenCalledOnce();
    });
  });

  it("calls cookieManager.off with both tokens on unmount", () => {
    const { unmount } = render(<CookieManagerInit />);
    unmount();
    expect(mockOff).toHaveBeenCalledWith("token-UserPreferencesLoaded");
    expect(mockOff).toHaveBeenCalledWith("token-UserPreferencesSaved");
  });
});
