#!/bin/bash
# Frozen-graph arm driver — runs a journey against a PRE-SEEDED scenario (no draft/mint).
# The scenario's graph is already in scenarios.graph (seed-frozen-scenario.py); analysis is
# deterministic (PLoT resolveSeed), so every arm over its own seeded scenario hits identical state.
# Usage: ARM=<label> SCEN=<seeded-id> BASE=<server root> KEY=<assist key> JOURNEY=<file> ./run-frozen-arm.sh
# RE-HOMED from orchestrator-prompt-workstream/fixed-graph-harness/run-frozen-arm.sh (proven 2026-07).
# Kept byte-adjusted for provenance; runner.mjs is the v0 runner.
set -u
ARM="${ARM:?}"; SCEN="${SCEN:?}"; BASE="${BASE:?}"; KEY="${KEY:?}"; JOURNEY="${JOURNEY:?}"
DIR="$(cd "$(dirname "$0")" && pwd)"; OUT="$DIR/../runs/$ARM"; mkdir -p "$OUT"
# Reset this arm's dir: clear stale per-turn captures + TRUNCATE the log ('>' not '>>') so a prior
# run's "RUN END" cannot be read as premature completion by a monitor (real incident 2026-07).
rm -f "$OUT"/[A-Z]*.json "$OUT/turns.tsv"; : > "$OUT/run-log.txt"
echo "$SCEN" > "$OUT/scenario-id.txt"
echo "RUN START $(date -u +%Y-%m-%dT%H:%M:%SZ) arm=$ARM seeded_scenario=$SCEN base=$BASE journey=$JOURNEY" >> "$OUT/run-log.txt"
run_turn () {
  local id="$1" stage="$2" msg="$3" tid payload start code_time
  tid=$(python3 -c "import uuid;print(uuid.uuid4())")
  payload=$(python3 - "$SCEN" "$tid" "$stage" "$msg" <<'PYEOF'
import json,sys
print(json.dumps({"scenario_id":sys.argv[1],"turn_id":sys.argv[2],"turn_class":"frame","kind":"message","stage":sys.argv[3],"source":"composer","message":sys.argv[4]}))
PYEOF
)
  start=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  code_time=$(curl -s -m 180 -X POST "$BASE/orchestrate/v2/turn" -H "Content-Type: application/json" -H "X-Olumi-Assist-Key: $KEY" -d "$payload" -o "$OUT/${id}.json" -w "%{http_code} %{time_total}")
  echo "$id | $start | http_time=$code_time | stage=$stage | msg=$msg" >> "$OUT/run-log.txt"
  echo "$id done: $code_time"
  local http="${code_time%% *}"
  case "$http" in 2*) ;; *) echo "TURN FAILED: $id http=$http" | tee -a "$OUT/run-log.txt"; return 1 ;; esac
  sleep 2
}
if ! python3 - "$JOURNEY" > "$OUT/turns.tsv" <<'PYEOF'
import json,sys
for t in json.load(open(sys.argv[1]))["turns"]: print(t["id"]+"\t"+t["stage"]+"\t"+t["message"])
PYEOF
then echo "ARM $ARM ABORTED — bad journey file: $JOURNEY"; exit 1; fi
[ -s "$OUT/turns.tsv" ] || { echo "ARM $ARM ABORTED — journey produced zero turns: $JOURNEY"; exit 1; }
while IFS=$'\t' read -r id stage msg; do
  run_turn "$id" "$stage" "$msg" || {
    echo "RUN ABORTED $(date -u +%Y-%m-%dT%H:%M:%SZ) at $id (turn failed)" >> "$OUT/run-log.txt"
    echo "ARM $ARM ABORTED at $id -> $OUT"; exit 1; }
done < "$OUT/turns.tsv"
echo "RUN END $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$OUT/run-log.txt"
echo "ARM $ARM COMPLETE -> $OUT"
