# Authorisation in transcribe-web (DIAAT-373, web side)

What the web does about who a user is and what they may do. The API is the only
enforcement point; the web decides nothing from role names, it shows or hides UI
from the permissions the API returns. The interfaces are fixed in
`authz-contract.md` (kept by the coordinator next to the plan); this page is how
the web uses them.

## The flow

```
browser                      Next.js (server)                         transcribe-api
   |                               |                                        |
   |-- /auth/login (OIDC) -------->|                                        |
   |<-- Entra sign-in, callback ---|                                        |
   |                               |-- POST /api/auth/session (Entra ID) -->|
   |                               |<-- {token, expires_at, me} ------------|
   |                               |   session = {idToken, appToken,        |
   |                               |              appTokenExpiresAt,        |
   |                               |              context}  (Redis)         |
   |<-- cookie transcribe_session -|                                        |
   |                               |                                        |
   |-- GET /api/me/permissions --->| (Caddy forward_auth adds the token) -->|
   |<-- me: status, assignments, active, permissions, pending_requests ------|
```

* The BenchNotes access token is a short-lived (default 300 s) JWT minted by the
  API from the Entra ID token. It lives only in the server-side session
  (`lib/auth/session-store.ts`; Redis in deployment, memory locally). The browser
  holds only the opaque `transcribe_session` cookie and never sees the token.
* `bearerForSession` (`lib/auth/session.ts`) is what Caddy's `forward_auth`
  (`/auth/forward`) and the recording route handlers send. It is the BenchNotes
  token, never the Entra one. Within 60 s of expiry it mints again from the Entra
  ID token (refreshed first if due) with `X-Requested-Context: <jurisdiction|->:<role>`
  from the session, so the chosen context survives re-mints. Whatever the API says
  is active is what the session remembers. If the API refuses the mint (401/403)
  the session ends, as it does today when the Entra refresh fails; a blip (API
  down) keeps a still-valid token.
* A change to the user's access (a role added or removed, a request approved)
  reaches them at the next re-mint, within the token lifetime. `POST /auth/session`
  mints now (the "Check again" button on the no-access page).

### Routes that return a token never reach the browser

`PUT /api/me/context`, `DELETE /api/me/jurisdictions/{code}` and
`POST /api/auth/session` answer with a new token. The browser calls these
through Next.js instead, and gets only the `me` object back:

| Browser call | Next.js route | API call |
|---|---|---|
| choose a context | `POST /auth/context` `{jurisdiction, role}` | `PUT /api/me/context` |
| leave a jurisdiction | `DELETE /auth/jurisdictions/{code}` | `DELETE /api/me/jurisdictions/{code}` |
| mint now | `POST /auth/session` | `POST /api/auth/session` |

The `Caddyfile` answers 404 for the API's own routes (`@token_routes`), and the
local dev proxy does the same, so the token cannot be fetched by hand either.

## Working context, per session and per tab

* The choice of (jurisdiction, role) is remembered for the session on the
  server. There is no default: after sign-in a user with one pair goes straight
  in (the API selects it), a user with several sees "choose where and as what"
  (`status: "choose"`), a user with none sees the "no access yet" page
  (`status: "no_access"`). A system administrator with no assignments is
  `ready` with system pages only.
* Each tab also remembers, in `sessionStorage`, the context its page state was
  loaded for (`lib/jurisdiction-session.ts`) and names it on every call in
  `X-Jurisdiction` (`-` for a global role) and `X-Role`. If another tab switched,
  the API answers 409 `context_changed`; one watcher on `fetch`
  (`lib/access/context-changed.ts`) sees every call and the tab shows a banner
  asking to reload. It does not reload by itself, so nothing being typed or
  dictated is lost, and the stale tab's saves are refused until it does.
* `GET /api/me/permissions` is asked without any context headers, and the tab
  adopts the answer.
* Switching (`providers/access.tsx`, `switchContext`): save the tab's work
  (the `onBeforeJurisdictionSwitch` handlers), `POST /auth/context`, save again,
  then reload at the same page if it is a list-level page the new context may use
  (`lib/access/routes.ts`), else at `/`. If the second save fails the previous
  context is put back. Leaving a jurisdiction does the same with `DELETE`.

## How permissions drive the UI

`providers/access.tsx` exposes `useAccess()`: `status`, `me`, `can(permission)`,
`active`, `assignments`, `stale`, `refresh`, `checkAgain`, `switchContext`,
`leaveJurisdiction`. Children render once `status` is `ready`; before that the
user sees the screen for their state (loading, choose, no access, or, in local
development, the persona picker). Privacy, cookies, support and the other pages
that are nobody's material render in any state.

| UI | Needs |
|---|---|
| Header: Admin link, home-page Admin tile, `/admin` | `admin.access` |
| Header: Wording link, `/jurisdiction-wording` | `jurisdiction.wording.edit` |
| Header/home: Dictation, `/record`, `/upload`, `/speech-demo`, dictation list, backup recovery, dictation help | `dictation.use` (and the dictation switch) |
| Header/home: hearing recordings, `/recording/**` | `recording.own` (and the jurisdiction using them) |
| Admin tab Document Content | `legal_text.manage` |
| Admin tab Templates | `templates.manage` |
| Admin tab Users | `users.manage` |
| Admin tab Approvals | `access.approve` |
| Admin tab Jurisdictions | `jurisdictions.manage` or `jurisdiction.create` |
| Admin tab Super administrators | `jurisdiction_super_admin.assign` |
| Admin tab Feature flags | `feature_flags.manage` |
| Onboarding check, dictation list loading | `app.access`, `dictation.use` |

The path-to-permission table for pages is `lib/access/routes.ts`; the route
layouts (`app/record/layout.tsx` and the others) use it, and a page at its
address without the permission shows "This is not available in your role". Users,
Approvals, Templates, Super administrators and Feature flags are placeholders
(Phase 6 and 7 build them); Document Content and Jurisdictions are the existing
panels.

The only role values in the web are the two on the access request form
(`lib/access/requestable-roles.ts`: what `POST /api/access-requests` accepts) and
the test fixtures. Role names are shown by splitting what the API returned
(`roleLabel`).

`GET /api/jurisdictions/current` (a contract amendment) gives the active
jurisdiction's template, features and wording, which the removed
`GET /api/jurisdictions/me` used to carry. If the API does not have it (404) the
web carries on with neutral wording and no template.

## Local development: dev login and the dev proxy

Caddy is not run locally, and there is no Entra. With the API running with
`ENVIRONMENT=local` and its personas seeded (`scripts-seed-personas.py`), the web
can sign in as a persona:

```bash
# .env.local
AUTH_ENABLED=false
NEXT_PUBLIC_DEV_LOGIN=true            # opt in to the persona picker and the dev proxy
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
BACKEND_INTERNAL_URL=http://127.0.0.1:8000
yarn dev                              # NODE_ENV=development; `yarn build && yarn start` is production
```

* `GET /auth/dev-login?persona=<name>[&returnTo=/path]` calls
  `POST /api/auth/session` with `X-Dev-Persona`, stores the token in the session
  store, sets the cookie and redirects to `returnTo` (a relative path only).
* `app/api/[...path]/route.ts` proxies `/api/*` to the API with the session's
  token attached, the stand-in for `forward_auth`. Routes with their own handler
  (`/api/jobs`, `/api/upload`, `/api/audio`, `/api/version`) keep their paths. It
  discards any `Authorization` the browser sent and refuses the token routes.
* With `NEXT_PUBLIC_DEV_LOGIN=true` the shared API client calls `/api` on its own
  origin (through that proxy) instead of the API directly.
* The header shows a persona picker; the unauthenticated and no-access screens
  show one too.
* Hard-disabled otherwise: `/auth/dev-login` and the proxy answer 404 unless
  `AUTH_ENABLED` is not `"true"` **and** `NODE_ENV` is not `"production"`
  (`lib/auth/dev-mode.ts`), a persona session is ended when that stops being true,
  and the browser side needs `NEXT_PUBLIC_DEV_LOGIN=true` and is off in a
  production build. `tests/unit/dev-login.test.ts` has a test for each refusal.

## The mock API

`scripts/dev-mock-api.mjs` is a dependency-free stand-in for the API, for
checking the web against the contract when the real API is not at hand. It is
for development only: tokens are unsigned, state is in memory, it trusts every
caller.

```bash
node scripts/dev-mock-api.mjs        # http://127.0.0.1:8000  (PORT=... to change)
```

It implements the no-context endpoints for the nine personas (`judge-et`,
`judge-iac`, `multi`, `jadmin-iac`, `jadmin-et`, `legal-iac`, `jsuper`,
`sysadmin`, `no-role`): `POST /api/auth/session` (with `X-Dev-Persona`),
`GET /api/me/permissions`, `PUT /api/me/context`,
`DELETE /api/me/jurisdictions/{code}`, `GET /api/jurisdictions/public`, the
access request endpoints, `GET /api/jurisdictions/current`, `GET /api/flags`,
and a few empty reads so the pages render. The role map in it is a copy of the
contract's. It answers 403 `context_required` to anything else when there is no
context, and 409 `context_changed` when `X-Jurisdiction` / `X-Role` differ from
the token's context. Anything it does not know is 404 `mock_not_implemented`.

To drive the web against it: start the mock, start `yarn dev` with the `.env.local`
above, open `http://localhost:3000` and pick a persona. For the real API, stop the
mock and run the API with `ENVIRONMENT=local`.

## Tests

`yarn test` (vitest). The ones for this work: `tests/unit/auth-app-token.test.ts`
(mint, re-mint, forward, context routes, Caddy), `dev-login.test.ts` (dev login,
proxy and every guard), `access-provider.test.tsx` (provider, `can`, choose,
no-access, 409, dev picker), `jurisdiction-switch.test.tsx` (switch, leave),
`route-guards.test.tsx`, `header.test.tsx`, `permission-driven-ui.test.tsx`,
`legal-wording-admin.test.tsx` (admin tabs), `admin-roles-api.test.ts`,
`context-changed.test.ts`. `tests/access-helpers.ts` has a `MeResponse` for each
persona shape; its role names and role map are test data copied from the contract.
