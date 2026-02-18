#!/usr/bin/env bash
# pre-push-validate.sh — gate that catches deployment failures before push.
# Run manually or via git pre-push hook.
set -euo pipefail

FAILURES=0
CHECKS_RUN=0
CHECKS_PASSED=0
BRANCH=$(git branch --show-current)

# ─── colours (disabled if not a terminal) ──────────────────────────────────────
if [[ -t 1 ]]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; BOLD='\033[1m'; RESET='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; BOLD=''; RESET=''
fi

pass() { ((CHECKS_PASSED++)) || true; echo -e "${GREEN}✓${RESET} $1"; }
fail() { ((FAILURES++))      || true; echo -e "${RED}✗${RESET} $1"; }
warn() { echo -e "${YELLOW}⚠${RESET} $1"; }
header() { echo -e "\n${BOLD}── $1 ──${RESET}"; }

# ─── Check 1: Branch guard ────────────────────────────────────────────────────
check_branch_guard() {
  header "Check 1: Branch guard"
  ((CHECKS_RUN++)) || true

  if [[ "$BRANCH" == "main" ]]; then
    fail "Direct push from 'main' is blocked. Push to 'staging' instead."
    return
  fi

  # When invoked as a git pre-push hook, stdin carries lines:
  #   <local ref> <local sha> <remote ref> <remote sha>
  # If stdin has data, parse it to block pushes targeting refs/heads/main.
  if [[ -n "${PRE_PUSH_STDIN:-}" ]]; then
    while IFS=' ' read -r _local_ref _local_sha remote_ref _remote_sha; do
      if [[ "$remote_ref" == "refs/heads/main" ]]; then
        fail "Push targets refs/heads/main — blocked. Push to 'staging' instead."
        return
      fi
    done <<< "$PRE_PUSH_STDIN"
  fi

  pass "Branch guard (on '$BRANCH', not targeting main)"
}

# ─── Check 2: TypeScript compilation ──────────────────────────────────────────
check_typecheck() {
  header "Check 2: TypeScript compilation"
  ((CHECKS_RUN++)) || true

  if pnpm typecheck 2>&1; then
    pass "TypeScript compilation (tsc --noEmit)"
  else
    fail "TypeScript compilation failed — run 'pnpm typecheck' for details."
  fi
}

# ─── Check 3: Full test suite ─────────────────────────────────────────────────
check_tests() {
  header "Check 3: Full test suite"
  ((CHECKS_RUN++)) || true

  local tmpfile
  tmpfile=$(mktemp /tmp/pre-push-tests.XXXXXX.log)

  if pnpm test > "$tmpfile" 2>&1; then
    pass "Full test suite"
    rm -f "$tmpfile"
  else
    fail "Test suite failed. Last 40 lines:"
    echo "---"
    tail -40 "$tmpfile"
    echo "---"
    echo "Full log: $tmpfile"
  fi
}

# ─── Check 4: Stale .js detection ─────────────────────────────────────────────
check_stale_js() {
  header "Check 4: Stale .js detection"
  ((CHECKS_RUN++)) || true

  local stale_files=()
  while IFS= read -r jsfile; do
    [[ -z "$jsfile" ]] && continue
    local tsfile="${jsfile%.js}.ts"
    if [[ -f "$tsfile" ]]; then
      stale_files+=("$jsfile")
    fi
  done < <(git ls-files -- 'src/*.js' 'src/**/*.js' 2>/dev/null)

  if [[ ${#stale_files[@]} -eq 0 ]]; then
    pass "No stale .js files in src/"
  else
    fail "Stale tracked .js files with co-located .ts (remove them):"
    for f in "${stale_files[@]}"; do
      echo "  - $f"
    done
  fi
}

# ─── Check 5: Dependency audit ────────────────────────────────────────────────
check_deps() {
  header "Check 5: Dependency audit (file: references)"
  ((CHECKS_RUN++)) || true

  local found=0

  # Check package.json for file: protocol references (e.g. "file:../local-pkg")
  # Use a precise regex: "file: followed by a path character (. or /)
  if grep -qE '"file:[./]' package.json 2>/dev/null; then
    fail "package.json contains 'file:' dependency reference (fails on Render):"
    grep -E '"file:[./]' package.json | while IFS= read -r line; do echo "  $line"; done
    found=1
  fi

  # Check lockfile for file: protocol references
  # In pnpm-lock.yaml these appear as:  specifier: file:../path  or  version: file:../path
  # Avoid false positives on package names containing "file" (e.g. jsonfile, get-caller-file)
  local lockfile=""
  if [[ -f pnpm-lock.yaml ]]; then lockfile="pnpm-lock.yaml"
  elif [[ -f package-lock.json ]]; then lockfile="package-lock.json"
  elif [[ -f yarn.lock ]]; then lockfile="yarn.lock"
  fi

  if [[ -n "$lockfile" ]] && grep -qE '("|'"'"')file:[./]|:\s+file:[./]' "$lockfile" 2>/dev/null; then
    fail "$lockfile contains 'file:' references (fails on Render):"
    grep -E '("|'"'"')file:[./]|:\s+file:[./]' "$lockfile" | head -5 | while IFS= read -r line; do echo "  $line"; done
    found=1
  fi

  if [[ $found -eq 0 ]]; then
    pass "No file: dependency references"
  fi
}

# ─── Check 6: OpenAPI freshness ───────────────────────────────────────────────
check_openapi() {
  header "Check 6: OpenAPI freshness"
  ((CHECKS_RUN++)) || true

  # Regenerate the OpenAPI types and check for drift
  if ! pnpm openapi:generate > /dev/null 2>&1; then
    fail "OpenAPI generation failed — run 'pnpm openapi:generate' for details."
    return
  fi

  if git diff --exit-code --quiet src/generated/openapi.d.ts 2>/dev/null; then
    pass "OpenAPI spec is fresh"
  else
    fail "OpenAPI generated types are stale — run 'pnpm openapi:generate' and commit."
    git diff --stat src/generated/openapi.d.ts
    # Restore the file so we don't leave dirty state
    git checkout -- src/generated/openapi.d.ts 2>/dev/null || true
  fi
}

# ─── Main ──────────────────────────────────────────────────────────────────────
echo -e "${BOLD}Pre-push validation${RESET}"
echo "Branch: $BRANCH"
echo ""

check_branch_guard || true
check_typecheck    || true
check_tests        || true
check_stale_js     || true
check_deps         || true
check_openapi      || true

# ─── Check 7: Summary ─────────────────────────────────────────────────────────
header "Summary"
echo "Branch:        $BRANCH"

# Files changed vs origin/staging (may fail if remote not fetched)
changed_count=$(git diff --name-only origin/staging...HEAD 2>/dev/null | wc -l | tr -d ' ')
echo "Files changed: ${changed_count:-unknown} (vs origin/staging)"

echo "Checks run:    $CHECKS_RUN"
echo "Passed:        $CHECKS_PASSED"
echo "Failed:        $FAILURES"
echo ""

if [[ $FAILURES -gt 0 ]]; then
  echo -e "${RED}${BOLD}✗ Pre-push validation FAILED ($FAILURES failure(s))${RESET}"
  exit 1
else
  echo -e "${GREEN}${BOLD}✓ All checks passed${RESET}"
  exit 0
fi
