import { describe, expect, it } from "vitest";
import { get, postJson, TEST_URL } from "./client";

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

  // DIAAT-403: the preview user holds every role and the SystemAdministrator role. Switched to
  // Judge, they have a Judge's permissions only: no admin tab is offered and the API refuses it.
  it.runIf(isPreview)(
    "gives a user with every role, switched to Judge, nothing of their other roles",
    async () => {
      const login = await get("/auth/preview-login?returnTo=%2F");
      const cookie = login.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .find((value) => value.startsWith("transcribe_session=")) as string;
      const me = await (await get("/api/me/permissions", { cookie })).json();
      const system = { jurisdiction: null, role: "SystemAdministrator" };
      expect(me.assignments).toContainEqual(system);
      const judge = me.assignments.find(
        (a: { jurisdiction: unknown; role: string }) =>
          a.role === "Judge" && a.jurisdiction
      );
      expect(judge).toBeTruthy();

      const asJudge = await postJson(
        "/auth/context",
        { jurisdiction: judge.jurisdiction.code, role: "Judge" },
        { cookie }
      );
      expect(asJudge.status).toBe(200);
      const judgeMe = await (
        await get("/api/me/permissions", { cookie })
      ).json();
      expect(judgeMe.active).toMatchObject({ role: "Judge" });
      expect(judgeMe.permissions).toContain("dictation.use");
      for (const admin of [
        "admin.access",
        "jurisdiction_super_admin.assign",
        "jurisdiction_admin.assign",
        "feature_flags.manage",
        "users.manage",
      ]) {
        expect(judgeMe.permissions).not.toContain(admin);
      }
      expect((await get("/api/admin/feature-flags", { cookie })).status).toBe(
        403
      );

      const asSystem = await postJson("/auth/context", system, { cookie });
      expect(asSystem.status).toBe(200);
      const systemMe = await (
        await get("/api/me/permissions", { cookie })
      ).json();
      expect(systemMe.active).toEqual(system);
      expect(systemMe.permissions).toContain("feature_flags.manage");
      expect(systemMe.permissions).not.toContain("dictation.use");
    }
  );
});
