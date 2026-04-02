#!/usr/bin/env bash
set -euo pipefail

# Pre-push validation for olumi-assistants-service
# Called by .git/hooks/pre-push — receives remote name + URL as $1/$2,
# and ref info on stdin per the git pre-push protocol.

# Git hooks run with a minimal PATH that may exclude node/pnpm.
# Ensure /usr/local/bin (node) and repo-local binaries are reachable.
REPO_ROOT="$(git rev-parse --show-toplevel)"
export PATH="/usr/local/bin:${REPO_ROOT}/node_modules/.bin:$PATH"

FAILURES=0
cd "$REPO_ROOT"

# Capture stdin before any function can consume it
STDIN_DATA=$(cat || true)

# Smoke test file set: 8 critical orchestrator pipeline tests
SMOKE_TESTS=(
  tests/unit/orchestrator/pipeline/pipeline.test.ts
  tests/unit/orchestrator/pipeline/pipeline-stream.test.ts
  tests/unit/orchestrator/pipeline/phase1-enrichment.test.ts
  tests/unit/orchestrator/pipeline/phase3-llm.test.ts
  tests/unit/orchestrator/pipeline/phase4-tools.test.ts
  tests/unit/orchestrator/pipeline/phase5-envelope-assembler.test.ts
  tests/unit/orchestrator/tools/dispatch-chaining.test.ts
  tests/unit/orchestrator/tools/edit-graph-normalisation.test.ts
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

print_check() {
  local name="$1" status="$2"
  printf "  %-36s %s\n" "$name" "$status"
}

# ---------------------------------------------------------------------------
# 1. Branch guard — block push to main
# ---------------------------------------------------------------------------
check_branch_guard() {
  if [ -z "$STDIN_DATA" ]; then
    print_check "branch-guard" "OK (no refs)"
    return 0
  fi
  while IFS=' ' read -r _local_ref _local_sha remote_ref _remote_sha; do
    if [ "$remote_ref" = "refs/heads/main" ]; then
      print_check "branch-guard" "FAIL"
      echo "    Direct push to main is blocked. Use a pull request."
      FAILURES=$((FAILURES + 1))
      return 0
    fi
  done <<< "$STDIN_DATA"
  print_check "branch-guard" "OK"
}

# ---------------------------------------------------------------------------
# 2. TypeScript type check
# ---------------------------------------------------------------------------
check_typecheck() {
  local output
  # Use build config (source only, excludes test files with pre-existing type errors)
  if output=$(tsc -p tsconfig.build.json --noEmit 2>&1); then
    print_check "typecheck" "OK"
  else
    print_check "typecheck" "FAIL"
    echo "$output" | tail -40
    FAILURES=$((FAILURES + 1))
  fi
}

# ---------------------------------------------------------------------------
# 3. Lint changed .ts/.tsx files only
# ---------------------------------------------------------------------------
check_lint_changed() {
  local files
  # Lint source files only (test files have pre-existing lint issues)
  files=$(git diff --name-only HEAD -- 'src/**/*.ts' 'src/**/*.tsx' 2>/dev/null || true)
  if [ -z "$files" ]; then
    print_check "lint-changed" "OK (no changed src files)"
    return 0
  fi
  local output
  if output=$(echo "$files" | xargs eslint --no-error-on-unmatched-pattern 2>&1); then
    print_check "lint-changed" "OK"
  else
    print_check "lint-changed" "FAIL"
    echo "$output" | tail -40
    FAILURES=$((FAILURES + 1))
  fi
}

# ---------------------------------------------------------------------------
# 4. Smoke tests — critical orchestrator pipeline files
# ---------------------------------------------------------------------------
check_smoke_tests() {
  local output
  if output=$(vitest run "${SMOKE_TESTS[@]}" 2>&1); then
    print_check "smoke-tests" "OK"
  else
    print_check "smoke-tests" "FAIL"
    echo "$output" | tail -40
    FAILURES=$((FAILURES + 1))
  fi
}

# ---------------------------------------------------------------------------
# 5. Stale .js detection — tracked .js with co-located .ts in src/
# ---------------------------------------------------------------------------
check_stale_js() {
  local stale
  stale=$(git ls-files 'src/**/*.js' | while read -r f; do test -f "${f%.js}.ts" && echo "$f"; done || true)
  if [ -z "$stale" ]; then
    print_check "stale-js" "OK"
  else
    print_check "stale-js" "FAIL"
    echo "    Stale .js files shadowing .ts sources:"
    echo "$stale" | sed 's/^/      /'
    FAILURES=$((FAILURES + 1))
  fi
}

# ---------------------------------------------------------------------------
# 6. Dependency audit — check for file: references in package.json
# ---------------------------------------------------------------------------
check_dependency_audit() {
  local hits
  hits=$(grep -n '"file:' package.json 2>/dev/null || true)
  if [ -z "$hits" ]; then
    print_check "dependency-audit" "OK"
  else
    print_check "dependency-audit" "FAIL"
    echo "    package.json contains file: references:"
    echo "$hits" | sed 's/^/      /'
    FAILURES=$((FAILURES + 1))
  fi
}

# ---------------------------------------------------------------------------
# Run all checks
# ---------------------------------------------------------------------------
echo ""
echo "pre-push validation"
echo "-------------------"

check_branch_guard
check_typecheck
check_lint_changed
check_smoke_tests
check_stale_js
check_dependency_audit

echo ""
if [ "$FAILURES" -gt 0 ]; then
  echo "pre-push: $FAILURES check(s) failed. Push blocked."
  echo "Bypass with: git push --no-verify"
  exit 1
fi
echo "pre-push: all checks passed."
exit 0
