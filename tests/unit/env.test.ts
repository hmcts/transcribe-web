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
    const HOST_KEY = "NEXT_PUBLIC_POSTHOG_HOST" as const;
    const API_KEY = "NEXT_PUBLIC_POSTHOG_API_KEY" as const;
    let originalHost: string | undefined;
    let originalApiKey: string | undefined;

    beforeEach(() => {
      originalHost = process.env[HOST_KEY];
      originalApiKey = process.env[API_KEY];
      delete process.env[HOST_KEY];
      delete process.env[API_KEY];
      delete (window as any).__ENV;
    });

    afterEach(() => {
      if (originalHost !== undefined) process.env[HOST_KEY] = originalHost;
      else delete process.env[HOST_KEY];
      if (originalApiKey !== undefined) process.env[API_KEY] = originalApiKey;
      else delete process.env[API_KEY];
    });

    it("returns https://eu.i.posthog.com for NEXT_PUBLIC_POSTHOG_HOST when no runtime value is set", () => {
      expect(getEnv(HOST_KEY)).toBe("https://eu.i.posthog.com");
    });

    it("returns undefined for NEXT_PUBLIC_POSTHOG_API_KEY when no runtime value is set", () => {
      expect(getEnv(API_KEY)).toBeUndefined();
    });

    it("overrides NEXT_PUBLIC_POSTHOG_HOST preset with window.__ENV value", () => {
      (window as any).__ENV = { [HOST_KEY]: "https://custom.posthog.com" };
      expect(getEnv(HOST_KEY)).toBe("https://custom.posthog.com");
    });
  });
});
