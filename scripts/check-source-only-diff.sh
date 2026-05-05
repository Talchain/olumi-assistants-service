#!/usr/bin/env bash
# Source-only diff guard for the P0 V5 golden-path branch (and any other
# branch that needs to ship intentional source changes only).
#
# Fails if any UNSAFE path appears in:
#   - The staging area (git diff --cached --name-only).  [default mode]
#   - The diff between HEAD and a base ref.              [--against]
#   - A single commit's diff.                            [--commit]
#
# Why this exists: the CEE repo has thousands of files tracked under
# `node_modules/` from a historical accidental commit. Local
# `pnpm install` produces hundreds of dirty entries that drift from
# those committed snapshots. The repo also stores generated artefacts
# (`dist/`, `coverage/`, `playwright-report/`, `test-results/`,
# `src/generated/`) and prompt files (`data/prompts*`, `Prompts/`,
# `prompts/`) that must never enter a source-only branch diff. Lock
# files and env files must never be staged casually either.
#
# A careless `git add -A` / `git add .` / `git add -u` would absorb
# any of these. The pre-push validation catches dependency `file:`
# references, but tracked-state churn and unsafe paths still slip
# through. This guard fails fast.
#
# Compatible with bash 3.2 (macOS default) — no associative arrays,
# no advanced expansions.
#
# Usage:
#   bash scripts/check-source-only-diff.sh                    # check staging area
#   bash scripts/check-source-only-diff.sh --against staging  # diff vs ref
#   bash scripts/check-source-only-diff.sh --commit HEAD      # single commit
#
# Exit codes:
#   0 — no unsafe paths in the checked diff/staging area.
#   1 — unsafe paths found; printed for review with category labels.
#   2 — usage error or git failure.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# Denylist — parallel arrays (bash-3 compatible, avoids regex/separator
# collisions that broke an earlier `pattern|category` array form).
#
# Each (DENY_PATTERNS[i], DENY_CATEGORIES[i]) pair denies one class of
# unsafe path. Patterns are bash regex, matched against the path string
# (no leading slash). The category appears in error output so reviewers
# immediately see what kind of unsafe file was caught.
#
# Add new entries by appending to BOTH arrays at the same index. Order
# does not matter for correctness; the first matching entry wins per
# path. Patterns are anchored where appropriate to avoid false
# positives on legitimate source/tests/docs/scripts/tooling.
# ---------------------------------------------------------------------------

DENY_PATTERNS=()
DENY_CATEGORIES=()

deny() {
  DENY_PATTERNS+=("$1")
  DENY_CATEGORIES+=("$2")
}

# Dependencies and lockfiles.
deny '^node_modules/'                    'node_modules'
deny '^package-lock\.json$'              'lockfile (npm)'
deny '^pnpm-lock\.yaml$'                 'lockfile (pnpm)'
deny '^yarn\.lock$'                      'lockfile (yarn)'

# Environment / secrets.
# Matches: top-level .env, any .env.<name>, any *.env file, .npmrc.
deny '(^|/)\.env$'                       'env file'
deny '(^|/)\.env\.[^/]+$'                'env file'
deny '(^|/)[^/]+\.env$'                  'env file'
deny '(^|/)\.npmrc$'                     'npm credentials'

# Prompt files. The repo has data/prompts.json (parked in stash),
# data/prompts.json.backup.<timestamp>, Prompts/, prompts/, and various
# prompt-dump text files at the repo root. These must never enter a
# source-only branch diff (prompt rewrites need their own scoped change).
deny '^data/prompts\.json$'              'prompt file (data/prompts.json)'
deny '^data/prompts(/|$)'                'prompt directory'
deny '^data/prompts\.json\.backup\.'     'prompt backup'
deny '^data/prompts[ 0-9]*\.json$'       'prompt file copy'
deny '^Prompts/'                         'prompt directory'
deny '^prompts/'                         'prompt directory'
deny '(^|/)assembled-prompt'             'prompt inspection dump'
deny '(^|/)olumi_orchestrator_system_prompt'  'prompt dump'

# Generated / build / test artefacts.
deny '^dist/'                            'build artefact'
deny '^build/'                           'build artefact'
deny '^coverage/'                        'coverage artefact'
deny '^\.turbo/'                         'turborepo cache'
deny '^\.next/'                          'next build cache'
deny '^playwright-report/'               'playwright report'
deny '^test-results/'                    'test artefact'
deny '^src/generated/'                   'generated source'
deny '^generated/'                       'generated source'
deny '\.tsbuildinfo$'                    'TypeScript build cache'

# OS / IDE detritus.
deny '(^|/)\.DS_Store$'                  'OS metadata'

# Backup / autosave files.
deny '\.backup\.'                        'backup file'
deny '\.bak$'                            'backup file'
deny '~$'                                'editor backup'

# Sqlite / large binary snapshots that shouldn't be in a source diff.
deny '(^|/):memory:'                     'sqlite snapshot'

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

MODE="staged"
BASE_REF=""
COMMIT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --against)
      MODE="against"
      BASE_REF="${2:-}"
      shift 2
      ;;
    --commit)
      MODE="commit"
      COMMIT="${2:-HEAD}"
      shift 2
      ;;
    -h|--help)
      sed -n '1,/^set -euo/p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

case "$MODE" in
  staged)
    DIFF_OUTPUT="$(git diff --cached --name-only -- '*')"
    SCOPE="staged changes"
    ;;
  against)
    if [[ -z "$BASE_REF" ]]; then
      echo "error: --against requires a ref" >&2
      exit 2
    fi
    DIFF_OUTPUT="$(git diff --name-only "${BASE_REF}..HEAD" -- '*')"
    SCOPE="diff against ${BASE_REF}"
    ;;
  commit)
    DIFF_OUTPUT="$(git show --name-only --format='' "${COMMIT}" -- '*')"
    SCOPE="commit ${COMMIT}"
    ;;
esac

# Empty diff is OK (e.g. nothing staged).
if [[ -z "${DIFF_OUTPUT// /}" ]]; then
  echo "✓ source-only diff guard passed — no paths in ${SCOPE}"
  exit 0
fi

# ---------------------------------------------------------------------------
# Match each path against the denylist. Collect (path, category) pairs
# in parallel arrays so we can report grouped output without bash 4+
# associative arrays.
# ---------------------------------------------------------------------------

OFFENDERS=()
OFFENDER_CATS=()
N_PATTERNS=${#DENY_PATTERNS[@]}

while IFS= read -r path; do
  [[ -z "$path" ]] && continue
  i=0
  while [[ $i -lt $N_PATTERNS ]]; do
    pattern="${DENY_PATTERNS[$i]}"
    category="${DENY_CATEGORIES[$i]}"
    if [[ "$path" =~ $pattern ]]; then
      OFFENDERS+=("$path")
      OFFENDER_CATS+=("$category")
      break
    fi
    i=$((i + 1))
  done
done <<< "$DIFF_OUTPUT"

if [[ ${#OFFENDERS[@]} -eq 0 ]]; then
  echo "✓ source-only diff guard passed — no unsafe paths in ${SCOPE}"
  exit 0
fi

# ---------------------------------------------------------------------------
# Report. Group by category for readability. Cap at 30 lines.
# ---------------------------------------------------------------------------

COUNT=${#OFFENDERS[@]}
echo "✗ source-only diff guard FAILED — ${COUNT} unsafe path(s) in ${SCOPE}:" >&2
echo "" >&2

# Build a sorted list of unique categories first (bash-3 compatible).
SORTED_CATS=()
for cat in "${OFFENDER_CATS[@]}"; do
  seen=0
  for existing in "${SORTED_CATS[@]:-}"; do
    if [[ "$cat" = "$existing" ]]; then
      seen=1
      break
    fi
  done
  if [[ $seen -eq 0 ]]; then
    SORTED_CATS+=("$cat")
  fi
done

shown=0
for cat in "${SORTED_CATS[@]}"; do
  echo "  [$cat]" >&2
  i=0
  while [[ $i -lt $COUNT ]]; do
    if [[ "${OFFENDER_CATS[$i]}" = "$cat" ]]; then
      if [[ $shown -ge 30 ]]; then
        REMAINDER=$((COUNT - 30))
        echo "  ... and ${REMAINDER} more" >&2
        echo "" >&2
        break 2
      fi
      echo "    ${OFFENDERS[$i]}" >&2
      shown=$((shown + 1))
    fi
    i=$((i + 1))
  done
done

echo "" >&2
echo "  This branch must ship source-only changes. The CEE repo has" >&2
echo "  pre-existing tracked node_modules churn from a historical" >&2
echo "  accidental commit, and stores prompt files / generated artefacts" >&2
echo "  that must never enter a source-only branch diff." >&2
echo "" >&2
echo "  Do NOT use 'git add -A', 'git add .', or 'git add -u' to stage." >&2
echo "  Stage individual files with explicit paths:" >&2
echo "    git add src/<file> tests/<file> Docs/<file> scripts/<file>" >&2
echo "" >&2
echo "  See Docs/v5/p0-v5-golden-path-final-report.md §10 for the" >&2
echo "  full merge-handoff checklist." >&2
exit 1
