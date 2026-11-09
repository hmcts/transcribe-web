import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Local development without Entra (authz contract, section 4): sign in as a
 * seeded persona, and reach the API through a dev-only proxy that attaches the
 * session's token. Both are refused when login is on (AUTH_ENABLED=true) or the
 * build is a production one (NODE_ENV=production).
 */
const API = "http://api.internal";
const api = vi.fn();

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

function personaMe(email = "judge-et@localhost.test") {
  return {
    user: { id: "u-1", email, name: "Judge ET" },
    status: "ready",
    assignments: [{ jurisdiction: { code: "ET", name: "Employment Tribunal" }, role: "Judge" }],
    active: { jurisdiction: { code: "ET", name: "Employment Tribunal" }, role: "Judge" },
    permissions: ["app.access"],
    pending_requests: [],
  };
}
const mintBody = (token = "dev-app-token") => ({
  token,
  expires_at: new Date(Date.now() + 300_000).toISOString(),
  me: personaMe(),
});

function req(path: string, init: { method?: string; body?: string; headers?: Record<string, string>; cookies?: Record<string, string> } = {}) {
  const { cookies, ...rest } = init;
  const cookie = Object.entries(cookies ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  return new NextRequest(`http://localhost:3000${path}`, {
    ...rest,
    headers: { ...(cookie ? { cookie } : {}), ...rest.headers },
  });
}

const ctx = (...path: string[]) => ({ params: Promise.resolve({ path }) });

async function devSession(over: Record<string, unknown> = {}) {
  const store = await import("@/lib/auth/session-store");
  await store.writeSession("dev-sess", {
    idToken: "",
    idTokenExpiresAt: Number.MAX_SAFE_INTEGER,
    user: { oid: "u-1", name: "Judge ET", email: "judge-et@localhost.test", roles: [] },
    createdAt: Date.now(),
    devPersona: "judge-et",
    appToken: "dev-app-token",
    appTokenExpiresAt: Date.now() + 300_000,
    context: { jurisdiction: "ET", role: "Judge" },
    ...over,
  } as never);
}

beforeEach(async () => {
  api.mockReset();
  vi.stubGlobal("fetch", api);
  vi.stubEnv("BACKEND_INTERNAL_URL", API);
  vi.stubEnv("AUTH_ENABLED", "false");
  vi.stubEnv("NODE_ENV", "development");
  (await import("@/lib/auth/session-store")).__resetStoreForTests();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("isDevLoginEnabled", () => {
  it.each([
    ["false", "development", true],
    ["false", "test", true],
    ["", "development", true],
    ["true", "development", false],
    ["false", "production", false],
    ["true", "production", false],
    ["", "production", false],
  ])("AUTH_ENABLED=%j NODE_ENV=%s -> %s", async (auth, nodeEnv, expected) => {
    vi.stubEnv("AUTH_ENABLED", auth);
    vi.stubEnv("NODE_ENV", nodeEnv);
    const { isDevLoginEnabled } = await import("@/lib/auth/dev-mode");
    expect(isDevLoginEnabled()).toBe(expected);
  });
});

describe("GET /auth/dev-login", () => {
  it("signs in as the persona with the API, sets the cookie and goes where it was going", async () => {
    api.mockResolvedValue(json(mintBody()));
    const { GET } = await import("@/app/auth/dev-login/route");

    const res = await GET(req("/auth/dev-login?persona=judge-et&returnTo=%2Frecording"));

    expect(api.mock.calls[0][0]).toBe(`${API}/api/auth/session`);
    const headers = new Headers((api.mock.calls[0][1] as RequestInit).headers);
    expect(headers.get("x-dev-persona")).toBe("judge-et");
    expect(headers.get("authorization")).toBeNull();
    // On the origin the developer used, so the cookie is the one sent next.
    expect(res.headers.get("location")).toBe("http://localhost:3000/recording");
    const cookie = res.cookies.get("transcribe_session");
    expect(cookie?.httpOnly).toBe(true);
    const store = await import("@/lib/auth/session-store");
    const session = await store.readSession(cookie?.value ?? "");
    expect(session).toMatchObject({
      devPersona: "judge-et",
      appToken: "dev-app-token",
      context: { jurisdiction: "ET", role: "Judge" },
    });
    // The token is in the session, not in anything sent to the browser.
    expect(JSON.stringify([...res.headers.entries()])).not.toContain("dev-app-token");
  });

  it("starts with no chosen context when the API chose none", async () => {
    api.mockResolvedValue(json({ ...mintBody(), me: { ...personaMe(), active: null, status: "choose" } }));
    const { GET } = await import("@/app/auth/dev-login/route");

    const res = await GET(req("/auth/dev-login?persona=multi"));

    const store = await import("@/lib/auth/session-store");
    expect((await store.readSession(res.cookies.get("transcribe_session")?.value ?? ""))?.context).toBeNull();
  });

  it.each([
    "https://evil.example/",
    "//evil.example/",
    "/\\evil.example",
    "javascript:alert(1)",
    "/auth/logout",
  ])("does not redirect to %s (returnTo must be a relative path)", async (returnTo) => {
    api.mockResolvedValue(json(mintBody()));
    const { GET } = await import("@/app/auth/dev-login/route");

    const res = await GET(req(`/auth/dev-login?persona=judge-et&returnTo=${encodeURIComponent(returnTo)}`));

    expect(res.headers.get("location")).toBe("http://localhost:3000/");
  });

  it("replaces a session the browser already had", async () => {
    await devSession();
    api.mockResolvedValue(json(mintBody("second")));
    const { GET } = await import("@/app/auth/dev-login/route");

    const res = await GET(req("/auth/dev-login?persona=judge-et", { cookies: { transcribe_session: "dev-sess" } }));

    const store = await import("@/lib/auth/session-store");
    expect(await store.readSession("dev-sess")).toBeNull();
    expect(res.cookies.get("transcribe_session")?.value).not.toBe("dev-sess");
  });

  it.each(["", "Judge ET", "../etc", "a".repeat(41), "x;y"])("is 400 for the persona %j, and calls nothing", async (persona) => {
    const { GET } = await import("@/app/auth/dev-login/route");

    const res = await GET(req(`/auth/dev-login?persona=${encodeURIComponent(persona)}`));

    expect(res.status).toBe(400);
    expect(api).not.toHaveBeenCalled();
    expect(res.cookies.get("transcribe_session")).toBeUndefined();
  });

  it("is 401 with a hint when the API does not know the persona", async () => {
    api.mockResolvedValue(json({ detail: { code: "unknown_persona" } }, 401));
    const { GET } = await import("@/app/auth/dev-login/route");

    const res = await GET(req("/auth/dev-login?persona=nobody"));

    expect(res.status).toBe(401);
    expect(await res.text()).toMatch(/ENVIRONMENT=local/);
    expect(res.cookies.get("transcribe_session")).toBeUndefined();
  });

  it("says the user is deactivated, not that the persona is unknown, when the API says so", async () => {
    api.mockResolvedValue(json({ detail: { code: "user_deactivated", message: "This account has been deactivated." } }, 403));
    const { GET } = await import("@/app/auth/dev-login/route");

    const res = await GET(req("/auth/dev-login?persona=judge-iac"));

    expect(res.status).toBe(403);
    expect(await res.text()).toMatch(/deactivated/);
    expect(res.cookies.get("transcribe_session")).toBeUndefined();
  });

  it("is 502 when the API is not running", async () => {
    api.mockRejectedValue(new Error("connect ECONNREFUSED"));
    const { GET } = await import("@/app/auth/dev-login/route");

    const res = await GET(req("/auth/dev-login?persona=judge-et"));

    expect(res.status).toBe(502);
    expect(res.cookies.get("transcribe_session")).toBeUndefined();
  });

  describe("is refused, as if it did not exist, outside local development", () => {
    it.each([
      ["login is enabled", { AUTH_ENABLED: "true", NODE_ENV: "development" }],
      ["it is a production build", { AUTH_ENABLED: "false", NODE_ENV: "production" }],
      ["login is enabled in production", { AUTH_ENABLED: "true", NODE_ENV: "production" }],
      ["login is not configured in production", { AUTH_ENABLED: "", NODE_ENV: "production" }],
    ])("when %s", async (_why, env) => {
      for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
      const { GET } = await import("@/app/auth/dev-login/route");

      const res = await GET(req("/auth/dev-login?persona=judge-et"));

      expect(res.status).toBe(404);
      expect(api).not.toHaveBeenCalled(); // never even asks the API
      expect(res.cookies.get("transcribe_session")).toBeUndefined();
      expect(res.headers.get("location")).toBeNull();
    });
  });
});

describe("the dev proxy at /api/*", () => {
  const call = async (
    method: string,
    path: string,
    init: {
      body?: string;
      headers?: Record<string, string>;
      cookies?: Record<string, string>;
    } = {}
  ) => {
    const route = await import("@/app/api/[...path]/route");
    const handler = (route as unknown as Record<string, (r: NextRequest, c: unknown) => Promise<Response>>)[method];
    const segments = path.replace(/^\/api\//, "").split("?")[0].split("/");
    return handler(req(path, { method, ...init }), ctx(...segments));
  };

  it("attaches the session's token, as Caddy's forward_auth does, and returns the API's answer", async () => {
    await devSession();
    api.mockResolvedValue(json({ hello: "world" }, 200, { "X-Request-Id": "r-1" }));

    const res = await call("GET", "/api/me/permissions", { cookies: { transcribe_session: "dev-sess" } });

    expect(api.mock.calls[0][0]).toBe(`${API}/api/me/permissions`);
    const headers = new Headers((api.mock.calls[0][1] as RequestInit).headers);
    expect(headers.get("authorization")).toBe("Bearer dev-app-token");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hello: "world" });
    expect(res.headers.get("x-request-id")).toBe("r-1");
  });

  it("discards what the browser sent in Authorization, and its cookie, and any persona header", async () => {
    await devSession();
    api.mockResolvedValue(json({}));

    await call("GET", "/api/me/permissions", {
      cookies: { transcribe_session: "dev-sess" },
      headers: {
        Authorization: "Bearer from-the-browser",
        "X-Dev-Persona": "jsuper",
        "X-Requested-Context": "-:Whatever",
      },
    });

    const headers = new Headers((api.mock.calls[0][1] as RequestInit).headers);
    expect(headers.get("authorization")).toBe("Bearer dev-app-token");
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("x-dev-persona")).toBeNull();
    expect(headers.get("x-requested-context")).toBeNull();
  });

  it("sends no Authorization at all without a session, so the API answers 401", async () => {
    api.mockResolvedValue(json({ detail: "no" }, 401));

    const res = await call("GET", "/api/me/permissions", { headers: { Authorization: "Bearer forged" } });

    expect(new Headers((api.mock.calls[0][1] as RequestInit).headers).get("authorization")).toBeNull();
    expect(res.status).toBe(401);
  });

  it("passes the tab's context headers, the query string, the method and the body on", async () => {
    await devSession();
    api.mockResolvedValue(json({ ok: true }, 201));

    const res = await call("POST", "/api/access-requests?x=1&y=a%20b", {
      cookies: { transcribe_session: "dev-sess" },
      headers: { "X-Jurisdiction": "ET", "X-Role": "Judge", "Content-Type": "application/json" },
      body: JSON.stringify({ jurisdiction: "ET", roles: ["Judge"] }),
    });

    expect(api.mock.calls[0][0]).toBe(`${API}/api/access-requests?x=1&y=a%20b`);
    const init = api.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("x-jurisdiction")).toBe("ET");
    expect(headers.get("x-role")).toBe("Judge");
    expect(res.status).toBe(201);
  });

  it("passes the API's refusals on with their status, such as 409 context_changed", async () => {
    await devSession();
    api.mockResolvedValue(json({ detail: { code: "context_changed" } }, 409));

    const res = await call("PUT", "/api/anything", {
      cookies: { transcribe_session: "dev-sess" },
      body: "{}",
    });

    expect(res.status).toBe(409);
    expect((await res.json()).detail.code).toBe("context_changed");
  });

  it("mints again with the persona when the token is near expiry", async () => {
    await devSession({ appTokenExpiresAt: Date.now() + 10_000 });
    api.mockImplementation(async (url: string) =>
      url.endsWith("/api/auth/session") ? json(mintBody("dev-app-token-2")) : json({})
    );

    await call("GET", "/api/me/permissions", { cookies: { transcribe_session: "dev-sess" } });

    const mintHeaders = new Headers((api.mock.calls[0][1] as RequestInit).headers);
    expect(mintHeaders.get("x-dev-persona")).toBe("judge-et");
    expect(mintHeaders.get("x-requested-context")).toBe("ET:Judge");
    const forwarded = new Headers((api.mock.calls[1][1] as RequestInit).headers);
    expect(forwarded.get("authorization")).toBe("Bearer dev-app-token-2");
  });

  it.each([
    "/api/auth/session",
    "/api/me/context",
    "/api/me/jurisdictions/ET",
  ])("does not forward %s, which returns the token: the browser uses /auth/* for it", async (path) => {
    await devSession();

    const res = await call("PUT", path, { cookies: { transcribe_session: "dev-sess" }, body: "{}" });

    expect(res.status).toBe(404);
    expect(api).not.toHaveBeenCalled();
  });

  it("is 502 when the API is not running", async () => {
    api.mockRejectedValue(new Error("connect ECONNREFUSED"));

    const res = await call("GET", "/api/me/permissions");

    expect(res.status).toBe(502);
  });

  describe("is refused, as if it did not exist, outside local development", () => {
    it.each([
      ["login is enabled", { AUTH_ENABLED: "true", NODE_ENV: "development" }],
      ["it is a production build", { AUTH_ENABLED: "false", NODE_ENV: "production" }],
      ["login is enabled in production", { AUTH_ENABLED: "true", NODE_ENV: "production" }],
    ])("when %s", async (_why, env) => {
      await devSession();
      for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);

      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
        const res = await call(method, "/api/me/permissions", {
          cookies: { transcribe_session: "dev-sess" },
          ...(method === "GET" ? {} : { body: "{}" }),
        });
        expect(res.status, method).toBe(404);
      }
      expect(api).not.toHaveBeenCalled();
    });
  });
});

describe("a persona session outside local development", () => {
  it.each([
    ["login is enabled", { AUTH_ENABLED: "true", NODE_ENV: "development" }],
    ["it is a production build", { AUTH_ENABLED: "false", NODE_ENV: "production" }],
  ])("gives no token and is ended when %s", async (_why, env) => {
    await devSession();
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    vi.stubEnv("APP_URL", "https://transcribe.example");
    const { bearerForSession } = await import("@/lib/auth/session");

    await expect(bearerForSession("dev-sess")).resolves.toBeNull();

    const store = await import("@/lib/auth/session-store");
    expect(await store.readSession("dev-sess")).toBeNull();
  });

  it("does not make Caddy's forward_auth route send a persona's token", async () => {
    await devSession();
    vi.stubEnv("AUTH_ENABLED", "true");
    vi.stubEnv("APP_URL", "https://transcribe.example");
    const { GET } = await import("@/app/auth/forward/route");

    const res = await GET(req("/auth/forward", { cookies: { transcribe_session: "dev-sess" } }));

    expect(res.status).toBe(401);
    expect(res.headers.get("authorization")).toBeNull();
  });
});

describe("the browser side of dev login", () => {
  it("is on only when opted in and not in a production build", async () => {
    const { isDevLoginMode } = await import("@/lib/dev-login-mode");

    vi.stubEnv("NEXT_PUBLIC_DEV_LOGIN", "");
    expect(isDevLoginMode()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_DEV_LOGIN", "true");
    expect(isDevLoginMode()).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    expect(isDevLoginMode()).toBe(false);
  });

  it("sends the API client through the same-origin dev proxy only in dev login mode", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { apiClient } = await import("@/lib/api-client");

    vi.stubEnv("NEXT_PUBLIC_DEV_LOGIN", "true");
    await apiClient.request("/me/permissions");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/me/permissions");
    expect((fetchMock.mock.calls[0][1] as RequestInit).credentials).toBe("include");

    vi.stubEnv("NEXT_PUBLIC_DEV_LOGIN", "");
    await apiClient.request("/me/permissions");
    expect(String(fetchMock.mock.calls[1][0])).toMatch(/^http:\/\/localhost:8000\/api\/me\/permissions$/);
  });
});
