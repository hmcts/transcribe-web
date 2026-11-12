import { describe, expect, it } from "vitest";
import { get, TEST_URL } from "./client";

// Per-PR preview releases run with AUTH_ENABLED 'false' (their hostnames
// cannot be Entra redirect URIs; charts/transcribe-web/values.preview.template.yaml),
// and sign the API's preview user in instead (/auth/preview-login). The API refuses
// a call without a BenchNotes token everywhere, a preview included (DIAAT-373).
const isPreview = new URL(TEST_URL).hostname.endsWith(
  ".preview.platform.hmcts.net"
);

describe(`functional: ${TEST_URL}`, () => {
  it("is healthy", async () => {
    expect((await get("/health")).status).toBe(200);
  });

  it("refuses an anonymous API call rather than serving data", async () => {
    expect((await get("/api/jobs")).status).toBe(401);
  });

  // A preview runs its own transcribe-api in the same release. The web signs the API's
  // preview user in (no Entra token: values.preview.template.yaml), keeps the BenchNotes
  // token in its session and attaches it to API calls: Caddy -> forward_auth -> the api's
  // in-release Service -> its Postgres, end to end. (Needs an api that has the
  // role-assignment sign-in: the api-pr:<n> label on a PR that brings it.)
  it.runIf(isPreview)(
    "signs the preview user in and serves them from the preview's own API",
    async () => {
      const login = await get("/auth/preview-login?returnTo=%2F");
      expect(login.status).toBe(307);
      const cookie = login.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .find((value) => value.startsWith("transcribe_session="));
      expect(cookie).toBeTruthy();

      const response = await get("/api/me/permissions", {
        cookie: cookie as string,
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        user: { email: "preview-user@preview.platform.hmcts.net" },
      });
    }
  );
});
