#!/bin/bash
# Round-1 arm driver — orchestrator-prompt workstream. Runs journey-round1.json
# sequentially against a CEE server on a FRESH client-minted disposable scenario.
# No {FACTOR} substitution (the trimmed journey drops the edit turns). Captures
# full response JSON per turn. Usage: ARM=r1-control BASE=http://localhost:3103 KEY=<assist key> ./run-round1.sh
set -u
ARM="${ARM:?set ARM=<label>}"
BASE="${BASE:?set BASE=<server root, no path>}"
KEY="${KEY:?set KEY=<assist api key>}"
JOURNEY_FILE="${JOURNEY:-$DIR/journey-round1.json}"
DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/runs/$ARM"
mkdir -p "$OUT"
# Reset this arm's dir so a prior/aborted run of the same ARM cannot leak state:
#   - clear stale per-turn captures (uppercase-prefixed <id>.json)
#   - TRUNCATE the run log (append-mode previously left a stale "RUN END" that a
#     monitor read as premature completion — real incident 2026-07). '>' not '>>'.
rm -f "$OUT"/[A-Z]*.json "$OUT/turns.tsv"
: > "$OUT/run-log.txt"
SCEN=$(python3 -c "import uuid; print(uuid.uuid4())")
echo "$SCEN" > "$OUT/scenario-id.txt"
echo "RUN START $(date -u +%Y-%m-%dT%H:%M:%SZ) arm=$ARM scenario=$SCEN base=$BASE journey=$JOURNEY_FILE" >> "$OUT/run-log.txt"

run_turn () {
  local id="$1" stage="$2" msg="$3"
  local tid payload start code_time
  tid=$(python3 -c "import uuid; print(uuid.uuid4())")
  payload=$(python3 - "$SCEN" "$tid" "$stage" "$msg" <<'PYEOF'
import json, sys
print(json.dumps({
    "scenario_id": sys.argv[1], "turn_id": sys.argv[2], "turn_class": "frame",
    "kind": "message", "stage": sys.argv[3], "source": "composer",
    "message": sys.argv[4],
}))
PYEOF
)
  start=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  code_time=$(curl -s -m 180 -X POST "$BASE/orchestrate/v2/turn" \
    -H "Content-Type: application/json" \
    -H "X-Olumi-Assist-Key: $KEY" \
    -d "$payload" \
    -o "$OUT/${id}.json" -w "%{http_code} %{time_total}")
  echo "$id | $start | http_time=$code_time | stage=$stage | msg=$msg" >> "$OUT/run-log.txt"
  echo "$id done: $code_time"
  # Abort the arm on any non-2xx (or 000 connect-failure): continuing would burn the rest
  # of the journey's LLM calls against a degraded/broken conversation state.
  local http="${code_time%% *}"
  case "$http" in 2*) ;; *) echo "TURN FAILED: $id http=$http" | tee -a "$OUT/run-log.txt"; return 1 ;; esac
  sleep 2
}

# Build the turn list; abort if the journey file is missing/malformed (empty turns.tsv → zero-turn run).
if ! python3 - "$JOURNEY_FILE" > "$OUT/turns.tsv" <<'PYEOF'
import json, sys
for t in json.load(open(sys.argv[1]))["turns"]:
    print(t["id"] + "\t" + t["stage"] + "\t" + t["message"])
PYEOF
then
  echo "RUN ABORTED $(date -u +%Y-%m-%dT%H:%M:%SZ) — could not parse journey $JOURNEY_FILE" >> "$OUT/run-log.txt"
  echo "ARM $ARM ABORTED — bad journey file: $JOURNEY_FILE"; exit 1
fi
[ -s "$OUT/turns.tsv" ] || { echo "ARM $ARM ABORTED — journey produced zero turns: $JOURNEY_FILE"; exit 1; }

while IFS=$'\t' read -r id stage msg; do
  run_turn "$id" "$stage" "$msg" || {
    echo "RUN ABORTED $(date -u +%Y-%m-%dT%H:%M:%SZ) at $id (turn failed)" >> "$OUT/run-log.txt"
    echo "ARM $ARM ABORTED at $id (turn failed) -> $OUT"; exit 1
  }
done < "$OUT/turns.tsv"

echo "RUN END $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$OUT/run-log.txt"
echo "ARM $ARM COMPLETE -> $OUT"
