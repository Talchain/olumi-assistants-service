#!/usr/bin/env bash
#
# Forbidden-boundary-pattern scan (Brief 3, Gate 1).
#
# A cheap, grep-based CONTAINMENT gate for the highest-signal patterns behind
# Olumi's recurring silent-drop / schema-drift failure mode at service
# boundaries. It does NOT cure existing violations and does NOT prove current
# boundaries are safe — it freezes the current population (an exact committed
# baseline) so growth blocks the gate and cleanup keeps the baseline honest.
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
# generated code (src/generated/**), and comment-only lines (a line whose first
# non-space token is `//`, `/*`, or `*`).
#
# Exemption (escape hatch): place a dedicated comment on the line IMMEDIATELY
# ABOVE the offending line:
#       // forbidden-exempt: <non-empty reason>
#       const x = y as unknown as Z;
# The marker must be a real preceding comment line (starts with `//`) AND carry
# a non-empty reason. A trailing marker, a bare marker, or marker text inside a
# string literal / URL on the code line does NOT grant an exemption.
#
# Baseline: scripts/ci/forbidden-boundary-baseline.txt (`<key>=<count>` lines).
# Validated strictly (exactly one of each expected key; no duplicate/unknown
# keys; integer values; warnOnInvalid must be 0). The gate FAILS when any
# current count != its baseline — growth blocks the gate, and a real cleanup
# requires lowering the baseline in the SAME PR, so an inflated/stale baseline
# can never silently disable the ratchet.
#
# Enforcement reality (no over-claim): this script is NOT auto-installed or
# auto-required.
#   - Pre-push: it runs as check #16 in scripts/validate-prepush.sh, which gates
#     `git push` ONLY for developers who have run scripts/install-hooks.sh. A
#     fresh checkout has no .git/hooks/pre-push and no package.json lifecycle
#     installs it, so pre-push enforcement is per-developer, not universal.
#   - CI: it runs in the `CI / Lint, TypeCheck, Unit Tests` job, which blocks
#     MERGE only once `staging` branch protection / a ruleset REQUIRES that
#     status check. Until that setting exists, a red gate does not block merge.
#
# Usage:
#   bash scripts/check-forbidden-boundary-patterns.sh             # run the gate
#   bash scripts/check-forbidden-boundary-patterns.sh --self-test # prove behaviour
#   bash scripts/check-forbidden-boundary-patterns.sh --help
#
# Exit: 0 = pass / self-test OK; 1 = violation / malformed baseline / self-test
#       failure / misuse.
#
# `set -e` is intentionally omitted (matching scripts/ci/typecheck-ratchet.sh):
# the gate relies on grep's no-match exit code (1) in several places, so global
# `-e` would risk false failures in a merge-relevant check. Instead, every
# baseline-validation pipeline checks its own exit status EXPLICITLY (grep:
# 0/1 are valid outcomes, >1 = error -> die; sort/uniq/sed: any non-zero =
# error -> die) so a failed validation step fails CLOSED rather than being
# mistaken for benign-empty output. `-u` and pipefail are kept.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

BASELINE="scripts/ci/forbidden-boundary-baseline.txt"
SCAN_DIR="src"

# Science-field constant-fallback regex (ERE): `<sciencefield> ?? <c>` or
# `<sciencefield> || <c>` where <c> is null or a zero-leading number (0, 0.5,
# 0.8, ...). Operator must immediately follow the identifier (modulo spaces).
SCIENCE_ERE='(robustness|confidence|freshness|evpi|value_of_information|stale)[A-Za-z0-9_]*[[:space:]]*(\?\?|\|\|)[[:space:]]*(null|0)'

# Exemption marker: a preceding comment LINE (starts with `//`) + non-empty reason.
EXEMPT_RE='^[[:space:]]*//[[:space:]]*forbidden-exempt:[[:space:]]*[^[:space:]]'

# Expected baseline keys (also the report order). warnOnInvalid is zero-tolerance.
PATTERN_KEYS=(warnOnInvalid as_unknown_as science_field_default_fallback)

die() { echo "::error::$*" >&2; exit 1; }

# ── Match production ─────────────────────────────────────────────────────────
# Scope filter: drop out-of-scope + comment-only lines from a `path:line:content`
# stream (the comment-only test covers `//`, `/*`, and `*` openers).
scope_filter() {
  grep -v '/__tests__/' \
  | grep -v '\.test\.ts:' \
  | grep -v '/src/generated/' \
  | grep -vE '^[^:]+:[0-9]+:[[:space:]]*(//|/\*|\*)'
}

# Exemption: drop a match when the line IMMEDIATELY ABOVE it is a dedicated
# `// forbidden-exempt: <reason>` comment. Reading the *preceding comment line*
# (not a trailing substring) means a marker inside a string literal/URL on the
# code line cannot grant an exemption.
apply_exemptions() {
  local match file rest lineno prev
  while IFS= read -r match; do
    [[ -z "$match" ]] && continue
    file="${match%%:*}"
    rest="${match#*:}"
    lineno="${rest%%:*}"
    if [[ "$lineno" =~ ^[0-9]+$ ]] && [[ "$lineno" -gt 1 ]]; then
      prev="$(sed -n "$((lineno - 1))p" "$file" 2>/dev/null || true)"
      if printf '%s' "$prev" | grep -qE "$EXEMPT_RE"; then
        continue
      fi
    fi
    printf '%s\n' "$match"
  done
}

# Emit in-scope, unexempted `path:line:content` for <key> under <path>. `-H`
# forces the filename prefix even when <path> is a single file (self-test).
scan() {
  local key="$1" path="$2"
  {
    case "$key" in
      warnOnInvalid)
        grep -rnH --include='*.ts' 'warnOnInvalid' "$path" 2>/dev/null ;;
      as_unknown_as)
        grep -rnH --include='*.ts' 'as unknown as' "$path" 2>/dev/null ;;
      science_field_default_fallback)
        grep -rnHE --include='*.ts' "$SCIENCE_ERE" "$path" 2>/dev/null ;;
      *)
        echo "INTERNAL ERROR: unknown pattern key '$key'" >&2; return 2 ;;
    esac
  } | scope_filter | apply_exemptions || true
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

  # Entry lines = non-comment, non-blank. grep exit 0 (found) or 1 (none) are
  # both valid; >1 is a read error and must fail closed (declared separately so
  # `local` does not mask the substitution's exit status in $?).
  local entries rc
  entries="$(grep -vE '^[[:space:]]*(#|$)' "$BASELINE")"; rc=$?
  [[ $rc -le 1 ]] || die "Failed to read baseline file $BASELINE (grep exit $rc)."
  [[ -n "$entries" ]] || die "Baseline $BASELINE contains no entries."

  # Every entry must be exactly KEY=INTEGER. grep -v exit: 1 = all lines conform
  # (good), 0 = some malformed, >1 = error (fail closed).
  local bad
  bad="$(printf '%s\n' "$entries" | grep -vE '^[A-Za-z_][A-Za-z0-9_]*=[0-9]+$')"; rc=$?
  [[ $rc -le 1 ]] || die "Failed to validate baseline line format (grep exit $rc)."
  [[ -z "$bad" ]] || die "Malformed baseline line(s): $(printf '%s' "$bad" | tr '\n' '|')"

  # sed/sort/uniq have no benign non-zero outcome here: any failure means we
  # could not actually validate, so it must fail closed rather than be read as
  # "no problem".
  local keys
  if ! keys="$(printf '%s\n' "$entries" | sed -E 's/=.*//')"; then
    die "Failed to extract baseline keys."
  fi

  local dupes
  if ! dupes="$(printf '%s\n' "$keys" | sort | uniq -d)"; then
    die "Unable to validate baseline for duplicate keys (sort/uniq failed)."
  fi
  [[ -z "$dupes" ]] || die "Duplicate baseline key(s): $(printf '%s' "$dupes" | tr '\n' ' ')"

  local k
  for k in $keys; do
    case " ${PATTERN_KEYS[*]} " in
      *" $k "*) ;;
      *) die "Unknown baseline key: '$k' (expected only: ${PATTERN_KEYS[*]})";;
    esac
  done

  local ek
  for ek in "${PATTERN_KEYS[@]}"; do
    printf '%s\n' "$keys" | grep -Fqx "$ek" || die "Missing baseline key: '$ek'"
  done

  [[ "$(baseline_for warnOnInvalid)" == "0" ]] \
    || die "warnOnInvalid baseline must be 0 (zero-tolerance); got '$(baseline_for warnOnInvalid)'."
}

# ── Self-test: prove detector + exemption + comment behaviour ────────────────
SELFTEST_TMP=""
run_self_test() {
  SELFTEST_TMP="$(mktemp -d)"
  trap 'rm -rf "$SELFTEST_TMP"' EXIT
  local failures=0 key c

  # (a) each detector fires on a bare violation.
  cat > "$SELFTEST_TMP/fire.ts" <<'EOF'
export function bad(input: { confidence?: number }) {
  const meta = (input as unknown as Record<string, unknown>);
  const options = { warnOnInvalid: true };
  const belief = input.confidence ?? 0.8;
  return { meta, options, belief };
}
EOF
  echo "self-test:"
  for key in "${PATTERN_KEYS[@]}"; do
    c="$(count "$key" "$SELFTEST_TMP/fire.ts")"
    if [[ "$c" -ge 1 ]]; then printf '  OK   %-28s detector fired (%s)\n' "$key" "$c"
    else printf '  FAIL %-28s did NOT fire\n' "$key"; failures=$((failures + 1)); fi
  done

  # (b) reasoned preceding comment exempts; bare preceding marker and a string-
  # literal marker on the code line do NOT.  Lines 2/4/6 carry `as unknown as`;
  # only line 2 (reasoned preceding comment) is exempt ⇒ 2 violations remain.
  cat > "$SELFTEST_TMP/exempt.ts" <<'EOF'
// forbidden-exempt: reasoned exemption, tracked in TICKET-1
const a = (p as unknown as Record<string, unknown>);
// forbidden-exempt:
const b = (q as unknown as Record<string, unknown>);
const note = "see https://x.invalid// forbidden-exempt: still inside a string";
const c = (r as unknown as Record<string, unknown>);
EOF
  c="$(count as_unknown_as "$SELFTEST_TMP/exempt.ts")"
  if [[ "$c" -eq 2 ]]; then printf '  OK   %-28s reasoned-comment exempts; bare+string do not (2)\n' "exemption"
  else printf '  FAIL %-28s expected 2 unexempted, got %s\n' "exemption" "$c"; failures=$((failures + 1)); fi

  # (c) the reviewer's exact one-line string-literal exploit must be counted.
  cat > "$SELFTEST_TMP/exploit.ts" <<'EOF'
export const x = value as unknown as Record<string, unknown>; const note = "https://example.invalid// forbidden-exempt: not a comment";
EOF
  c="$(count as_unknown_as "$SELFTEST_TMP/exploit.ts")"
  if [[ "$c" -eq 1 ]]; then printf '  OK   %-28s string-literal marker does not exempt\n' "string-exploit"
  else printf '  FAIL %-28s exploit wrongly exempted (got %s)\n' "string-exploit" "$c"; failures=$((failures + 1)); fi

  # (d) a block-comment opener line is treated as a comment, not code.
  cat > "$SELFTEST_TMP/comment.ts" <<'EOF'
/* example: const z = a as unknown as B in a block-comment opener */
EOF
  c="$(count as_unknown_as "$SELFTEST_TMP/comment.ts")"
  if [[ "$c" -eq 0 ]]; then printf '  OK   %-28s block-comment opener not counted\n' "comment-only"
  else printf '  FAIL %-28s block comment counted (got %s)\n' "comment-only" "$c"; failures=$((failures + 1)); fi

  if [[ "$failures" -ne 0 ]]; then
    echo "SELF-TEST FAILED: $failures check(s) misbehaved — the gate is not enforcing." >&2
    return 1
  fi
  echo "SELF-TEST PASSED: detectors fire; exemptions are preceding-comment-only with a reason; string-literal & block-comment cases handled."
  return 0
}

print_usage() {
  cat <<'EOF'
check-forbidden-boundary-patterns.sh — Brief 3 Gate 1 containment ratchet.

  (no args)     run the gate (exit 1 if any pattern != baseline, or baseline malformed)
  --self-test   prove detector + exemption + comment behaviour (exit 0 = OK)
  --help, -h    this message

Exempt a line by putting  // forbidden-exempt: <reason>  on the line ABOVE it.
Baseline: scripts/ci/forbidden-boundary-baseline.txt.
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
    echo "      Remove the new occurrence(s), or add a preceding"
    echo "      // forbidden-exempt: <reason>  comment line above it (a bare or"
    echo "      in-string marker is not honoured). Do NOT raise the baseline to hide growth."
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
