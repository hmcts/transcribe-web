import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isPublicPath, proxy } from "@/proxy";

/**
 * The login gate in proxy.ts. On CNP there is no App Service Easy Auth in
 * front of the app, so this is the only gate, and it covers every page — as
 * Easy Auth did in production, whose excluded_paths were only static assets,
 * the Speech proxy paths and /health. (/cookies, /privacy and /help were never
 * public there either.)
 */
function request(
  path: string,
  opts?: { session?: boolean; cookie?: [string, string] }
) {
  const req = new NextRequest(`https://transcribe.example${path}`);
  if (opts?.session) req.cookies.set("transcribe_session", "opaque-id");
  if (opts?.cookie) req.cookies.set(...opts.cookie);
  return req;
}

describe("proxy login gate", () => {
  afterEach(() => vi.unstubAllEnvs());

  describe("when login is enabled (AUTH_ENABLED=true)", () => {
    it("sends a page request without a session to /auth/login, keeping where it was going", async () => {
      vi.stubEnv("AUTH_ENABLED", "true");
      const res = await proxy(request("/recording/jobs/abc?tab=2"));
      const location = new URL(res.headers.get("location") ?? "");
      expect(location.pathname).toBe("/auth/login");
      expect(location.searchParams.get("returnTo")).toBe(
        "/recording/jobs/abc?tab=2"
      );
    });

    it("lets a request with a session through", async () => {
      vi.stubEnv("AUTH_ENABLED", "true");
      expect(
        (await proxy(request("/recording", { session: true }))).headers.get(
          "location"
        )
      ).toBeNull();
    });

    it("gates every page, including the dictation home and information pages", async () => {
      vi.stubEnv("AUTH_ENABLED", "true");
      for (const path of [
        "/",
        "/record",
        "/admin",
        "/cookies",
        "/privacy",
        "/help",
      ]) {
        expect(
          (await proxy(request(path))).headers.get("location"),
          path
        ).toContain("/auth/login");
      }
    });

    it("answers the recording area's own /api/* routes with 401, not a redirect", async () => {
      vi.stubEnv("AUTH_ENABLED", "true");
      const res = await proxy(request("/api/jobs"));
      expect(res.status).toBe(401);
      expect(res.headers.get("location")).toBeNull();
    });

    it("does not accept an old Easy Auth cookie as a session", async () => {
      vi.stubEnv("AUTH_ENABLED", "true");
      const res = await proxy(
        request("/recording", { cookie: ["AppServiceAuthSession", "x"] })
      );
      expect(res.headers.get("location")).toContain("/auth/login");
    });

    it("leaves the login routes, health and static assets open", async () => {
      vi.stubEnv("AUTH_ENABLED", "true");
      for (const path of [
        "/auth/login",
        "/auth/callback",
        "/auth/logout",
        "/health",
        "/manifest.json",
        "/favicon.ico",
        "/env-config.js",
        "/images/crest.png",
      ]) {
        expect(
          (await proxy(request(path))).headers.get("location"),
          path
        ).toBeNull();
      }
    });
  });

  describe("when login is disabled (local development, preview)", () => {
    it("gates nothing", async () => {
      vi.stubEnv("AUTH_ENABLED", "false");
      for (const path of ["/", "/recording/jobs/abc", "/admin"]) {
        expect(
          (await proxy(request(path))).headers.get("location"),
          path
        ).toBeNull();
      }
    });
  });

  describe("isPublicPath", () => {
    it("does not treat a page that merely contains 'auth' as public", () => {
      expect(isPublicPath("/author")).toBe(false);
      expect(isPublicPath("/admin/auth-settings")).toBe(false);
    });
  });
});

describe("the proxy matcher", () => {
  it("skips the two upload routes, which stream large bodies and must not be buffered by Next.js", async () => {
    const { config } = await import("@/proxy");
    const [{ source }] = config.matcher as { source: string }[];
    const runsOn = (path: string) => new RegExp(`^${source}$`).test(path);

    expect(runsOn("/api/upload")).toBe(false);
    expect(runsOn("/api/upload-audio")).toBe(false);
    // Anything else, including a path that only starts like them, still goes through the proxy.
    expect(runsOn("/api/upload-audio/extra")).toBe(true);
    expect(runsOn("/api/uploads")).toBe(true);
    expect(runsOn("/api/jobs")).toBe(true);
    expect(runsOn("/admin")).toBe(true);
  });
});
