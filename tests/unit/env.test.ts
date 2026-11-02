import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getEnv } from "@/lib/env";

const TEST_KEY = "NEXT_PUBLIC_TEST_ONLY_KEY" as const;

describe("getEnv", () => {
  const originalEnv = process.env[TEST_KEY];

  beforeEach(() => {
    delete (window as any).__ENV;
    delete process.env[TEST_KEY];
  });

  afterEach(() => {
    delete (window as any).__ENV;
    if (originalEnv !== undefined) {
      process.env[TEST_KEY] = originalEnv;
    } else {
      delete process.env[TEST_KEY];
    }
  });

  it("returns the value from process.env when window.__ENV is absent", () => {
    process.env[TEST_KEY] = "http://process.example.com";
    expect(getEnv(TEST_KEY)).toBe("http://process.example.com");
  });

  it("returns the value from window.__ENV when the key is present there", () => {
    (window as any).__ENV = { [TEST_KEY]: "http://window.example.com" };
    expect(getEnv(TEST_KEY)).toBe("http://window.example.com");
  });

  it("prefers window.__ENV over process.env", () => {
    process.env[TEST_KEY] = "http://process.example.com";
    (window as any).__ENV = { [TEST_KEY]: "http://window.example.com" };
    expect(getEnv(TEST_KEY)).toBe("http://window.example.com");
  });

  it("falls back to process.env when key is missing from window.__ENV", () => {
    (window as any).__ENV = { NEXT_PUBLIC_OTHER: "other" };
    process.env[TEST_KEY] = "http://process.example.com";
    expect(getEnv(TEST_KEY)).toBe("http://process.example.com");
  });

  it("returns undefined when key is not set anywhere", () => {
    expect(getEnv(TEST_KEY)).toBeUndefined();
  });

  describe("preset values", () => {
    const PRESET_KEY = "NEXT_PUBLIC_MAX_RECORDING_MINUTES" as const;
    let original: string | undefined;

    beforeEach(() => {
      original = process.env[PRESET_KEY];
      delete process.env[PRESET_KEY];
      delete (window as any).__ENV;
    });

    afterEach(() => {
      if (original !== undefined) process.env[PRESET_KEY] = original;
      else delete process.env[PRESET_KEY];
    });

    it("returns the preset when no runtime value is set", () => {
      expect(getEnv(PRESET_KEY)).toBe("125");
    });

    it("overrides the preset with a window.__ENV value", () => {
      (window as any).__ENV = { [PRESET_KEY]: "60" };
      expect(getEnv(PRESET_KEY)).toBe("60");
    });

    it("has no PostHog settings any more (OBS-3)", () => {
      expect(getEnv("NEXT_PUBLIC_POSTHOG_HOST")).toBeUndefined();
      expect(getEnv("NEXT_PUBLIC_POSTHOG_API_KEY")).toBeUndefined();
    });
  });
});

describe("static references for build-time inlining (PR #14 review)", () => {
  // Next.js inlines only literal process.env.NEXT_PUBLIC_* references into
  // browser code; getEnv's dynamic process.env[key] is not. Outside start.js's
  // runtime injection (e.g. `next dev`), a key missing from the preset would
  // ignore its .env value in the browser.
  const source = readFileSync(join(__dirname, "../../lib/env.ts"), "utf8");

  it.each([
    "NEXT_PUBLIC_NO_SPEECH_WARNING_SECONDS",
    "NEXT_PUBLIC_SPEECH_COLLAPSE_THRESHOLD",
    "NEXT_PUBLIC_SPEECH_COLLAPSE_WINDOW_SECONDS",
    "NEXT_PUBLIC_AUTOSAVE_FAILURE_ALERT_THRESHOLD",
    "NEXT_PUBLIC_LIVE_DRAFT_EXPIRY_WARNING_AFTER_HOURS",
  ])("references %s literally", (key) => {
    expect(source).toContain(`process.env.${key}`);
  });
});
