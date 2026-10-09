import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The frontend's own Entra ID login (lib/auth, app/auth). openid-client is
 * mocked at its boundary; everything above it — state/nonce/PKCE handling,
 * the session store, cookies, refresh — is real.
 */
const oidc = vi.hoisted(() => ({
  discovery: vi.fn(async () => ({ fake: "configuration" })),
  randomPKCECodeVerifier: vi.fn(() => "verifier-1"),
  calculatePKCECodeChallenge: vi.fn(async () => "challenge-1"),
  randomState: vi.fn(() => "state-1"),
  randomNonce: vi.fn(() => "nonce-1"),
  buildAuthorizationUrl: vi.fn(
    (_c: unknown, params: Record<string, string>) =>
      new URL(`https://login.example/authorize?${new URLSearchParams(params)}`)
  ),
  authorizationCodeGrant: vi.fn(),
  refreshTokenGrant: vi.fn(),
  buildEndSessionUrl: vi.fn(
    (_c: unknown, _params?: Record<string, string>) =>
      new URL("https://login.example/logout")
  ),
  allowInsecureRequests: vi.fn(),
}));
vi.mock("openid-client", () => oidc);

const APP = "https://transcribe.example";

function tokens(
  idToken: string,
  expSecondsFromNow = 3600,
  refresh = "refresh-1"
) {
  return {
    id_token: idToken,
    refresh_token: refresh,
    claims: () => ({
      oid: "oid-1",
      name: "Judge Real",
      preferred_username: "judge.real@justice.gov.uk",
      roles: ["Judge"],
      exp: Math.floor(Date.now() / 1000) + expSecondsFromNow,
    }),
  };
}

function req(path: string, cookies: Record<string, string> = {}) {
  const cookie = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  return new NextRequest(`http://127.0.0.1:3001${path}`, {
    headers: cookie ? { cookie } : {},
  });
}

beforeEach(async () => {
  vi.stubEnv("AUTH_ENABLED", "true");
  vi.stubEnv("APP_URL", APP);
  vi.stubEnv("AZURE_AD_TENANT_ID", "tenant-1");
  vi.stubEnv("AZURE_AD_CLIENT_ID", "client-1");
  vi.stubEnv("AZURE_AD_CLIENT_SECRET", "secret-1");
  const store = await import("@/lib/auth/session-store");
  store.__resetStoreForTests();
  (await import("@/lib/auth/oidc")).__resetOidcForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("safeReturnTo", () => {
  it("allows only same-site relative paths", async () => {
    const { safeReturnTo } = await import("@/lib/auth/session");
    expect(safeReturnTo("/recording/jobs/1?x=1")).toBe("/recording/jobs/1?x=1");
    for (const bad of [
      "https://evil.example/",
      "//evil.example/",
      "/\\evil.example",
      "javascript:alert(1)",
      "",
      null,
      "/auth/logout",
    ]) {
      expect(safeReturnTo(bad), String(bad)).toBe("/");
    }
  });
});

describe("GET /auth/login", () => {
  it("redirects to Entra with PKCE, state and nonce, and binds the state to this browser", async () => {
    const { GET } = await import("@/app/auth/login/route");
    const res = await GET(req("/auth/login?returnTo=%2Frecording"));

    const location = new URL(res.headers.get("location") ?? "");
    expect(location.origin).toBe("https://login.example");
    expect(location.searchParams.get("redirect_uri")).toBe(
      `${APP}/auth/callback`
    );
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("state")).toBe("state-1");
    expect(location.searchParams.get("nonce")).toBe("nonce-1");
    expect(res.cookies.get("transcribe_login_state")?.value).toBe("state-1");
    expect(res.cookies.get("transcribe_login_state")?.httpOnly).toBe(true);
  });

  it("goes straight to the return path when login is disabled", async () => {
    vi.stubEnv("AUTH_ENABLED", "false");
    const { GET } = await import("@/app/auth/login/route");
    const res = await GET(req("/auth/login?returnTo=%2Frecording"));
    expect(res.headers.get("location")).toBe(`${APP}/recording`);
    expect(oidc.discovery).not.toHaveBeenCalled();
  });

  it("refuses to start when a required setting is missing", async () => {
    vi.stubEnv("AZURE_AD_CLIENT_SECRET", "");
    const { GET } = await import("@/app/auth/login/route");
    await expect(GET(req("/auth/login"))).rejects.toThrow(
      /AZURE_AD_CLIENT_SECRET/
    );
  });
});

describe("GET /auth/callback", () => {
  async function startLogin() {
    const { GET } = await import("@/app/auth/login/route");
    await GET(req("/auth/login?returnTo=%2Frecording%2Fjobs%2F9"));
  }

  it("creates a session, sets the cookie and returns to where the user was going", async () => {
    await startLogin();
    oidc.authorizationCodeGrant.mockResolvedValue(tokens("id-token-1"));
    const { GET } = await import("@/app/auth/callback/route");

    const res = await GET(
      req("/auth/callback?code=abc&state=state-1", {
        transcribe_login_state: "state-1",
      })
    );

    expect(res.headers.get("location")).toBe(`${APP}/recording/jobs/9`);
    const sessionId = res.cookies.get("transcribe_session")?.value ?? "";
    expect(sessionId.length).toBeGreaterThan(30);
    // The code exchange is told the PUBLIC callback URL, not the internal one.
    const currentUrl = oidc.authorizationCodeGrant.mock.calls[0][1] as URL;
    expect(currentUrl.toString()).toBe(
      `${APP}/auth/callback?code=abc&state=state-1`
    );
    expect(oidc.authorizationCodeGrant.mock.calls[0][2]).toMatchObject({
      pkceCodeVerifier: "verifier-1",
      expectedState: "state-1",
      expectedNonce: "nonce-1",
    });
    const { bearerForSession } = await import("@/lib/auth/session");
    await expect(bearerForSession(sessionId)).resolves.toBe("id-token-1");
  });

  it("rejects a callback whose state is not bound to this browser (login CSRF)", async () => {
    await startLogin();
    const { GET } = await import("@/app/auth/callback/route");
    const res = await GET(req("/auth/callback?code=abc&state=state-1"));
    expect(res.status).toBe(400);
    expect(oidc.authorizationCodeGrant).not.toHaveBeenCalled();
  });

  it("rejects a replayed callback (pending login is single use)", async () => {
    await startLogin();
    oidc.authorizationCodeGrant.mockResolvedValue(tokens("id-token-1"));
    const { GET } = await import("@/app/auth/callback/route");
    const cb = () =>
      GET(
        req("/auth/callback?code=abc&state=state-1", {
          transcribe_login_state: "state-1",
        })
      );
    expect((await cb()).status).toBe(307);
    expect((await cb()).status).toBe(400);
  });

  it("issues a fresh session id and discards a pre-existing one (fixation)", async () => {
    const store = await import("@/lib/auth/session-store");
    await store.writeSession("planted", {
      idToken: "old",
      idTokenExpiresAt: Date.now() + 3600_000,
      user: { oid: "x", name: "", email: "", roles: [] },
      createdAt: Date.now(),
    });
    await startLogin();
    oidc.authorizationCodeGrant.mockResolvedValue(tokens("id-token-1"));
    const { GET } = await import("@/app/auth/callback/route");
    const res = await GET(
      req("/auth/callback?code=abc&state=state-1", {
        transcribe_login_state: "state-1",
        transcribe_session: "planted",
      })
    );
    expect(res.cookies.get("transcribe_session")?.value).not.toBe("planted");
    await expect(store.readSession("planted")).resolves.toBeNull();
  });

  it("does not create a session when the identity provider returns an error", async () => {
    const { GET } = await import("@/app/auth/callback/route");
    const res = await GET(
      req("/auth/callback?error=access_denied&state=state-1")
    );
    expect(res.status).toBe(401);
    expect(res.cookies.get("transcribe_session")).toBeUndefined();
  });
});

describe("GET /auth/forward (Caddy forward_auth)", () => {
  async function session(
    idToken: string,
    expSecondsFromNow: number,
    refreshToken?: string
  ) {
    const store = await import("@/lib/auth/session-store");
    await store.writeSession("sess-1", {
      idToken,
      refreshToken,
      idTokenExpiresAt: Date.now() + expSecondsFromNow * 1000,
      user: { oid: "oid-1", name: "", email: "", roles: [] },
      createdAt: Date.now(),
    });
  }

  it("returns the session's bearer token", async () => {
    await session("id-token-1", 3600);
    const { GET } = await import("@/app/auth/forward/route");
    const res = await GET(
      req("/auth/forward", { transcribe_session: "sess-1" })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("authorization")).toBe("Bearer id-token-1");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("is 401 without a session", async () => {
    const { GET } = await import("@/app/auth/forward/route");
    const res = await GET(req("/auth/forward"));
    expect(res.status).toBe(401);
    expect(res.headers.get("authorization")).toBeNull();
  });

  it("refreshes a token that is about to expire", async () => {
    await session("old-token", 60, "refresh-1");
    oidc.refreshTokenGrant.mockResolvedValue(
      tokens("new-token", 3600, "refresh-2")
    );
    const { GET } = await import("@/app/auth/forward/route");
    const res = await GET(
      req("/auth/forward", { transcribe_session: "sess-1" })
    );
    expect(res.headers.get("authorization")).toBe("Bearer new-token");
    expect(oidc.refreshTokenGrant.mock.calls[0][1]).toBe("refresh-1");
  });

  it("ends the session when the refresh fails", async () => {
    await session("old-token", 60, "refresh-1");
    oidc.refreshTokenGrant.mockRejectedValue(new Error("invalid_grant"));
    const { GET } = await import("@/app/auth/forward/route");
    const res = await GET(
      req("/auth/forward", { transcribe_session: "sess-1" })
    );
    expect(res.status).toBe(401);
    const store = await import("@/lib/auth/session-store");
    await expect(store.readSession("sess-1")).resolves.toBeNull();
  });

  it("adds no token when login is disabled", async () => {
    vi.stubEnv("AUTH_ENABLED", "false");
    const { GET } = await import("@/app/auth/forward/route");
    const res = await GET(req("/auth/forward"));
    expect(res.status).toBe(200);
    expect(res.headers.get("authorization")).toBeNull();
  });
});

describe("session lifetime", () => {
  it("is absolute from sign-in, not extended by activity", async () => {
    vi.stubEnv("SESSION_TTL_SECONDS", "60");
    const store = await import("@/lib/auth/session-store");
    await store.writeSession("old", {
      idToken: "t",
      idTokenExpiresAt: Date.now() + 3600_000,
      user: { oid: "x", name: "", email: "", roles: [] },
      createdAt: Date.now() - 120_000, // signed in two minutes ago
    });
    await expect(store.readSession("old")).resolves.toBeNull();
  });
});

describe("GET /auth/logout", () => {
  it("deletes the session, clears the cookie and ends the Entra session", async () => {
    const store = await import("@/lib/auth/session-store");
    await store.writeSession("sess-1", {
      idToken: "id-token-1",
      idTokenExpiresAt: Date.now() + 3600_000,
      user: { oid: "x", name: "", email: "", roles: [] },
      createdAt: Date.now(),
    });
    const { GET } = await import("@/app/auth/logout/route");
    const res = await GET(
      req("/auth/logout", { transcribe_session: "sess-1" })
    );
    expect(res.headers.get("location")).toBe("https://login.example/logout");
    expect(res.cookies.get("transcribe_session")?.value).toBe("");
    await expect(store.readSession("sess-1")).resolves.toBeNull();
    expect(oidc.buildEndSessionUrl.mock.calls[0][1]).toMatchObject({
      post_logout_redirect_uri: APP,
      id_token_hint: "id-token-1",
    });
  });
});
