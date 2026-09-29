#!/usr/bin/env bash
#
# Typecheck drift ratchet.
#
# Runs the FULL `tsc --noEmit` (tsconfig.json = src + tests) and compares the
# result against a committed baseline of pre-existing test-file type errors
# (scripts/ci/typecheck-baseline.txt). It tolerates the frozen baseline but
# FAILS on regressions:
#   - any file with type errors that is NOT in the baseline (new-file drift), OR
#   - a total error count that EXCEEDS the baseline count (new errors added to
#     files that are already in the baseline).
#
# This keeps the full typecheck running and visible without forcing a 462-error
# cleanup, while making NEW drift block. The src-only gate (`pnpm typecheck:src`)
# remains the required green check; this ratchet is a separate, non-required job.
#
# Known limitation (intentional for Tier-1): detection is file-set + total-count,
# not per-file counts. Removing an error from one baseline file while adding one
# to another baseline file (net total unchanged) is NOT caught; any NET increase
# in total errors, or any error in a non-baseline file, IS caught. Upgrade to
# per-file counts if tighter intra-baseline drift detection is ever needed.
#
# Deterministic and network-free: assumes `pnpm openapi:generate` already ran
# (the workflow does this in a prior step). Ignores tsc's own non-zero exit code
# (the baseline guarantees tsc exits non-zero) and decides purely from the diff.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

BASELINE="scripts/ci/typecheck-baseline.txt"
GENERATED="src/generated/openapi.d.ts"

if [[ ! -f "$BASELINE" ]]; then
  echo "::error::Missing baseline file: $BASELINE"
  exit 1
fi

# Guard against the local-contamination failure mode (missing generated types
# turns into phantom TS2307 errors that look like new drift).
if [[ ! -f "$GENERATED" ]]; then
  echo "::error::$GENERATED is missing — run 'pnpm openapi:generate' before the ratchet."
  exit 1
fi

# Validate the baseline header UP FRONT — before the ~30s `tsc` run — so a
# malformed baseline fails fast. Require exactly one `# count=<N>` header
# (multiple would silently concatenate after whitespace stripping) and a
# non-negative integer value (empty fails the regex too).
BASE_COUNT_HEADERS="$(grep -cE '^[[:space:]]*#[[:space:]]*count=' "$BASELINE")"
if [[ "$BASE_COUNT_HEADERS" -ne 1 ]]; then
  echo "::error::Baseline must have exactly one '# count=<N>' header line (found $BASE_COUNT_HEADERS)."
  exit 1
fi
BASE_COUNT="$(grep -E '^[[:space:]]*#[[:space:]]*count=' "$BASELINE" | sed -E 's/.*count=//' | tr -d '[:space:]')"
if [[ ! "$BASE_COUNT" =~ ^[0-9]+$ ]]; then
  echo "::error::Baseline '# count=' must be a non-negative integer, got: '$BASE_COUNT'"
  exit 1
fi

TSC_OUT="$(mktemp)"
# Use default-expansions so the trap is safe under `set -u` even on the early
# exit paths below (CUR_FILES/BASE_FILES are not assigned until later).
trap 'rm -f "${TSC_OUT:-}" "${CUR_FILES:-}" "${BASE_FILES:-}" 2>/dev/null || true' EXIT

# Force single-line, color-free diagnostics so parsing is stable across TTY/CI.
pnpm exec tsc --noEmit --pretty false >"$TSC_OUT" 2>&1
TSC_EXIT=$?

# An error line looks like:  path.ts(line,col): error TSxxxx: message
ERR_REGEX='\.tsx?\([0-9]+,[0-9]+\): error TS[0-9]+'
CUR_COUNT="$(grep -cE "$ERR_REGEX" "$TSC_OUT" || true)"

# Catastrophic-failure guard: tsc failed but produced no parseable type errors
# (e.g. a tsconfig/resolution failure). Treat as a hard failure, not "0 drift".
if [[ "$TSC_EXIT" -ne 0 && "$CUR_COUNT" -eq 0 ]]; then
  echo "::error::tsc exited $TSC_EXIT with no parseable type errors — likely a config/resolution failure, not clean."
  echo "----- tsc output (tail) -----"
  tail -n 40 "$TSC_OUT"
  exit 1
fi

CUR_FILES="$(mktemp)"
BASE_FILES="$(mktemp)"
grep -E "$ERR_REGEX" "$TSC_OUT" \
  | sed -E 's/\([0-9]+,[0-9]+\): error TS[0-9]+.*$//' \
  | sort -u >"$CUR_FILES"

# Baseline file list (the count header was validated up front). Strip
# comments / blank lines, sort-unique.
grep -vE '^[[:space:]]*#' "$BASELINE" | grep -vE '^[[:space:]]*$' | sort -u >"$BASE_FILES"

# Regressions.
NEW_FILES="$(comm -13 "$BASE_FILES" "$CUR_FILES" || true)"
FIXED_FILES="$(comm -23 "$BASE_FILES" "$CUR_FILES" || true)"

FAIL=0
if [[ -n "$NEW_FILES" ]]; then
  echo "::error::New file(s) with TypeScript errors (not in $BASELINE):"
  while IFS= read -r f; do [[ -n "$f" ]] && echo "  + $f"; done <<<"$NEW_FILES"
  FAIL=1
fi
if [[ "$CUR_COUNT" -gt "$BASE_COUNT" ]]; then
  echo "::error::Total typecheck errors increased: baseline=$BASE_COUNT current=$CUR_COUNT (+$((CUR_COUNT - BASE_COUNT)))."
  echo "         New errors were added to files already in the baseline — fix them or update the baseline with reviewer sign-off."
  FAIL=1
fi

CUR_FILE_COUNT="$(wc -l <"$CUR_FILES" | tr -d '[:space:]')"
if [[ "$FAIL" -ne 0 ]]; then
  echo "::error::Typecheck drift ratchet FAILED — current: $CUR_FILE_COUNT files / $CUR_COUNT errors vs baseline $(wc -l <"$BASE_FILES" | tr -d '[:space:]') files / $BASE_COUNT errors."
  echo "To intentionally accept new drift, update scripts/ci/typecheck-baseline.txt (count + paths) in the same PR with explicit reviewer sign-off."
  exit 1
fi

echo "✅ Typecheck drift within baseline — $CUR_FILE_COUNT files / $CUR_COUNT errors (baseline: $(wc -l <"$BASE_FILES" | tr -d '[:space:]') files / $BASE_COUNT errors)."
if [[ -n "$FIXED_FILES" || "$CUR_COUNT" -lt "$BASE_COUNT" ]]; then
  echo "::notice::Drift shrank — consider tightening scripts/ci/typecheck-baseline.txt (lower count / remove fixed files)."
  if [[ -n "$FIXED_FILES" ]]; then
    echo "Files no longer erroring (safe to remove from baseline):"
    while IFS= read -r f; do [[ -n "$f" ]] && echo "  - $f"; done <<<"$FIXED_FILES"
  fi
fi
if [[ "$CUR_COUNT" -eq 0 ]]; then
  echo "::notice::No typecheck errors remain — the drift is fully cleared. Fold 'pnpm typecheck' back into the required gate and retire this ratchet."
fi
exit 0
