#!/usr/bin/env bash
#
# Forbidden-boundary-pattern scan (Brief 3, Gate 1).
#
# A cheap, grep-based CONTAINMENT gate for the highest-signal patterns behind
# Olumi's recurring silent-drop / schema-drift failure mode at service
# boundaries. It does NOT cure existing violations and does NOT prove current
# boundaries are safe — it freezes the current population (a committed baseline)
# so NEW high-risk usages block merge.
#
# Patterns (curated, narrow on purpose — see Docs / the baseline file):
#   1. warnOnInvalid                     — zero-tolerance (must stay 0).
#   2. as unknown as                     — count-ratchet (distinctive double-cast).
#   3. science-field null/zero fallback  — count-ratchet (naive `field ?? 0|null`).
#
# Scope: src/ TypeScript only, excluding tests (**/__tests__/**, *.test.ts),
# generated code (src/generated/**), comment-only lines, and any line carrying a
# `// forbidden-exempt: <reason>` marker (single-line escape hatch, mirrors
# scripts/check-no-direct-analysis-ready.sh).
#
# Baseline: scripts/ci/forbidden-boundary-baseline.txt (`<key>=<count>` lines).
# The gate FAILS when a current count EXCEEDS its baseline; counts at or below
# baseline pass. Known limitation (same as scripts/ci/typecheck-ratchet.sh):
# per-pattern TOTAL count, not a per-line identity set.
#
# Usage:
#   bash scripts/check-forbidden-boundary-patterns.sh            # run the gate
#   bash scripts/check-forbidden-boundary-patterns.sh --self-test # prove detectors fire
#   bash scripts/check-forbidden-boundary-patterns.sh --help
#
# Exit: 0 = pass / self-test OK; 1 = violation / self-test detector failure / misuse.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

BASELINE="scripts/ci/forbidden-boundary-baseline.txt"
SCAN_DIR="src"

# Science-field naive-fallback regex (ERE). Catches `<sciencefield> ?? 0|null`
# and `<sciencefield> || 0|null` with the operator immediately following the
# identifier (modulo whitespace). Deliberately tight to stay high-signal.
SCIENCE_ERE='(robustness|confidence|freshness|evpi|value_of_information|stale)[A-Za-z0-9_]*[[:space:]]*(\?\?|\|\|)[[:space:]]*(null|0)'

PATTERN_KEYS=(warnOnInvalid as_unknown_as science_field_null_zero_fallback)

# ── Filters ────────────────────────────────────────────────────────────────
# Drop out-of-scope and false-positive lines from a `path:line:content` stream.
gate_filter() {
  grep -v '/__tests__/' \
  | grep -v '\.test\.ts:' \
  | grep -v '/src/generated/' \
  | grep -vE '^[^:]+:[0-9]+:[[:space:]]*(//|\*)' \
  | grep -v 'forbidden-exempt:'
}

# Emit matching `path:line:content` for <key> under <path>. Tolerant of grep's
# no-match exit (1) so `set -uo pipefail` does not abort the run.
scan() {
  local key="$1" path="$2"
  {
    case "$key" in
      warnOnInvalid)
        grep -rn --include='*.ts' 'warnOnInvalid' "$path" 2>/dev/null ;;
      as_unknown_as)
        grep -rn --include='*.ts' 'as unknown as' "$path" 2>/dev/null ;;
      science_field_null_zero_fallback)
        grep -rnE --include='*.ts' "$SCIENCE_ERE" "$path" 2>/dev/null ;;
      *)
        echo "INTERNAL ERROR: unknown pattern key '$key'" >&2; return 2 ;;
    esac
  } | gate_filter || true
}

count() { scan "$1" "$2" | grep -c '' || true; }

baseline_for() {
  local key="$1"
  local line
  line="$(grep -E "^${key}=" "$BASELINE" 2>/dev/null | head -1)"
  if [[ -z "$line" ]]; then
    echo "::error::Baseline file '$BASELINE' is missing a '${key}=' entry." >&2
    return 1
  fi
  local val="${line#*=}"
  val="$(printf '%s' "$val" | tr -d '[:space:]')"
  if [[ ! "$val" =~ ^[0-9]+$ ]]; then
    echo "::error::Baseline '${key}=' must be a non-negative integer, got: '$val'" >&2
    return 1
  fi
  printf '%s' "$val"
}

pattern_label() {
  case "$1" in
    warnOnInvalid)                    echo "warnOnInvalid (zero-tolerance)";;
    as_unknown_as)                    echo "as unknown as (double-cast ratchet)";;
    science_field_null_zero_fallback) echo "science-field null/zero fallback (ratchet)";;
  esac
}

# ── Self-test: prove the three detectors fire on synthetic known-bad input ──
run_self_test() {
  local tmp
  tmp="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "rm -rf '$tmp'" RETURN
  cat > "$tmp/fixture.ts" <<'EOF'
// Synthetic known-bad fixture for --self-test. Not part of the codebase.
export function bad(input: { confidence?: number }) {
  const meta = (input as unknown as Record<string, unknown>);
  const options = { warnOnInvalid: true };
  const belief = input.confidence ?? 0.8;
  return { meta, options, belief };
}
EOF
  local failures=0 key c
  echo "self-test: scanning a synthetic fixture that contains one of each pattern"
  for key in "${PATTERN_KEYS[@]}"; do
    c="$(count "$key" "$tmp/fixture.ts")"
    if [[ "$c" -ge 1 ]]; then
      printf '  OK   %-40s detector fired (%s match)\n' "$key" "$c"
    else
      printf '  FAIL %-40s detector did NOT fire on known-bad input\n' "$key"
      failures=$((failures + 1))
    fi
  done
  if [[ "$failures" -ne 0 ]]; then
    echo "SELF-TEST FAILED: $failures detector(s) did not fire — the gate is not enforcing." >&2
    return 1
  fi
  echo "SELF-TEST PASSED: all ${#PATTERN_KEYS[@]} detectors correctly flag injected violations."
  return 0
}

# ── Main ────────────────────────────────────────────────────────────────────
case "${1:-}" in
  -h|--help)
    sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'
    exit 0 ;;
  --self-test)
    run_self_test
    exit $? ;;
  "" )
    ;; # fall through to the gate
  * )
    echo "Unknown argument: $1 (use --help)" >&2
    exit 1 ;;
esac

if [[ ! -f "$BASELINE" ]]; then
  echo "::error::Missing baseline file: $BASELINE" >&2
  exit 1
fi

FAILURES=0
LOWERABLE=0
for key in "${PATTERN_KEYS[@]}"; do
  base="$(baseline_for "$key")" || exit 1
  cur="$(count "$key" "$SCAN_DIR")"
  label="$(pattern_label "$key")"
  if [[ "$cur" -gt "$base" ]]; then
    FAILURES=$((FAILURES + 1))
    echo "FAIL: ${label}"
    echo "      baseline=${base}  current=${cur}  (+$((cur - base)) NEW)"
    echo "      A new occurrence was introduced. Remove it, or (if genuinely"
    echo "      unavoidable and safe) append  // forbidden-exempt: <reason>  on"
    echo "      that line. Do NOT raise the baseline without a reviewed justification."
    echo "      Current matches:"
    scan "$key" "$SCAN_DIR" | sed 's/^/        /'
    echo
  elif [[ "$cur" -lt "$base" ]]; then
    LOWERABLE=$((LOWERABLE + 1))
    echo "INFO: ${label}: current=${cur} < baseline=${base} — cleanup detected."
    echo "      Lower '${key}=${cur}' in ${BASELINE} in this PR to ratchet the floor down."
  else
    echo "OK:   ${label}: ${cur} (== baseline)"
  fi
done

if [[ "$FAILURES" -ne 0 ]]; then
  echo
  echo "Forbidden-boundary-pattern gate FAILED (${FAILURES} pattern(s) grew past baseline)."
  echo "This gate is containment only — it blocks NEW high-risk usages. See ${BASELINE}."
  exit 1
fi

echo
echo "Forbidden-boundary-pattern gate passed (no growth past baseline)."
[[ "$LOWERABLE" -ne 0 ]] && echo "Note: ${LOWERABLE} pattern(s) can have their baseline lowered (see INFO above)."
exit 0
