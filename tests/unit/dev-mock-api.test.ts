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

  it("offers a system administrator the two administrator roles, and never SystemAdministrator", async () => {
    const { token } = await session("sysadmin");
    const { roles } = (await call(token, "GET", "/api/admin/roles")).body;
    expect(roles).toEqual(["JurisdictionAdministrator", "JurisdictionSuperAdministrator"]);
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

  it("lets a system administrator give themselves JurisdictionSuperAdministrator, and nobody else change their own admin role", async () => {
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
    const self = await call(boss.token, "POST", "/api/admin/assignments", {
      user_id: boss.me.user.id,
      jurisdiction: "ET",
      role: "JurisdictionAdministrator",
    });
    expect(self.status).toBe(403);
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
