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

# Smoke test file set: critical V5 orchestrator-pipeline tests.
#
# Codex F1 (2026-07-22): the previous list was ten pre-V5 paths, NINE of which
# #615 deleted with the dead V1 belt. Vitest SILENTLY IGNORES a path filter that
# matches no file, so the gate ran GREEN while exercising 1/10 files — guarantee
# theatre. This set is the current LIVE V5 critical pipeline; every entry is
# verified to exist AND pass, `check_smoke_tests` now fails LOUD on any missing
# entry (below), and tests/unit/smoke-gate-inventory.test.ts derives from THIS
# list (reads it out of this script) and asserts each path exists on disk — so a
# future deletion fails a test, not silently under-covers the gate.
#
#   path                                                                  covers
#   --------------------------------------------------------------------  -------------------------
SMOKE_TESTS=(
  src/orchestrator-v5/__tests__/turn-executor.test.ts                                 # turn-executor routing
  src/orchestrator-v5/routing/__tests__/route-with-tool-use-forced-explanation.test.ts # forced-intent analytical pills
  src/orchestrator-v5/handlers/__tests__/chip-click-dispatch.test.ts                  # run_analysis chip dispatch
  src/orchestrator-v5/handlers/__tests__/edit-graph-dispatch.test.ts                  # edit-graph dispatch
  src/orchestrator-v5/context/__tests__/freshness.test.ts                             # analysis-freshness derivation
  src/orchestrator-v5/__tests__/turn-executor-recovery-chips.test.ts                  # bounded routing fallback
  tests/unit/validators/b1-drift.test.ts                                              # B1 boundary validator (egress/ingress typed fallback)
  src/orchestrator-v5/context/__tests__/context-pack-assembler.test.ts                # context-pack assembly
  src/orchestrator-v5/tools/handlers/__tests__/run-analysis.test.ts                   # run_analysis handler ingest
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

print_check() {
  local name="$1" status="$2"
  printf "  %-36s %s\n" "$name" "$status"
}

# ---------------------------------------------------------------------------
# 0. Toolchain preflight — fail fast with the actual cause.
#    Fresh worktrees check out sources but no usable toolchain: checks 2–4
#    would otherwise die in MODULE_NOT_FOUND walls that mask the real problem.
#    IMPORTANT: existence checks are NOT sufficient — node_modules is
#    partially tracked, so .bin/tsc exists AND RUNS in a fresh worktree while
#    eslint/vitest crash on load and openapi-typescript is absent entirely.
#    So we probe by EXECUTION (--version) plus the one known-absent binary.
#    Exits immediately (rather than accumulating FAILURES): every later
#    check is noise without a toolchain.
# ---------------------------------------------------------------------------
check_toolchain_preflight() {
  local broken=""
  local bin
  for bin in tsc eslint vitest; do
    if ! "${REPO_ROOT}/node_modules/.bin/${bin}" --version > /dev/null 2>&1; then
      broken="${broken} ${bin}"
    fi
  done
  if [ ! -x "${REPO_ROOT}/node_modules/.bin/openapi-typescript" ]; then
    broken="${broken} openapi-typescript"
  fi
  if [ -n "$broken" ]; then
    print_check "toolchain-preflight" "FAIL"
    echo "    Broken or missing toolchain binaries:${broken}"
    echo "    This worktree's toolchain is not installed (fresh worktree?)."
    echo "    node_modules is partially tracked, so some binaries exist but crash."
    echo "    Fix:   bash scripts/bootstrap-worktree.sh"
    echo ""
    echo "pre-push: toolchain missing. Push blocked."
    exit 1
  fi
  print_check "toolchain-preflight" "OK"
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
  # Delegate to `pnpm typecheck` — the single honest gate (tsconfig.build.json,
  # source-only). Going through the script rather than calling tsc directly means
  # this inherits BOTH prerequisites from `pretypecheck`:
  #   1. openapi:generate — fresh worktrees lack src/generated/openapi.d.ts
  #      (gitignored) which ~40 source files import; without it tsc reports a wall
  #      of TS2307 errors that mask real issues.
  #   2. check:schemas-resolution — fails loudly if @talchain/schemas resolves to a
  #      parent directory's copy (the worktree trap) or drifts from the pin.
  # Calling tsc directly here would silently skip (2) and re-introduce the trap.
  # Mirrors the CI flow exactly.
  if output=$(pnpm typecheck 2>&1); then
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
  # Fail LOUD if any SMOKE_TESTS entry is missing on disk BEFORE invoking
  # Vitest. Vitest treats a path filter that matches no file as a silent no-op
  # (it does not error), so a deleted/renamed entry would otherwise leave this
  # gate GREEN while exercising fewer files than intended — the exact F1
  # guarantee-theatre regression (#615 deleted 9 of the 10 old entries and the
  # gate stayed green on 1). This existence check makes drift a hard FAIL.
  local missing="" f
  for f in "${SMOKE_TESTS[@]}"; do
    if [ ! -f "${REPO_ROOT}/${f}" ]; then
      missing="${missing}
      ${f}"
    fi
  done
  if [ -n "$missing" ]; then
    print_check "smoke-tests" "FAIL"
    echo "    SMOKE_TESTS entries missing on disk (Vitest would SILENTLY skip these):${missing}"
    echo "    Update the SMOKE_TESTS list in scripts/validate-prepush.sh to current"
    echo "    V5 critical-pipeline test paths. See tests/unit/smoke-gate-inventory.test.ts."
    FAILURES=$((FAILURES + 1))
    return 0
  fi

  local output
  if output=$(vitest run "${SMOKE_TESTS[@]}" 2>&1); then
    print_check "smoke-tests" "OK (${#SMOKE_TESTS[@]} files)"
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
# 16. Forbidden-boundary-pattern containment gate — blocks growth in high-risk
#     usages (warnOnInvalid, `as unknown as` double-casts, science-field
#     constant fallbacks) vs an exact frozen baseline. Containment only; does
#     not cure or vouch for the existing population. See
#     scripts/check-forbidden-boundary-patterns.sh and
#     scripts/ci/forbidden-boundary-baseline.txt.
# ---------------------------------------------------------------------------
check_forbidden_boundary_patterns() {
  local out
  if out="$(bash scripts/check-forbidden-boundary-patterns.sh 2>&1)"; then
    print_check "forbidden-boundary-patterns" "OK"
  else
    print_check "forbidden-boundary-patterns" "FAIL"
    printf '%s\n' "$out" | sed 's/^/      /'
    FAILURES=$((FAILURES + 1))
  fi
}

# ---------------------------------------------------------------------------
# Run all checks
# ---------------------------------------------------------------------------
echo ""
echo "pre-push validation"
echo "-------------------"

check_toolchain_preflight
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
check_forbidden_boundary_patterns

echo ""
if [ "$FAILURES" -gt 0 ]; then
  echo "pre-push: $FAILURES check(s) failed. Push blocked."
  echo "Bypass with: git push --no-verify"
  exit 1
fi
echo "pre-push: all checks passed."
exit 0
