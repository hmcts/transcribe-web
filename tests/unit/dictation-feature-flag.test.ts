import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isDictationEnabled } from "@/lib/environment";
import { proxy } from "@/proxy";

const FLAG = "NEXT_PUBLIC_DICTATION_ENABLED";

function location(path: string): string | null {
  return proxy(
    new NextRequest(`https://transcribe.example${path}`)
  ).headers.get("location");
}

describe("isDictationEnabled (DIAAT-366)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete (window as any).__ENV;
  });

  it("is on when the flag is unset, so local dev and tests keep Dictation", () => {
    vi.stubEnv(FLAG, undefined);
    expect(isDictationEnabled()).toBe(true);
  });

  it.each(["false", "FALSE", "False"])("is off for %s", (value) => {
    vi.stubEnv(FLAG, value);
    expect(isDictationEnabled()).toBe(false);
  });

  it("is on for true", () => {
    vi.stubEnv(FLAG, "true");
    expect(isDictationEnabled()).toBe(true);
  });

  it("reads the runtime value start.js writes to window.__ENV", () => {
    vi.stubEnv(FLAG, "true");
    (window as any).__ENV = { [FLAG]: "false" };
    expect(isDictationEnabled()).toBe(false);
  });
});

describe("proxy Dictation gate (DIAAT-366)", () => {
  afterEach(() => vi.unstubAllEnvs());

  describe("when Dictation is off", () => {
    it.each([
      "/record",
      "/record?mode=mic",
      "/record/anything",
      "/speech-demo",
    ])("redirects %s to the home page", (path) => {
      vi.stubEnv(FLAG, "false");
      expect(location(path)).toBe("https://transcribe.example/");
    });

    it.each([
      "/",
      "/recording",
      "/recording/jobs/abc",
      "/upload",
      "/help",
    ])("leaves %s alone", (path) => {
      vi.stubEnv(FLAG, "false");
      expect(location(path)).toBeNull();
    });

    it("still sends a signed-out user to the login first", () => {
      vi.stubEnv(FLAG, "false");
      vi.stubEnv("AUTH_ENABLED", "true");
      expect(location("/record")).toContain("/auth/login");
    });
  });

  it.each([
    ["on", "true"],
    ["unset", undefined],
  ])("serves /record and /speech-demo when the flag is %s", (_, value) => {
    vi.stubEnv(FLAG, value);
    expect(location("/record?mode=mic")).toBeNull();
    expect(location("/speech-demo")).toBeNull();
  });
});
