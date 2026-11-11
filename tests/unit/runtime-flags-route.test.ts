import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// DIAAT-392: the route proxy.ts asks for the runtime flag. It holds the session's
// BenchNotes token, which the proxy does not, and calls GET /api/flags with it.

const API = "http://api.internal";
const api = vi.fn();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function seed(id = "sess-1") {
  const store = await import("@/lib/auth/session-store");
  await store.writeSession(id, {
    idToken: "entra-id-token",
    refreshToken: "refresh-1",
    idTokenExpiresAt: Date.now() + 3600_000,
    user: { oid: "oid-1", name: "A", email: "a@localhost.test", roles: [] },
    createdAt: Date.now(),
    appToken: "app-token-1",
    appTokenExpiresAt: Date.now() + 300_000,
  } as never);
}

const req = (cookie?: string) =>
  new NextRequest("http://127.0.0.1:3001/auth/runtime-flags", {
    headers: cookie ? { cookie } : {},
  });

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
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("GET /auth/runtime-flags", () => {
  it("calls the API's /api/flags with the session's BenchNotes token and returns the flags", async () => {
    await seed();
    api.mockResolvedValue(json({ dictation_enabled: false }));
    const { GET } = await import("@/app/auth/runtime-flags/route");

    const res = await GET(req("transcribe_session=sess-1"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ dictation_enabled: false });
    const [url, init] = api.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API}/api/flags`);
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer app-token-1");
    expect(JSON.stringify(init.headers)).not.toContain("entra-id-token");
  });

  it("answers 401 without a session, and does not call the API", async () => {
    const { GET } = await import("@/app/auth/runtime-flags/route");
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(api).not.toHaveBeenCalled();
  });

  it.each([
    ["the API failing", () => api.mockResolvedValue(json({ detail: "boom" }, 500))],
    ["a body that is not the flags", () => api.mockResolvedValue(json({ dictation_enabled: "yes" }))],
    ["the API being unreachable", () => api.mockRejectedValue(new Error("ECONNREFUSED"))],
  ])("answers 502 on %s, which the proxy treats as 'use the deploy-time value'", async (_, arrange) => {
    await seed();
    arrange();
    const { GET } = await import("@/app/auth/runtime-flags/route");

    const res = await GET(req("transcribe_session=sess-1"));

    expect(res.status).toBe(502);
  });

  it.each([401, 403])(
    "passes the API's %s on as it is: it refused this session, and the proxy must not keep that for everyone",
    async (status) => {
      await seed();
      api.mockResolvedValue(json({ detail: { code: "user_deactivated" } }, status));
      const { GET } = await import("@/app/auth/runtime-flags/route");

      const res = await GET(req("transcribe_session=sess-1"));

      expect(res.status).toBe(status);
      expect((await res.json()).detail.code).toBe("session_refused");
    }
  );

  it("never puts the token in what it returns", async () => {
    await seed();
    api.mockResolvedValue(json({ dictation_enabled: true, token: "leak" }));
    const { GET } = await import("@/app/auth/runtime-flags/route");

    const res = await GET(req("transcribe_session=sess-1"));

    expect(await res.json()).toEqual({ dictation_enabled: true });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
