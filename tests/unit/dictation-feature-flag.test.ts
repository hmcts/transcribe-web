import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isDictationEnabled } from "@/lib/environment";
import {
  FLAG_TTL_MS,
  isDictationEnabledAtRuntime,
  resetProxyFlagCache,
} from "@/lib/flags/proxy-flags";
import { proxy } from "@/proxy";

const FLAG = "NEXT_PUBLIC_DICTATION_ENABLED";

async function location(path: string, cookie?: string): Promise<string | null> {
  const headers = cookie ? { cookie } : undefined;
  const response = await proxy(
    new NextRequest(`https://transcribe.example${path}`, { headers })
  );
  return response.headers.get("location");
}

/** `fetch` as the proxy's own call to /auth/runtime-flags sees it. */
function runtimeFlag(answer: unknown, status = 200) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(answer), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("isDictationEnabled, the deploy-time default (DIAAT-366)", () => {
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

describe("proxy Dictation gate (DIAAT-366, DIAAT-392)", () => {
  beforeEach(() => resetProxyFlagCache());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe("when the runtime flag cannot be read, the deploy-time value decides", () => {
    beforeEach(() => {
      vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("down"))));
    });

    describe("and Dictation is off", () => {
      it.each([
        "/decisions",
        "/record",
        "/record?mode=mic",
        "/record/anything",
        "/upload", // the dictation upload: the API refuses it too with dictation off (403 dictation_disabled)
        "/speech-demo",
      ])("redirects %s to the home page", async (path) => {
        vi.stubEnv(FLAG, "false");
        expect(await location(path)).toBe("https://transcribe.example/");
      });

      it.each([
        "/",
        "/recording",
        "/recording/jobs/abc",
        "/help",
      ])("leaves %s alone", async (path) => {
        vi.stubEnv(FLAG, "false");
        expect(await location(path)).toBeNull();
      });

      it("still sends a signed-out user to the login first", async () => {
        vi.stubEnv(FLAG, "false");
        vi.stubEnv("AUTH_ENABLED", "true");
        expect(await location("/record")).toContain("/auth/login");
      });
    });

    it.each([
      ["on", "true"],
      ["unset", undefined],
    ])("serves /record and /speech-demo when the env value is %s", async (_, value) => {
      vi.stubEnv(FLAG, value);
      expect(await location("/record?mode=mic")).toBeNull();
      resetProxyFlagCache();
      expect(await location("/speech-demo")).toBeNull();
    });

    it.each([
      ["a refusal", () => runtimeFlag({ detail: "no" }, 401)],
      ["a server error", () => runtimeFlag({}, 502)],
      ["a body that is not the flags", () => runtimeFlag({ dictation_enabled: "yes" })],
      ["no body", () => runtimeFlag(null)],
    ])("falls back to the env value on %s", async (_, answer) => {
      answer();
      vi.stubEnv(FLAG, "false");
      expect(await location("/record")).toBe("https://transcribe.example/");
      resetProxyFlagCache();
      answer();
      vi.stubEnv(FLAG, "true");
      expect(await location("/record")).toBeNull();
    });
  });

  describe("when the runtime flag is read, it wins over the env value", () => {
    it("sends dictation pages home when the flag is off, though the env says on", async () => {
      vi.stubEnv(FLAG, "true");
      runtimeFlag({ dictation_enabled: false });
      expect(await location("/record")).toBe("https://transcribe.example/");
      expect(await location("/upload")).toBe("https://transcribe.example/");
      expect(await location("/speech-demo")).toBe("https://transcribe.example/");
    });

    it("serves dictation pages when the flag is on, though the env says off", async () => {
      vi.stubEnv(FLAG, "false");
      runtimeFlag({ dictation_enabled: true });
      expect(await location("/record")).toBeNull();
    });

    it("passes the session cookie on, to this app's own flags route", async () => {
      vi.stubEnv("PORT", "3001");
      const fetchMock = runtimeFlag({ dictation_enabled: true });
      await location("/record", "transcribe_session=opaque");
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("http://127.0.0.1:3001/auth/runtime-flags");
      expect(init.headers).toEqual({ cookie: "transcribe_session=opaque" });
    });

    it("reads the flag only for the pages it guards, and keeps the answer briefly", async () => {
      const fetchMock = runtimeFlag({ dictation_enabled: true });
      await location("/");
      await location("/recording");
      await location("/admin");
      expect(fetchMock).not.toHaveBeenCalled();
      await location("/record");
      await location("/speech-demo");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each([401, 403])(
      "does not keep one browser's refused session (%s) for everyone else: the next user's read is made",
      async (status) => {
        vi.stubEnv(FLAG, "true");
        let answer: Response = new Response("{}", { status });
        const fetchImpl = vi.fn(async () => answer);
        const deps = { fetchImpl: fetchImpl as unknown as typeof fetch, now: () => 1_000_000 };

        // An expired session fills the shared cache first: the env value stands for that request ...
        expect(await isDictationEnabledAtRuntime("transcribe_session=expired", deps)).toBe(true);
        // ... but a valid user straight after gets their own read, and the runtime flag wins.
        answer = new Response(JSON.stringify({ dictation_enabled: false }));
        expect(await isDictationEnabledAtRuntime("transcribe_session=valid", deps)).toBe(false);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
      }
    );

    it("reads it again once the answer has expired, so a change applies without a redeploy", async () => {
      vi.stubEnv(FLAG, "true");
      let now = 1_000_000;
      let enabled = true;
      const fetchImpl = vi.fn(
        async () => new Response(JSON.stringify({ dictation_enabled: enabled }))
      );
      const deps = { fetchImpl: fetchImpl as unknown as typeof fetch, now: () => now };
      expect(await isDictationEnabledAtRuntime(null, deps)).toBe(true);
      enabled = false;
      expect(await isDictationEnabledAtRuntime(null, deps)).toBe(true);
      now += FLAG_TTL_MS + 1;
      expect(await isDictationEnabledAtRuntime(null, deps)).toBe(false);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });
  });
});
