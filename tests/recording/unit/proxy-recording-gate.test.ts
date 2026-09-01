import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "@/proxy";

/**
 * MERGE NOTE: replaces the recording frontend's middleware.test.ts.
 *
 * Recording had its own middleware.ts gating every route on EASY_AUTH_ENABLED.
 * Next.js 16's proxy.ts supersedes middleware.ts, so the merged app has one edge
 * handler and gates the /recording and /admin areas explicitly instead of
 * everything — otherwise dictation's public pages would have started demanding
 * a login. These tests cover that merged behaviour.
 */
function request(path: string, opts?: { cookie?: boolean }) {
  const req = new NextRequest(`https://frontend.example${path}`);
  if (opts?.cookie) req.cookies.set("AppServiceAuthSession", "token");
  return req;
}

describe("merged proxy auth gate", () => {
  afterEach(() => vi.unstubAllEnvs());

  describe("when Easy Auth is enforced (EASY_AUTH_ENABLED=true — stg/prod)", () => {
    it("redirects unauthenticated recording requests to the Easy Auth login endpoint", () => {
      vi.stubEnv("EASY_AUTH_ENABLED", "true");
      const res = proxy(request("/recording/jobs/abc"));
      const location = res.headers.get("location");
      expect(location).toContain("/.auth/login/aad");
      expect(location).toContain("post_login_redirect_uri=%2Frecording%2Fjobs%2Fabc");
    });

    it("allows authenticated recording requests", () => {
      vi.stubEnv("EASY_AUTH_ENABLED", "true");
      const res = proxy(request("/recording", { cookie: true }));
      expect(res.headers.get("location")).toBeNull();
    });

    it("leaves dictation's public pages open — the reason the blanket gate was dropped", () => {
      vi.stubEnv("EASY_AUTH_ENABLED", "true");
      for (const path of ["/", "/cookies", "/privacy", "/help"]) {
        expect(proxy(request(path)).headers.get("location")).toBeNull();
      }
    });
  });

  describe("when Easy Auth is not enforced (EASY_AUTH_ENABLED=false — dev)", () => {
    it("leaves the recording area open so e2e and manual checks work", () => {
      vi.stubEnv("EASY_AUTH_ENABLED", "false");
      const res = proxy(request("/recording/jobs/abc"));
      expect(res.headers.get("location")).toBeNull();
    });
  });
});
