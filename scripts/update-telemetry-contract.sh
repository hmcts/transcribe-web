#!/usr/bin/env bash
# Refresh the pinned copy of transcribe-api's telemetry contract, which
# tests/unit/telemetry-contract.test.ts checks this app's browser events against.
# usage: scripts/update-telemetry-contract.sh <path to a transcribe-api checkout> [git ref, default origin/master]
set -euo pipefail
API="${1:?path to a transcribe-api checkout}"
REF="${2:-origin/master}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIXTURES="$ROOT/tests/fixtures"

git -C "$API" fetch --quiet origin
COMMIT="$(git -C "$API" rev-parse --short "$REF^{commit}")"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
git -C "$API" show "$COMMIT:telemetry-contract.json" > "$TMP"
# Only a contract that parses replaces the pinned one.
node -e 'const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); if (!c.events || !c.attributes) process.exit(1);' "$TMP"
mv "$TMP" "$FIXTURES/telemetry-contract.json"
trap - EXIT
printf 'transcribe-api %s\n' "$COMMIT" > "$FIXTURES/telemetry-contract.source"
echo "tests/fixtures/telemetry-contract.json <- transcribe-api $COMMIT"
