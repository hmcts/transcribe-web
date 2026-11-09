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
| Header/home: Dictation, `/record`, `/upload`, `/speech-demo`, dictation list, backup recovery, dictation help | `dictation.use` and the dictation flag (below) |
| Header/home: hearing recordings, `/recording/**` | `recording.own` (and the jurisdiction using them) |
| Admin tab Document Content | `legal_text.manage` |
| Admin tab Templates | `templates.manage` |
| Admin tab Users | `users.manage` (its Role history view: `role_audit.read`) |
| Admin tab Approvals | `access.approve` |
| Admin tab Jurisdictions | `jurisdictions.manage`, `jurisdiction.create` or `jurisdiction_admin.assign` (settings: `jurisdictions.manage`; Add jurisdiction: `jurisdiction.create`; Administrators of a jurisdiction: `jurisdiction_admin.assign`) |
| Admin tab Super administrators | `jurisdiction_super_admin.assign` |
| Admin tab Feature flags | `feature_flags.manage` |
| Recording "History" | `recording.audit.read` |
| Onboarding check, dictation list loading | `app.access`, `dictation.use` |

The path-to-permission table for pages is `lib/access/routes.ts`; the route
layouts (`app/record/layout.tsx` and the others) use it, and a page at its
address without the permission shows "This is not available in your role". Templates is
still a placeholder (templates belong to another epic); every other tab is a
working screen, described under "Administration" below.

The only role values in the web are the two on the access request form
(`lib/access/requestable-roles.ts`: what `POST /api/access-requests` accepts),
the two the Jurisdictions and Super administrators screens assign
(`lib/access/assignable-roles.ts`: which of the roles the API lists is which)
and the test fixtures. Role names are shown by splitting what the API returned
(`roleLabel`). `tests/unit/no-role-strings.test.ts` fails if a role string
appears anywhere else in the app source, or if the system administrator role is
named anywhere at all.

`GET /api/jurisdictions/current` (a contract amendment) gives the active
jurisdiction's template, features and wording, which the removed
`GET /api/jurisdictions/me` used to carry. If the API does not have it (404) the
web carries on with neutral wording and no template.

## Administration (DIAAT-385, 391, 394, 396, 392)

All of Admin is permission-driven and the API enforces every rule; the screens
show what they are given and show the API's own message when it refuses.
A role change reaches the person at their next token re-mint, so the screens say
"takes effect within a few minutes".

* **Users** (`components/admin/users-panel.tsx`, `GET /api/admin/users`): paged
  (25), searchable by email, filterable by jurisdiction, each user's roles as
  chips per jurisdiction. The roles a caller can give or take away are exactly
  `GET /api/admin/roles`: the add form offers those and the remove button shows
  only on a chip whose role is in that list. A jurisdiction administrator is
  therefore never offered JurisdictionAdministrator, because the API does not
  list it for them (a test drives this from the list, with the list changed).
  The add form takes a signed-in user (picked from a search as you type, by id)
  or an email (pending until first sign-in), a jurisdiction and one or more roles
  (one `POST /api/admin/assignments` per role; a refused role stays ticked and the
  API's reason is shown). Removing a role (`DELETE /api/admin/assignments/{id}`)
  and deactivating (`POST .../deactivate`) ask first; reactivating does not.
  There is no Deactivate button on your own row (the API refuses it too).
  Role history (`GET /api/admin/role-history`, 50 a page) is a second view, shown
  only with `role_audit.read`.
* **Approvals** (`approvals-panel.tsx`, `GET /api/admin/access-requests?status=pending`):
  approve or reject with an optional reason. The email link is
  `/admin?tab=approvals&request=<id>`: the Admin page opens that tab (if the
  caller has it, else the first one they have) and the panel highlights that
  request and scrolls to it. The link carries only the id and grants nothing: the
  highlight is of a request in the queue the API returned, and an id that is not
  there (decided, withdrawn, or another jurisdiction's) gets a neutral "not
  waiting for your decision" that confirms nothing about it.
* **Jurisdictions** (`jurisdictions-panel.tsx`): settings for
  `jurisdictions.manage`, *Add jurisdiction* only for `jurisdiction.create`, and,
  for `jurisdiction_admin.assign`, *Administrators of X*: the JurisdictionAdministrator
  assignments of that jurisdiction, added by email or by picking a signed-in user,
  removed by assignment id (`components/admin/role-holders.tsx`). `auto_enrol` and
  the judge/admin member endpoints are gone. Someone who holds only
  `jurisdiction_admin.assign` sees the names (`GET /api/jurisdictions/public`) and
  the administrators, none of the settings.
* **Super administrators** (`super-administrators-panel.tsx`): the holders of the
  global JurisdictionSuperAdministrator role, with add (by email, by picking, or
  *Add me*) and remove, oneself included.
* **Feature flags** (`feature-flags-panel.tsx`, `GET/PUT /api/admin/feature-flags`):
  a switch per flag; shows what the API stored, last changed by whom.

The two screens that list holders of one role ask `GET /api/admin/users` with
`role=` and keep only the matching assignments themselves, reading pages of 100
(at most 20). The contract has no `role` filter; sending it is harmless and lets an
API that adds one answer in a page (see the contract's Amendments). If the cap is
reached the screen says its list may be incomplete.

### The dictation flag at runtime

`GET /api/flags` (`{dictation_enabled}`, any signed-in user) replaces the
build-time `NEXT_PUBLIC_DICTATION_ENABLED` as the decision. The env value stays as
the **default**: used until the flag has loaded and whenever it cannot be read
(API unreachable, a refusal, a body that is not the promised shape), so a failure
leaves the deployment's own setting in force and never opens dictation in prod.

* UI: `providers/runtime-flags.tsx` loads the flag once the user is known and when
  the tab becomes visible; the header, home page and help page read
  `useDictationEnabled()` / `<DictationOnly>`.
* `proxy.ts` (the redirect of `/record` and `/speech-demo` to `/`): it has no
  token, so it asks this app's own `/auth/runtime-flags` route
  (`app/auth/runtime-flags/route.ts`), passing the session cookie; that route calls
  `GET /api/flags` with the session's token. Only dictation paths trigger the call;
  the answer is kept 10 s (a failure 3 s) in `lib/flags/proxy-flags.ts`, so a change
  applies within about ten seconds without a redeploy.
* `charts/transcribe-web/values.yaml` keeps `NEXT_PUBLIC_DICTATION_ENABLED` (off in
  prod): that is the default described above.

### Recording history (DIAAT-395)

A **History** section on the recording page (`recording-history.tsx`), beside the
per-segment *Modification history* (which it does not touch), only with
`recording.audit.read`. The browser reads it from `GET /api/jobs/{id}/history`
(a Next route handler, like the rest of the recording area), which calls
`GET /api/v1/jobs/{id}/history` with the session's token; a 403 or 404 from the API
is shown as "not available". It lists action, who and in which role, when and the
outcome, 20 a page, and no transcript text (the API sends none).

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

It implements the contract for the nine personas (`judge-et`, `judge-iac`,
`multi`, `jadmin-iac`, `jadmin-et`, `legal-iac`, `jsuper`, `sysadmin`, `no-role`)
with in-memory state, so every admin screen can be driven end to end: the
no-context endpoints (session, permissions, context, leave, public jurisdictions,
access requests, `GET /api/flags`, `GET /api/jurisdictions/current`), and
`GET /api/admin/roles`, `GET /api/admin/users`, `POST /api/admin/assignments`,
`DELETE /api/admin/assignments/{id}`, `POST /api/admin/users/{id}/deactivate` and
`reactivate`, `GET /api/admin/role-history`, the access request queue and its
approve/reject, `GET`/`PUT /api/admin/jurisdictions`, `GET`/`PUT /api/admin/feature-flags`,
and `GET /api/v1/jobs`, `/jobs/{id}` and `/jobs/{id}/history` (two seeded
recordings, owned by `judge-et` and `judge-iac`). The role map is a copy of the
contract's, and the assignment rules of section 1 are enforced as the real API
will (a jurisdiction administrator gives Judge and LegalTextManager in the active
jurisdiction only; a super administrator also JurisdictionAdministrator; a system
administrator both administrator roles, and any role to themselves; nobody changes
their own admin role or deactivates themselves; nobody grants SystemAdministrator).
`tests/unit/dev-mock-api.test.ts` starts it and checks those rules.

What a token may do is what it carried when minted, as in the real API, so a role
given or removed reaches the user at their next mint. `APP_JWT_TTL_SECONDS=75`
makes that quick (the web re-mints 60 s before expiry). At start-up it prints the
ids of two seeded pending requests, for `/admin?tab=approvals&request=<id>`.
It answers 403 `context_required` to anything else when there is no context, and 409
`context_changed` when `X-Jurisdiction` / `X-Role` differ from the token's context.
Anything it does not know is 404 `mock_not_implemented`.

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
`context-changed.test.ts`. Phase 6 and 7: `admin-users-panel.test.tsx`,
`admin-approvals-panel.test.tsx` (including the deep link),
`admin-super-administrators.test.tsx`, `admin-feature-flags.test.tsx`,
`jurisdictions-panel.test.tsx`, `runtime-flags.test.tsx`,
`runtime-flags-route.test.ts`, `dictation-feature-flag.test.ts` (the proxy and the
fallback), `recording-history.test.tsx` and the history route test under
`tests/recording/unit`, `user-settings-access.test.tsx`, `no-role-strings.test.ts`,
`dev-mock-api.test.ts`. `tests/access-helpers.ts` has a `MeResponse` for each
persona shape; its role names and role map are test data copied from the contract.
