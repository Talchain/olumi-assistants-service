#!/bin/bash
# A/B arm driver — orchestrator-prompt workstream.
# Runs journey-v2.json sequentially against a CEE server on a FRESH client-minted
# disposable scenario. {FACTOR} in messages is replaced with a factor label from
# THIS run's own draft (Monte-Carlo/draft variance). Captures full response JSON per turn.
# Usage: ARM=armB-v42.2a BASE=http://localhost:3101 KEY=<assist key> ./run-arm.sh
set -u
ARM="${ARM:?set ARM=<label>}"
BASE="${BASE:?set BASE=<server root, no path>}"
KEY="${KEY:?set KEY=<assist api key>}"
DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/runs/$ARM"
mkdir -p "$OUT"
# Reset arm dir: clear stale per-turn captures + TRUNCATE the log ('>' not '>>') so a prior run's
# "RUN END" can't be read as premature completion (real incident 2026-07).
rm -f "$OUT"/[A-Z]*.json "$OUT/turns.tsv"; : > "$OUT/run-log.txt"
SCEN=$(python3 -c "import uuid; print(uuid.uuid4())")
echo "$SCEN" > "$OUT/scenario-id.txt"
echo "RUN START $(date -u +%Y-%m-%dT%H:%M:%SZ) arm=$ARM scenario=$SCEN base=$BASE journey=$DIR/journey-v2.json" >> "$OUT/run-log.txt"

FACTOR="Team Execution Capacity"  # replaced after T01 from this run's draft

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
  local http="${code_time%% *}"
  case "$http" in 2*) ;; *) echo "TURN FAILED: $id http=$http" | tee -a "$OUT/run-log.txt"; return 1 ;; esac
  sleep 2
}

python3 - "$DIR/journey-v2.json" <<'PYEOF' > "$OUT/turns.tsv"
import json, sys
for t in json.load(open(sys.argv[1]))["turns"]:
    print(t["id"] + "\t" + t["stage"] + "\t" + t["message"])
PYEOF

while IFS=$'\t' read -r id stage msg; do
  msg="${msg//\{FACTOR\}/$FACTOR}"
  run_turn "$id" "$stage" "$msg" || {
    echo "RUN ABORTED $(date -u +%Y-%m-%dT%H:%M:%SZ) at $id (turn failed)" >> "$OUT/run-log.txt"
    echo "ARM $ARM ABORTED at $id -> $OUT"; exit 1
  }
  if [ "$id" = "T01" ]; then
    picked=$(python3 - "$OUT/T01.json" <<'PYEOF'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
    facs = [n["label"] for n in d.get("draft_graph", {}).get("nodes", [])
            if n.get("kind") == "factor" and not n.get("label", "").endswith("Hired")]
    pref = [l for l in facs if any(w in l.lower() for w in ("capacity", "speed", "quality", "maturity", "throughput"))]
    print((pref or facs or ["Team Execution Capacity"])[0])
except Exception:
    print("Team Execution Capacity")
PYEOF
)
    if [ -n "$picked" ]; then FACTOR="$picked"; fi
    echo "FACTOR resolved: $FACTOR" >> "$OUT/run-log.txt"
  fi
done < "$OUT/turns.tsv"

echo "RUN END $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$OUT/run-log.txt"
echo "ARM $ARM COMPLETE -> $OUT"
