#!/usr/bin/env bash
# Phase 0 completion gate — plan rev 2 I-1.
#
# Single machine-checkable assertion that every Phase 0 artefact is present
# and wired. Runs before Tranche 2 dispatch as a fast sanity check so a
# "doc-approved but half-committed" Phase 0 cannot pass informal review.
#
# Each check is local (file existence + grep). The script does NOT run
# migrations, call Supabase, or execute tests — it's a pre-flight gate,
# not a deep verification. The live gates (introspection --strict,
# post-migration RPC test) run separately.
#
# Non-zero exit blocks CI / pre-push.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXIT=0

fail() {
  echo "FAIL: $1"
  EXIT=1
}

pass() {
  echo "OK:   $1"
}

# ------------------------------------------------------------
# 1. Vendored tarball + SHA manifest (currently pinned version)
#
# Generalised in CQE 0.6.0 bump: the Phase 0 semantic is "the
# @talchain/schemas tarball + its manifest + its pin all exist and
# agree", not "the pin is literally 0.5.1 forever". We derive the
# pinned filename from package.json and then check presence of the
# file and manifest, plus that the pin references a file:./vendor/
# schemas tarball at all (guards against an accidental swap to an
# npm-registry version).
# ------------------------------------------------------------

PINNED_TARBALL="$(grep -oE '"@talchain/schemas":[[:space:]]*"file:\./vendor/[^"]+\.tgz"' "$REPO_ROOT/package.json" | sed -E 's|.*vendor/||; s|".*||' || true)"
if [ -z "$PINNED_TARBALL" ]; then
  fail "package.json does not pin @talchain/schemas to a file:./vendor/*.tgz"
else
  pass "package.json pin: @talchain/schemas -> $PINNED_TARBALL"
fi

TARBALL="$REPO_ROOT/vendor/$PINNED_TARBALL"
MANIFEST="$TARBALL.sha256"

if [ -f "$TARBALL" ]; then pass "vendored tarball: $PINNED_TARBALL"; else fail "missing: $TARBALL"; fi
if [ -f "$MANIFEST" ]; then pass "vendored SHA manifest: $PINNED_TARBALL.sha256"; else fail "missing: $MANIFEST"; fi

# ------------------------------------------------------------
# 2. 7 new CeeTaskId literals present in src/prompts/schema.ts
# ------------------------------------------------------------

TASK_IDS=(
  'run_analysis_narrate'
  'set_factor_value_narrate'
  'add_constraint_narrate'
  'adjust_edge_strength_narrate'
  'explain_result_narrate'
  'compare_options_narrate'
  'what_would_flip_narrate'
)

for tid in "${TASK_IDS[@]}"; do
  if grep -q "'$tid'" "$REPO_ROOT/src/prompts/schema.ts"; then
    pass "CeeTaskId literal: '$tid'"
  else
    fail "CeeTaskId literal missing in src/prompts/schema.ts: '$tid'"
  fi
done

# ------------------------------------------------------------
# 3. 7 OPERATION_TO_TASK_ID entries present in the map the loader USES
#
# ⚠ This check hardcoded `src/adapters/llm/prompt-loader.ts` and stood RED on
# pristine staging from 86b0e006 ("prompt estate derivable — one governance
# home") until 7 Sep 2026. That commit moved the map to src/prompts/operations.ts
# and left the loader importing it; the gate kept grepping the file the map had
# left. All seven entries existed the whole time — the gate was reading the
# wrong file, so it failed on a claim that was TRUE.
#
# The cost was not one red. The gate is wired into pre-push, so every push used
# --no-verify, which ALSO skipped the branch guard, typecheck, lint, smoke tests
# and stale-.js detection. A red everyone routes around disables its neighbours.
#
# So the location is DERIVED, exactly as section 1 derives the pinned tarball
# rather than naming a version forever. Moving the map again cannot re-break
# this; splitting or duplicating it fails LOUD rather than assume-good.
#
# ⚠ The assertion is UNCHANGED in strength: still `key: 'value'`, still all
# seven, still fail-on-missing. Removing an entry from the map still REDs — that
# is mutation-proven, not asserted. What changed is only where it looks.
# ------------------------------------------------------------

# ⚠ BOUNDARY-MATCHED, and this was caught by a mutant rather than by reading:
# `grep -l "export const OPERATION_TO_TASK_ID"` also matches
# `OPERATION_TO_TASK_ID_RENAMED`, because the longer identifier CONTAINS the
# shorter one. A rename would have sailed through the derivation and the gate
# would have gone green on a map that no longer exists under that name.
MAP_FILES="$(cd "$REPO_ROOT" && grep -rlE "export const OPERATION_TO_TASK_ID[^A-Za-z0-9_]" src || true)"
MAP_FILE_COUNT="$(printf '%s' "$MAP_FILES" | grep -c . || true)"

if [ "$MAP_FILE_COUNT" -eq 0 ]; then
  fail "OPERATION_TO_TASK_ID: no file under src/ exports it — the map is gone or renamed"
elif [ "$MAP_FILE_COUNT" -gt 1 ]; then
  fail "OPERATION_TO_TASK_ID: exported from $MAP_FILE_COUNT files, expected exactly 1 — $(printf '%s' "$MAP_FILES" | tr '\n' ' ')"
else
  MAP_FILE="$MAP_FILES"
  pass "OPERATION_TO_TASK_ID defined in: $MAP_FILE"

  # The map must be the one the prompt loader actually reads. Without this, the
  # gate would happily pass against an orphaned copy nothing imports.
  MAP_MODULE="$(basename "$MAP_FILE" .ts)"
  if grep -qE "import \{[^}]*OPERATION_TO_TASK_ID[^}]*\} from '[^']*${MAP_MODULE}\.js'" "$REPO_ROOT/src/adapters/llm/prompt-loader.ts"; then
    pass "OPERATION_TO_TASK_ID: prompt-loader.ts imports the map it is checked against"
  else
    fail "OPERATION_TO_TASK_ID: prompt-loader.ts does not import from ${MAP_MODULE} — the checked map is not the one in use"
  fi

  for tid in "${TASK_IDS[@]}"; do
    # `key: 'value'` style — operation key matches task_id 1:1.
    if grep -q "${tid}: '${tid}'" "$REPO_ROOT/$MAP_FILE"; then
      pass "OPERATION_TO_TASK_ID entry: $tid"
    else
      fail "OPERATION_TO_TASK_ID entry missing: $tid"
    fi
  done
fi

# ------------------------------------------------------------
# 4. 7 placeholder prompt fragments registered in defaults.ts
# ------------------------------------------------------------

for tid in "${TASK_IDS[@]}"; do
  if grep -q "registerDefaultPrompt('${tid}'" "$REPO_ROOT/src/prompts/defaults.ts"; then
    pass "default prompt registered: $tid"
  else
    fail "default prompt missing in defaults.ts: $tid"
  fi
done

# ------------------------------------------------------------
# 5. Migration file + rollback companion
# ------------------------------------------------------------

MIGRATION_GLOB=("$REPO_ROOT"/supabase/migrations/*_v5_session_store.sql)
ROLLBACK_GLOB=("$REPO_ROOT"/supabase/migrations/rollback/*_v5_session_store_rollback.sql.do-not-apply)

if [ -e "${MIGRATION_GLOB[0]}" ]; then
  pass "migration file: ${MIGRATION_GLOB[0]##*/}"
else
  fail "no migration file matching *_v5_session_store.sql under supabase/migrations/"
fi

if [ -e "${ROLLBACK_GLOB[0]}" ]; then
  pass "rollback companion: ${ROLLBACK_GLOB[0]##*/}"
else
  fail "no rollback companion matching *_v5_session_store_rollback.sql.do-not-apply under supabase/migrations/rollback/"
fi

# ------------------------------------------------------------
# 6. Validation scripts + post-apply validator + closure artefacts
# ------------------------------------------------------------

SCRIPTS=(
  'scripts/validate-data-responsibility.sh'
  'scripts/validate-transport-invariants.sh'
  'scripts/validate-tarball-sha.sh'
  'scripts/validate-docs-consistency.sh'
  'scripts/phase-0-introspect.ts'
  'scripts/phase-0-shape-probe.ts'
  'scripts/phase-0-post-apply-validate.ts'
)

for s in "${SCRIPTS[@]}"; do
  if [ -f "$REPO_ROOT/$s" ]; then
    pass "script present: $s"
  else
    fail "script missing: $s"
  fi
done

# Pre-push hook must include the two Phase-0-specific checks wired in the
# last hardening round. If someone deletes them, this gate catches it.
if grep -q 'check_phase_0_complete' "$REPO_ROOT/scripts/validate-prepush.sh"; then
  pass "pre-push hook: check_phase_0_complete wired"
else
  fail "pre-push hook missing check_phase_0_complete (Phase 0 closure gate unbound)"
fi
if grep -q 'check_docs_consistency' "$REPO_ROOT/scripts/validate-prepush.sh"; then
  pass "pre-push hook: check_docs_consistency wired"
else
  fail "pre-push hook missing check_docs_consistency (docs regression unbound)"
fi

# ------------------------------------------------------------
# 7. Audit + plan + evidence + sql-review doc landmarks
# ------------------------------------------------------------

AUDIT="$REPO_ROOT/Docs/v5/slice-phase-0-supabase-audit.md"
if [ -f "$AUDIT" ]; then
  pass "audit doc present"
  if grep -qE '^## 5\..*Verdict:[[:space:]]+NEW_TABLES' "$AUDIT"; then
    pass "audit verdict: NEW_TABLES"
  else
    fail "audit §5 heading does not start with 'Verdict: NEW_TABLES'"
  fi
  if grep -q 'v5_conversation_turns' "$AUDIT" && grep -q 'v5_handler_facts' "$AUDIT"; then
    pass "audit references v5_ prefixed table names"
  else
    fail "audit missing v5_ prefixed references (rename not carried through?)"
  fi
else
  fail "audit doc missing: $AUDIT"
fi

for doc in 'slice-bcd-plan.md' 'slice-phase-0-evidence-pack.md' 'slice-phase-0-sql-review.md'; do
  if [ -f "$REPO_ROOT/Docs/v5/$doc" ]; then
    pass "doc present: $doc"
  else
    fail "doc missing: Docs/v5/$doc"
  fi
done

# ------------------------------------------------------------
# Summary
# ------------------------------------------------------------

echo
if [ "$EXIT" -eq 0 ]; then
  echo "Phase 0 completion gate: PASS."
else
  echo "Phase 0 completion gate: FAIL. Fix the missing artefact(s) above before dispatching Tranche 2."
fi

exit "$EXIT"
