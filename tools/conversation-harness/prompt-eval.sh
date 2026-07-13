#!/bin/bash
# prompt-eval — turnkey A/B of a PROMPT CANDIDATE in the hermetic arm (ROADMAP 1.70 v1).
#
# One command: build the baseline (staging-mirror) store, derive a candidate store
# that swaps ONE PMS task for a candidate file, boot BOTH as hermetic arms (local
# CEE, FILE prompt store, ZERO PMS writes — the #432 substrate), drive the SAME
# frozen journey N times against each, score every run, and emit an A/B verdict.
#
# Fair-A/B guarantees:
#   - baseline vs candidate stores differ ONLY in the swapped task (pure JSON
#     patch via make-candidate-store.mjs — see that file's header).
#   - both arms source the SAME staging-parity.env (identical flags/models/seed
#     surface) and drive the SAME journey; seeded scenarios come from the SAME
#     frozen graph fixture, so the only independent variable is the prompt.
#   - N>=3 reruns per side feed ab-verdict.ts's flaky-dim median (live-model
#     nondeterminism) — a single rerun is allowed but flagged low-confidence.
#
# Usage:
#   OLUMI_ASSIST_KEY=<key> ./prompt-eval.sh \
#     --task decision_review \
#     --candidate candidates/decision_review.v43.txt \
#     --journey journeys/s3-option-question-probe.json \
#     [--reruns 3] [--base-port 3103] [--cand-port 3113] [--l0] [--keep-arms]
#
# Discipline: HERMETIC only. This script never writes to PMS and never promotes a
# prompt — it produces EVIDENCE (runs/<arm>/scores.json + runs/ab-<task>/ab-verdict.*)
# for the orchestrator to decide on. Staging-mode A/B is out of scope here (see the
# README "Staging-mode discipline"); at most one manual smoke turn against live.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

TASK=""; CANDIDATE=""; JOURNEY=""; RERUNS=3; BASE_PORT=3103; CAND_PORT=3113
L0=""; KEEP_ARMS=""; REFRESH_BASELINE=""; STORE_DIR="$DIR/stores"
while [ $# -gt 0 ]; do
  case "$1" in
    --task) TASK="$2"; shift 2;;
    --candidate) CANDIDATE="$2"; shift 2;;
    --journey) JOURNEY="$2"; shift 2;;
    --reruns) RERUNS="$2"; shift 2;;
    --base-port) BASE_PORT="$2"; shift 2;;
    --cand-port) CAND_PORT="$2"; shift 2;;
    --l0) L0="--l0"; shift;;
    --keep-arms) KEEP_ARMS=1; shift;;
    --refresh-baseline) REFRESH_BASELINE=1; shift;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done
[ -n "$TASK" ] && [ -n "$CANDIDATE" ] && [ -n "$JOURNEY" ] || {
  echo "usage: OLUMI_ASSIST_KEY=<key> ./prompt-eval.sh --task <id> --candidate <file> --journey <journey.json> [--reruns 3] [--base-port 3103] [--cand-port 3113] [--l0] [--keep-arms] [--refresh-baseline]" >&2
  exit 2
}

# UNIQUE run dirs per eval (C-hygiene): reusing runs/base-N across evals left
# stale turn dirs a prior journey wrote — and the scorer's defensive loader
# scores any extra on-disk turn dir. One eval = one fresh runs/eval-* tree.
EVAL_ID="$(date +%Y%m%d-%H%M%S)-$$"
RUNS_DIR="$DIR/runs/eval-${TASK}-${EVAL_ID}"
mkdir -p "$RUNS_DIR"
: "${OLUMI_ASSIST_KEY:?set OLUMI_ASSIST_KEY (or ASSIST_API_KEY) for the runner}"
[ -f "$CANDIDATE" ] || { echo "candidate file not found: $CANDIDATE" >&2; exit 2; }

TSX="$DIR/../../node_modules/.bin/tsx"
BASE_STORE="$STORE_DIR/staging-mirror.json"
CAND_STORE="$STORE_DIR/cand-${TASK}.json"
BASE_LOG="$DIR/arm-base.log"; CAND_LOG="$DIR/arm-cand.log"
BASE_PID=""; CAND_PID=""

cleanup() {
  [ -n "$KEEP_ARMS" ] && return 0
  [ -n "$BASE_PID" ] && kill "$BASE_PID" 2>/dev/null || true
  [ -n "$CAND_PID" ] && kill "$CAND_PID" 2>/dev/null || true
}
trap cleanup EXIT

wait_for_boot() { # $1 = logfile
  for _ in $(seq 1 60); do
    grep -q 'file-PMS boot complete' "$1" 2>/dev/null && return 0
    sleep 1
  done
  echo "arm did not boot within 60s — see $1" >&2; tail -20 "$1" >&2; exit 1
}

echo "== 1/6 baseline store (refresh/verify) =="
# BASELINE REFRESH/VERIFY (hygiene fix): a silently-reused stale staging-mirror
# invalidates the A/B — the "baseline" stops being the served baseline. Rebuild
# when forced (--refresh-baseline) or older than BASELINE_MAX_AGE_HOURS
# (default 24), and always record sha256 + age into the eval dir as evidence.
BASELINE_MAX_AGE_HOURS="${BASELINE_MAX_AGE_HOURS:-24}"
if [ -f "$BASE_STORE" ] && [ -z "$REFRESH_BASELINE" ]; then
  AGE_H=$(python3 -c "import os,sys,time; print(int((time.time()-os.path.getmtime(sys.argv[1]))//3600))" "$BASE_STORE")
  if [ "$AGE_H" -ge "$BASELINE_MAX_AGE_HOURS" ]; then
    echo "baseline store is ${AGE_H}h old (>= ${BASELINE_MAX_AGE_HOURS}h) — rebuilding from PMS"
    python3 arm/build-stores.py --out "$BASE_STORE"
  else
    echo "reusing baseline store (${AGE_H}h old, < ${BASELINE_MAX_AGE_HOURS}h)"
  fi
else
  [ -n "$REFRESH_BASELINE" ] && echo "--refresh-baseline: rebuilding from PMS"
  python3 arm/build-stores.py --out "$BASE_STORE"
fi
# Verify: parseable JSON + record identity (sha256 + mtime) with the evidence.
python3 - "$BASE_STORE" "$RUNS_DIR/baseline-store.txt" <<'PY'
import hashlib, json, os, sys, time
store, out = sys.argv[1], sys.argv[2]
with open(store, 'rb') as f:
    raw = f.read()
json.loads(raw)  # hard-fail on a corrupt store
sha = hashlib.sha256(raw).hexdigest()
mtime = time.strftime('%Y-%m-%dT%H:%M:%S%z', time.localtime(os.path.getmtime(store)))
line = f"baseline store: {store}\nsha256: {sha}\nmtime: {mtime}\n"
open(out, 'w').write(line)
print(line, end='')
PY

echo "== 2/6 candidate store (swap $TASK) =="
node arm/make-candidate-store.mjs --baseline "$BASE_STORE" --task "$TASK" --candidate "$CANDIDATE" --out "$CAND_STORE"

echo "== 3/6 boot both hermetic arms =="
STORE="$BASE_STORE" PORT="$BASE_PORT" ./arm/boot-arm.sh "$BASE_LOG" & BASE_PID=$!
STORE="$CAND_STORE" PORT="$CAND_PORT" ./arm/boot-arm.sh "$CAND_LOG" & CAND_PID=$!
wait_for_boot "$BASE_LOG"; wait_for_boot "$CAND_LOG"
echo "baseline arm :$BASE_PORT (pid $BASE_PID) · candidate arm :$CAND_PORT (pid $CAND_PID)"

# A seeded journey needs a frozen scenario per (side, rerun) for independent
# samples; a fresh journey (requires_seeded_scenario=false) lets the runner mint.
NEEDS_SEED=$(node -e "const p=require('path').resolve(process.argv[1]);process.stdout.write(String(!!(require(p).requires_seeded_scenario)))" "$JOURNEY")
SEEDED_IDS=()
seed() { python3 staging/seed-frozen-scenario.py --title-prefix "prompt_eval_${TASK}_"; }

echo "== 4/6 drive $RERUNS paired reruns =="
BASE_DIRS=(); CAND_DIRS=()
for i in $(seq 1 "$RERUNS"); do
  BSCEN=""; CSCEN=""
  if [ "$NEEDS_SEED" = "true" ]; then
    BSCEN=$(seed); SEEDED_IDS+=("$BSCEN")
    CSCEN=$(seed); SEEDED_IDS+=("$CSCEN")
  fi
  echo "-- rerun $i --"
  node runner.mjs --journey "$JOURNEY" --arm "base-$i" --base "http://localhost:$BASE_PORT" \
    ${BSCEN:+--scenario "$BSCEN"} $L0 --flags-env staging-parity.env
  node runner.mjs --journey "$JOURNEY" --arm "cand-$i" --base "http://localhost:$CAND_PORT" \
    ${CSCEN:+--scenario "$CSCEN"} $L0 --flags-env staging-parity.env
  RUN_DIR="$RUNS_DIR/base-$i" "$TSX" scorer/score-run.ts >/dev/null
  RUN_DIR="$RUNS_DIR/cand-$i" "$TSX" scorer/score-run.ts >/dev/null
  BASE_DIRS+=("$RUNS_DIR/base-$i"); CAND_DIRS+=("$RUNS_DIR/cand-$i")
done

echo "== 5/6 A/B verdict =="
AB_DIR="$RUNS_DIR/ab-${TASK}"; mkdir -p "$AB_DIR"
BL=$(IFS=,; echo "${BASE_DIRS[*]}"); CD=$(IFS=,; echo "${CAND_DIRS[*]}")
BASELINE_DIRS="$BL" CANDIDATE_DIRS="$CD" AB_OUT="$AB_DIR" "$TSX" scorer/ab-verdict.ts

echo "== 6/6 cleanup seeded scenarios =="
if [ "${#SEEDED_IDS[@]}" -gt 0 ]; then
  python3 staging/delete-scenarios.py "${SEEDED_IDS[@]}"            # dry-run first (reserved ids hard-blocked)
  python3 staging/delete-scenarios.py --execute "${SEEDED_IDS[@]}"
fi
echo "DONE -> $AB_DIR/ab-verdict.md"
