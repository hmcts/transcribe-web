import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Static mock — same vi.fn() instance used by both the test and auth-utils.ts
vi.mock("jwt-decode", () => ({
  jwtDecode: vi.fn(),
}));

import { jwtDecode } from "jwt-decode";
import { getAuthToken } from "@/lib/auth-utils";

const mockFetch = vi.fn();

/**
 * Force the module-level tokenCache back to { token: null, expires: 0 }.
 *
 * Strategy:
 * 1. Advance fake system time 24 hours so the cache-check `now < expires` fails.
 * 2. Use a non-local hostname so getAuthToken() actually tries to fetch.
 * 3. Make the fetch fail so the function hits the cache-clearing code at line 186.
 */
async function clearTokenCache() {
  vi.useFakeTimers();
  vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000); // 24h in future
  vi.stubGlobal("location", { hostname: "prod.example.com" });
  global.fetch = vi.fn().mockRejectedValue(new Error("clear-cache"));
  await getAuthToken(); // cache miss → fetch fails → tokenCache = { token: null, expires: 0 }
  vi.useRealTimers();
}

/** Build a minimal successful fetch response for /.auth/me */
function authMeResponse(idToken: string) {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue([{ id_token: idToken }]),
  };
}

/** A successful /.auth/refresh response */
const refreshOk = { ok: true, json: vi.fn().mockResolvedValue({}) };

beforeEach(async () => {
  vi.mocked(jwtDecode).mockReset();
  await clearTokenCache();
  vi.unstubAllGlobals(); // restore window.location to jsdom default
  global.fetch = mockFetch;
  mockFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getAuthToken", () => {
  // ── successful token fetch ─────────────────────────────────────────────────

  it("fetches from /.auth/me and returns a valid token", async () => {
    vi.stubGlobal("location", { hostname: "prod.example.com" });
    const futureExp = Math.floor(Date.now() / 1000) + 3600; // 1 hour away
    vi.mocked(jwtDecode).mockReturnValue({ exp: futureExp });
    mockFetch.mockResolvedValue(authMeResponse("valid-token"));

    const result = await getAuthToken();

    expect(result).toBe("valid-token");
    expect(mockFetch).toHaveBeenCalledWith(
      "/.auth/me",
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("caches the token and skips the network on a second call", async () => {
    vi.stubGlobal("location", { hostname: "prod.example.com" });
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    vi.mocked(jwtDecode).mockReturnValue({ exp: futureExp });
    mockFetch.mockResolvedValue(authMeResponse("cached-token"));

    // First call populates the cache
    await getAuthToken();
    mockFetch.mockReset();

    // Second call should use the cache
    const result = await getAuthToken();

    expect(result).toBe("cached-token");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ── token expiring soon → refresh ─────────────────────────────────────────

  it("refreshes when the token is expiring within 10 minutes", async () => {
    vi.stubGlobal("location", { hostname: "prod.example.com" });
    const expiringExp = Math.floor(Date.now() / 1000) + 300; // 5 min – within buffer
    const freshExp = Math.floor(Date.now() / 1000) + 3600;

    // First jwtDecode call (expiring token), second (fresh token after refresh)
    vi.mocked(jwtDecode)
      .mockReturnValueOnce({ exp: expiringExp })
      .mockReturnValue({ exp: freshExp });

    mockFetch
      .mockResolvedValueOnce(authMeResponse("expiring-token")) // initial /.auth/me
      .mockResolvedValueOnce(refreshOk) // /.auth/refresh
      .mockResolvedValueOnce(authMeResponse("refreshed-token")); // second /.auth/me

    const result = await getAuthToken();

    expect(result).toBe("refreshed-token");
    expect(mockFetch).toHaveBeenCalledWith(
      "/.auth/refresh",
      expect.any(Object)
    );
  });

  it("returns null when the refresh endpoint returns an error", async () => {
    vi.stubGlobal("location", { hostname: "prod.example.com" });
    const expiringExp = Math.floor(Date.now() / 1000) + 300;
    vi.mocked(jwtDecode).mockReturnValue({ exp: expiringExp });

    mockFetch
      .mockResolvedValueOnce(authMeResponse("expiring-token"))
      .mockResolvedValueOnce({ ok: false, status: 401 }); // /.auth/refresh fails

    const result = await getAuthToken();

    expect(result).toBeNull();
  });

  // ── /.auth/me returns no token ─────────────────────────────────────────────

  it("returns null when the auth response array is empty", async () => {
    vi.stubGlobal("location", { hostname: "prod.example.com" });
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue([]),
    });

    const result = await getAuthToken();

    expect(result).toBeNull();
  });

  it("returns null when the provider has no id_token", async () => {
    vi.stubGlobal("location", { hostname: "prod.example.com" });
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue([{ access_token: "no-id-token" }]),
    });

    const result = await getAuthToken();

    expect(result).toBeNull();
  });

  // ── fetch error → recovery path ───────────────────────────────────────────

  it("attempts a recovery refresh when the initial fetch throws", async () => {
    vi.stubGlobal("location", { hostname: "prod.example.com" });
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    vi.mocked(jwtDecode).mockReturnValue({ exp: futureExp });

    mockFetch
      .mockRejectedValueOnce(new Error("Network error")) // initial /.auth/me fails
      .mockResolvedValueOnce(refreshOk) // /.auth/refresh succeeds
      .mockResolvedValueOnce(authMeResponse("recovery-token")); // second /.auth/me

    const result = await getAuthToken();

    expect(result).toBe("recovery-token");
  });

  it("returns null when both the initial fetch and recovery refresh fail", async () => {
    vi.stubGlobal("location", { hostname: "prod.example.com" });
    mockFetch.mockRejectedValue(new Error("Offline"));

    const result = await getAuthToken();

    expect(result).toBeNull();
  });

  it("returns null when /.auth/me is not ok", async () => {
    vi.stubGlobal("location", { hostname: "prod.example.com" });
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 401 }) // /.auth/me fails
      .mockResolvedValueOnce({ ok: false, status: 401 }); // /.auth/refresh also fails

    const result = await getAuthToken();

    expect(result).toBeNull();
  });
});
