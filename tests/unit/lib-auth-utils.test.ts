import { afterEach, describe, expect, it, vi } from "vitest";
import { getAuthToken, loginUrl } from "@/lib/auth-utils";

/**
 * On CNP the browser never holds an access token: the frontend server keeps
 * tokens in a server-side session and Caddy attaches the bearer token to API
 * calls. These helpers replace the App Service Easy Auth /.auth/me handling.
 */
describe("lib/auth-utils", () => {
  afterEach(() => vi.restoreAllMocks());

  it("getAuthToken never returns a token and never calls Easy Auth", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(getAuthToken()).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("loginUrl returns to the given path", () => {
    expect(loginUrl("/recording/jobs/1?x=2")).toBe(
      "/auth/login?returnTo=%2Frecording%2Fjobs%2F1%3Fx%3D2"
    );
  });

  it("loginUrl defaults to the current page", () => {
    window.history.pushState({}, "", "/record?draft=7");
    expect(loginUrl()).toBe("/auth/login?returnTo=%2Frecord%3Fdraft%3D7");
  });
});
