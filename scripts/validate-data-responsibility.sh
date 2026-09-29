#!/usr/bin/env bash
# Data-responsibility guard — V5 slice B/C/D (plan rev 2 R2).
#
# PLoT is the canonical compute surface for analysis enrichment. CEE handlers
# thread those fields through from PLoT responses; they do NOT compute or
# synthesise them. The V4 silent-drop bug happened because enrichment
# assignments slipped into CEE code without anyone noticing.
#
# This guard greps `src/orchestrator-v5/` for assignment patterns on the
# canonical enrichment field names. A hit is a tripwire, not a final verdict
# — some false positives are acceptable (e.g. test fixtures). Any hit
# requires reviewer attention before merge.
#
# Non-zero exit blocks CI / pre-push.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXIT=0

# Fail closed if the comment-stripping scanner cannot run (a missing node would
# otherwise empty every scan and misreport as clean).
command -v node >/dev/null 2>&1 || { echo "TRIPWIRE: node is required (matching runs via scripts/ci/strip-source-comments.mjs)"; exit 1; }

# Canonical enrichment fields owned by PLoT. CEE is passthrough-only for each.
# Extend this list whenever a new PLoT-computed field appears in the analysis
# envelope.
ENRICHMENT_FIELDS=(
  'factor_sensitivity'
  'm1_coaching'
  'flip_thresholds'
  'conditional_probabilities'
  'edge_e_values'
)

check() {
  local field="$1"
  local -a paths=("src/orchestrator-v5")

  # Assignment patterns that imply CEE is setting the value rather than
  # reading it. Object-literal construction (`{ factor_sensitivity: ... }`) is
  # a legitimate concern too, but also shows up in legitimate passthrough
  # shapes — reviewer judgement required on those hits.
  # Matching runs on the COMMENT-STRIPPED view (scripts/ci/strip-source-comments.mjs):
  # a comment documenting the passthrough rule can never trip the tripwire.
  local pattern="(^|[^.a-zA-Z0-9_])${field}\\s*="
  local hits
  hits="$(node "$REPO_ROOT/scripts/ci/strip-source-comments.mjs" --scan "$pattern" "${paths[@]/#/$REPO_ROOT/}" 2>/dev/null \
    | grep -v '/__tests__/' | grep -v '\.test\.ts:' || true)"
  if [ -n "$hits" ]; then
    echo "TRIPWIRE: suspicious assignment to PLoT-owned enrichment field '$field'"
    echo "CEE handlers must thread enrichment through, not compute it."
    echo "Hits:"
    echo "$hits"
    echo
    EXIT=1
  fi
}

# Run the grep for each enrichment field.
for field in "${ENRICHMENT_FIELDS[@]}"; do
  check "$field"
done

if [ "$EXIT" -eq 0 ]; then
  echo "Data-responsibility check OK: no enrichment-field assignments found in src/orchestrator-v5/."
fi

exit "$EXIT"
