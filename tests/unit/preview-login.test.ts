import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PR previews (DIAAT-399): no Entra, so the web signs the browser in as the API's
 * fixed preview user by calling the sign-in with no Authorization header (and no
 * persona). Refused when login is on (AUTH_ENABLED=true), and unless the preview
 * chart sets PREVIEW_USER_SIGN_IN.
 */
const API = "http://api.internal";
const api = vi.fn();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const previewMe = {
  user: { id: "u-preview", email: "preview@preview.test", name: "Preview user" },
  status: "choose",
  assignments: [
    { jurisdiction: null, role: "JurisdictionSuperAdministrator" },
    { jurisdiction: { code: "IAC", name: "Immigration and Asylum Chamber" }, role: "Judge" },
  ],
  active: null,
  permissions: [],
  pending_requests: [],
};
const mintBody = (token = "preview-app-token") => ({
  token,
  expires_at: new Date(Date.now() + 300_000).toISOString(),
  me: previewMe,
});

function req(
  path: string,
  init: { headers?: Record<string, string>; cookies?: Record<string, string> } = {}
) {
  const cookie = Object.entries(init.cookies ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  return new NextRequest(`https://transcribe-web-pr-1.preview.example${path}`, {
    headers: { ...(cookie ? { cookie } : {}), ...init.headers },
  });
}

async function previewSession(over: Record<string, unknown> = {}) {
  const store = await import("@/lib/auth/session-store");
  await store.writeSession("preview-sess", {
    idToken: "",
    idTokenExpiresAt: Number.MAX_SAFE_INTEGER,
    user: { oid: "u-preview", name: "Preview user", email: "preview@preview.test", roles: [] },
    createdAt: Date.now(),
    previewUser: true,
    appToken: "preview-app-token",
    appTokenExpiresAt: Date.now() + 300_000,
    context: null,
    ...over,
  } as never);
}

beforeEach(async () => {
  api.mockReset();
  vi.stubGlobal("fetch", api);
  vi.stubEnv("BACKEND_INTERNAL_URL", API);
  vi.stubEnv("AUTH_ENABLED", "false");
  vi.stubEnv("PREVIEW_USER_SIGN_IN", "true");
  vi.stubEnv("NODE_ENV", "production"); // a PR preview is a production build
  (await import("@/lib/auth/session-store")).__resetStoreForTests();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("isPreviewSignInEnabled", () => {
  it.each([
    ["false", "true", true],
    ["", "true", true],
    ["true", "true", false], // login on: impossible
    ["false", "", false], // not a preview: the variable is absent
    ["false", "false", false],
    ["false", "1", false], // only the exact value
    ["true", "", false],
  ])("AUTH_ENABLED=%j PREVIEW_USER_SIGN_IN=%j -> %s", async (auth, preview, expected) => {
    vi.stubEnv("AUTH_ENABLED", auth);
    vi.stubEnv("PREVIEW_USER_SIGN_IN", preview);
    const { isPreviewSignInEnabled } = await import("@/lib/auth/preview-mode");
    expect(isPreviewSignInEnabled()).toBe(expected);
  });
});

describe("GET /auth/preview-login", () => {
  // Deployed, APP_URL is the public origin the browser uses.
  beforeEach(() => {
    vi.stubEnv("APP_URL", "https://transcribe-web-pr-1.preview.example");
  });

  it("signs in with no Authorization header and no persona, sets the cookie and goes where it was going", async () => {
    api.mockResolvedValue(json(mintBody()));
    const { GET } = await import("@/app/auth/preview-login/route");

    const res = await GET(req("/auth/preview-login?returnTo=%2Frecording%3Ftab%3D2"));

    expect(api.mock.calls[0][0]).toBe(`${API}/api/auth/session`);
    expect((api.mock.calls[0][1] as RequestInit).method).toBe("POST");
    const headers = new Headers((api.mock.calls[0][1] as RequestInit).headers);
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("x-dev-persona")).toBeNull();
    // No context is asked for: the preview user chooses in the existing chooser.
    expect(headers.get("x-requested-context")).toBeNull();
    expect(res.headers.get("location")).toBe(
      "https://transcribe-web-pr-1.preview.example/recording?tab=2"
    );
    // Behind Caddy the request arrives on the internal origin: the redirect still goes to the public one.
    api.mockResolvedValue(json(mintBody())); // a Response body can be read once
    const internal = await GET(
      new NextRequest("http://127.0.0.1:3001/auth/preview-login?returnTo=%2Frecording")
    );
    expect(internal.headers.get("location")).toBe(
      "https://transcribe-web-pr-1.preview.example/recording"
    );
    const cookie = res.cookies.get("transcribe_session");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.secure).toBe(true); // APP_URL is https: the flag follows it
    const store = await import("@/lib/auth/session-store");
    expect(await store.readSession(cookie?.value ?? "")).toMatchObject({
      previewUser: true,
      appToken: "preview-app-token",
      context: null,
    });
    // The token is in the session, not in anything sent to the browser.
    expect(JSON.stringify([...res.headers.entries()])).not.toContain("preview-app-token");
  });

  it("never sends a persona header, even if the browser asked for one", async () => {
    api.mockResolvedValue(json(mintBody()));
    const { GET } = await import("@/app/auth/preview-login/route");

    await GET(
      req("/auth/preview-login?persona=jsuper", {
        headers: { "x-dev-persona": "jsuper", authorization: "Bearer from-the-browser" },
      })
    );

    const headers = new Headers((api.mock.calls[0][1] as RequestInit).headers);
    expect(headers.get("x-dev-persona")).toBeNull();
    expect(headers.get("authorization")).toBeNull();
  });

  it.each([
    "https://evil.example/",
    "//evil.example/",
    "/\\evil.example",
    "javascript:alert(1)",
    "/auth/logout",
  ])("does not redirect to %s (returnTo must be a relative path)", async (returnTo) => {
    api.mockResolvedValue(json(mintBody()));
    const { GET } = await import("@/app/auth/preview-login/route");

    const res = await GET(req(`/auth/preview-login?returnTo=${encodeURIComponent(returnTo)}`));

    expect(res.headers.get("location")).toBe("https://transcribe-web-pr-1.preview.example/");
  });

  it("replaces a session the browser already had", async () => {
    await previewSession();
    api.mockResolvedValue(json(mintBody("second")));
    const { GET } = await import("@/app/auth/preview-login/route");

    const res = await GET(req("/auth/preview-login", { cookies: { transcribe_session: "preview-sess" } }));

    const store = await import("@/lib/auth/session-store");
    expect(await store.readSession("preview-sess")).toBeNull();
    expect(res.cookies.get("transcribe_session")?.value).not.toBe("preview-sess");
  });

  it("is 401 with a hint when the API does not sign the preview user in", async () => {
    api.mockResolvedValue(json({ detail: { code: "not_authenticated" } }, 401));
    const { GET } = await import("@/app/auth/preview-login/route");

    const res = await GET(req("/auth/preview-login"));

    expect(res.status).toBe(401);
    expect(await res.text()).toMatch(/ENVIRONMENT=preview/);
    expect(res.cookies.get("transcribe_session")).toBeUndefined();
  });

  it("is 502 when the API is not reachable yet", async () => {
    api.mockRejectedValue(new Error("connect ECONNREFUSED"));
    const { GET } = await import("@/app/auth/preview-login/route");

    const res = await GET(req("/auth/preview-login"));

    expect(res.status).toBe(502);
    expect(res.cookies.get("transcribe_session")).toBeUndefined();
  });

  describe("is refused, as if it did not exist, unless it is a preview", () => {
    it.each([
      ["login is enabled", { AUTH_ENABLED: "true", PREVIEW_USER_SIGN_IN: "true" }],
      ["the variable is absent", { AUTH_ENABLED: "false", PREVIEW_USER_SIGN_IN: "" }],
      ["the variable is false", { AUTH_ENABLED: "false", PREVIEW_USER_SIGN_IN: "false" }],
      ["login is enabled and the variable is absent", { AUTH_ENABLED: "true", PREVIEW_USER_SIGN_IN: "" }],
    ])("when %s", async (_why, env) => {
      for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
      const { GET } = await import("@/app/auth/preview-login/route");

      const res = await GET(req("/auth/preview-login"));

      expect(res.status).toBe(404);
      expect(api).not.toHaveBeenCalled();
      expect(res.cookies.get("transcribe_session")).toBeUndefined();
    });
  });
});

describe("a preview session", () => {
  it("is re-minted from the API with no Authorization header and no persona, keeping its context", async () => {
    await previewSession({
      appTokenExpiresAt: Date.now() + 10_000, // about to expire
      context: { jurisdiction: "IAC", role: "Judge" },
    });
    api.mockResolvedValue(json(mintBody("renewed")));
    const { bearerForSession } = await import("@/lib/auth/session");

    expect(await bearerForSession("preview-sess")).toBe("renewed");

    const headers = new Headers((api.mock.calls[0][1] as RequestInit).headers);
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("x-dev-persona")).toBeNull();
    expect(headers.get("x-requested-context")).toBe("IAC:Judge");
  });

  it.each([
    ["login is enabled", { AUTH_ENABLED: "true", PREVIEW_USER_SIGN_IN: "true" }],
    ["preview sign-in is off", { AUTH_ENABLED: "false", PREVIEW_USER_SIGN_IN: "" }],
  ])("means nothing, and is ended, when %s", async (_why, env) => {
    await previewSession();
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    const { bearerForSession } = await import("@/lib/auth/session");

    expect(await bearerForSession("preview-sess")).toBeNull();
    const store = await import("@/lib/auth/session-store");
    expect(await store.readSession("preview-sess")).toBeNull();
  });
});

describe("GET /auth/forward in a preview (Caddy's forward_auth)", () => {
  it("attaches the preview session's BenchNotes token", async () => {
    await previewSession();
    const { GET } = await import("@/app/auth/forward/route");

    const res = await GET(req("/auth/forward", { cookies: { transcribe_session: "preview-sess" } }));

    expect(res.status).toBe(200);
    expect(res.headers.get("authorization")).toBe("Bearer preview-app-token");
  });

  it("is a 401 with a challenge for a browser without a session", async () => {
    const { GET } = await import("@/app/auth/forward/route");

    const res = await GET(req("/auth/forward"));

    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
  });

  it("is as before when login is off and it is not a preview: 200, nothing attached", async () => {
    vi.stubEnv("PREVIEW_USER_SIGN_IN", "");
    const { GET } = await import("@/app/auth/forward/route");

    const res = await GET(req("/auth/forward"));

    expect(res.status).toBe(200);
    expect(res.headers.get("authorization")).toBeNull();
  });

  it("is as before when login is on: the session's token, or a 401", async () => {
    vi.stubEnv("AUTH_ENABLED", "true");
    vi.stubEnv("PREVIEW_USER_SIGN_IN", "true"); // ignored: login is on
    const { GET } = await import("@/app/auth/forward/route");

    expect((await GET(req("/auth/forward"))).status).toBe(401);
  });
});

describe("GET /auth/login in a preview", () => {
  it("sends the browser to the preview sign-in, keeping where it was going", async () => {
    vi.stubEnv("APP_URL", "https://transcribe-web-pr-1.preview.example");
    const { GET } = await import("@/app/auth/login/route");

    const res = await GET(req("/auth/login?returnTo=%2Frecording"));

    const location = new URL(res.headers.get("location") ?? "");
    expect(location.pathname).toBe("/auth/preview-login");
    expect(location.searchParams.get("returnTo")).toBe("/recording");
  });

  it("only goes back to where it was going when it is not a preview", async () => {
    vi.stubEnv("APP_URL", "https://transcribe-web-pr-1.preview.example");
    vi.stubEnv("PREVIEW_USER_SIGN_IN", "");
    const { GET } = await import("@/app/auth/login/route");

    const res = await GET(req("/auth/login?returnTo=%2Frecording"));

    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/recording");
  });
});

describe("the page gate (proxy.ts) in a preview", () => {
  const request = (path: string, session = false) =>
    new NextRequest(`https://transcribe-web-pr-1.preview.example${path}`, {
      headers: session ? { cookie: "transcribe_session=opaque" } : {},
    });

  it("sends a page request without a session to the preview sign-in, keeping where it was going", async () => {
    const { proxy } = await import("@/proxy");

    const res = await proxy(request("/recording/jobs/abc?tab=2"));

    const location = new URL(res.headers.get("location") ?? "");
    expect(location.pathname).toBe("/auth/preview-login");
    expect(location.searchParams.get("returnTo")).toBe("/recording/jobs/abc?tab=2");
  });

  it("gives a fetch to a route handler a 401 it can act on, not a redirect", async () => {
    const { proxy } = await import("@/proxy");

    expect((await proxy(request("/api/jobs"))).status).toBe(401);
  });

  it("lets a request with a session through, and the sign-in route itself", async () => {
    const { proxy } = await import("@/proxy");

    expect((await proxy(request("/recording", true))).headers.get("location")).toBeNull();
    expect((await proxy(request("/auth/preview-login"))).headers.get("location")).toBeNull();
  });

  it("does not gate anything when it is not a preview", async () => {
    vi.stubEnv("PREVIEW_USER_SIGN_IN", "");
    const { proxy } = await import("@/proxy");

    expect((await proxy(request("/recording"))).headers.get("location")).toBeNull();
  });

  it("still sends to Entra, not the preview sign-in, when login is on", async () => {
    vi.stubEnv("AUTH_ENABLED", "true");
    vi.stubEnv("PREVIEW_USER_SIGN_IN", "true");
    const { proxy } = await import("@/proxy");

    const res = await proxy(request("/recording"));

    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/auth/login");
  });
});
