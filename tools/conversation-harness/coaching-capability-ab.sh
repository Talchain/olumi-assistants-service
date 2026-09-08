#!/bin/bash
# coaching-capability-ab — baseline vs ONE candidate for the CODE-OWNED
# `COACHING_CONTEXT_INSTRUCTION`, using the existing hermetic conversation-harness
# arm (local CEE, FILE prompt store, ZERO PMS writes).
#
# ── WHY THIS SCRIPT EXISTS RATHER THAN `prompt-eval.sh` ────────────────────────
# `prompt-eval.sh` A/Bs a PMS *task prompt* by swapping one row of the file store.
# The change under test here is not in PMS at all: it is a code constant appended
# to the routing user message by `buildUserMessage`. Swapping a store row would
# therefore compare two IDENTICAL arms and report a difference of zero — a
# vacuous green. So the swapped variable here is the SOURCE FILE, and both arms
# boot sequentially from the SAME tree, the same store, the same parity env and
# the same seeded frozen graph. The instruction bytes actually served by each arm
# are sha256-pinned into the run dir, so a vacuous run is detectable after the
# fact: if the two arm hashes match, the comparison measured nothing.
#
# ── BOUNDS, DELIBERATE AND HARD ────────────────────────────────────────────────
#   · ONE baseline + ONE candidate. No third arm, no model bake-off.
#   · 3 questions x 3 repeats x 2 arms = 18 generated answers, and no more.
#   · Read-only journey: no analysis run, no edit, no consent turn. Nothing this
#     script drives mutates a model.
#   · Fixed snapshots: one store mirror, one parity env, one frozen graph.
#   · Every seeded scenario is disposable, prefix-tagged and deleted at the end.
#
# ⚠ THIS SCRIPT PRODUCES ANSWERS, NOT A VERDICT. The delivered answer for every
# turn is written next to its question and history for a HUMAN reviewer. Do not
# promote on a keyword count.
#
# Usage:
#   ENV_FILE=<repo>/.env STAGING_ENV=<repo>/.env.staging.local \
#   PARITY_ENV=<path>/staging-parity.env OLUMI_ASSIST_KEY=<key> \
#   ./coaching-capability-ab.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
WT="$(cd "$DIR/../.." && pwd)"
cd "$DIR"

BASE_SHA="${BASE_SHA:-dcff3c562a53ecda0c487dd211aa9e04f788b468}"
SRC="src/orchestrator-v5/routing/route-with-tool-use.ts"
JOURNEY="${JOURNEY:-$DIR/journeys/coaching-capability-pre-analysis.json}"
REPEATS="${REPEATS:-3}"
PORT="${PORT:-3107}"
STORE="${STORE:-$DIR/stores/staging-mirror.json}"
OUT="$DIR/runs/coaching-capability-$(date +%Y%m%d-%H%M%S)"

: "${ENV_FILE:?set ENV_FILE=<repo>/.env}"
: "${STAGING_ENV:?set STAGING_ENV=<repo>/.env.staging.local}"
: "${PARITY_ENV:?set PARITY_ENV=<path>/staging-parity.env}"
: "${OLUMI_ASSIST_KEY:?set OLUMI_ASSIST_KEY}"
for f in "$ENV_FILE" "$STAGING_ENV" "$PARITY_ENV" "$STORE" "$JOURNEY"; do
  [ -f "$f" ] || { echo "MISSING PREREQUISITE: $f" >&2; exit 1; }
done

# PREREQUISITE PROBE, read-only, BEFORE a single paid call is made. The staging
# service-role key was rotated: as of 2026-09-08 the `SUPABASE_SERVICE_ROLE_KEY`
# these harness scripts read is "Unregistered API key" (HTTP 401), while the
# credential under `SUPABASE_SERVICE_ROLE_KEY_NEW` in the same file authenticates.
# Without a repaired staging env BOTH arms fail to read the seeded scenario, and
# an arm that cannot read the graph would produce 18 worthless paid answers.
python3 - "$STAGING_ENV" <<'PY' || exit 1
import sys, urllib.request, urllib.error
env = {}
for line in open(sys.argv[1]):
    line = line.strip()
    if line and not line.startswith('#') and '=' in line:
        k, v = line.split('=', 1)
        env[k] = v.strip().strip('"').strip("'")
url = env['SUPABASE_URL'].rstrip('/')
key = env.get('SUPABASE_SERVICE_ROLE_KEY', '')
req = urllib.request.Request(url + '/rest/v1/scenarios?select=id&limit=1',
                             headers={'apikey': key, 'Authorization': 'Bearer ' + key})
try:
    urllib.request.urlopen(req, timeout=20)
except urllib.error.HTTPError as e:
    if e.code == 401:
        sys.exit('BLOCKED: SUPABASE_SERVICE_ROLE_KEY in %s is not registered for this '
                 'project (HTTP 401). The staging env must be repaired by the environment '
                 'operator before this A/B can run. Not retried here, not worked around '
                 'with a hand-assembled secrets file.' % sys.argv[1])
    raise
PY

mkdir -p "$OUT"
cp "$JOURNEY" "$OUT/journey.json"
SCENARIOS=""
restore() {
  git -C "$WT" checkout -- "$SRC" 2>/dev/null || true
  [ -n "$SCENARIOS" ] && echo "SEEDED SCENARIOS (delete with staging/delete-scenarios.py --execute): $SCENARIOS" | tee -a "$OUT/cleanup.txt"
}
trap restore EXIT

CAND_SRC="$(mktemp)"; cp "$WT/$SRC" "$CAND_SRC"

run_arm() {
  local arm="$1"
  # Pin what this arm actually serves. If the two arms' hashes match, the run is
  # vacuous and must be discarded — that is the whole point of recording it.
  python3 - "$WT/$SRC" > "$OUT/$arm.instruction.txt" <<'PY'
import re, sys, hashlib
s = open(sys.argv[1], encoding='utf-8').read()
i = s.index('export const COACHING_CONTEXT_INSTRUCTION = [')
j = s.index("].join('\\n');", i)
block = s[i:j]
sys.stdout.write(block)
sys.stderr.write(hashlib.sha256(block.encode()).hexdigest()[:16] + '\n')
PY
  shasum -a 256 "$OUT/$arm.instruction.txt" | tee -a "$OUT/arm-hashes.txt"

  STORE="$STORE" PORT="$PORT" WT="$WT" ENV_FILE="$ENV_FILE" \
    STAGING_ENV="$STAGING_ENV" PARITY_ENV="$PARITY_ENV" \
    ./arm/boot-arm.sh "$OUT/$arm.arm.log" &
  local pid=$!
  local waited=0
  until grep -qm1 'file-PMS boot complete' "$OUT/$arm.arm.log" 2>/dev/null; do
    sleep 2; waited=$((waited + 2))
    [ "$waited" -gt 120 ] && { echo "arm $arm failed to boot; see $OUT/$arm.arm.log" >&2; kill $pid 2>/dev/null; exit 1; }
  done

  for i in $(seq 1 "$REPEATS"); do
    # One FRESH scenario per repeat: a conversation mutates its own history, so
    # reusing one scenario would make repeat 3 a different question from repeat 1.
    local scen
    scen="$(STAGING_ENV_FILE="$STAGING_ENV" python3 staging/seed-frozen-scenario.py --title-prefix coachcap_)"
    SCENARIOS="$SCENARIOS $scen"
    OLUMI_ASSIST_KEY="$OLUMI_ASSIST_KEY" node runner.mjs \
      --journey "$JOURNEY" --arm "$arm-r$i" --base "http://localhost:$PORT" \
      --scenario "$scen" --out "$OUT" --flags-env "$PARITY_ENV"
  done
  kill $pid 2>/dev/null || true
  wait $pid 2>/dev/null || true
}

echo "== BASELINE arm: $SRC restored to $BASE_SHA =="
git -C "$WT" show "$BASE_SHA:$SRC" > "$WT/$SRC"
run_arm baseline

echo "== CANDIDATE arm: $SRC as authored on this branch =="
cp "$CAND_SRC" "$WT/$SRC"
run_arm candidate

echo
echo "18 answers (3 questions x $REPEATS repeats x 2 arms) under $OUT"
echo "Reviewer: read each turn's QUESTION + HISTORY + FINAL DELIVERED ANSWER."
echo "First check arm-hashes.txt: two identical hashes means the run measured NOTHING."
