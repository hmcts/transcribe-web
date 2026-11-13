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

  // DIAAT-406: each role's responsibilities. The preview user holds every role; acting in each,
  // they have only what that role does, and the API refuses the rest.
  it.runIf(isPreview)(
    "gives the super administrator jurisdictions only, the jurisdiction administrator its users, templates and approvals, and the legal text manager legal text only",
    async () => {
      const login = await get("/auth/preview-login?returnTo=%2F");
      const cookie = login.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .find((value) => value.startsWith("transcribe_session=")) as string;
      const me = await (await get("/api/me/permissions", { cookie })).json();
      type Pair = { jurisdiction: { code: string } | null; role: string };
      const find = (role: string) =>
        me.assignments.find((a: Pair) => a.role === role) as Pair | undefined;
      const actAs = async (pair: Pair) => {
        const switched = await postJson(
          "/auth/context",
          { jurisdiction: pair.jurisdiction?.code ?? null, role: pair.role },
          { cookie }
        );
        expect(switched.status).toBe(200);
        return (await (await get("/api/me/permissions", { cookie })).json())
          .permissions as string[];
      };

      const superAdmin = find("JurisdictionSuperAdministrator");
      expect(superAdmin).toBeTruthy();
      const asSuper = await actAs(superAdmin as Pair);
      expect(asSuper).toContain("jurisdictions.manage");
      expect(asSuper).toContain("jurisdiction_admin.assign");
      for (const gone of [
        "users.manage",
        "access.approve",
        "templates.manage",
        "legal_text.manage",
      ]) {
        expect(asSuper).not.toContain(gone);
      }
      expect((await get("/api/admin/jurisdictions", { cookie })).status).toBe(
        200
      );
      expect(
        (await get("/api/admin/access-requests?status=pending", { cookie }))
          .status
      ).toBe(403);
      expect(asSuper).toContain("accounts.manage");
      expect((await get("/api/admin/role-history", { cookie })).status).toBe(
        200
      );
      expect([404, 405]).toContain(
        (await get("/api/jurisdictions/wording", { cookie })).status
      );

      const administrator = find("JurisdictionAdministrator");
      expect(administrator?.jurisdiction).toBeTruthy();
      const asAdministrator = await actAs(administrator as Pair);
      for (const kept of [
        "users.manage",
        "access.approve",
        "templates.manage",
      ]) {
        expect(asAdministrator).toContain(kept);
      }
      for (const gone of [
        "jurisdictions.manage",
        "jurisdiction.wording.edit",
        "legal_text.manage",
      ]) {
        expect(asAdministrator).not.toContain(gone);
      }
      expect((await get("/api/admin/jurisdictions", { cookie })).status).toBe(
        403
      );
      const code = administrator?.jurisdiction?.code as string;
      expect(
        (await get(`/api/admin/jurisdictions/${code}/templates`, { cookie }))
          .status
      ).toBe(200);

      const legal = find("LegalTextManager");
      expect(legal?.jurisdiction).toBeTruthy();
      const asLegal = await actAs(legal as Pair);
      expect(asLegal).toContain("legal_text.manage");
      expect(asLegal).not.toContain("templates.manage");
      expect(asLegal).not.toContain("users.manage");
    }
  );
});
