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

## Local development

```bash
docker-compose up -d              # in ../transcribe-api — postgres + azurite
cd ../transcribe-api && ./run-local.sh
cd ../transcribe-web
cp .env.example .env.local
pnpm install && pnpm run build && pnpm run start
```

The backend serves both surfaces: `/api/*` (dictation) and `/api/v1/*` (recording).

Recording's BFF route handlers authenticate to the backend with a machine API
key. Seed one with `../transcribe-api/scripts-seed-local.py` and put the printed
value in `TRANSCRIPTION_API_KEY`.

## Tests

```bash
pnpm run test:unit    # vitest — 765 tests
pnpm run test:e2e     # playwright (recording e2e specs)
pnpm run type-check
```

## Outstanding

- **Design-system convergence.** Recording keeps its own `components/recording/ui/*`
  because the two shadcn copies had drifted and converging them needs visual
  review. One design system is a stated benefit of merging and is not yet realised.
- **Feature flags.** The merged decision makes flags, trunk-based development and
  per-directory CODEOWNERS conditions of accepting the C1 breach. None are in
  place yet.
- **Product title** is still "Judicial Transcribe"; user-facing naming is a
  product decision.
- The recording area's nav link is in the header but only renders behind
  dictation's AccessGate, so it has not been visually confirmed in an
  authenticated session.
