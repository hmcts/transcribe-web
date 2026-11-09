#!/usr/bin/env node
/**
 * A tiny stand-in for transcribe-api, for local development and for checking
 * the web app against the authorisation contract (DIAAT-373) without the real
 * API. DEVELOPMENT ONLY: it signs nothing, stores nothing on disk and trusts
 * every caller. Never deploy it and never point a real environment at it.
 *
 * It implements the contract (authz-contract.md, section 3) for the nine local
 * personas (section 4), with in-memory state that lasts until it is restarted, so
 * every admin screen can be driven end to end:
 *
 *   POST   /api/auth/session            X-Dev-Persona, or Bearer mock-entra:<persona>
 *   GET    /api/me/permissions          PUT /api/me/context
 *   DELETE /api/me/jurisdictions/{code}
 *   GET    /api/jurisdictions/public    GET /api/jurisdictions/current (see Amendments)
 *   POST   /api/access-requests, GET /api/access-requests/mine, POST .../{id}/withdraw
 *   GET    /api/flags
 *   GET    /api/admin/roles
 *   GET    /api/admin/users             POST /api/admin/assignments
 *   DELETE /api/admin/assignments/{id}  POST /api/admin/users/{id}/deactivate|reactivate
 *   GET    /api/admin/role-history
 *   GET    /api/admin/access-requests?status=pending
 *   POST   /api/admin/access-requests/{id}/approve|reject
 *   GET    /api/admin/jurisdictions     PUT /api/admin/jurisdictions/{code}
 *   GET    /api/admin/feature-flags     PUT /api/admin/feature-flags/{name}
 *   GET    /api/v1/jobs, /api/v1/jobs/{id}, /api/v1/jobs/{id}/history   (two seeded recordings)
 *
 * The assignment rules of section 1 are enforced as the real API will: a
 * jurisdiction administrator assigns Judge and LegalTextManager in the active
 * jurisdiction only; a super administrator also assigns JurisdictionAdministrator;
 * the system administrator assigns JurisdictionAdministrator and
 * JurisdictionSuperAdministrator (and any role to themselves); nobody changes their
 * own admin role or deactivates themselves; nobody grants SystemAdministrator.
 *
 * "Tokens" are `mock.<base64url JSON>`: the claims of section 2, unsigned. As in
 * the real API, what a token may do is what it carried when it was minted: a role
 * given or removed reaches the user at their next mint. Run with a short lifetime
 * to see that quickly:
 *
 *   node scripts/dev-mock-api.mjs                       # http://127.0.0.1:8000
 *   PORT=8001 node scripts/dev-mock-api.mjs
 *   APP_JWT_TTL_SECONDS=75 node scripts/dev-mock-api.mjs   # the web re-mints 60 s before expiry
 *
 * Advisory headers are checked as the real API does: X-Jurisdiction / X-Role
 * that differ from the token's context answer 409 context_changed. Every route
 * other than the no-context ones answers 403 context_required without a context.
 *
 * Seeded so the screens have something to show: two pending access requests (their
 * ids are printed at start-up, for `/admin?tab=approvals&request=<id>`), a little role
 * history, and one recording each for judge-et and judge-iac with an audit history.
 */
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 8000);
const TTL_SECONDS = Number(process.env.APP_JWT_TTL_SECONDS ?? 300);

// ---- reference data ----------------------------------------------------------
const ET = { code: "ET", name: "Employment Tribunal" };
const IAC = { code: "IAC", name: "Immigration and Asylum Chamber" };

/** Jurisdiction records. `version` changes on every save (a stale save is a 409). */
const jurisdictions = [
  { ...ET, enabled: true, template: null, hearing_recordings: true, wording: {}, version: "v1" },
  { ...IAC, enabled: true, template: "iac_decision", hearing_recordings: true, wording: {}, version: "v1" },
];
const refOf = (code) => {
  const j = jurisdictions.find((x) => x.code === code);
  return j ? { code: j.code, name: j.name } : null;
};

// The contract's role map (section 1). Mock copy: the real API owns it.
const BASIC = ["app.access", "context.switch", "access.request"];
const JUDGE = [...BASIC, "dictation.use", "recording.upload", "recording.own", "documents.export", "recording.audit.read", "document_content.read"];
const LEGAL = [...BASIC, "admin.access", "legal_text.manage", "templates.manage", "document_content.read", "document_content.write"];
const JADMIN = [...BASIC, "admin.access", "users.manage", "access.approve", "role_audit.read", "templates.manage", "jurisdictions.manage", "jurisdiction.wording.edit", "jurisdiction.features"];
const JSUPER = [...JADMIN, "jurisdiction.create", "jurisdiction_admin.assign"];
const SYSADMIN = ["admin.access", "feature_flags.manage", "system.settings", "security.alert_test", "jurisdiction_super_admin.assign", "jurisdiction_admin.assign"];
const ROLE_PERMISSIONS = {
  Judge: JUDGE,
  LegalTextManager: LEGAL,
  JurisdictionAdministrator: JADMIN,
  JurisdictionSuperAdministrator: JSUPER,
};
const STORED_ROLES = Object.keys(ROLE_PERMISSIONS);
const REQUESTABLE = ["Judge", "LegalTextManager"];
// The roles whose own-assignment is forbidden (section 1: "your own admin role").
const ADMIN_ROLES = ["JurisdictionAdministrator", "JurisdictionSuperAdministrator"];

const a = (code, role) => ({ id: randomUUID(), jurisdiction: code ? refOf(code) : null, role });
const PERSONAS = {
  "judge-et": { assignments: [["ET", "Judge"]], sysadmin: false },
  "judge-iac": { assignments: [["IAC", "Judge"]], sysadmin: false },
  multi: { assignments: [["ET", "Judge"], ["IAC", "JurisdictionAdministrator"]], sysadmin: false },
  "jadmin-iac": { assignments: [["IAC", "JurisdictionAdministrator"]], sysadmin: false },
  "jadmin-et": { assignments: [["ET", "JurisdictionAdministrator"]], sysadmin: false },
  "legal-iac": { assignments: [["IAC", "LegalTextManager"]], sysadmin: false },
  jsuper: { assignments: [[null, "JurisdictionSuperAdministrator"]], sysadmin: false },
  sysadmin: { assignments: [], sysadmin: true },
  "no-role": { assignments: [], sysadmin: false },
};

// ---- state (in memory) --------------------------------------------------------
/** Every user who has signed in (the seed creates the personas as signed in). */
const users = new Map();
for (const [persona, seed] of Object.entries(PERSONAS)) {
  users.set(persona, {
    id: randomUUID(),
    email: `${persona}@localhost.test`,
    name: persona,
    assignments: seed.assignments.map(([code, role]) => a(code, role)),
    sysadmin: seed.sysadmin,
    is_active: true,
    requests: [],
  });
}
const userFor = (persona) => users.get(persona);
const userById = (id) => [...users.values()].find((u) => u.id === id);
const userByEmail = (email) => [...users.values()].find((u) => u.email === email.toLowerCase());

/** Assignments given by email to someone who has not signed in: claimed at first sign-in. */
const pendingByEmail = new Map(); // email -> { id, email, assignments: [] }

/** Role-change history, newest last (served newest first). */
const roleHistory = [];
function recordChange(claims, change, target, jurisdictionCode, role) {
  const actor = claims ? userFor(claims.persona) : null;
  roleHistory.push({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    actor: actor ? { id: actor.id, email: actor.email } : { id: randomUUID(), email: "system@localhost.test" },
    actor_context: claims?.ctx ? { jurisdiction: claims.ctx.jurisdiction?.code ?? null, role: claims.ctx.role } : null,
    target: { id: target.id ?? null, email: target.email },
    change,
    jurisdiction: jurisdictionCode ?? null,
    role: role ?? null,
  });
}

const flags = [
  {
    name: "dictation_enabled",
    value: true,
    description: "Live dictation: the Dictation pages and the API's dictation routes.",
    updated_at: null,
    updated_by: null,
  },
];

const SEED_REQUEST_IDS = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"];
function seedState() {
  const day = 24 * 3600 * 1000;
  const iso = (ago) => new Date(Date.now() - ago).toISOString();
  userFor("judge-iac").requests.push({
    id: SEED_REQUEST_IDS[0],
    jurisdiction: refOf("ET"),
    roles: ["LegalTextManager"],
    status: "pending",
    created_at: iso(day),
    decided_at: null,
    reason: null,
  });
  userFor("legal-iac").requests.push({
    id: SEED_REQUEST_IDS[1],
    jurisdiction: refOf("IAC"),
    roles: ["Judge"],
    status: "pending",
    created_at: iso(2 * day),
    decided_at: null,
    reason: null,
  });
  const push = (ago, actor, change, target, code, role) => {
    recordChange({ persona: actor, ctx: PERSONAS[actor].assignments[0] ? { jurisdiction: refOf(PERSONAS[actor].assignments[0][0]), role: PERSONAS[actor].assignments[0][1] } : null }, change, userFor(target), code, role);
    roleHistory[roleHistory.length - 1].timestamp = iso(ago);
  };
  push(3 * day, "jsuper", "assignment.added", "jadmin-iac", "IAC", "JurisdictionAdministrator");
  push(2 * day, "jadmin-iac", "assignment.added", "judge-iac", "IAC", "Judge");
  push(2 * day, "jadmin-iac", "assignment.added", "legal-iac", "IAC", "LegalTextManager");
}

// Two recordings, owned by judge-et and judge-iac, each with an audit history.
const jobs = [
  { id: "11111111-1111-4111-8111-000000000001", owner: "judge-et", jurisdiction: "ET", reference: "ET/1234/26" },
  { id: "11111111-1111-4111-8111-000000000002", owner: "judge-iac", jurisdiction: "IAC", reference: "IA/56789/2026" },
];
const jobHistory = new Map(); // job id -> entries, oldest first
function auditJob(job, action, actorLabel, role, outcome = "success", agoMs = 0) {
  const entries = jobHistory.get(job.id) ?? [];
  entries.push({
    id: randomUUID(),
    timestamp: new Date(Date.now() - agoMs).toISOString(),
    action,
    actor_label: actorLabel,
    actor_role: role,
    outcome,
  });
  jobHistory.set(job.id, entries);
}
function seedJobs() {
  const hour = 3600 * 1000;
  for (const job of jobs) {
    const who = job.owner === "judge-et" ? "J. Judge (you)" : "J. Judge (you)";
    auditJob(job, "job.submit", who, "Judge", "success", 30 * hour);
    auditJob(job, "transcript.view", who, "Judge", "success", 29 * hour);
    auditJob(job, "transcript.edit", who, "Judge", "success", 28 * hour);
    auditJob(job, "transcript.rollback", who, "Judge", "success", 27 * hour);
    auditJob(job, "audio.export", who, "Judge", "success", 26 * hour);
  }
}
const backendJob = (job) => ({
  job_id: job.id,
  status: "succeeded",
  created_at: new Date(Date.now() - 30 * 3600 * 1000).toISOString(),
  updated_at: new Date(Date.now() - 29 * 3600 * 1000).toISOString(),
  dialogue_entries: [
    { id: "d1", speaker: "Speaker 1", text: "This is a seeded segment of the mock transcript.", start_time: 0, end_time: 4, confidence: 0.95, words: [], alternatives: [], accepted: false, correction_history: [] },
    { id: "d2", speaker: "Speaker 2", text: "A second seeded segment, so the page has something to show.", start_time: 4, end_time: 9, confidence: 0.9, words: [], alternatives: [], accepted: false, correction_history: [] },
  ],
  accuracy: null,
  needs_review: null,
  error_message: null,
  metadata: { case_reference: job.reference, audio_file_name: "hearing.mp3" },
  audio_duration_seconds: 9,
  transcription_duration_seconds: 3,
  model_identifier: "mock",
  model_display_name: "Mock model",
});

const same = (x, y) => (x?.code ?? null) === (y?.code ?? null);
const holds = (user, jurisdictionCode, role) =>
  user.assignments.some((p) => (p.jurisdiction?.code ?? null) === jurisdictionCode && p.role === role);
/** An assignment as the contract shows it in MeResponse (no id). */
const plain = (p) => ({ jurisdiction: p.jurisdiction, role: p.role });

// ---- tokens --------------------------------------------------------------------
function sign(claims) {
  return `mock.${Buffer.from(JSON.stringify(claims)).toString("base64url")}`;
}
function verify(header) {
  const token = /^Bearer (mock\.[\w-]+)$/.exec(header ?? "")?.[1];
  if (!token) return null;
  try {
    const claims = JSON.parse(Buffer.from(token.slice(5), "base64url").toString());
    return claims.exp * 1000 > Date.now() ? claims : null;
  } catch {
    return null;
  }
}

function mint(persona, requested) {
  const user = userFor(persona);
  const pairs = user.assignments.map(plain);
  let ctx = null;
  if (requested) {
    const [code, role] = [requested.slice(0, requested.indexOf(":")), requested.slice(requested.indexOf(":") + 1)];
    if (holds(user, code === "-" ? null : code, role)) {
      ctx = pairs.find((p) => p.role === role && (p.jurisdiction?.code ?? "-") === code);
    }
  } else if (pairs.length === 1 && !user.sysadmin) {
    ctx = pairs[0];
  }
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  return {
    token: sign({ sub: user.id, persona, sysadmin: user.sysadmin, assignments: pairs, ctx, exp }),
    expires_at: new Date(exp * 1000).toISOString(),
  };
}

function permissionsOf(claims) {
  const fromRole = claims.ctx ? (ROLE_PERMISSIONS[claims.ctx.role] ?? []) : [];
  return [...new Set([...fromRole, ...(claims.sysadmin ? SYSADMIN : [])])];
}

/** `me` from what the token carries (as the API does), plus the user's live pending requests. */
function meOf(claims) {
  const user = userFor(claims.persona);
  const pairs = claims.assignments;
  const status = claims.ctx || (claims.sysadmin && pairs.length === 0) ? "ready" : pairs.length > 0 ? "choose" : "no_access";
  return {
    user: { id: user.id, email: user.email, name: user.name },
    status,
    assignments: pairs,
    active: claims.ctx,
    // A user with no context still holds access.request (any signed-in user).
    permissions: claims.ctx || claims.sysadmin ? permissionsOf(claims) : ["access.request"],
    pending_requests: user.requests.filter((r) => r.status === "pending"),
  };
}
const tokenBody = (minted) => ({ token: minted.token, expires_at: minted.expires_at, me: meOf(verify(`Bearer ${minted.token}`)) });

function materialOf(code) {
  const j = jurisdictions.find((x) => x.code === code);
  return {
    code: j.code,
    name: j.name,
    template: j.template,
    features: { hearing_recordings: j.hearing_recordings },
    wording: j.wording,
  };
}

// ---- http helpers ------------------------------------------------------------------
function send(res, status, body, headers = {}) {
  const text = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers });
  res.end(text);
}
const refuse = (res, status, code, message) => send(res, status, { detail: { code, message } });
const notAllowed = (res, message) => refuse(res, 403, "assignment_not_allowed", message);

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

const log = (req, status) => console.log(`${req.method} ${req.url} -> ${status}`);
const intParam = (value, fallback) => {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

/** The user rows the contract's list returns, for what `claims` may see. */
function listUsers(claims, search, jurisdictionFilter, roleFilter) {
  const perms = permissionsOf(claims);
  const everywhere = perms.includes("jurisdiction_super_admin.assign") || perms.includes("jurisdiction_admin.assign");
  const scope = everywhere ? null : claims.ctx?.jurisdiction?.code ?? "";
  const needle = (search ?? "").trim().toLowerCase();
  const rows = [];
  const view = (assignments) =>
    assignments
      .filter((p) => scope === null || (p.jurisdiction?.code ?? null) === scope)
      .filter((p) => !jurisdictionFilter || (p.jurisdiction?.code ?? null) === jurisdictionFilter)
      .map((p) => ({ id: p.id, jurisdiction: p.jurisdiction, role: p.role }));
  for (const user of users.values()) {
    if (needle && !user.email.includes(needle)) continue;
    const shown = view(user.assignments);
    // A scoped caller lists the people in their jurisdiction; a search reaches
    // anyone who has signed in, so they can be added.
    if (!needle && scope !== null && shown.length === 0) continue;
    if (jurisdictionFilter && shown.length === 0 && !needle) continue;
    if (roleFilter && !shown.some((p) => p.role === roleFilter)) continue;
    rows.push({ id: user.id, email: user.email, name: user.name, is_active: user.is_active, assignments: shown, pending: false });
  }
  for (const pending of pendingByEmail.values()) {
    if (needle && !pending.email.includes(needle)) continue;
    const shown = view(pending.assignments);
    if (shown.length === 0) continue;
    if (roleFilter && !shown.some((p) => p.role === roleFilter)) continue;
    rows.push({ id: pending.id, email: pending.email, name: null, is_active: true, assignments: shown, pending: true });
  }
  return rows.sort((x, y) => x.email.localeCompare(y.email));
}

const server = createServer(async (req, res) => {
  const finish = res.end.bind(res);
  res.end = (...args) => {
    log(req, res.statusCode);
    return finish(...args);
  };
  const url = new URL(req.url ?? "/", "http://mock");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method ?? "GET";
  const q = url.searchParams;

  if (path === "/health" || path === "/api/health") return send(res, 200, { status: "ok", mock: true });
  if (path === "/api/version") return send(res, 200, { version: "mock" });

  // The only route that takes an identity rather than a BenchNotes token.
  if (method === "POST" && path === "/api/auth/session") {
    const persona =
      req.headers["x-dev-persona"] ?? /^Bearer mock-entra:([\w-]+)$/.exec(req.headers.authorization ?? "")?.[1];
    if (typeof persona !== "string" || !PERSONAS[persona]) {
      return refuse(res, 401, "unauthenticated", "Unknown persona, or not an identity this mock accepts");
    }
    if (!userFor(persona).is_active) return refuse(res, 403, "user_deactivated", "This user has been deactivated");
    const minted = mint(persona, req.headers["x-requested-context"]);
    return send(res, 200, tokenBody(minted));
  }

  const claims = verify(req.headers.authorization);
  if (!claims) return refuse(res, 401, "unauthenticated", "Missing, expired or malformed token");

  // A user deactivated after the token was minted is refused at once.
  const user = userFor(claims.persona);
  if (!user.is_active) return refuse(res, 403, "user_deactivated", "This user has been deactivated");

  // Advisory headers: a tab whose context differs from the session's is stale.
  const advisoryJurisdiction = req.headers["x-jurisdiction"];
  const advisoryRole = req.headers["x-role"];
  if (advisoryJurisdiction !== undefined || advisoryRole !== undefined) {
    const ctx = claims.ctx;
    const tabJurisdiction = advisoryJurisdiction === "-" ? null : advisoryJurisdiction;
    if (
      (advisoryJurisdiction !== undefined && tabJurisdiction !== (ctx?.jurisdiction?.code ?? null)) ||
      (advisoryRole !== undefined && advisoryRole !== (ctx?.role ?? undefined))
    ) {
      return refuse(res, 409, "context_changed", "Your working context changed in another tab");
    }
  }

  const permissions = claims.ctx || claims.sysadmin ? permissionsOf(claims) : ["access.request"];

  // ---- no-context endpoints -------------------------------------------------
  if (method === "GET" && path === "/api/me/permissions") return send(res, 200, meOf(claims));

  if (method === "PUT" && path === "/api/me/context") {
    const body = await readBody(req);
    const code = body.jurisdiction ?? null;
    if (typeof body.role !== "string" || !holds(user, code, body.role)) {
      return refuse(res, 403, "context_not_available", "You do not hold that jurisdiction and role");
    }
    return send(res, 200, tokenBody(mint(claims.persona, `${code ?? "-"}:${body.role}`)));
  }

  const leave = /^\/api\/me\/jurisdictions\/([^/]+)$/.exec(path);
  if (method === "DELETE" && leave) {
    const code = decodeURIComponent(leave[1]);
    if (!user.assignments.some((p) => p.jurisdiction?.code === code)) {
      return refuse(res, 404, "not_a_member", "You hold no role there");
    }
    for (const p of user.assignments.filter((x) => x.jurisdiction?.code === code)) {
      recordChange(claims, "membership.leave", user, code, p.role);
    }
    user.assignments = user.assignments.filter((p) => p.jurisdiction?.code !== code);
    const stillActive = claims.ctx && (claims.ctx.jurisdiction?.code ?? null) !== code;
    return send(res, 200, tokenBody(mint(claims.persona, stillActive ? `${claims.ctx.jurisdiction?.code ?? "-"}:${claims.ctx.role}` : undefined)));
  }

  if (method === "GET" && path === "/api/jurisdictions/public") {
    return send(res, 200, jurisdictions.filter((j) => j.enabled).map((j) => ({ code: j.code, name: j.name })));
  }

  if (method === "POST" && path === "/api/access-requests") {
    const body = await readBody(req);
    const jurisdiction = jurisdictions.find((j) => j.code === body.jurisdiction);
    const roles = Array.isArray(body.roles) ? body.roles : [];
    if (!jurisdiction) return refuse(res, 400, "jurisdiction_not_found", "No such jurisdiction");
    if (roles.length === 0 || roles.some((r) => !REQUESTABLE.includes(r))) {
      return refuse(res, 400, "role_not_requestable", "Only Judge and LegalTextManager can be requested");
    }
    const duplicate = user.requests.find(
      (r) => r.status === "pending" && r.jurisdiction.code === jurisdiction.code && [...r.roles].sort().join() === [...roles].sort().join()
    );
    if (duplicate) return refuse(res, 409, "request_exists", "You already asked for this");
    const request = {
      id: randomUUID(),
      jurisdiction: refOf(jurisdiction.code),
      roles,
      status: "pending",
      created_at: new Date().toISOString(),
      decided_at: null,
      reason: null,
    };
    user.requests.push(request);
    console.log(`access request ${request.id}: ${user.email} -> ${jurisdiction.code} ${roles.join("+")} (link: /admin?tab=approvals&request=${request.id})`);
    return send(res, 201, request);
  }
  if (method === "GET" && path === "/api/access-requests/mine") return send(res, 200, user.requests);
  const withdraw = /^\/api\/access-requests\/([^/]+)\/withdraw$/.exec(path);
  if (method === "POST" && withdraw) {
    const request = user.requests.find((r) => r.id === withdraw[1]);
    if (!request) return refuse(res, 404, "not_found", "No such request");
    if (request.status === "pending") {
      request.status = "withdrawn";
      request.decided_at = new Date().toISOString();
    }
    return send(res, 200, request);
  }
  if (method === "GET" && path === "/api/flags") {
    return send(res, 200, { dictation_enabled: flags.find((f) => f.name === "dictation_enabled").value });
  }

  // ---- everything else needs a context (or a system administrator) ----------
  if (!claims.ctx && !claims.sysadmin) {
    return refuse(res, 403, "context_required", "Choose where and as what you are working first");
  }
  const need = (permission) => {
    if (permissions.includes(permission)) return true;
    refuse(res, 403, "permission_denied", `Needs ${permission}`);
    return false;
  };
  const needAny = (...list) => {
    if (list.some((p) => permissions.includes(p))) return true;
    refuse(res, 403, "permission_denied", `Needs ${list.join(" or ")}`);
    return false;
  };

  if (method === "GET" && path === "/api/jurisdictions/current") {
    if (!claims.ctx?.jurisdiction) return refuse(res, 403, "context_required", "No jurisdiction in this context");
    return send(res, 200, materialOf(claims.ctx.jurisdiction.code));
  }
  if (method === "GET" && path === "/api/user/onboarding-status") {
    if (!need("app.access")) return;
    return send(res, 200, {
      has_completed_onboarding: true,
      force_onboarding_override: false,
      should_show_onboarding: false,
      should_show_coming_soon: false,
      user_id: user.id,
      environment: "local",
    });
  }
  if (method === "GET" && (path === "/api/users/me" || path === "/api/user/profile")) {
    if (!need("app.access")) return;
    return send(res, 200, { id: user.id, email: user.email, has_completed_onboarding: true, role: null });
  }
  if (method === "GET" && path === "/api/transcriptions-metadata") {
    if (!need("dictation.use")) return;
    return send(res, 200, []);
  }

  // ---- recordings (two seeded ones, owned by judge-et and judge-iac) ---------
  const mine = (job) => job.owner === claims.persona && job.jurisdiction === claims.ctx?.jurisdiction?.code;
  if (method === "GET" && path === "/api/v1/jobs") {
    if (!need("recording.own")) return;
    const list = jobs.filter(mine).map(backendJob);
    return send(res, 200, { jobs: list, total: list.length, limit: 20, offset: 0 });
  }
  const jobRoute = /^\/api\/v1\/jobs\/([^/]+)(\/history)?$/.exec(path);
  if (method === "GET" && jobRoute) {
    if (!need("recording.own")) return;
    const job = jobs.find((j) => j.id === jobRoute[1]);
    if (!job || !mine(job)) return refuse(res, 404, "not_found", "Job not found");
    if (!jobRoute[2]) {
      auditJob(job, "transcript.view", `${user.name} (you)`, claims.ctx.role);
      return send(res, 200, backendJob(job));
    }
    // History: the recording's owner, acting with recording.audit.read; anyone else
    // is answered as for a recording they cannot see. No transcript text.
    if (!permissions.includes("recording.audit.read")) return refuse(res, 404, "not_found", "Job not found");
    const all = [...(jobHistory.get(job.id) ?? [])].reverse();
    const pageSize = intParam(q.get("page_size"), 50);
    const page = intParam(q.get("page"), 1);
    return send(res, 200, { items: all.slice((page - 1) * pageSize, page * pageSize), total: all.length });
  }

  // ---- admin -------------------------------------------------------------------------
  // What the caller may assign, from the permissions of the token's context (never
  // a system administrator role). A system administrator may also give themselves any.
  const assignable = () => {
    const roles = [];
    if (permissions.includes("users.manage")) roles.push("Judge", "LegalTextManager");
    if (permissions.includes("jurisdiction_admin.assign")) roles.push("JurisdictionAdministrator");
    if (permissions.includes("jurisdiction_super_admin.assign")) roles.push("JurisdictionSuperAdministrator");
    return roles;
  };
  // Jurisdictions the caller works across: all for those who assign administrators,
  // else the active one.
  const reaches = (code) =>
    permissions.includes("jurisdiction_admin.assign") ||
    permissions.includes("jurisdiction_super_admin.assign") ||
    (claims.ctx?.jurisdiction?.code ?? null) === code;

  if (method === "GET" && path === "/api/admin/roles") {
    if (!need("admin.access")) return;
    return send(res, 200, { roles: assignable() });
  }

  if (method === "GET" && path === "/api/admin/users") {
    if (!needAny("users.manage", "jurisdiction_super_admin.assign")) return;
    const rows = listUsers(claims, q.get("search"), q.get("jurisdiction"), q.get("role"));
    const pageSize = intParam(q.get("page_size"), 25);
    const page = intParam(q.get("page"), 1);
    return send(res, 200, { items: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, page_size: pageSize });
  }

  if (method === "POST" && path === "/api/admin/assignments") {
    if (!needAny("users.manage", "jurisdiction_admin.assign", "jurisdiction_super_admin.assign")) return;
    const body = await readBody(req);
    const role = body.role;
    const code = body.jurisdiction ?? null;
    if (!STORED_ROLES.includes(role)) return notAllowed(res, "That role cannot be given");
    if ((role === "JurisdictionSuperAdministrator") !== (code === null)) {
      return refuse(res, 400, "invalid_assignment", code === null ? "That role needs a jurisdiction" : "That role has no jurisdiction");
    }
    if (code !== null && !refOf(code)) return refuse(res, 404, "jurisdiction_not_found", "No such jurisdiction");
    let target = body.user_id ? userById(body.user_id) : body.email ? userByEmail(String(body.email)) : null;
    if (body.user_id && !target) return refuse(res, 404, "user_not_found", "No such user");
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!target && !/^[^\s@]+@[^\s@]+$/.test(email)) return refuse(res, 400, "invalid_email", "Enter a full email address");
    const toSelf = target?.id === user.id;
    const own = toSelf && claims.sysadmin; // a system administrator may give themselves any role
    if (!own) {
      if (!assignable().includes(role)) return notAllowed(res, "You cannot give that role");
      if (code !== null && !reaches(code)) return notAllowed(res, "That is not your jurisdiction");
      if (toSelf && ADMIN_ROLES.includes(role)) return notAllowed(res, "You cannot change your own administrator role");
    }
    const holder = target ?? pendingByEmail.get(email) ?? { id: randomUUID(), email, assignments: [] };
    if (!target) pendingByEmail.set(email, holder);
    if (holder.assignments.some((p) => p.role === role && (p.jurisdiction?.code ?? null) === code)) {
      return refuse(res, 409, "assignment_exists", "They already have that role there");
    }
    const created = a(code, role);
    holder.assignments.push(created);
    recordChange(claims, "assignment.added", holder, code, role);
    return send(res, 201, { id: created.id, jurisdiction: created.jurisdiction, role });
  }

  const assignment = /^\/api\/admin\/assignments\/([^/]+)$/.exec(path);
  if (method === "DELETE" && assignment) {
    if (!needAny("users.manage", "jurisdiction_admin.assign", "jurisdiction_super_admin.assign")) return;
    const holders = [...users.values(), ...pendingByEmail.values()];
    const holder = holders.find((h) => h.assignments.some((p) => p.id === assignment[1]));
    const found = holder?.assignments.find((p) => p.id === assignment[1]);
    if (!holder || !found) return refuse(res, 404, "not_found", "No such assignment");
    const code = found.jurisdiction?.code ?? null;
    const own = holder.id === user.id && claims.sysadmin;
    if (!own) {
      if (!assignable().includes(found.role)) return notAllowed(res, "You cannot remove that role");
      if (code !== null && !reaches(code)) return refuse(res, 404, "not_found", "No such assignment");
      if (holder.id === user.id && ADMIN_ROLES.includes(found.role)) return notAllowed(res, "You cannot change your own administrator role");
    }
    holder.assignments = holder.assignments.filter((p) => p.id !== found.id);
    if (holder.assignments.length === 0 && pendingByEmail.get(holder.email) === holder) {
      pendingByEmail.delete(holder.email);
    }
    recordChange(claims, "assignment.removed", holder, code, found.role);
    return send(res, 204);
  }

  const setActive = /^\/api\/admin\/users\/([^/]+)\/(deactivate|reactivate)$/.exec(path);
  if (method === "POST" && setActive) {
    if (!need("users.manage")) return;
    const target = userById(setActive[1]);
    if (!target) return refuse(res, 404, "user_not_found", "No such user");
    if (target.id === user.id) return refuse(res, 403, "cannot_deactivate_self", "You cannot deactivate yourself");
    const scoped = !permissions.includes("jurisdiction_admin.assign");
    if (scoped && !target.assignments.some((p) => p.jurisdiction?.code === claims.ctx?.jurisdiction?.code)) {
      return refuse(res, 404, "user_not_found", "No such user");
    }
    target.is_active = setActive[2] === "reactivate";
    recordChange(claims, target.is_active ? "user.reactivated" : "user.deactivated", target, claims.ctx?.jurisdiction?.code ?? null, null);
    return send(res, 204);
  }

  if (method === "GET" && path === "/api/admin/role-history") {
    if (!need("role_audit.read")) return;
    const everywhere = permissions.includes("jurisdiction_admin.assign");
    const scope = everywhere ? null : claims.ctx?.jurisdiction?.code ?? "";
    const wanted = q.get("jurisdiction");
    const rows = roleHistory
      .filter((e) => scope === null || e.jurisdiction === scope)
      .filter((e) => !wanted || e.jurisdiction === wanted)
      .reverse();
    const pageSize = intParam(q.get("page_size"), 50);
    const page = intParam(q.get("page"), 1);
    return send(res, 200, { items: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length });
  }

  // Access requests: the queue of the caller's jurisdictions, and a decision.
  const requestsInScope = () =>
    [...users.values()].flatMap((u) =>
      u.requests.map((r) => ({ ...r, requester: { id: u.id, email: u.email, name: u.name } }))
    ).filter((r) => reaches(r.jurisdiction.code));
  if (method === "GET" && path === "/api/admin/access-requests") {
    if (!need("access.approve")) return;
    const status = q.get("status") ?? "pending";
    return send(res, 200, requestsInScope().filter((r) => r.status === status).sort((x, y) => x.created_at.localeCompare(y.created_at)));
  }
  const decide = /^\/api\/admin\/access-requests\/([^/]+)\/(approve|reject)$/.exec(path);
  if (method === "POST" && decide) {
    if (!need("access.approve")) return;
    const body = await readBody(req);
    const found = requestsInScope().find((r) => r.id === decide[1]);
    if (!found) return refuse(res, 404, "not_found", "No such request");
    const owner = userById(found.requester.id);
    const request = owner.requests.find((r) => r.id === found.id);
    if (request.status !== "pending") return refuse(res, 409, "request_not_pending", "That request has already been decided");
    request.status = decide[2] === "approve" ? "approved" : "rejected";
    request.decided_at = new Date().toISOString();
    request.reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : null;
    for (const role of request.roles) {
      if (request.status === "approved" && !holds(owner, request.jurisdiction.code, role)) {
        owner.assignments.push(a(request.jurisdiction.code, role));
      }
      recordChange(claims, request.status === "approved" ? "access_request.approved" : "access_request.rejected", owner, request.jurisdiction.code, role);
    }
    return send(res, 200, request);
  }

  // Jurisdictions: settings behind jurisdictions.manage, creating behind jurisdiction.create.
  const adminShape = (j) => ({
    code: j.code,
    name: j.name,
    enabled: j.enabled,
    settings: { wording: j.wording, template: j.template, features: { hearing_recordings: j.hearing_recordings } },
    member_count: [...users.values()].filter((u) => u.assignments.some((p) => p.jurisdiction?.code === j.code)).length,
    version: j.version,
  });
  if (method === "GET" && path === "/api/admin/jurisdictions") {
    if (!needAny("jurisdictions.manage", "jurisdiction.create")) return;
    return send(res, 200, jurisdictions.filter((j) => reaches(j.code)).map(adminShape));
  }
  if (method === "GET" && path === "/api/admin/jurisdictions/wording-keys") {
    return send(res, 200, { keys: { "home.intro": "Introduction under the welcome heading", "help.subtitle": "Under the service name" } });
  }
  const putJurisdiction = /^\/api\/admin\/jurisdictions\/([^/]+)$/.exec(path);
  if (method === "PUT" && putJurisdiction) {
    const code = decodeURIComponent(putJurisdiction[1]).toUpperCase();
    const body = await readBody(req);
    const existing = jurisdictions.find((j) => j.code === code);
    if (!existing) {
      if (!need("jurisdiction.create")) return;
      if (body.version) return refuse(res, 409, "version_conflict", "That jurisdiction changed meanwhile");
      const created = { code, name: String(body.name ?? code), enabled: body.enabled ?? true, template: body.settings?.template ?? null, hearing_recordings: !!body.settings?.features?.hearing_recordings, wording: body.settings?.wording ?? {}, version: "v1" };
      jurisdictions.push(created);
      return send(res, 200, adminShape(created));
    }
    if (!need("jurisdictions.manage")) return;
    if (!reaches(code)) return refuse(res, 403, "permission_denied", "That is not your jurisdiction");
    if (!body.version) return refuse(res, 409, "already_exists", `${code} already exists`);
    if (body.version !== existing.version) return refuse(res, 409, "version_conflict", "That jurisdiction changed meanwhile");
    existing.name = String(body.name ?? existing.name);
    if (typeof body.enabled === "boolean") existing.enabled = body.enabled;
    existing.template = body.settings?.template ?? null;
    existing.hearing_recordings = !!body.settings?.features?.hearing_recordings;
    existing.wording = body.settings?.wording ?? {};
    existing.version = `v${Number(existing.version.slice(1)) + 1}`;
    return send(res, 200, adminShape(existing));
  }

  // Feature flags (system administrator).
  if (method === "GET" && path === "/api/admin/feature-flags") {
    if (!need("feature_flags.manage")) return;
    return send(res, 200, { flags });
  }
  const putFlag = /^\/api\/admin\/feature-flags\/([^/]+)$/.exec(path);
  if (method === "PUT" && putFlag) {
    if (!need("feature_flags.manage")) return;
    const flag = flags.find((f) => f.name === decodeURIComponent(putFlag[1]));
    if (!flag) return refuse(res, 404, "flag_not_found", "No such flag");
    const body = await readBody(req);
    if (typeof body.value !== "boolean") return refuse(res, 422, "invalid_value", "value must be true or false");
    flag.value = body.value;
    flag.updated_at = new Date().toISOString();
    flag.updated_by = user.email;
    return send(res, 200, { flags });
  }

  if (method === "GET" && path === "/api/admin/document-content") {
    if (!need("legal_text.manage")) return;
    return send(res, 200, {
      jurisdiction: claims.ctx?.jurisdiction ?? null,
      has_legal_wording: false,
      hearing_types: [],
      legal_frameworks: [],
      anonymity: { statuses: [] },
    });
  }
  if (method === "GET" && path === "/api/jurisdictions/wording") {
    if (!need("jurisdiction.wording.edit")) return;
    return send(res, 200, { code: claims.ctx.jurisdiction.code, name: claims.ctx.jurisdiction.name, keys: { "home.intro": "Introduction under the welcome heading" }, wording: {}, version: "v1" });
  }

  return refuse(res, 404, "mock_not_implemented", `The mock API does not implement ${method} ${path}`);
});

seedState();
seedJobs();
server.listen(PORT, "127.0.0.1", () => {
  console.log(`dev mock API (not the real one) on http://127.0.0.1:${PORT}`);
  console.log(`personas: ${Object.keys(PERSONAS).join(", ")}`);
  console.log(`token lifetime ${TTL_SECONDS}s`);
  console.log(`seeded requests: /admin?tab=approvals&request=${SEED_REQUEST_IDS[0]}  (judge-iac -> ET)`);
  console.log(`                 /admin?tab=approvals&request=${SEED_REQUEST_IDS[1]}  (legal-iac -> IAC)`);
  console.log(`seeded recordings: ${jobs.map((j) => `${j.owner}: /recording/jobs/${j.id}`).join("; ")}`);
});
