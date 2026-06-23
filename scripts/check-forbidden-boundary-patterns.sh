#!/usr/bin/env bash
#
# Forbidden-boundary-pattern scan (Brief 3, Gate 1).
#
# A cheap, grep-based CONTAINMENT gate for the highest-signal patterns behind
# Olumi's recurring silent-drop / schema-drift failure mode at service
# boundaries. It does NOT cure existing violations and does NOT prove current
# boundaries are safe — it freezes the current population (an exact committed
# baseline) so growth blocks merge and cleanup keeps the baseline honest.
#
# Patterns (curated, narrow on purpose — see the baseline file):
#   1. warnOnInvalid                    — zero-tolerance (baseline hard-required 0).
#   2. as unknown as                    — exact ratchet (distinctive double-cast).
#   3. science-field constant fallback  — exact ratchet. `<sciencefield> ?? null|0|0.x`
#                                         / `|| null|0|0.x`. Catches naive AND
#                                         fabricated-default fallbacks (e.g.
#                                         `confidence ?? 0.8`); misses laundered
#                                         cases (field cast/renamed/destructured
#                                         before the fallback). Partial by design.
#
# Scope: src/ TypeScript only, excluding tests (**/__tests__/**, *.test.ts),
# generated code (src/generated/**), comment-only lines, and any line carrying a
# `// forbidden-exempt: <reason>` marker WITH A NON-EMPTY REASON (single-line
# escape hatch; a bare marker is NOT honoured). Mirrors
# scripts/check-no-direct-analysis-ready.sh.
#
# Baseline: scripts/ci/forbidden-boundary-baseline.txt (`<key>=<count>` lines).
# Validated strictly (exactly one of each expected key; no duplicate/unknown
# keys; integer values; warnOnInvalid must be 0). The gate FAILS when any
# current count != its baseline — i.e. growth blocks merge, and a real cleanup
# requires lowering the baseline in the SAME PR so an inflated/stale baseline
# can never silently disable the ratchet.
#
# Enforcement reality: this script blocks local `git push` (pre-push hook, check
# #16) and runs in the `CI / Lint, TypeCheck, Unit Tests` job. CI is only truly
# merge-blocking once `staging` branch protection / a ruleset REQUIRES that
# status check — putting the step in the workflow is necessary but not
# sufficient. See the PR description.
#
# Usage:
#   bash scripts/check-forbidden-boundary-patterns.sh             # run the gate
#   bash scripts/check-forbidden-boundary-patterns.sh --self-test # prove detectors fire
#   bash scripts/check-forbidden-boundary-patterns.sh --help
#
# Exit: 0 = pass / self-test OK; 1 = violation / malformed baseline / self-test
#       detector failure / misuse.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

BASELINE="scripts/ci/forbidden-boundary-baseline.txt"
SCAN_DIR="src"

# Science-field constant-fallback regex (ERE). Matches `<sciencefield> ?? <c>`
# and `<sciencefield> || <c>` where <c> is null or a zero-leading number
# (0, 0.5, 0.8, ...). The operator must immediately follow the identifier
# (modulo whitespace) — deliberately tight to stay high-signal.
SCIENCE_ERE='(robustness|confidence|freshness|evpi|value_of_information|stale)[A-Za-z0-9_]*[[:space:]]*(\?\?|\|\|)[[:space:]]*(null|0)'

# Expected baseline keys (also the report order). warnOnInvalid is zero-tolerance.
PATTERN_KEYS=(warnOnInvalid as_unknown_as science_field_default_fallback)

die() { echo "::error::$*" >&2; exit 1; }

# ── Filters ────────────────────────────────────────────────────────────────
# Drop out-of-scope / false-positive / validly-exempted lines from a
# `path:line:content` stream. The exemption requires a NON-EMPTY reason after
# the marker: `// forbidden-exempt: <reason>`. A bare `// forbidden-exempt:`
# (no reason) is NOT honoured and remains a violation.
gate_filter() {
  grep -v '/__tests__/' \
  | grep -v '\.test\.ts:' \
  | grep -v '/src/generated/' \
  | grep -vE '^[^:]+:[0-9]+:[[:space:]]*(//|\*)' \
  | grep -vE '//[[:space:]]*forbidden-exempt:[[:space:]]*[^[:space:]]'
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
      science_field_default_fallback)
        grep -rnE --include='*.ts' "$SCIENCE_ERE" "$path" 2>/dev/null ;;
      *)
        echo "INTERNAL ERROR: unknown pattern key '$key'" >&2; return 2 ;;
    esac
  } | gate_filter || true
}

count() { scan "$1" "$2" | grep -c '' || true; }

pattern_label() {
  case "$1" in
    warnOnInvalid)                  echo "warnOnInvalid (zero-tolerance)";;
    as_unknown_as)                  echo "as unknown as (double-cast)";;
    science_field_default_fallback) echo "science-field constant fallback (?? null|0|0.x)";;
  esac
}

# Read the (already-validated) value for a baseline key.
baseline_for() {
  grep -E "^$1=" "$BASELINE" | head -1 | sed -E 's/^[^=]*=//'
}

# ── Strict, fail-closed baseline validation ─────────────────────────────────
validate_baseline() {
  [[ -f "$BASELINE" ]] || die "Missing baseline file: $BASELINE"

  # Non-comment, non-blank lines are the entries.
  local entries
  entries="$(grep -vE '^[[:space:]]*(#|$)' "$BASELINE" || true)"
  [[ -n "$entries" ]] || die "Baseline $BASELINE contains no entries."

  # Every entry must be exactly KEY=INTEGER (no whitespace, no trailing junk).
  local bad
  bad="$(printf '%s\n' "$entries" | grep -vE '^[A-Za-z_][A-Za-z0-9_]*=[0-9]+$' || true)"
  [[ -z "$bad" ]] || die "Malformed baseline line(s): $(printf '%s' "$bad" | tr '\n' '|')"

  local keys
  keys="$(printf '%s\n' "$entries" | sed -E 's/=.*//')"

  # No duplicate keys.
  local dupes
  dupes="$(printf '%s\n' "$keys" | sort | uniq -d)"
  [[ -z "$dupes" ]] || die "Duplicate baseline key(s): $(printf '%s' "$dupes" | tr '\n' ' ')"

  # No unknown keys.
  local k
  for k in $keys; do
    case " ${PATTERN_KEYS[*]} " in
      *" $k "*) ;;
      *) die "Unknown baseline key: '$k' (expected only: ${PATTERN_KEYS[*]})";;
    esac
  done

  # Every expected key present (exactly once — duplicates already rejected).
  local ek
  for ek in "${PATTERN_KEYS[@]}"; do
    printf '%s\n' "$keys" | grep -Fqx "$ek" || die "Missing baseline key: '$ek'"
  done

  # Zero-tolerance: warnOnInvalid baseline must be exactly 0.
  [[ "$(baseline_for warnOnInvalid)" == "0" ]] \
    || die "warnOnInvalid baseline must be 0 (zero-tolerance); got '$(baseline_for warnOnInvalid)'."
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
      printf '  OK   %-32s detector fired (%s match)\n' "$key" "$c"
    else
      printf '  FAIL %-32s detector did NOT fire on known-bad input\n' "$key"
      failures=$((failures + 1))
    fi
  done
  # The exemption escape hatch must honour a reason but NOT a bare marker.
  cat > "$tmp/exempt.ts" <<'EOF'
const a = (x as unknown as Record<string, unknown>); // forbidden-exempt: legacy bridge, tracked in TICKET-1
const b = (y as unknown as Record<string, unknown>); // forbidden-exempt:
EOF
  local exempt_count
  exempt_count="$(count as_unknown_as "$tmp/exempt.ts")"
  if [[ "$exempt_count" -eq 1 ]]; then
    printf '  OK   %-32s reason honoured, bare marker still flagged\n' "exemption"
  else
    printf '  FAIL %-32s expected exactly 1 unexempted match, got %s\n' "exemption" "$exempt_count"
    failures=$((failures + 1))
  fi
  if [[ "$failures" -ne 0 ]]; then
    echo "SELF-TEST FAILED: $failures check(s) did not behave as expected — the gate is not enforcing." >&2
    return 1
  fi
  echo "SELF-TEST PASSED: detectors fire on injected violations; exemptions require a reason."
  return 0
}

print_usage() {
  cat <<'EOF'
check-forbidden-boundary-patterns.sh — Brief 3 Gate 1 containment ratchet.

  (no args)     run the gate (exit 1 if any pattern != baseline or baseline malformed)
  --self-test   prove the detectors fire on synthetic violations (exit 0 = OK)
  --help, -h    this message

Patterns: warnOnInvalid (zero-tolerance), `as unknown as`, science-field
constant fallback. Baseline: scripts/ci/forbidden-boundary-baseline.txt.
Exempt a single line with a NON-EMPTY  // forbidden-exempt: <reason>  marker.
EOF
}

# ── Main ────────────────────────────────────────────────────────────────────
case "${1:-}" in
  -h|--help)   print_usage; exit 0 ;;
  --self-test) run_self_test; exit $? ;;
  "")          ;; # fall through to the gate
  *)           echo "Unknown argument: $1 (use --help)" >&2; exit 1 ;;
esac

validate_baseline

FAILURES=0
for key in "${PATTERN_KEYS[@]}"; do
  base="$(baseline_for "$key")"
  cur="$(count "$key" "$SCAN_DIR")"
  label="$(pattern_label "$key")"
  if [[ "$cur" -gt "$base" ]]; then
    FAILURES=$((FAILURES + 1))
    echo "FAIL: ${label}"
    echo "      current=${cur} > baseline=${base}  (+$((cur - base)) NEW)"
    echo "      Remove the new occurrence(s), or append a NON-EMPTY"
    echo "      // forbidden-exempt: <reason>  on the offending line (a bare"
    echo "      marker is not honoured). Do NOT raise the baseline to hide growth."
    echo "      Current matches:"
    scan "$key" "$SCAN_DIR" | sed 's/^/        /'
    echo
  elif [[ "$cur" -lt "$base" ]]; then
    FAILURES=$((FAILURES + 1))
    echo "FAIL: ${label}"
    echo "      current=${cur} < baseline=${base} — cleanup detected."
    echo "      Lower the baseline to '${key}=${cur}' in ${BASELINE} in THIS PR so"
    echo "      the floor tracks reality (the ratchet requires current == baseline,"
    echo "      so a stale/inflated baseline can never silently disable the gate)."
    echo
  else
    echo "OK:   ${label}: ${cur} (== baseline)"
  fi
done

if [[ "$FAILURES" -ne 0 ]]; then
  echo
  echo "Forbidden-boundary-pattern gate FAILED (${FAILURES} pattern(s) off baseline)."
  echo "Containment only — it blocks growth and keeps the baseline honest; it does"
  echo "not cure or vouch for the existing population. See ${BASELINE}."
  exit 1
fi

echo
echo "Forbidden-boundary-pattern gate passed (every pattern == baseline)."
exit 0
