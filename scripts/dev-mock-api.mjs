#!/usr/bin/env node
/**
 * A tiny stand-in for transcribe-api, for local development and for checking
 * the web app against the authorisation contract (DIAAT-373) without the real
 * API. DEVELOPMENT ONLY: it signs nothing, stores nothing on disk and trusts
 * every caller. Never deploy it and never point a real environment at it.
 *
 * It implements the contract's no-context endpoints (authz-contract.md,
 * section 3) for the nine local personas (section 4), plus just enough of the
 * rest (empty lists, a few admin reads) for the pages to render:
 *
 *   POST   /api/auth/session            X-Dev-Persona, or Bearer mock-entra:<persona>
 *   GET    /api/me/permissions
 *   PUT    /api/me/context
 *   DELETE /api/me/jurisdictions/{code}
 *   GET    /api/jurisdictions/public
 *   GET    /api/jurisdictions/current   (the web asks for this; see Amendments)
 *   POST   /api/access-requests, GET /api/access-requests/mine, POST .../{id}/withdraw
 *   GET    /api/admin/roles, /api/admin/jurisdictions, /api/flags, ...
 *
 * "Tokens" are `mock.<base64url JSON>`: the claims of section 2, unsigned.
 * Advisory headers are checked as the real API does: X-Jurisdiction / X-Role
 * that differ from the token's context answer 409 context_changed. Every route
 * other than the no-context ones answers 403 context_required without a context.
 *
 *   node scripts/dev-mock-api.mjs            # http://127.0.0.1:8000
 *   PORT=8001 node scripts/dev-mock-api.mjs
 */
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 8000);
const TTL_SECONDS = Number(process.env.APP_JWT_TTL_SECONDS ?? 300);

const ET = { code: "ET", name: "Employment Tribunal" };
const IAC = { code: "IAC", name: "Immigration and Asylum Chamber" };
const JURISDICTIONS = [ET, IAC];

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

const a = (jurisdiction, role) => ({ jurisdiction, role });
const PERSONAS = {
  "judge-et": { assignments: [a(ET, "Judge")], sysadmin: false },
  "judge-iac": { assignments: [a(IAC, "Judge")], sysadmin: false },
  multi: { assignments: [a(ET, "Judge"), a(IAC, "JurisdictionAdministrator")], sysadmin: false },
  "jadmin-iac": { assignments: [a(IAC, "JurisdictionAdministrator")], sysadmin: false },
  "jadmin-et": { assignments: [a(ET, "JurisdictionAdministrator")], sysadmin: false },
  "legal-iac": { assignments: [a(IAC, "LegalTextManager")], sysadmin: false },
  jsuper: { assignments: [a(null, "JurisdictionSuperAdministrator")], sysadmin: false },
  sysadmin: { assignments: [], sysadmin: true },
  "no-role": { assignments: [], sysadmin: false },
};

/** Mutable per-user state (assignments change when a user leaves a jurisdiction). */
const users = new Map();
function userFor(persona) {
  if (!users.has(persona)) {
    const seed = PERSONAS[persona];
    users.set(persona, {
      id: randomUUID(),
      email: `${persona}@localhost.test`,
      name: persona,
      assignments: structuredClone(seed.assignments),
      sysadmin: seed.sysadmin,
      requests: [],
    });
  }
  return users.get(persona);
}

const same = (x, y) => (x?.code ?? null) === (y?.code ?? null);
const holds = (user, jurisdictionCode, role) =>
  user.assignments.some((p) => (p.jurisdiction?.code ?? null) === jurisdictionCode && p.role === role);

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
  const pairs = user.assignments;
  let ctx = null;
  if (requested) {
    const [code, role] = [requested.slice(0, requested.indexOf(":")), requested.slice(requested.indexOf(":") + 1)];
    if (holds(user, code === "-" ? null : code, role)) {
      ctx = a(pairs.find((p) => p.role === role && (p.jurisdiction?.code ?? "-") === code).jurisdiction, role);
    }
  } else if (pairs.length === 1 && !user.sysadmin) {
    ctx = pairs[0];
  }
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  return {
    token: sign({ sub: user.id, persona, sysadmin: user.sysadmin, assignments: pairs, ctx, exp }),
    expires_at: new Date(exp * 1000).toISOString(),
    claims: { ctx },
  };
}

function permissionsOf(claims) {
  const fromRole = claims.ctx ? (ROLE_PERMISSIONS[claims.ctx.role] ?? []) : [];
  return [...new Set([...fromRole, ...(claims.sysadmin ? SYSADMIN : [])])];
}

function meOf(claims) {
  const user = userFor(claims.persona);
  const status = claims.ctx || (claims.sysadmin && user.assignments.length === 0)
    ? "ready"
    : user.assignments.length > 0
      ? "choose"
      : "no_access";
  return {
    user: { id: user.id, email: user.email, name: user.name },
    status,
    assignments: user.assignments,
    active: claims.ctx,
    // A user with no context still holds access.request (any signed-in user).
    permissions: claims.ctx || claims.sysadmin ? permissionsOf(claims) : ["access.request"],
    pending_requests: user.requests.filter((r) => r.status === "pending"),
  };
}

const IAC_MATERIAL = {
  ...IAC,
  template: "iac_decision",
  features: { hearing_recordings: true },
  wording: {},
};
const ET_MATERIAL = { ...ET, template: null, features: { hearing_recordings: false }, wording: {} };

function send(res, status, body, headers = {}) {
  const text = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers });
  res.end(text);
}
const refuse = (res, status, code, message) => send(res, status, { detail: { code, message } });

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

const server = createServer(async (req, res) => {
  const finish = res.end.bind(res);
  res.end = (...args) => {
    log(req, res.statusCode);
    return finish(...args);
  };
  const url = new URL(req.url ?? "/", "http://mock");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method ?? "GET";

  if (path === "/health" || path === "/api/health") return send(res, 200, { status: "ok", mock: true });
  if (path === "/api/version") return send(res, 200, { version: "mock" });

  // The only route that takes an identity rather than a BenchNotes token.
  if (method === "POST" && path === "/api/auth/session") {
    const persona =
      req.headers["x-dev-persona"] ?? /^Bearer mock-entra:([\w-]+)$/.exec(req.headers.authorization ?? "")?.[1];
    if (typeof persona !== "string" || !PERSONAS[persona]) {
      return refuse(res, 401, "unauthenticated", "Unknown persona, or not an identity this mock accepts");
    }
    const minted = mint(persona, req.headers["x-requested-context"]);
    const claims = verify(`Bearer ${minted.token}`);
    return send(res, 200, { token: minted.token, expires_at: minted.expires_at, me: meOf(claims) });
  }

  const claims = verify(req.headers.authorization);
  if (!claims) return refuse(res, 401, "unauthenticated", "Missing, expired or malformed token");

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

  const user = userFor(claims.persona);
  const permissions = claims.ctx || claims.sysadmin ? permissionsOf(claims) : ["access.request"];

  // ---- no-context endpoints -------------------------------------------------
  if (method === "GET" && path === "/api/me/permissions") return send(res, 200, meOf(claims));

  if (method === "PUT" && path === "/api/me/context") {
    const body = await readBody(req);
    const code = body.jurisdiction ?? null;
    if (typeof body.role !== "string" || !holds(user, code, body.role)) {
      return refuse(res, 403, "context_not_available", "You do not hold that jurisdiction and role");
    }
    const minted = mint(claims.persona, `${code ?? "-"}:${body.role}`);
    return send(res, 200, { token: minted.token, expires_at: minted.expires_at, me: meOf(verify(`Bearer ${minted.token}`)) });
  }

  const leave = /^\/api\/me\/jurisdictions\/([^/]+)$/.exec(path);
  if (method === "DELETE" && leave) {
    const code = decodeURIComponent(leave[1]);
    user.assignments = user.assignments.filter((p) => p.jurisdiction?.code !== code);
    const stillActive = claims.ctx && (claims.ctx.jurisdiction?.code ?? null) !== code;
    const minted = mint(claims.persona, stillActive ? `${claims.ctx.jurisdiction?.code ?? "-"}:${claims.ctx.role}` : undefined);
    return send(res, 200, { token: minted.token, expires_at: minted.expires_at, me: meOf(verify(`Bearer ${minted.token}`)) });
  }

  if (method === "GET" && path === "/api/jurisdictions/public") return send(res, 200, JURISDICTIONS);

  if (method === "POST" && path === "/api/access-requests") {
    const body = await readBody(req);
    const jurisdiction = JURISDICTIONS.find((j) => j.code === body.jurisdiction);
    const roles = Array.isArray(body.roles) ? body.roles : [];
    if (!jurisdiction) return refuse(res, 400, "jurisdiction_not_found", "No such jurisdiction");
    if (roles.length === 0 || roles.some((r) => !["Judge", "LegalTextManager"].includes(r))) {
      return refuse(res, 400, "role_not_requestable", "Only Judge and LegalTextManager can be requested");
    }
    const same = user.requests.find(
      (r) => r.status === "pending" && r.jurisdiction.code === jurisdiction.code && [...r.roles].sort().join() === [...roles].sort().join()
    );
    if (same) return refuse(res, 409, "request_exists", "You already asked for this");
    const request = {
      id: randomUUID(),
      jurisdiction,
      roles,
      status: "pending",
      created_at: new Date().toISOString(),
      decided_at: null,
      reason: null,
    };
    user.requests.push(request);
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
  if (method === "GET" && path === "/api/flags") return send(res, 200, { dictation_enabled: true });

  // ---- everything else needs a context (or a system administrator) ----------
  if (!claims.ctx && !claims.sysadmin) {
    return refuse(res, 403, "context_required", "Choose where and as what you are working first");
  }
  const need = (permission) => {
    if (permissions.includes(permission)) return true;
    refuse(res, 403, "permission_denied", `Needs ${permission}`);
    return false;
  };

  if (method === "GET" && path === "/api/jurisdictions/current") {
    if (!claims.ctx?.jurisdiction) return refuse(res, 403, "context_required", "No jurisdiction in this context");
    return send(res, 200, claims.ctx.jurisdiction.code === "IAC" ? IAC_MATERIAL : ET_MATERIAL);
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
  if (method === "GET" && path === "/api/v1/jobs") {
    if (!need("recording.own")) return;
    return send(res, 200, []);
  }
  if (method === "GET" && path === "/api/admin/roles") {
    if (!need("admin.access")) return;
    const roles = permissions.includes("jurisdiction_admin.assign")
      ? ["Judge", "LegalTextManager", "JurisdictionAdministrator"]
      : ["Judge", "LegalTextManager"];
    return send(res, 200, { roles });
  }
  if (method === "GET" && path === "/api/admin/jurisdictions") {
    if (!(permissions.includes("jurisdictions.manage") || permissions.includes("jurisdiction.create"))) {
      return refuse(res, 403, "permission_denied", "Needs jurisdictions.manage");
    }
    return send(
      res,
      200,
      JURISDICTIONS.map((j) => ({
        ...j,
        enabled: true,
        settings: { wording: {}, template: j.code === "IAC" ? "iac_decision" : null, features: { hearing_recordings: j.code === "IAC" } },
        member_count: 0,
        version: "v1",
      }))
    );
  }
  if (method === "GET" && path === "/api/admin/jurisdictions/wording-keys") return send(res, 200, { keys: {} });
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

server.listen(PORT, "127.0.0.1", () => {
  console.log(`dev mock API (not the real one) on http://127.0.0.1:${PORT}`);
  console.log(`personas: ${Object.keys(PERSONAS).join(", ")}`);
});
