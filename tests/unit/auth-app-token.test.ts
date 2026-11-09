import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * DIAAT-373: the web keeps the BenchNotes token (minted by the API from the
 * Entra ID token) in the server-side session, sends it instead of the Entra
 * token, mints again near expiry keeping the chosen context, and never gives it
 * to the browser. The API is a stub here; the session store is real.
 */
const oidc = vi.hoisted(() => ({
  discovery: vi.fn(async () => ({ fake: "configuration" })),
  refreshTokenGrant: vi.fn(),
  authorizationCodeGrant: vi.fn(),
  randomPKCECodeVerifier: vi.fn(() => "verifier-1"),
  calculatePKCECodeChallenge: vi.fn(async () => "challenge-1"),
  randomState: vi.fn(() => "state-1"),
  randomNonce: vi.fn(() => "nonce-1"),
  buildAuthorizationUrl: vi.fn(() => new URL("https://login.example/authorize")),
  buildEndSessionUrl: vi.fn(() => new URL("https://login.example/logout")),
  allowInsecureRequests: vi.fn(),
}));
vi.mock("openid-client", () => oidc);

const API = "http://api.internal";
const api = vi.fn();

type Pair = { jurisdiction: { code: string; name: string } | null; role: string };
const ET: Pair = { jurisdiction: { code: "ET", name: "Employment Tribunal" }, role: "Judge" };

function me(active: Pair | null, status = active ? "ready" : "choose") {
  return {
    user: { id: "u-1", email: "a@localhost.test", name: "A" },
    status,
    assignments: active ? [active] : [],
    active,
    permissions: ["app.access"],
    pending_requests: [],
  };
}

/** What the API's mint, context and leave endpoints answer with. */
function tokenBody(token: string, active: Pair | null, ttlSeconds = 300) {
  return {
    token,
    expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    me: me(active),
  };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function req(path: string, cookies: Record<string, string> = {}, init: { method?: string; body?: string; headers?: Record<string, string> } = {}) {
  const cookie = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  return new NextRequest(`http://127.0.0.1:3001${path}`, {
    ...init,
    headers: { ...(cookie ? { cookie } : {}), ...init.headers },
  });
}

async function seed(over: Record<string, unknown> = {}, id = "sess-1") {
  const store = await import("@/lib/auth/session-store");
  await store.writeSession(id, {
    idToken: "entra-id-token",
    refreshToken: "refresh-1",
    idTokenExpiresAt: Date.now() + 3600_000,
    user: { oid: "oid-1", name: "A", email: "a@localhost.test", roles: [] },
    createdAt: Date.now(),
    appToken: "app-token-1",
    appTokenExpiresAt: Date.now() + 300_000,
    context: { jurisdiction: "ET", role: "Judge" },
    ...over,
  } as never);
}

async function stored(id = "sess-1") {
  return (await import("@/lib/auth/session-store")).readSession(id);
}

const headersOf = (call: unknown[]) => new Headers((call[1] as RequestInit).headers);

beforeEach(async () => {
  api.mockReset();
  vi.stubGlobal("fetch", api);
  vi.stubEnv("BACKEND_INTERNAL_URL", API);
  vi.stubEnv("AUTH_ENABLED", "true");
  vi.stubEnv("APP_URL", "https://transcribe.example");
  vi.stubEnv("AZURE_AD_TENANT_ID", "tenant-1");
  vi.stubEnv("AZURE_AD_CLIENT_ID", "client-1");
  vi.stubEnv("AZURE_AD_CLIENT_SECRET", "secret-1");
  (await import("@/lib/auth/session-store")).__resetStoreForTests();
  (await import("@/lib/auth/oidc")).__resetOidcForTests();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("what the API is sent", () => {
  it("is the BenchNotes token, never the Entra token", async () => {
    await seed();
    const { GET } = await import("@/app/auth/forward/route");
    const res = await GET(req("/auth/forward", { transcribe_session: "sess-1" }));

    expect(res.headers.get("authorization")).toBe("Bearer app-token-1");
    expect(res.headers.get("authorization")).not.toContain("entra-id-token");
    expect(api).not.toHaveBeenCalled(); // plenty of life left: no mint
  });

  it("is the same for the recording route handlers", async () => {
    await seed();
    const { getBackendAuthContext } = await import("@/lib/recording/auth-utils");
    const ctx = await getBackendAuthContext({
      headers: new Headers({
        cookie: "transcribe_session=sess-1",
        "X-Jurisdiction": "ET",
        "X-Role": "Judge",
      }),
    });

    expect(ctx).toEqual({ bearerToken: "app-token-1", jurisdiction: "ET", role: "Judge" });
  });
});

describe("minting at sign-in", () => {
  async function callback() {
    const { GET: login } = await import("@/app/auth/login/route");
    await login(req("/auth/login"));
    oidc.authorizationCodeGrant.mockResolvedValue({
      id_token: "entra-id-token",
      refresh_token: "r",
      claims: () => ({
        oid: "oid-1",
        name: "A",
        email: "a@localhost.test",
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    });
    const { GET } = await import("@/app/auth/callback/route");
    return GET(
      req("/auth/callback?code=abc&state=state-1", { transcribe_login_state: "state-1" })
    );
  }

  it("sends the Entra ID token to the API and keeps what it returns in the session", async () => {
    api.mockResolvedValue(json(tokenBody("app-token-9", null)));
    const res = await callback();

    expect(res.status).toBe(307);
    expect(api.mock.calls[0][0]).toBe(`${API}/api/auth/session`);
    expect((api.mock.calls[0][1] as RequestInit).method).toBe("POST");
    expect(headersOf(api.mock.calls[0]).get("authorization")).toBe("Bearer entra-id-token");
    expect(headersOf(api.mock.calls[0]).get("x-requested-context")).toBeNull();
    const session = await stored(res.cookies.get("transcribe_session")?.value);
    expect(session?.appToken).toBe("app-token-9");
    expect(session?.context).toBeNull();
    // Nothing of it in what goes back to the browser.
    expect(res.headers.get("location")).not.toContain("app-token-9");
  });

  it("creates no session when the API refuses the sign-in", async () => {
    api.mockResolvedValue(json({ detail: { code: "user_deactivated" } }, 403));
    const res = await callback();

    expect(res.status).toBe(403);
    expect(res.cookies.get("transcribe_session")).toBeUndefined();
  });

  it("creates no session when the API cannot be reached, and says to try again", async () => {
    api.mockRejectedValue(new Error("connect ECONNREFUSED"));
    const res = await callback();

    expect(res.status).toBe(502);
    expect(res.cookies.get("transcribe_session")).toBeUndefined();
    expect(await res.text()).toMatch(/try again/i);
  });
});

describe("minting again near expiry", () => {
  it("does so within 60 seconds of expiry, keeping the chosen context", async () => {
    await seed({ appTokenExpiresAt: Date.now() + 30_000 });
    api.mockResolvedValue(json(tokenBody("app-token-2", ET)));
    const { bearerForSession } = await import("@/lib/auth/session");

    await expect(bearerForSession("sess-1")).resolves.toBe("app-token-2");

    const headers = headersOf(api.mock.calls[0]);
    expect(headers.get("authorization")).toBe("Bearer entra-id-token");
    expect(headers.get("x-requested-context")).toBe("ET:Judge");
    const session = await stored();
    expect(session?.appToken).toBe("app-token-2");
    expect(session?.appTokenExpiresAt).toBeGreaterThan(Date.now() + 200_000);
  });

  it("does not at 61 seconds", async () => {
    await seed({ appTokenExpiresAt: Date.now() + 61_000 });
    const { bearerForSession } = await import("@/lib/auth/session");

    await expect(bearerForSession("sess-1")).resolves.toBe("app-token-1");
    expect(api).not.toHaveBeenCalled();
  });

  it("names a global context with a dash", async () => {
    await seed({
      appTokenExpiresAt: Date.now() + 1_000,
      context: { jurisdiction: null, role: "JurisdictionSuperAdministrator" },
    });
    api.mockResolvedValue(
      json(tokenBody("app-token-2", { jurisdiction: null, role: "JurisdictionSuperAdministrator" }))
    );
    const { bearerForSession } = await import("@/lib/auth/session");
    await bearerForSession("sess-1");

    expect(headersOf(api.mock.calls[0]).get("x-requested-context")).toBe(
      "-:JurisdictionSuperAdministrator"
    );
  });

  it("sends no context when none was chosen", async () => {
    await seed({ appTokenExpiresAt: Date.now() + 1_000, context: null });
    api.mockResolvedValue(json(tokenBody("app-token-2", null)));
    const { bearerForSession } = await import("@/lib/auth/session");
    await bearerForSession("sess-1");

    expect(headersOf(api.mock.calls[0]).get("x-requested-context")).toBeNull();
  });

  it("remembers what the API says is active: no choice any more if the role was removed", async () => {
    await seed({ appTokenExpiresAt: Date.now() + 1_000 });
    api.mockResolvedValue(json(tokenBody("app-token-2", null)));
    const { bearerForSession } = await import("@/lib/auth/session");
    await bearerForSession("sess-1");

    expect((await stored())?.context).toBeNull();
  });

  it("uses the refreshed Entra token when both are due", async () => {
    await seed({
      idTokenExpiresAt: Date.now() + 30_000,
      appTokenExpiresAt: Date.now() + 30_000,
    });
    oidc.refreshTokenGrant.mockResolvedValue({
      id_token: "entra-id-token-2",
      refresh_token: "refresh-2",
      claims: () => ({ oid: "oid-1", name: "A", email: "a@localhost.test", exp: Math.floor(Date.now() / 1000) + 3600 }),
    });
    api.mockResolvedValue(json(tokenBody("app-token-2", ET)));
    const { bearerForSession } = await import("@/lib/auth/session");
    await bearerForSession("sess-1");

    expect(headersOf(api.mock.calls[0]).get("authorization")).toBe("Bearer entra-id-token-2");
  });

  it("mints once for concurrent requests of one session", async () => {
    await seed({ appTokenExpiresAt: Date.now() + 1_000 });
    api.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return json(tokenBody("app-token-2", ET));
    });
    const { bearerForSession } = await import("@/lib/auth/session");

    const tokens = await Promise.all([
      bearerForSession("sess-1"),
      bearerForSession("sess-1"),
      bearerForSession("sess-1"),
    ]);

    expect(tokens).toEqual(["app-token-2", "app-token-2", "app-token-2"]);
    expect(api).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403])("ends the session when the API answers %s, as for an ID token it refuses", async (status) => {
    await seed({ appTokenExpiresAt: Date.now() + 1_000 });
    api.mockResolvedValue(json({ detail: { code: "x" } }, status));
    const { GET } = await import("@/app/auth/forward/route");

    const res = await GET(req("/auth/forward", { transcribe_session: "sess-1" }));

    expect(res.status).toBe(401);
    expect(res.headers.get("authorization")).toBeNull();
    expect(await stored()).toBeNull();
  });

  it("keeps using a token that is still valid through a blip in the API", async () => {
    await seed({ appTokenExpiresAt: Date.now() + 30_000 });
    api.mockRejectedValue(new Error("connect ECONNREFUSED"));
    const { bearerForSession } = await import("@/lib/auth/session");

    await expect(bearerForSession("sess-1")).resolves.toBe("app-token-1");
    expect(await stored()).not.toBeNull();
  });

  it("sends nothing, and keeps the session to try again, once the token has expired", async () => {
    await seed({ appTokenExpiresAt: Date.now() - 1_000 });
    api.mockResolvedValue(json({ detail: "boom" }, 500));
    const { bearerForSession } = await import("@/lib/auth/session");

    await expect(bearerForSession("sess-1")).resolves.toBeNull();
    expect(await stored()).not.toBeNull();
  });

  it("mints for a session saved before there was a BenchNotes token", async () => {
    await seed({ appToken: undefined, appTokenExpiresAt: undefined, context: undefined });
    api.mockResolvedValue(json(tokenBody("app-token-2", null)));
    const { bearerForSession } = await import("@/lib/auth/session");

    await expect(bearerForSession("sess-1")).resolves.toBe("app-token-2");
  });
});

describe("POST /auth/context", () => {
  const post = (body: unknown, cookies: Record<string, string> = { transcribe_session: "sess-1" }) =>
    req("/auth/context", cookies, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });

  it("chooses the context with the API, keeps the new token in the session, and returns only me", async () => {
    await seed({ context: null });
    api.mockResolvedValue(json(tokenBody("app-token-ctx", ET)));
    const { POST } = await import("@/app/auth/context/route");

    const res = await POST(post({ jurisdiction: "ET", role: "Judge" }));

    expect(api.mock.calls[0][0]).toBe(`${API}/api/me/context`);
    expect((api.mock.calls[0][1] as RequestInit).method).toBe("PUT");
    expect(headersOf(api.mock.calls[0]).get("authorization")).toBe("Bearer app-token-1");
    expect(JSON.parse(String((api.mock.calls[0][1] as RequestInit).body))).toEqual({
      jurisdiction: "ET",
      role: "Judge",
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("app-token-ctx");
    expect(text).not.toContain("expires_at");
    expect(JSON.parse(text)).toEqual(me(ET));
    const session = await stored();
    expect(session?.appToken).toBe("app-token-ctx");
    expect(session?.context).toEqual({ jurisdiction: "ET", role: "Judge" });
  });

  it("chooses a global role, which has no jurisdiction", async () => {
    await seed({ context: null });
    const pair = { jurisdiction: null, role: "JurisdictionSuperAdministrator" };
    api.mockResolvedValue(json(tokenBody("app-token-ctx", pair)));
    const { POST } = await import("@/app/auth/context/route");

    await POST(post({ jurisdiction: null, role: "JurisdictionSuperAdministrator" }));

    expect(JSON.parse(String((api.mock.calls[0][1] as RequestInit).body))).toEqual({
      jurisdiction: null,
      role: "JurisdictionSuperAdministrator",
    });
    expect((await stored())?.context).toEqual({
      jurisdiction: null,
      role: "JurisdictionSuperAdministrator",
    });
  });

  it("passes the API's refusal on and changes nothing", async () => {
    await seed();
    api.mockResolvedValue(
      json({ detail: { code: "context_not_available", message: "Not yours" } }, 403)
    );
    const { POST } = await import("@/app/auth/context/route");

    const res = await POST(post({ jurisdiction: "IAC", role: "Judge" }));

    expect(res.status).toBe(403);
    expect((await res.json()).detail.code).toBe("context_not_available");
    const session = await stored();
    expect(session?.appToken).toBe("app-token-1");
    expect(session?.context).toEqual({ jurisdiction: "ET", role: "Judge" });
  });

  it("is 502 when the API cannot be reached", async () => {
    await seed();
    api.mockRejectedValue(new Error("down"));
    const { POST } = await import("@/app/auth/context/route");

    expect((await POST(post({ jurisdiction: "ET", role: "Judge" }))).status).toBe(502);
  });

  it("is 401 without a session, and calls nothing", async () => {
    const { POST } = await import("@/app/auth/context/route");

    expect((await POST(post({ jurisdiction: "ET", role: "Judge" }, {}))).status).toBe(401);
    expect(api).not.toHaveBeenCalled();
  });

  it.each([
    [{ role: "Judge" }],
    [{ jurisdiction: 5, role: "Judge" }],
    [{ jurisdiction: "ET" }],
    [{ jurisdiction: "ET", role: "" }],
    ["not an object"],
  ])("is 400 for a body of %j, and calls nothing", async (body) => {
    await seed();
    const { POST } = await import("@/app/auth/context/route");

    const res = await POST(post(body));

    expect(res.status).toBe(400);
    expect(api).not.toHaveBeenCalled();
  });
});

describe("DELETE /auth/jurisdictions/{code}", () => {
  it("leaves with the API, keeps the new token in the session, and returns only me", async () => {
    await seed();
    api.mockResolvedValue(json(tokenBody("app-token-left", null)));
    const { DELETE } = await import("@/app/auth/jurisdictions/[code]/route");

    const res = await DELETE(
      req("/auth/jurisdictions/ET", { transcribe_session: "sess-1" }, { method: "DELETE" }),
      { params: Promise.resolve({ code: "ET" }) }
    );

    expect(api.mock.calls[0][0]).toBe(`${API}/api/me/jurisdictions/ET`);
    expect((api.mock.calls[0][1] as RequestInit).method).toBe("DELETE");
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain("app-token-left");
    const session = await stored();
    expect(session?.appToken).toBe("app-token-left");
    expect(session?.context).toBeNull();
  });

  it("is 401 without a session", async () => {
    const { DELETE } = await import("@/app/auth/jurisdictions/[code]/route");
    const res = await DELETE(req("/auth/jurisdictions/ET", {}, { method: "DELETE" }), {
      params: Promise.resolve({ code: "ET" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /auth/session", () => {
  it("mints now, keeping the context, and returns only me", async () => {
    await seed(); // plenty of life left: a normal call would not mint
    api.mockResolvedValue(json(tokenBody("app-token-now", ET)));
    const { POST } = await import("@/app/auth/session/route");

    const res = await POST(req("/auth/session", { transcribe_session: "sess-1" }, { method: "POST" }));

    expect(headersOf(api.mock.calls[0]).get("authorization")).toBe("Bearer entra-id-token");
    expect(headersOf(api.mock.calls[0]).get("x-requested-context")).toBe("ET:Judge");
    expect(await res.text()).not.toContain("app-token-now");
    expect((await stored())?.appToken).toBe("app-token-now");
  });

  it("is 401 without a session", async () => {
    const { POST } = await import("@/app/auth/session/route");
    expect((await POST(req("/auth/session", {}, { method: "POST" }))).status).toBe(401);
  });
});

describe("the browser cannot reach the routes that return the token", () => {
  it("is refused by Caddy for the API's mint, context and leave routes", async () => {
    const { readFileSync } = await import("node:fs");
    const caddy = readFileSync("Caddyfile", "utf8");

    const refusal = caddy.indexOf("@token_routes");
    const backend = caddy.indexOf("@backend_api path /api/*");
    expect(refusal).toBeGreaterThan(-1);
    // Before the catch-all for the API, or it would never apply.
    expect(refusal).toBeLessThan(backend);
    const block = caddy.slice(refusal, caddy.indexOf("}", caddy.indexOf("handle @token_routes")));
    for (const path of ["/api/auth/session", "/api/me/context", "/api/me/jurisdictions/*"]) {
      expect(block).toContain(path);
    }
    expect(block).toContain("respond 404");
  });
});
