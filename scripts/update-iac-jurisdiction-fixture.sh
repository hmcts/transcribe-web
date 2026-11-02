#!/usr/bin/env bash
# Refresh tests/fixtures/iac-jurisdiction.json, the IAC as transcribe-api's migration
# 0004 creates it (DIAAT-322), which the component tests render the IAC with.
# usage: scripts/update-iac-jurisdiction-fixture.sh <path to a transcribe-api checkout> [git ref, default origin/master]
set -euo pipefail
API="${1:?path to a transcribe-api checkout}"
REF="${2:-origin/master}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIXTURES="$ROOT/tests/fixtures"

# Offline, or a local ref: use what the checkout already has.
git -C "$API" fetch --quiet origin || echo "Could not fetch origin; using the checkout's refs" >&2
COMMIT="$(git -C "$API" rev-parse --short "$REF^{commit}")"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
# The migration's constants, read without running it.
git -C "$API" show "$COMMIT:alembic/versions/0004_jurisdictions.py" | python3 -I -c '
import ast, json, sys
values = {}
for node in ast.parse(sys.stdin.read()).body:
    if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
        target = node.targets[0]
    elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) and node.value is not None:
        target = node.target
    else:
        continue
    try:
        values[target.id] = ast.literal_eval(node.value)
    except Exception:  # not a literal, and not one of ours
        pass
missing = {"IAC_CODE", "IAC_NAME", "IAC_SETTINGS"} - set(values)
if missing:
    sys.exit(f"0004_jurisdictions.py does not declare {sorted(missing)} as literals")
settings = values["IAC_SETTINGS"]
print(json.dumps({
    "code": values["IAC_CODE"], "name": values["IAC_NAME"], "role": "judge",
    "template": settings["template"], "features": settings["features"], "wording": settings["wording"],
}, indent=2))' > "$TMP"
mv "$TMP" "$FIXTURES/iac-jurisdiction.json"
trap - EXIT
printf 'transcribe-api %s alembic/versions/0004_jurisdictions.py\n' "$COMMIT" > "$FIXTURES/iac-jurisdiction.source"
echo "tests/fixtures/iac-jurisdiction.json <- transcribe-api $COMMIT"
