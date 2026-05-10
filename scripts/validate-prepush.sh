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

# Smoke test file set: critical orchestrator pipeline tests
SMOKE_TESTS=(
  tests/unit/orchestrator/pipeline/pipeline.test.ts
  tests/unit/orchestrator/pipeline/pipeline-stream.test.ts
  tests/unit/orchestrator/pipeline/phase1-enrichment.test.ts
  tests/unit/orchestrator/pipeline/phase3-llm.test.ts
  tests/unit/orchestrator/pipeline/phase4-tools.test.ts
  tests/unit/orchestrator/pipeline/phase5-envelope-assembler.test.ts
  tests/unit/orchestrator/pipeline/analysis-state-normalization.test.ts
  tests/unit/orchestrator/analysis-state-normalizer.test.ts
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
  # Ensure OpenAPI generated types exist before tsc — fresh worktrees lack
  # src/generated/openapi.d.ts (gitignored), and ~40 source files import it.
  # Without this, tsc reports a wall of TS2307 errors that mask real issues.
  # Mirrors the CI flow (`pnpm openapi:generate` then typecheck).
  if ! output=$(pnpm openapi:generate 2>&1); then
    print_check "typecheck" "FAIL (openapi:generate failed)"
    echo "$output" | tail -20
    FAILURES=$((FAILURES + 1))
    return 0
  fi
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
# 3. Lint changed lintable files (matches CI lint scope)
#
# CI runs `pnpm lint` = `eslint .` over the whole repo. The local hook lints
# only changed files for speed, but must include every category CI would
# (src/ AND tests/), and must fail closed when it can't determine the diff
# base — silent skips here let lint regressions slip through to CI.
#
# Operator override: `SKIP_LINT_CHANGED=1 git push` bypasses with a loud
# warning. Use only for offline/emergency push.
# ---------------------------------------------------------------------------
check_lint_changed() {
  if [ "${SKIP_LINT_CHANGED:-0}" = "1" ]; then
    print_check "lint-changed" "SKIPPED"
    echo "    WARNING: SKIP_LINT_CHANGED=1 — bypassing lint-changed."
    echo "    Operator override only. Do not use in CI or routine pushes."
    return 0
  fi

  # Resolve diff base via merge-base. Prefer origin/staging because this
  # repo's CLAUDE.md "Always push to staging" makes staging the active
  # trunk; origin/main has historically diverged. Fall back through
  # origin/main and local refs in case the remote ref isn't fetched.
  # Fail closed if none resolve to a non-empty merge-base.
  local base="" base_ref=""
  for ref in origin/staging origin/main staging main; do
    if git rev-parse --verify --quiet "${ref}^{commit}" >/dev/null 2>&1; then
      base=$(git merge-base "$ref" HEAD 2>/dev/null || true)
      if [ -n "$base" ]; then
        base_ref="$ref"
        break
      fi
    fi
  done

  if [ -z "$base" ]; then
    print_check "lint-changed" "FAIL"
    echo "    Could not resolve diff base. Tried: origin/staging, origin/main, staging, main."
    echo "    Fix:   git fetch origin staging   (or main)"
    echo "    Or bypass for offline/emergency push: SKIP_LINT_CHANGED=1 git push"
    FAILURES=$((FAILURES + 1))
    return 0
  fi

  # NUL-delimited diff handles paths with spaces / special chars safely.
  local -a candidate=()
  while IFS= read -r -d '' f; do
    [ -n "$f" ] && candidate+=("$f")
  done < <(git diff --name-only -z "$base" HEAD 2>/dev/null || true)

  # Filter to ESLint-eligible files. Must mirror eslint.config.js `ignores`
  # (dist/**, node_modules/**, tests/perf/**/*.js, examples/**, scripts/**,
  # tests/types/**, perf/**, qa-smoke.mjs, sdk/typescript/dist/**,
  # sdk/typescript/vitest.config.ts, "** *  2.ts" / "** *  3.ts" stale
  # shadows). If eslint.config.js ignore list changes, update here.
  local -a selected=()
  local f
  if [ "${#candidate[@]}" -gt 0 ]; then
    for f in "${candidate[@]}"; do
      case "$f" in
        *.ts|*.tsx|*.js|*.mjs|*.cjs) ;;
        *) continue ;;
      esac
      case "$f" in
        dist/*|node_modules/*|examples/*|scripts/*|perf/*) continue ;;
        tests/types/*) continue ;;
        tests/perf/*.js|tests/perf/*/*.js|tests/perf/*/*/*.js) continue ;;
        sdk/typescript/dist/*) continue ;;
        sdk/typescript/vitest.config.ts) continue ;;
        qa-smoke.mjs) continue ;;
        *" 2.ts"|*" 2.tsx"|*" 3.ts"|*" 3.tsx") continue ;;
      esac
      selected+=("$f")
    done
  fi

  # Visible no-op: print base + counts so a true zero-change push is
  # distinguishable from a silent skip (the bug this hook hardening fixes).
  if [ "${#selected[@]}" -eq 0 ]; then
    print_check "lint-changed" "OK (no lintable changed files)"
    echo "    base:                    $base_ref ($base)"
    echo "    candidate changed files: ${#candidate[@]}"
    echo "    selected lint files:     0"
    return 0
  fi

  # Drop deletions — eslint can't lint missing files.
  local -a existing=()
  for f in "${selected[@]}"; do
    if [ -f "$f" ]; then
      existing+=("$f")
    fi
  done

  if [ "${#existing[@]}" -eq 0 ]; then
    print_check "lint-changed" "OK (selected files all deleted)"
    echo "    base:                    $base_ref ($base)"
    echo "    candidate changed files: ${#candidate[@]}"
    echo "    selected lint files:     ${#selected[@]} (all deleted)"
    return 0
  fi

  local output
  if output=$(eslint --no-error-on-unmatched-pattern "${existing[@]}" 2>&1); then
    print_check "lint-changed" "OK (${#existing[@]} file(s) linted vs $base_ref)"
  else
    print_check "lint-changed" "FAIL"
    echo "    base:                    $base_ref ($base)"
    echo "    candidate changed files: ${#candidate[@]}"
    echo "    selected lint files:     ${#existing[@]}"
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
#
# A1: `@talchain/schemas` is legitimately vendored via `file:./vendor/...`.
# Exclude it from the audit (the tarball-sha-manifest check below covers
# drift for this specific dependency). Any OTHER file: reference still fails.
# ---------------------------------------------------------------------------
check_dependency_audit() {
  local hits
  hits=$(grep -n '"file:' package.json 2>/dev/null | grep -v '"@talchain/schemas"' || true)
  if [ -z "$hits" ]; then
    print_check "dependency-audit" "OK"
  else
    print_check "dependency-audit" "FAIL"
    echo "    package.json contains non-allowlisted file: references:"
    echo "$hits" | sed 's/^/      /'
    FAILURES=$((FAILURES + 1))
  fi
}

# ---------------------------------------------------------------------------
# 7. V5 tarball SHA manifest — drift blocks push.
# ---------------------------------------------------------------------------
check_tarball_sha() {
  if bash scripts/validate-tarball-sha.sh > /dev/null 2>&1; then
    print_check "tarball-sha" "OK"
  else
    print_check "tarball-sha" "FAIL"
    bash scripts/validate-tarball-sha.sh 2>&1 | sed 's/^/      /'
    FAILURES=$((FAILURES + 1))
  fi
}

# ---------------------------------------------------------------------------
# 8. V5 transport invariants — no raw stream writes / SSE in orchestrator-v5.
# ---------------------------------------------------------------------------
check_transport_invariants() {
  if bash scripts/validate-transport-invariants.sh > /dev/null 2>&1; then
    print_check "transport-invariants" "OK"
  else
    print_check "transport-invariants" "FAIL"
    bash scripts/validate-transport-invariants.sh 2>&1 | sed 's/^/      /'
    FAILURES=$((FAILURES + 1))
  fi
}

# ---------------------------------------------------------------------------
# 9. V5 data-responsibility tripwire — CEE must not compute PLoT-owned
#    enrichment fields (factor_sensitivity, m1_coaching, flip_thresholds,
#    conditional_probabilities, edge_e_values). Passthrough only.
#    Catches the V4 silent-drop regression class before it recurs.
# ---------------------------------------------------------------------------
check_data_responsibility() {
  if bash scripts/validate-data-responsibility.sh > /dev/null 2>&1; then
    print_check "data-responsibility" "OK"
  else
    print_check "data-responsibility" "FAIL"
    bash scripts/validate-data-responsibility.sh 2>&1 | sed 's/^/      /'
    FAILURES=$((FAILURES + 1))
  fi
}

# ---------------------------------------------------------------------------
# 10. Phase 0 closure gate — every Phase 0 artefact present + wired.
#     Guards against accidental deletion of the task IDs, migration file,
#     rollback companion, validation scripts, or audit verdict/rename refs.
#     Becomes near-noise-free once Tranche 2+ lands (always passes on a
#     well-formed tree), but catches drift if anyone touches the artefacts.
# ---------------------------------------------------------------------------
check_phase_0_complete() {
  if bash scripts/validate-phase-0-complete.sh > /dev/null 2>&1; then
    print_check "phase-0-complete" "OK"
  else
    print_check "phase-0-complete" "FAIL"
    bash scripts/validate-phase-0-complete.sh 2>&1 | sed 's/^/      /'
    FAILURES=$((FAILURES + 1))
  fi
}

# ---------------------------------------------------------------------------
# 11. Docs consistency guard — regression tripwire against specific stale
#     patterns the external reviewer flagged + we fixed (grant-model
#     contradictions, removed p_user_id parameter, pin/tarball drift).
# ---------------------------------------------------------------------------
check_docs_consistency() {
  if bash scripts/validate-docs-consistency.sh > /dev/null 2>&1; then
    print_check "docs-consistency" "OK"
  else
    print_check "docs-consistency" "FAIL"
    bash scripts/validate-docs-consistency.sh 2>&1 | sed 's/^/      /'
    FAILURES=$((FAILURES + 1))
  fi
}

# ---------------------------------------------------------------------------
# 12. State-write invariant — V5 Slice B. Ensures the session persistence
#     surface is narrow: append_turn_atomic RPC + v5_* tables are only
#     touched from session/supabase-store.ts; the SessionStore interface is
#     only imported by the declared integration points (commit.ts,
#     build-turn-context.ts).
# ---------------------------------------------------------------------------
check_state_write_invariant() {
  if bash scripts/validate-state-write-invariant.sh > /dev/null 2>&1; then
    print_check "state-write-invariant" "OK"
  else
    print_check "state-write-invariant" "FAIL"
    bash scripts/validate-state-write-invariant.sh 2>&1 | sed 's/^/      /'
    FAILURES=$((FAILURES + 1))
  fi
}

# ---------------------------------------------------------------------------
# 13. Handler-ownership invariant — V5 Slice C2. F.6 negative-proof that
#     the run_analysis handler does NOT reinterpret PLoT results, apply
#     math/formatting helpers to response fields, use direct HTTP calls,
#     reference the UI repo, or drift from the locked assistant_text
#     template enum. Prevents the V4 "silent semantic drift" failure mode.
# ---------------------------------------------------------------------------
check_handler_ownership() {
  if bash scripts/validate-handler-ownership.sh > /dev/null 2>&1; then
    print_check "handler-ownership" "OK"
  else
    print_check "handler-ownership" "FAIL"
    bash scripts/validate-handler-ownership.sh 2>&1 | sed 's/^/      /'
    FAILURES=$((FAILURES + 1))
  fi
}

# ---------------------------------------------------------------------------
# 14. V5 Phase 1.5 invariants — the `validate_skipped_graph_checks` stage
#     string-literal must not appear in production code (Phase 1.5 renamed
#     it to `validate_skipped_no_graph`), and the ContextPack assembler
#     must stay free of semantic transforms (F.6 passthrough).
# ---------------------------------------------------------------------------
check_phase_1_5_invariants() {
  if bash scripts/validate-v5-phase1.5-invariants.sh > /dev/null 2>&1; then
    print_check "phase-1.5-invariants" "OK"
  else
    print_check "phase-1.5-invariants" "FAIL"
    bash scripts/validate-v5-phase1.5-invariants.sh 2>&1 | sed 's/^/      /'
    FAILURES=$((FAILURES + 1))
  fi
}

# ---------------------------------------------------------------------------
# 15. V5 finaliser contract — `analysis_ready` must only be set by the
#     response-finaliser; route-v2.ts is the sole writer via finaliseV5Response.
#     Composers, dispatch handlers, and TurnExecutor compose-call sites must
#     NOT touch the field. See Docs/v5/v5-response-exit-audit.md.
# ---------------------------------------------------------------------------
check_response_finaliser_contract() {
  if bash scripts/check-no-direct-analysis-ready.sh > /dev/null 2>&1; then
    print_check "response-finaliser-contract" "OK"
  else
    print_check "response-finaliser-contract" "FAIL"
    bash scripts/check-no-direct-analysis-ready.sh 2>&1 | sed 's/^/      /'
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
check_tarball_sha
check_transport_invariants
check_data_responsibility
check_phase_0_complete
check_docs_consistency
check_state_write_invariant
check_handler_ownership
check_phase_1_5_invariants
check_response_finaliser_contract

echo ""
if [ "$FAILURES" -gt 0 ]; then
  echo "pre-push: $FAILURES check(s) failed. Push blocked."
  echo "Bypass with: git push --no-verify"
  exit 1
fi
echo "pre-push: all checks passed."
exit 0
