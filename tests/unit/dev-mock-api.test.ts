import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// scripts/dev-mock-api.mjs is the stand-in for transcribe-api that the screens are
// driven against (DIAAT-373). These tests hold it to the contract's assignment
// rules and shapes, so a screen checked against it is checked against something
// that refuses what the real API will refuse.

let child: ChildProcess;
let base = "";

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

beforeAll(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [join(__dirname, "../../scripts/dev-mock-api.mjs")], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("mock did not start")), 10_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      if (String(chunk).includes("dev mock API")) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
});
afterAll(() => {
  child.kill();
});

async function session(persona: string, context?: string) {
  const response = await fetch(`${base}/api/auth/session`, {
    method: "POST",
    headers: { "X-Dev-Persona": persona, ...(context ? { "X-Requested-Context": context } : {}) },
  });
  return (await response.json()) as { token: string; me: { user: { id: string } } };
}

async function call(token: string, method: string, path: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
}

describe("the mock API: who may assign what", () => {
  it("offers a jurisdiction administrator Judge and LegalTextManager only", async () => {
    const { token } = await session("jadmin-iac");
    expect((await call(token, "GET", "/api/admin/roles")).body).toEqual({ roles: ["Judge", "LegalTextManager"] });
  });

  it("offers a super administrator JurisdictionAdministrator as well", async () => {
    const { token } = await session("jsuper");
    expect((await call(token, "GET", "/api/admin/roles")).body.roles).toEqual([
      "Judge",
      "LegalTextManager",
      "JurisdictionAdministrator",
    ]);
  });

  it("offers a system administrator the super administrator role only, and never SystemAdministrator", async () => {
    const { token } = await session("sysadmin");
    const { roles } = (await call(token, "GET", "/api/admin/roles")).body;
    expect(roles).toEqual(["JurisdictionSuperAdministrator"]);
    expect(JSON.stringify(roles)).not.toMatch(/SystemAdministrator/);
  });

  it("refuses a jurisdiction administrator giving JurisdictionAdministrator (403 assignment_not_allowed)", async () => {
    const { token } = await session("jadmin-iac");
    const result = await call(token, "POST", "/api/admin/assignments", {
      user_id: null,
      email: "judge-et@localhost.test",
      jurisdiction: "IAC",
      role: "JurisdictionAdministrator",
    });
    expect(result.status).toBe(403);
    expect(result.body.detail.code).toBe("assignment_not_allowed");
  });

  it("refuses a jurisdiction administrator in another jurisdiction, and nobody grants SystemAdministrator", async () => {
    const { token } = await session("jadmin-iac");
    const elsewhere = await call(token, "POST", "/api/admin/assignments", {
      email: "x@example.test",
      jurisdiction: "ET",
      role: "Judge",
    });
    expect(elsewhere.status).toBe(403);
    const sys = await session("sysadmin");
    const grant = await call(sys.token, "POST", "/api/admin/assignments", {
      email: "x@example.test",
      jurisdiction: null,
      role: "SystemAdministrator",
    });
    expect(grant.status).toBe(403);
  });

  it("lets a jurisdiction administrator add a user by email as pending, then lists and removes it", async () => {
    const { token } = await session("jadmin-iac");
    const added = await call(token, "POST", "/api/admin/assignments", {
      email: "Pending.Person@Example.test",
      jurisdiction: "IAC",
      role: "Judge",
    });
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ jurisdiction: { code: "IAC" }, role: "Judge" });

    const list = await call(token, "GET", "/api/admin/users?search=pending.person");
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ email: "pending.person@example.test", pending: true });

    expect((await call(token, "DELETE", `/api/admin/assignments/${added.body.id}`)).status).toBe(204);
    expect((await call(token, "GET", "/api/admin/users?search=pending.person")).body.items).toHaveLength(0);
  });

  it("scopes a jurisdiction administrator's list to their jurisdiction, but lets a search find anyone who signed in", async () => {
    const { token } = await session("jadmin-iac");
    const emails = (await call(token, "GET", "/api/admin/users")).body.items.map((u: { email: string }) => u.email);
    expect(emails).toContain("judge-iac@localhost.test");
    expect(emails).not.toContain("judge-et@localhost.test");
    const found = (await call(token, "GET", "/api/admin/users?search=judge-et")).body.items;
    expect(found).toHaveLength(1);
    expect(found[0].assignments).toEqual([]); // only assignments in the caller's jurisdictions
  });

  it("lets a system administrator give themselves JurisdictionSuperAdministrator, and nobody give themselves a role at or above their own", async () => {
    const sys = await session("sysadmin");
    const own = await call(sys.token, "POST", "/api/admin/assignments", {
      user_id: sys.me.user.id,
      jurisdiction: null,
      role: "JurisdictionSuperAdministrator",
    });
    expect(own.status).toBe(201);
    const supers = await call(sys.token, "GET", "/api/admin/users?role=JurisdictionSuperAdministrator");
    expect(supers.body.items.map((u: { email: string }) => u.email)).toContain("sysadmin@localhost.test");
    expect((await call(sys.token, "DELETE", `/api/admin/assignments/${own.body.id}`)).status).toBe(204);

    const boss = await session("jsuper");
    const same = await call(boss.token, "POST", "/api/admin/assignments", {
      user_id: boss.me.user.id,
      jurisdiction: null,
      role: "JurisdictionSuperAdministrator",
    });
    expect(same.status).toBe(403);
    const sysJurisdictionRole = await call(sys.token, "POST", "/api/admin/assignments", {
      user_id: sys.me.user.id,
      jurisdiction: "ET",
      role: "JurisdictionAdministrator",
    });
    expect(sysJurisdictionRole.status).toBe(403);
  });

  it("refuses everyone but a system administrator the super administrator role", async () => {
    const boss = await session("jsuper");
    const result = await call(boss.token, "POST", "/api/admin/assignments", {
      email: "x@example.test",
      jurisdiction: null,
      role: "JurisdictionSuperAdministrator",
    });
    expect(result.status).toBe(403);
  });
});

describe("the mock API: deactivation, history, requests, flags, recordings", () => {
  it("deactivates and reactivates, refuses self-deactivation, and refuses a deactivated user's sign-in", async () => {
    const admin = await session("jadmin-et");
    const target = await session("judge-et");
    const self = await call(admin.token, "POST", `/api/admin/users/${admin.me.user.id}/deactivate`);
    expect(self.status).toBe(403);
    expect((await call(admin.token, "POST", `/api/admin/users/${target.me.user.id}/deactivate`)).status).toBe(204);
    // A token minted earlier is refused at once; a new sign-in too.
    expect((await call(target.token, "GET", "/api/me/permissions")).status).toBe(403);
    const again = await fetch(`${base}/api/auth/session`, { method: "POST", headers: { "X-Dev-Persona": "judge-et" } });
    expect(again.status).toBe(403);
    expect((await call(admin.token, "POST", `/api/admin/users/${target.me.user.id}/reactivate`)).status).toBe(204);
    expect((await fetch(`${base}/api/auth/session`, { method: "POST", headers: { "X-Dev-Persona": "judge-et" } })).status).toBe(200);
  });

  it("records changes in the role history, newest first, scoped to the caller's jurisdiction", async () => {
    const admin = await session("jadmin-iac");
    const history = await call(admin.token, "GET", "/api/admin/role-history");
    expect(history.status).toBe(200);
    expect(history.body.total).toBeGreaterThan(0);
    expect(history.body.items.every((e: { jurisdiction: string | null }) => e.jurisdiction === "IAC")).toBe(true);
    expect(history.body.items[0]).toEqual(
      expect.objectContaining({ id: expect.any(String), timestamp: expect.any(String), change: expect.any(String) })
    );
    const judge = await session("judge-et");
    expect((await call(judge.token, "GET", "/api/admin/role-history")).status).toBe(403);
  });

  it("lists pending requests in scope, approves one (giving the roles at the next mint) and rejects another", async () => {
    const admin = await session("jadmin-iac");
    const queue = (await call(admin.token, "GET", "/api/admin/access-requests?status=pending")).body;
    expect(queue.every((r: { jurisdiction: { code: string } }) => r.jurisdiction.code === "IAC")).toBe(true);
    const mine = queue.find((r: { requester: { email: string } }) => r.requester.email === "legal-iac@localhost.test");
    expect(mine.requester).toEqual({ id: expect.any(String), email: "legal-iac@localhost.test", name: expect.any(String) });

    const decided = await call(admin.token, "POST", `/api/admin/access-requests/${mine.id}/approve`, { reason: "ok" });
    expect(decided.body).toMatchObject({ status: "approved", reason: "ok" });
    expect((await call(admin.token, "POST", `/api/admin/access-requests/${mine.id}/approve`, {})).status).toBe(409);
    const next = await session("legal-iac");
    expect((next.me as unknown as { assignments: { role: string }[] }).assignments.map((a) => a.role).sort()).toEqual([
      "Judge",
      "LegalTextManager",
    ]);

    // Another jurisdiction's request is not theirs; a system administrator cannot decide any.
    const sys = await session("sysadmin");
    expect((await call(sys.token, "GET", "/api/admin/access-requests?status=pending")).status).toBe(403);
  });

  it("serves flags to anyone, and lets only a system administrator change them", async () => {
    const judge = await session("judge-et");
    expect((await call(judge.token, "GET", "/api/flags")).body).toEqual({ dictation_enabled: true });
    expect((await call(judge.token, "GET", "/api/admin/feature-flags")).status).toBe(403);
    expect((await call(judge.token, "PUT", "/api/admin/feature-flags/dictation_enabled", { value: false })).status).toBe(403);

    const sys = await session("sysadmin");
    const put = await call(sys.token, "PUT", "/api/admin/feature-flags/dictation_enabled", { value: false });
    expect(put.status).toBe(200);
    expect(put.body.flags[0]).toMatchObject({ name: "dictation_enabled", value: false, updated_by: "sysadmin@localhost.test" });
    expect((await call(judge.token, "GET", "/api/flags")).body).toEqual({ dictation_enabled: false });
    await call(sys.token, "PUT", "/api/admin/feature-flags/dictation_enabled", { value: true });
  });

  it("creates a jurisdiction only with jurisdiction.create, and scopes a jurisdiction administrator's list", async () => {
    const admin = await session("jadmin-iac");
    const list = await call(admin.token, "GET", "/api/admin/jurisdictions");
    expect(list.body.map((j: { code: string }) => j.code)).toEqual(["IAC"]);
    expect(JSON.stringify(list.body)).not.toContain("auto_enrol");
    const body = { name: "New One", settings: {}, version: "" };
    expect((await call(admin.token, "PUT", "/api/admin/jurisdictions/NEW", body)).status).toBe(403);
    const boss = await session("jsuper");
    expect((await call(boss.token, "PUT", "/api/admin/jurisdictions/NEW", body)).status).toBe(200);
    expect((await call(boss.token, "GET", "/api/jurisdictions/public")).body.map((j: { code: string }) => j.code)).toContain("NEW");
    const sys = await session("sysadmin");
    expect((await call(sys.token, "PUT", "/api/admin/jurisdictions/NEW", { ...body, version: "v1" })).status).toBe(403);
  });

  it("answers a recording's history only to its owner acting with recording.audit.read, without transcript text", async () => {
    const judge = await session("judge-et");
    const jobs = await call(judge.token, "GET", "/api/v1/jobs");
    const id = jobs.body.jobs[0].job_id;
    const history = await call(judge.token, "GET", `/api/v1/jobs/${id}/history?page=1&page_size=2`);
    expect(history.status).toBe(200);
    expect(history.body.items).toHaveLength(2);
    expect(history.body.total).toBeGreaterThan(2);
    expect(Object.keys(history.body.items[0]).sort()).toEqual(["action", "actor_label", "actor_role", "id", "outcome", "timestamp"]);
    const other = await session("judge-iac");
    expect((await call(other.token, "GET", `/api/v1/jobs/${id}/history`)).status).toBe(404);
    const admin = await session("jadmin-iac");
    expect((await call(admin.token, "GET", `/api/v1/jobs/${id}/history`)).status).toBe(403);
  });
});

// Phase 7: each of these was checked against the real API (transcribe-api at 438a03a) and the mock
// was changed to answer the same.
describe("the mock API: refusals as the real API gives them", () => {
  const code = (r: { body: { detail?: { code?: string } } }) => r.body.detail?.code;

  it("lists the requestable roles with each public jurisdiction", async () => {
    const { token } = await session("no-role");
    const list = (await call(token, "GET", "/api/jurisdictions/public")).body;
    expect(list[0]).toEqual({ code: expect.any(String), name: expect.any(String), roles: ["Judge", "LegalTextManager"] });
  });

  it("refuses an access request with duplicate_request, jurisdiction_not_found or roles_required", async () => {
    const { token } = await session("no-role");
    const ask = (jurisdiction: string, roles: string[]) =>
      call(token, "POST", "/api/access-requests", { jurisdiction, roles });
    expect((await ask("ET", ["LegalTextManager"])).status).toBe(201);
    const again = await ask("ET", ["LegalTextManager"]);
    expect([again.status, code(again)]).toEqual([409, "duplicate_request"]);
    const unknown = await ask("ZZ", ["Judge"]);
    expect([unknown.status, code(unknown)]).toEqual([404, "jurisdiction_not_found"]);
    const none = await ask("ET", []);
    expect([none.status, code(none)]).toEqual([400, "roles_required"]);
    const bad = await ask("ET", ["JurisdictionAdministrator"]);
    expect([bad.status, code(bad)]).toEqual([400, "role_not_requestable"]);
  });

  it("answers no_jurisdiction to a global role asking for a jurisdiction's material, context_required to no context", async () => {
    const boss = await session("jsuper");
    expect(code(await call(boss.token, "GET", "/api/jurisdictions/current"))).toBe("no_jurisdiction");
    expect(code(await call(boss.token, "GET", "/api/jurisdictions/wording"))).toBe("no_jurisdiction");
    const sys = await session("sysadmin");
    expect(code(await call(sys.token, "GET", "/api/jurisdictions/current"))).toBe("permission_denied");
    expect(code(await call(sys.token, "GET", "/api/admin/role-history"))).toBe("permission_denied");
    // What a role has, asked for with no context at all: context_required, not permission_denied.
    const undecided = await session("multi");
    expect(code(await call(undecided.token, "GET", "/api/admin/role-history"))).toBe("context_required");
    const judge = await session("judge-et");
    expect(code(await call(judge.token, "GET", "/api/admin/role-history"))).toBe("permission_denied");
  });

  it("lists a system administrator's own context and grants its permissions only while acting in it (DIAAT-403)", async () => {
    const sys = await session("sysadmin");
    const me = (await call(sys.token, "GET", "/api/me/permissions")).body;
    expect(me.assignments).toEqual([{ jurisdiction: null, role: "SystemAdministrator" }]);
    expect(me.active).toEqual({ jurisdiction: null, role: "SystemAdministrator" });
    expect(me.permissions).toContain("feature_flags.manage");
    const judge = await session("judge-et");
    expect(code(await call(judge.token, "PUT", "/api/me/context", { jurisdiction: null, role: "SystemAdministrator" }))).toBe(
      "context_not_available"
    );
  });

  it("gives a system administrator switched to Judge a Judge's permissions only, and the system ones back as system administrator", async () => {
    const sys = await session("sysadmin");
    const boss = await session("jsuper");
    const given = await call(boss.token, "POST", "/api/admin/assignments", {
      user_id: sys.me.user.id,
      jurisdiction: "ET",
      role: "Judge",
    });
    expect(given.status).toBe(201);
    try {
      const asJudge = await session("sysadmin", "ET:Judge");
      const judgeMe = (await call(asJudge.token, "GET", "/api/me/permissions")).body;
      expect(judgeMe.active).toMatchObject({ role: "Judge" });
      expect(judgeMe.permissions).toContain("dictation.use");
      expect(judgeMe.permissions).not.toContain("feature_flags.manage");
      expect(judgeMe.permissions).not.toContain("admin.access");
      expect((await call(asJudge.token, "GET", "/api/admin/feature-flags")).status).toBe(403);

      const back = await call(asJudge.token, "PUT", "/api/me/context", { jurisdiction: null, role: "SystemAdministrator" });
      expect(back.status).toBe(200);
      expect(back.body.me.permissions).toContain("feature_flags.manage");
      expect(back.body.me.permissions).not.toContain("dictation.use");
      expect((await call(back.body.token, "GET", "/api/admin/feature-flags")).status).toBe(200);
    } finally {
      expect((await call(boss.token, "DELETE", `/api/admin/assignments/${given.body.id}`)).status).toBe(204);
    }
  });

  it("tells who the admin is, and lists roles only to those who may assign", async () => {
    const admin = await session("jadmin-iac");
    expect((await call(admin.token, "GET", "/api/admin/me")).body).toEqual({
      email: "jadmin-iac@localhost.test",
      role: "JurisdictionAdministrator",
      user_id: expect.any(String),
    });
    const judge = await session("judge-et");
    expect(code(await call(judge.token, "GET", "/api/admin/roles"))).toBe("permission_denied");
  });

  it("refuses dictation routes with dictation_disabled while the flag is off", async () => {
    const judge = await session("judge-et");
    const sys = await session("sysadmin");
    expect((await call(judge.token, "GET", "/api/transcriptions-metadata")).status).toBe(200);
    await call(sys.token, "PUT", "/api/admin/feature-flags/dictation_enabled", { value: false });
    const refused = await call(judge.token, "GET", "/api/transcriptions-metadata");
    expect([refused.status, code(refused)]).toEqual([403, "dictation_disabled"]);
    await call(sys.token, "PUT", "/api/admin/feature-flags/dictation_enabled", { value: true });
    expect((await call(judge.token, "GET", "/api/transcriptions-metadata")).status).toBe(200);
  });
});

describe("the mock API: the review-fix refusals (own_request, self-assignment, rename rule, 401 shape)", () => {
  const code = (r: { body?: { detail?: { code?: string } } }) => r.body?.detail?.code;

  it("lets you give yourself a role below your own only (DIAAT-403)", async () => {
    const admin = await session("jadmin-iac");
    const below = await call(admin.token, "POST", "/api/admin/assignments", {
      user_id: admin.me.user.id,
      jurisdiction: "IAC",
      role: "Judge",
    });
    expect(below.status).toBe(201);
    expect((await call(admin.token, "DELETE", `/api/admin/assignments/${below.body.id}`)).status).toBe(204);
    const same = await call(admin.token, "POST", "/api/admin/assignments", {
      user_id: admin.me.user.id,
      jurisdiction: "IAC",
      role: "JurisdictionAdministrator",
    });
    expect([same.status, code(same)]).toEqual([403, "assignment_not_allowed"]);
    const sys = await session("sysadmin");
    const mine = await call(sys.token, "POST", "/api/admin/assignments", {
      user_id: sys.me.user.id,
      jurisdiction: null,
      role: "JurisdictionSuperAdministrator",
    });
    expect(mine.status).toBe(201);
    await call(sys.token, "DELETE", `/api/admin/assignments/${mine.body.id}`);
  });

  it("refuses deciding your own access request (403 own_request), and lets another administrator", async () => {
    const admin = await session("jadmin-iac");
    // The administrator asks to be a judge in ET (any requestable role, anywhere) ...
    const made = await call(admin.token, "POST", "/api/access-requests", { jurisdiction: "IAC", roles: ["LegalTextManager"] });
    expect(made.status).toBe(201);
    // ... and cannot decide it.
    const own = await call(admin.token, "POST", `/api/admin/access-requests/${made.body.id}/approve`, { reason: null });
    expect([own.status, code(own)]).toEqual([403, "own_request"]);
    const other = await session("multi", "IAC:JurisdictionAdministrator");
    expect((await call(other.token, "POST", `/api/admin/access-requests/${made.body.id}/reject`, { reason: null })).status).toBe(200);
  });

  it("refuses a sixth pending request (409 too_many_pending_requests)", async () => {
    const { token } = await session("jadmin-et");
    const asks: [string, string[]][] = [
      ["ET", ["Judge"]],
      ["ET", ["LegalTextManager"]],
      ["ET", ["Judge", "LegalTextManager"]],
      ["IAC", ["Judge"]],
      ["IAC", ["LegalTextManager"]],
    ];
    for (const [jurisdiction, roles] of asks) {
      expect((await call(token, "POST", "/api/access-requests", { jurisdiction, roles })).status).toBe(201);
    }
    const sixth = await call(token, "POST", "/api/access-requests", { jurisdiction: "IAC", roles: ["Judge", "LegalTextManager"] });
    expect([sixth.status, code(sixth)]).toEqual([409, "too_many_pending_requests"]);
  });

  it("lets a jurisdiction administrator change settings but not the name or enabled (403 permission_denied)", async () => {
    const { token } = await session("jadmin-iac");
    const current = (await call(token, "GET", "/api/admin/jurisdictions")).body[0];
    const same = await call(token, "PUT", `/api/admin/jurisdictions/${current.code}`, {
      name: current.name,
      enabled: current.enabled,
      settings: current.settings,
      version: current.version,
    });
    expect(same.status).toBe(200);
    const renamed = await call(token, "PUT", `/api/admin/jurisdictions/${current.code}`, {
      name: "Another name",
      enabled: current.enabled,
      settings: current.settings,
      version: same.body.version,
    });
    expect([renamed.status, code(renamed)]).toEqual([403, "permission_denied"]);
    const off = await call(token, "PUT", `/api/admin/jurisdictions/${current.code}`, {
      name: current.name,
      enabled: false,
      settings: current.settings,
      version: same.body.version,
    });
    expect([off.status, code(off)]).toEqual([403, "permission_denied"]);
  });

  it("names no person for a change a system administrator made with their own permissions (actor.id null)", async () => {
    const sys = await session("sysadmin");
    const added = await call(sys.token, "POST", "/api/admin/assignments", {
      email: "by-system@example.test",
      jurisdiction: null,
      role: "JurisdictionSuperAdministrator",
    });
    expect(added.status).toBe(201);
    const super_ = await session("jsuper");
    const history = (await call(super_.token, "GET", "/api/admin/role-history")).body.items;
    expect(history[0].actor).toEqual({ id: null, email: "system administrator" });
    await call(sys.token, "DELETE", `/api/admin/assignments/${added.body.id}`);
  });

  it("answers a 401 as {code, message}", async () => {
    const none = await fetch(`${base}/api/me/permissions`);
    expect(none.status).toBe(401);
    expect((await none.json()).detail).toEqual({ code: "not_authenticated", message: expect.any(String) });
    const bad = await fetch(`${base}/api/me/permissions`, { headers: { Authorization: "Bearer nonsense" } });
    expect((await bad.json()).detail.code).toBe("invalid_token");
  });
});
