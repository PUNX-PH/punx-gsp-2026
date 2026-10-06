#!/bin/bash
# Regenerates blender-worker/fixtures/recipes/high/ from the web app's own functions (the kit, the estimate, the budget fit).
# Run from anywhere; needs Node 24 on the PATH. It copies generate-high-fixtures.ts into web/src/lib/builder as a test, runs it, and removes it.
set -e
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB="$HERE/../../web"
cp "$HERE/generate-high-fixtures.ts" "$WEB/src/lib/builder/_generate-high-fixtures.test.ts"
trap 'rm -f "$WEB/src/lib/builder/_generate-high-fixtures.test.ts"' EXIT
(cd "$WEB" && npx vitest run src/lib/builder/_generate-high-fixtures.test.ts)
