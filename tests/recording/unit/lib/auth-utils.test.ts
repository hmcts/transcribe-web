import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetStoreForTests, writeSession } from "@/lib/auth/session-store";

const { mockCookies } = vi.hoisted(() => ({ mockCookies: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: mockCookies }));

const SESSION_ID = "session-abc";

async function seedSession(idToken = "id-token-for-user") {
  await writeSession(SESSION_ID, {
    idToken,
    refreshToken: "refresh",
    idTokenExpiresAt: Date.now() + 60 * 60 * 1000, // well clear of the refresh window
    user: {
      oid: "oid-1",
      name: "Judge",
      email: "judge@justice.gov.uk",
      roles: [],
    },
    createdAt: Date.now(),
  });
}

function requestWith(headers: Record<string, string>) {
  return { headers: new Headers(headers) };
}

describe("recording auth-utils", () => {
  beforeEach(() => {
    __resetStoreForTests(); // in-memory store: no REDIS_URL, NODE_ENV=test
  });
  afterEach(() => vi.clearAllMocks());

  describe("getBackendAuthContext", () => {
    it("returns the session's token for a request carrying the session cookie", async () => {
      await seedSession();
      const { getBackendAuthContext } = await import(
        "@/lib/recording/auth-utils"
      );
      await expect(
        getBackendAuthContext(
          requestWith({ cookie: `other=1; transcribe_session=${SESSION_ID}` })
        )
      ).resolves.toEqual({ bearerToken: "id-token-for-user" });
    });

    it("returns no token without a session cookie", async () => {
      const { getBackendAuthContext } = await import(
        "@/lib/recording/auth-utils"
      );
      await expect(getBackendAuthContext(requestWith({}))).resolves.toEqual({
        bearerToken: null,
      });
    });

    it("returns no token for an unknown session id", async () => {
      const { getBackendAuthContext } = await import(
        "@/lib/recording/auth-utils"
      );
      await expect(
        getBackendAuthContext(
          requestWith({ cookie: "transcribe_session=forged" })
        )
      ).resolves.toEqual({ bearerToken: null });
    });

    it("ignores forged Easy Auth headers entirely", async () => {
      const { getBackendAuthContext } = await import(
        "@/lib/recording/auth-utils"
      );
      await expect(
        getBackendAuthContext(
          requestWith({
            "x-ms-client-principal": "base64-principal",
            "x-ms-token-aad-access-token": "attacker-token",
          })
        )
      ).resolves.toEqual({ bearerToken: null });
    });
  });

  describe("getServerComponentAuthContext", () => {
    it("reads the session cookie through next/headers", async () => {
      await seedSession("rsc-token");
      mockCookies.mockResolvedValue({
        get: (name: string) =>
          name === "transcribe_session" ? { value: SESSION_ID } : undefined,
      });
      const { getServerComponentAuthContext } = await import(
        "@/lib/recording/auth-utils"
      );
      await expect(getServerComponentAuthContext()).resolves.toEqual({
        bearerToken: "rsc-token",
      });
    });
  });
});
