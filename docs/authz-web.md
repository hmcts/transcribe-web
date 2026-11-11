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
* The token carries `sess_exp`: the Entra-verified sign-in it descends from, plus
  one lifetime. `PUT /api/me/context` and `DELETE /api/me/jurisdictions/{code}`
  mint from the presenting token and never outlive it, so `expires_at` of their
  answer can be shorter than a full lifetime (the web reads `expires_at`, never
  assumes 300 s) and a chain of context changes ends at `sess_exp`. That is a
  re-mint from Entra, not a sign-out: the session re-mints within 60 s of expiry as
  above, and if a context change is answered 401 anyway (the chain ended while the
  call was in flight) `/auth/context` and `/auth/jurisdictions/{code}`
  (`callWithSessionToken` in `lib/auth/route-support.ts`) mint again from Entra
  with the session's context and repeat the call once. The user is not sent back
  to sign-in.
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
  server. There is no default: after sign-in a user given one pair goes straight
  in (the API selects it; a jurisdiction administrator is given one, and is also
  offered Judge and Legal text manager in their own jurisdiction, which they can
  switch to from the header), a user given several sees "choose where and as what"
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
* The API's other refusals about who the user is are caught by the same watcher
  (`lib/access/refusals.ts`) and acted on once for the whole app, whichever call
  met them: 403 `user_deactivated` shows "Your account has been deactivated" (also
  when `GET /api/me/permissions` itself is refused with it); 403 `context_required`
  while this tab thinks it has a context (a role was removed at a re-mint) asks who
  the user is again and shows the choose or no-access screen; 403
  `dictation_disabled` reads the dictation flag again, so dictation is hidden at
  once (the dictation list is also not loaded while the flag is off). Every other
  refusal (`permission_denied`, `jurisdiction_not_in_scope`, `assignment_not_allowed`,
  ...) is shown where it happened, in the API's own words, except the ones with
  plain words of the web's own (next section). Every API error, the 401 and the 409
  of a stale save included, is `{"detail": {"code", "message"}}`: `apiClient` reads
  the message and keeps the code (a 401 too), and the dictation submission reads
  the same shape instead of showing "[object Object]".
* Switching (`providers/access.tsx`, `switchContext`): save the tab's work
  (the `onBeforeJurisdictionSwitch` handlers), `POST /auth/context`, save again,
  then reload at the same page if it is a list-level page the new context may use
  (`lib/access/routes.ts`), else at `/`. If the second save fails the previous
  context is put back. Leaving a jurisdiction does the same with `DELETE`.

## Refusals that have their own words

`describeRefusal(error, context)` (`lib/access/refusal-messages.ts`; used by
`errorMessage` in every admin screen and by the access request form) gives these in
plain words and falls back to the API's message for any other code:

| code | where | what the user sees |
|---|---|---|
| `own_request` 403 | Approvals | "This is your own request. Another administrator has to decide it." The queue offers no Approve or Reject on a request whose `requester.id` is the user's own id, so the refusal is only a fallback |
| `assignment_not_allowed` 403 | Users, Administrators of X, Super administrators | for oneself: "You cannot give yourself a role. Ask another administrator to add you." Add is off, with that note, when the person picked or the email typed is the caller, unless the caller holds `jurisdiction_super_admin.assign` (a system administrator may give themselves a stored role: *Add me* on the Super administrators screen). Otherwise the API's own message |
| `ambiguous_email` 409 | Users, Administrators of X | "More than one person has signed in with that email address ... choose the person from the list". The picker tells two accounts with one address apart ("account ending ...") and assigns by id |
| `jurisdiction_disabled` 409 | Users, Administrators of X, Approvals | "That jurisdiction is switched off ... A super administrator can switch it on again" |
| `too_many_pending_requests` 409 | access request form | "... Withdraw one of them, then ask again." Each pending request has Withdraw on the same page, and the message goes when one is withdrawn |
| `permission_denied` 403 | Jurisdictions, saving | "Only a super administrator can rename or switch off a jurisdiction" |

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
| Header: Wording link, `/jurisdiction-wording` | `jurisdiction.wording.edit` and a jurisdiction in the active context (a super administrator holds the permission but works in none: the API answers 403 `no_jurisdiction`, so the page points to Admin, Jurisdictions) |
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
  There is no Deactivate button on your own row, nor on a row with a role that is
  not in `GET /api/admin/roles` (the API refuses both: 403 `cannot_deactivate_self`,
  `assignment_not_allowed`).
  Role history (`GET /api/admin/role-history`, 50 a page) is a second view, shown
  only with `role_audit.read`. A row's `actor.id` is null when a system
  administrator made the change with their own permissions (the API sends
  `email: "system administrator"`, no person): it reads "System administrator"
  (`actorLabel`); an address the API did give is shown; a row missing its actor or
  target does not break the list.
* **Approvals** (`approvals-panel.tsx`, `GET /api/admin/access-requests?status=pending`):
  approve or reject with an optional reason. The email link is
  `/admin?tab=approvals&request=<id>`: the Admin page opens that tab (if the
  caller has it, else the first one they have) and the panel highlights that
  request and scrolls to it. The link carries only the id and grants nothing: the
  highlight is of a request in the queue the API returned, and an id that is not
  there (decided, withdrawn, or another jurisdiction's) gets a neutral "not
  waiting for your decision" that confirms nothing about it. An administrator's own
  request in the queue shows who and what but no Approve, Reject or reason box, only
  "This is your own request": nobody decides their own (403 `own_request`).
* **Jurisdictions** (`jurisdictions-panel.tsx`): settings for
  `jurisdictions.manage`, *Add jurisdiction* only for `jurisdiction.create`, and,
  for `jurisdiction_admin.assign`, *Administrators of X*: the JurisdictionAdministrator
  assignments of that jurisdiction, added by email or by picking a signed-in user,
  removed by assignment id (`components/admin/role-holders.tsx`). `auto_enrol` and
  the judge/admin member endpoints are gone. Changing a jurisdiction's name or its
  Enabled switch needs `jurisdiction.create` (a jurisdiction administrator changes
  only the settings: template, hearing recordings, wording): for a holder of
  `jurisdictions.manage` without it the editor shows name and Enabled disabled, with
  a note, and sends the name and `enabled` the jurisdiction already has (which the
  API accepts; anything else is 403 `permission_denied`). Someone who holds only
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

## Running against the real API

Checked end to end in a browser, as every persona, against the DIAAT-373 branch of
transcribe-api (`feat/DIAAT-373-authorisation`: the API with its review-fix pass,
new refusal codes, `sess_exp`, `{code,message}` 401/409). Two terminals, plus Docker
for Postgres.

**0. Postgres.** The API's `docker compose up -d postgres azurite` serves port 5432.
On the development machine the bridge to the host does not work, and the Postgres
that is used listens on **5433** (container `transcribe-postgres-hostnet`); the API's
`.env` already points to it. Check:

```bash
docker ps --format '{{.Names}} {{.Ports}}'
grep DATABASE_CONNECTION_STRING /home/oleg/code_repos/transcribe-api/.env
# DATABASE_CONNECTION_STRING=postgresql://transcribe:transcribe@localhost:5433/transcribe
```

*A scratch database* keeps the `transcribe` one (and `transcribe_test`, which the API's
tests use) untouched, for instance when another checkout of the API is running its
tests. Create it once, and in the shell that runs alembic, the seed script and the API
export the URL **after** `. ./.env`, so it is the one in the process environment
(the API loads dotenv files at import and does not override what is already set):

```bash
docker exec transcribe-postgres-hostnet psql -U transcribe -p 5433 -d postgres -c 'CREATE DATABASE transcribe_scratch'
export DATABASE_CONNECTION_STRING=postgresql://transcribe:transcribe@localhost:5433/transcribe_scratch
# drop it when done:
docker exec transcribe-postgres-hostnet psql -U transcribe -p 5433 -d postgres -c 'DROP DATABASE transcribe_scratch WITH (FORCE)'
```

**1. API, terminal 1** (port 8000, `ENVIRONMENT=local` is in its `.env`; the token key
`APP_JWT_SIGNING_KEY` must be set there too):

```bash
cd /home/oleg/code_repos/transcribe-api            # branch feat/DIAAT-373-authorisation
set -a; . ./.env; set +a                          # alembic reads the environment, not .env
.venv/bin/alembic upgrade head
.venv/bin/python scripts-seed-personas.py          # idempotent: adds what is missing, deletes nothing
./run-local.sh                                     # http://127.0.0.1:8000, takes ~20 s to start
# a role change reaches people at their next token; to see that in a minute, not five:
#   APP_JWT_TTL_SECONDS=75 ./run-local.sh
```

From a `git worktree` of the API (no `.venv` of its own), copy the checkout's `.env` in,
and run the main checkout's interpreter with `PYTHONPATH=<worktree>/src` instead of
`./run-local.sh`: `.venv/bin/python -m uvicorn transcribe_api.api.app:create_app --factory --host 127.0.0.1 --port 8000`
(`alembic -c <worktree>/alembic.ini upgrade head` and the seed script the same way).

**2. Web, terminal 2** (port 3000):

```bash
cd /home/oleg/code_repos/transcribe-web            # branch feat/DIAAT-373-authorisation
cat > .env.local <<'EOF'
AUTH_ENABLED=false
NEXT_PUBLIC_DEV_LOGIN=true
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
BACKEND_INTERNAL_URL=http://127.0.0.1:8000
EOF
rm -rf .next                  # after a `yarn build`: the production .next made the dev server reload the page in a loop
corepack yarn dev             # also writes an untracked AGENTS.md: do not commit it
```

**3. Sign in** at `http://localhost:3000/auth/dev-login?persona=<name>` (or use the
"Persona" button in the header, which links to the same). `yarn dev` is required:
`yarn build && yarn start` is a production build and always answers 404 here. The
session lives in the dev server's memory: restarting `yarn dev` signs everyone out.

| persona | holds | what to expect |
|---|---|---|
| `judge-et` | Judge in ET | Dictation and Recordings; Admin is "not available in your role" |
| `judge-iac` | Judge in IAC | the same, with the IAC's words ("Hearing recordings") |
| `multi` | Judge in ET, administrator in IAC | "Choose where and as what"; the header menu switches or leaves |
| `jadmin-iac`, `jadmin-et` | administrator of IAC / ET | Admin: Templates, Users, Approvals, Jurisdictions; Wording; no Document Content |
| `legal-iac` | legal text manager in IAC | Admin: Document Content (editable), Templates; nothing else |
| `jsuper` | super administrator (global) | Admin: Users (everyone), Approvals, Jurisdictions (add one, appoint administrators); no Wording link |
| `sysadmin` | none (system administrator) | Admin: Jurisdictions (names, administrators), Super administrators, Feature flags |
| `no-role` | none | "You do not have access yet" with the request form |

**4. Things to try**

* *Access request.* As `no-role` ask for IAC / Judge. As `jadmin-iac` open Admin,
  Approvals (the email link is `/admin?tab=approvals&request=<id>`; it highlights that
  request), approve with a reason. As `no-role`, **Check again** (or just wait: the
  token re-mints by itself within 5 minutes, 75 s with the short TTL, and a reload
  shows it): you are in, and "Earlier requests" shows the reason.
* *Users.* As `jadmin-iac`: add `anyone@localhost.test` as Judge (shown "Not signed in
  yet"), remove the role, search `no-role` and add it, **Deactivate** and **Reactivate**
  someone, read **Role history**. A deactivated person who has the app open gets "Your
  account has been deactivated" on their next call.
* *Jurisdictions.* As `jsuper`: Add jurisdiction `UT`, then Administrators of UT, add an
  email. As `sysadmin`: Super administrators, **Add me**, then remove it again.
* *Feature flag.* As `sysadmin`: Feature flags, switch `dictation_enabled` off. As
  `judge-et` (reload): Dictation is gone, `/record` goes to the home page. The API
  answers its dictation routes 403 `dictation_disabled`; a tab already open hides
  dictation as soon as it meets one. Switch it back on.
* *Refusals the screens avoid.* As `jadmin-iac`: Users, type `jadmin-iac@localhost.test`
  and tick Judge (a note says you cannot give yourself a role; Add stays off). Jurisdictions,
  IAC: Name and Enabled are disabled, with a note; Save still works for the settings.
  Approvals, for a request of your own (an administrator asking for another role has no
  button for it in the app; from the browser console on any page:
  `fetch('/api/access-requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jurisdiction:'IAC',roles:['LegalTextManager']})})`):
  the request is listed, with "This is your own request" instead of Approve and Reject.
  As `jsuper`, add a jurisdiction with Enabled off, then add an administrator to it:
  "That jurisdiction is switched off". As `no-role` with five requests pending, a sixth is
  refused with "Withdraw one of them" (withdraw one on the same page, send again).
* *History of a system administrator's change.* As `sysadmin`: Jurisdictions, IAC, add an
  administrator by email. As `jsuper`: Users, Role history: the row reads "Done by System
  administrator".
* *Token expiry.* Start the API with `APP_JWT_TTL_SECONDS=75`, sign in as `multi` and
  choose IAC administrator. Leave the tab open and use it: about every 20 s the web mints
  again from the persona (the stand-in for the Entra ID token) with the chosen context
  and you stay where you are. A context change made within the first 75 s gets a token
  that expires with the sign-in (`sess_exp`), not a full 75 s later.
* *Stale tab.* As `multi`, choose IAC administrator in tab 1; in tab 2 switch to ET
  Judge. In tab 1 click anything that calls the API: the "changed in another tab,
  reload" banner (409 `context_changed`).
* *History.* A recording is needed (uploading needs ffmpeg and Azure Speech, so insert
  one for `judge-et`, then open `/recording`, the recording, **History**):

```bash
cd /home/oleg/code_repos/transcribe-api
set -a; . ./.env; set +a
.venv/bin/python - <<'EOF'
from sqlmodel import Session, create_engine, select
import os
from transcribe_api.domain.models_dictation import Jurisdiction, User
from transcribe_api.domain.models_recording import DialogueEntry, JobStatus, SpeechBatchJob
with Session(create_engine(os.environ["DATABASE_CONNECTION_STRING"])) as s:
    u = s.exec(select(User).where(User.email == "judge-et@localhost.test")).one()
    et = s.exec(select(Jurisdiction).where(Jurisdiction.code == "ET")).one()
    e = [DialogueEntry(id="seg_a", speaker="Speaker 1", text="Opening", start_time=0.0, end_time=2.0, confidence=0.4)]
    j = SpeechBatchJob(audio_url="https://example.invalid/a.wav", user_id=u.id, jurisdiction_id=et.id,
                       status=JobStatus.SUCCEEDED, dialogue_entries=[x.model_dump() for x in e])
    s.add(j); s.commit(); print("/recording/jobs/" + str(j.id))
EOF
```

**5. Reset.** Re-running the seed script puts back a persona's missing roles (for
instance `multi` after leaving ET) but never removes anything, and does not reactivate
a deactivated persona (do that in Admin, Users, as someone who may). For a clean slate
(this deletes the local development database, nothing else):

```bash
docker exec transcribe-postgres-hostnet psql -U transcribe -p 5433 -d postgres \
  -c 'DROP DATABASE transcribe WITH (FORCE)' -c 'CREATE DATABASE transcribe'
cd /home/oleg/code_repos/transcribe-api && set -a; . ./.env; set +a
.venv/bin/alembic upgrade head && .venv/bin/python scripts-seed-personas.py
# then restart ./run-local.sh (its connections are gone) and `yarn dev` (its sessions name deleted users)
```

(Do not drop `transcribe_test`: the API's tests use it.)

**6. If something is off.** `/auth/dev-login` answers 401 "did not accept the
persona": the API is not running with `ENVIRONMENT=local`, or the persona is not seeded
(409 `persona_not_seeded`). 502: the API is not up yet. 403 "deactivated": reactivate
that persona. A blank "Bench Notes could not load" means the API is unreachable from
the dev server (`BACKEND_INTERNAL_URL`). Browser console: a 403 `context_required` or
409 `context_changed` after you changed a role elsewhere is expected, and the screen
moves on by itself (see "Working context").

No BenchNotes token reaches the browser: `POST /api/auth/session`, `PUT /api/me/context`
and `DELETE /api/me/jurisdictions/{code}` answer 404 `not_through_the_browser`, the
cookie `transcribe_session` is opaque, and no response body, header or storage held
a token when this was driven.

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
It also gives the API's review-fix refusals: 403 `assignment_not_allowed` for giving yourself a
role (a system administrator excepted), 403 `own_request`, 409 `jurisdiction_disabled`, 409
`too_many_pending_requests` (five), 403 `permission_denied` for a jurisdiction administrator
changing a name or `enabled`, 409 `edit_conflict`, history rows with `actor.id` null for a
system administrator's own change, and `{code, message}` 401s (`not_authenticated`,
`invalid_token`). It does not have `sess_exp` or `ambiguous_email`. It answers 403 `context_required` to anything else when there is no context, and 409
`context_changed` when `X-Jurisdiction` / `X-Role` differ from the token's context.
Anything it does not know is 404 `mock_not_implemented`.

To drive the web against it: start the mock, start `yarn dev` with the `.env.local`
above, open `http://localhost:3000` and pick a persona. For the real API, stop the
mock and follow "Running against the real API". The mock was compared with the real
API (status codes, refusal codes and response shapes of every endpoint it has, for
every persona) and changed to match: roles on `GET /api/jurisdictions/public`,
`duplicate_request`, `jurisdiction_not_found`, `no_jurisdiction` for a global role,
`context_required` (not `permission_denied`) for a system administrator with no
context, `/api/admin/me`, `/api/templates`, `dictation_disabled`. It stays a stand-in:
it implements nothing of dictation, uploads, document content, and its tokens are not
signed.

## Tests

`yarn test` (vitest). The ones for this work: `tests/unit/auth-app-token.test.ts`
(mint, re-mint, forward, context routes, Caddy), `dev-login.test.ts` (dev login,
proxy and every guard), `access-provider.test.tsx` (provider, `can`, choose,
no-access, 409, dev picker), `jurisdiction-switch.test.tsx` (switch, leave),
`route-guards.test.tsx`, `header.test.tsx`, `permission-driven-ui.test.tsx`,
`legal-wording-admin.test.tsx` (admin tabs), `admin-roles-api.test.ts`,
`context-changed.test.ts`, `refusals.test.ts`. Phase 6 and 7: `admin-users-panel.test.tsx`,
`admin-approvals-panel.test.tsx` (including the deep link),
`admin-super-administrators.test.tsx`, `admin-feature-flags.test.tsx`,
`jurisdictions-panel.test.tsx`, `runtime-flags.test.tsx`,
`runtime-flags-route.test.ts`, `dictation-feature-flag.test.ts` (the proxy and the
fallback), `recording-history.test.tsx` and the history route test under
`tests/recording/unit`, `user-settings-access.test.tsx`, `no-role-strings.test.ts`,
`dev-mock-api.test.ts`. `tests/access-helpers.ts` has a `MeResponse` for each
persona shape; its role names and role map are test data copied from the contract.

The API's review-fix changes (DIAAT-373, final web pass) are covered in
`refusal-messages.test.ts` (the codes in plain words, `actorLabel`, the dictation
submission's `{code, message}` body), `admin-users-panel.test.tsx` (null history actor,
no self-assignment, ambiguous email, disabled jurisdiction, the picker telling twins
apart), `admin-approvals-panel.test.tsx` (no Approve or Reject on one's own request),
`jurisdictions-panel.test.tsx` (name and Enabled need `jurisdiction.create`),
`access-provider.test.tsx` (too many pending requests), `lib-api-client.test.ts` (a 401
keeps its code, a 409 `edit_conflict` reads as text), `auth-app-token.test.ts` (a context
change whose token chain ended re-mints and repeats once) and `dev-mock-api.test.ts`.
`tests/unit/dictation-form-data.test.ts` ("sets hearingDate to today's date") compares
the local date with the UTC date and fails between 00:00 and 01:00 in CET/CEST; it is
not related to this work.

## Landing it: order, branches and PR previews

* **Trunk-based.** `master` is the only long-lived branch of both repositories: this
  work is one branch, `feat/DIAAT-373-authorisation`, cut from `master`, and its PR goes
  into `master` (there is no `develop`).
* **Push order: the API first.** The web needs the API's new schema and endpoints (the
  role tables, migration `0009`, `/api/me/permissions` and the `/api/admin/*` routes). The
  README's rule applies: a feature that needs a schema change waits until its additive
  migration is on transcribe-api `master`. So the transcribe-api PR merges first, and
  this one after it.
* **PR previews** (`lib/auth/preview-mode.ts`) have no Entra: they run with
  `AUTH_ENABLED=false` and, from the preview chart values only,
  `PREVIEW_USER_SIGN_IN=true`. Then:
  * `proxy.ts` sends a page request with no session to `/auth/preview-login?returnTo=…`
    (a route handler's fetch gets a 401, as with login on), and `/auth/login`, where a
    401 from the API sends the browser, forwards there too;
  * `/auth/preview-login` calls `POST /api/auth/session` with **no** Authorization header
    and no persona (the API, with `ENVIRONMENT=preview` and `AUTH_PREVIEW_USER_ENABLED=true`,
    signs in its fixed preview user and gives it every role), stores the session like
    dev login (`previewUser: true`), sets the cookie and goes to a relative `returnTo`;
  * the session is re-minted the same way, keeping its context, and `/auth/forward`
    attaches its token for Caddy exactly as with login on (a 401 without a session);
  * no context is requested: the preview user has several, so the chooser appears, and the
    header's switcher changes it;
  * it is impossible with `AUTH_ENABLED=true`, and off unless the variable is set. Every
    one of these paths asks `isPreviewSignInEnabled()`, a preview session is ended when it
    stops being true, and `tests/unit/preview-login.test.ts` has a test for each refusal.
  The persona login stays refused in a production build, which a preview is.
