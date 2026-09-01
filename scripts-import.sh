#!/usr/bin/env bash
# Reproducible import of the two upstream frontends into one merged app.
# Reads only; never writes to the source repos.
#
# Base = dictation frontend (larger surface, newer shadcn, richer providers).
# Recording is namespaced so the two feature areas stay separable — a condition
# of the merged-frontend decision (architecture 13).
set -euo pipefail
SRC="$1"; T="$(cd "$(dirname "$0")" && pwd)"
R="$SRC/batch-audio-transcription/frontend"
C="$SRC/courtstranscribe/frontend"

# ---------- base: dictation frontend ----------
for d in app components hooks lib providers public scripts src tests; do
  [ -d "$C/$d" ] && { rm -rf "$T/$d"; cp -R "$C/$d" "$T/$d"; }
done
for f in next.config.js tsconfig.json tailwind.config.ts postcss.config.mjs biome.json \
         vitest.config.ts components.json instrumentation.ts proxy.ts start.js \
         sentry.client.config.ts sentry.edge.config.ts sentry.server.config.ts \
         Caddyfile supervisord.conf Dockerfile Dockerfile.dev ACCESSIBILITY.md; do
  [ -f "$C/$f" ] && cp "$C/$f" "$T/$f"
done

# ---------- recording: namespaced ----------
mkdir -p "$T/app/recording" "$T/components/recording" "$T/lib/recording" "$T/tests/recording"

# routes: recording's root page becomes /recording, its jobs pages nest under it
cp "$R/app/page.tsx"   "$T/app/recording/page.tsx"
cp -R "$R/app/jobs"    "$T/app/recording/jobs"
# recording's Next route handlers (BFF proxies) are unique — dictation has no app/api/
cp -R "$R/app/api"     "$T/app/api"
# recording's root layout is NOT copied: dictation's is the shell (see MERGE NOTES)

# components and lib, namespaced. recording's shadcn ui is kept separate rather
# than folded into dictation's: the two had drifted, and converging them needs
# visual review. Design-system convergence is tracked as follow-up work.
cp -R "$R/components/." "$T/components/recording/"
cp -R "$R/lib/."        "$T/lib/recording/"
cp -R "$R/tests/."      "$T/tests/recording/"

find "$T" -name '__pycache__' -prune -exec rm -rf {} + 2>/dev/null || true
