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

- Feature branches start from `develop`, and their PRs go into `develop`. Each PR gets its own preview.
- `develop` deploys to demo (`benchnotes.demo.platform.hmcts.net`). The permanent draft PR #25 (`develop` → `master`) rebuilds on every push to `develop`, and Flux deploys its `pr-25-*` image. Never merge, close or mark #25 ready.
- To release, open a PR into `master` from a branch cut from `develop`. `master` deploys to AAT, then prod.
- Merge `master` into `develop` at least every 2 weeks, by a PR from a branch cut from `master` (not from `master` itself: Jenkins stops building a branch that is the head of an open PR), with a merge commit. Old `pr-*` images expire after about 3 weeks, and demo pods then fail to pull. If there is nothing to merge, re-run the latest Jenkins build of `PR-25` instead, which pushes a fresh tag.
- Migrations go only through `master` of transcribe-api, so a feature that needs schema waits until its additive migration is on transcribe-api `master` and merged into its `develop`.
- `demo` is the CNP branch for the demo Terraform only, and every `master` build overwrites it. Demo uses `master`'s Helm chart, so demo-only settings go in cnp-flux-config `apps/transcribe/transcribe-web/demo.yaml`.

## Local development

```bash
docker-compose up -d              # in ../transcribe-api — postgres + azurite
cd ../transcribe-api && ./run-local.sh
cd ../transcribe-web
cp .env.example .env.local
yarn install && yarn build && yarn start
```

The backend serves both surfaces: `/api/*` (dictation) and `/api/v1/*` (recording).

## Sign-in

On CNP there is no App Service Easy Auth, so this app runs the Entra ID login
itself — the CNP pattern for internal users (DARTS does the same):

- `app/auth/login` and `app/auth/callback` run an OIDC authorization-code flow
  with PKCE against the MoJ tenant app registration, as a confidential client.
- Tokens are kept in a server-side session in Redis (`lib/auth`). The browser
  only ever holds an opaque, httpOnly `transcribe_session` cookie.
- Caddy attaches the session's bearer token to every backend `/api/*` call via
  `forward_auth` (`/auth/forward`), after discarding any `Authorization` or
  Easy Auth header the client sent. The recording area's own `/api/*` route
  handlers attach it themselves (`lib/recording/auth-utils.ts`).
- `proxy.ts` sends anyone without a session to the login. The API verifies
  the token on every call; the cookie check is only a routing hint.

Locally, leave `AUTH_ENABLED=false`: nothing is gated, and the backend uses its
mock identity with `ENVIRONMENT=local`.

## Tests

```bash
yarn test:unit    # vitest — 779 tests
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
