# transcribe-web

The single HMCTS Transcribe frontend — one CNP component (`product: transcribe`,
`component: web`) merging the two upstream Next.js applications.

Per the merged-frontend decision: https://tools.hmcts.net/confluence/pages/viewpage.action?pageId=2004000371 (section 13)

## Provenance

Imported from the upstream `main` branches, never edited in place:

| Upstream | Branch / commit |
|---|---|
| `hmcts/courtstranscribe` (frontend) | `main` @ 2d73b43 — the base |
| `hmcts/batch-audio-transcription` (frontend) | `main` @ 988d797 — namespaced |

```bash
./scripts-import.sh <dir-containing-both-clones>
node scripts-rewrite-imports.mjs
```

## Layout

Dictation is the base (larger surface, newer shadcn, richer provider stack).
Recording is namespaced so the two feature areas stay separable — a condition of
the merged decision, and what keeps federating available as a fallback.

```
app/
├── (dictation routes at root)   /  /record  /upload  /admin  /help  ...
├── recording/                   /recording  /recording/jobs/[jobId]
│   └── layout.tsx               route-group metadata
└── api/                         recording's BFF route handlers
components/recording/            recording's components (incl. its own shadcn ui)
lib/recording/                   recording's api-client, auth-utils, helpers
tests/recording/                 recording's suite (+ e2e/ for Playwright)
```

## Routes

27 in total. Both areas are reachable from one nav in one session.

## Branches and environments

- Branch from `master` and open the PR into `master`. Each PR gets its own preview at `transcribe-web-pr-<n>.preview.platform.hmcts.net` (HMCTS VPN needed). Add the `enable_keep_helm` label to keep the preview running after the build.
- Merging to `master` deploys to AAT, then prod.
- Demo (`benchnotes.demo.platform.hmcts.net`) runs the images promoted to prod, through its image policies in cnp-flux-config ([cnp-flux-config#48971](https://github.com/hmcts/cnp-flux-config/pull/48971)). Demo-only settings go in cnp-flux-config `apps/transcribe/transcribe-web/demo.yaml`.
- A feature that needs a schema change waits until its additive migration is on transcribe-api `master`.

## Local development

```bash
docker-compose up -d              # in ../transcribe-api — postgres + azurite
cd ../transcribe-api && ./run-local.sh
cd ../transcribe-web
cp .env.example .env.local
yarn install && yarn build && yarn start
```

The backend serves both surfaces: `/api/*` (dictation) and `/api/v1/*` (recording).

## Preview environments

Every PR build deploys a preview to the CFT preview cluster at `https://transcribe-web-pr-<n>.preview.platform.hmcts.net` (HMCTS VPN needed).

- Keeping it: CNP uninstalls the release at the end of each build. Add the GitHub label `enable_keep_helm` to keep it running after the build. Labels are read when the build starts, so rebuild after adding one.
- Deleting it: hmcts/cnp-pr-cleanup-aks deletes the release when the PR is closed or merged. Removing the label uninstalls it at the end of the next build.
- API: the preview brings its own transcribe-api, deployed in the same Helm release (the `transcribe-api` chart dependency, on only in `values.preview.template.yaml`) with no ingress of its own. Web reaches it through its in-cluster Service.
  - By default it runs `transcribe/api:latest`, the last `master` build of transcribe-api. The image is pulled again on every build, so a kept preview picks up a newer api on its next build.
  - To test against a transcribe-api PR, add the label `api-pr:<n>` (its PR number) and rebuild. That runs the api PR's `pr-<n>` image, but still this repo's pinned api chart version. The api PR must have built at least once. Once it closes, its image is untagged and the preview's api stops starting: remove the label and rebuild.
- Sign-in: automatic, as the api's preview user. Per-PR hostnames cannot be Entra redirect URIs, so web runs with `AUTH_ENABLED=false` and `PREVIEW_USER_SIGN_IN=true`. A browser with no session is sent to `/auth/preview-login`, which calls the api's sign-in with no Authorization header. The api runs with `ENVIRONMENT=preview` and `AUTH_PREVIEW_USER_ENABLED=true`, so that sign-in is a fixed preview user, given every role (super administrator, and administrator, so also judge and legal text manager, in every jurisdiction, plus system administrator). It then holds a BenchNotes token like anyone else (every other api call still needs one), so the chooser asks where and as what to work, and the header switches. `PREVIEW_USER_SIGN_IN` is refused when `AUTH_ENABLED=true` and is set nowhere but the preview values.
- Data is throwaway: Postgres and Azurite run in the release, and Speech is mocked (`SPEECH_BACKEND=mock`). The preview cluster shuts down every night, which wipes both. Postgres and Azurite otherwise survive pushes, except that changing the api image (adding or removing `api-pr:<n>`) recreates Azurite: blobs go while database rows stay.

## Sign-in

On CNP there is no App Service Easy Auth, so this app runs the Entra ID login
itself — the CNP pattern for internal users (DARTS does the same):

- `app/auth/login` and `app/auth/callback` run an OIDC authorization-code flow
  with PKCE against the MoJ tenant app registration, as a confidential client.
- Tokens are kept in a server-side session in Redis (`lib/auth`). The browser
  only ever holds an opaque, httpOnly `transcribe_session` cookie.
- At sign-in the API turns the Entra ID token into a short-lived BenchNotes
  access token (`POST /api/auth/session`), kept in the session next to it and
  minted again near expiry. That token, not the Entra one, is what every backend
  call carries. The user's chosen jurisdiction and role, and what they may do,
  come from the API (`GET /api/me/permissions`); the UI shows only what those
  permissions allow. See [docs/authz-web.md](docs/authz-web.md).
- Caddy attaches the session's bearer token to every backend `/api/*` call via
  `forward_auth` (`/auth/forward`), after discarding any `Authorization` or
  Easy Auth header the client sent. The recording area's own `/api/*` route
  handlers attach it themselves (`lib/recording/auth-utils.ts`).
- `proxy.ts` sends anyone without a session to the login. The API verifies
  the token on every call; the cookie check is only a routing hint.

Locally, leave `AUTH_ENABLED=false`: nothing is gated. To work as one of the
API's seeded personas (`ENVIRONMENT=local`), set `NEXT_PUBLIC_DEV_LOGIN=true`
and run `yarn dev`: a persona picker appears, `/auth/dev-login?persona=<name>`
signs in, and `/api/*` goes through a dev-only proxy that attaches the session's
token. Both are refused when `AUTH_ENABLED=true` or in a production build
(`yarn build && yarn start`). `node scripts/dev-mock-api.mjs` is a stand-in for
the API when the real one is not running. Details in
[docs/authz-web.md](docs/authz-web.md).

## Tests

```bash
yarn test:unit    # vitest
yarn test:e2e     # playwright (recording e2e specs)
yarn type-check
```

## Outstanding

- **Design-system convergence.** Recording keeps its own `components/recording/ui/*`
  because the two shadcn copies had drifted and converging them needs visual
  review. One design system is a stated benefit of merging and is not yet realised.
- **Feature flags.** The merged decision makes flags, trunk-based development and
  per-directory CODEOWNERS conditions of accepting the C1 breach. None are in
  place yet.
- **Product title** is "Bench Notes" in all user-facing text. Identifiers keep
  the old name: the `judicial-transcribe-cookie-preferences` cookie and the
  JudicialTranscribe@justice.gov.uk support mailbox.
- The recording area's nav link is in the header but only renders behind
  dictation's AccessGate, so it has not been visually confirmed in an
  authenticated session.
