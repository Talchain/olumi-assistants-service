#!/bin/zsh
# Track 2 (21 Oct 2026): one CEE spec's living models through the REAL chain, offline. The CEE spec writes each Run's PLoT
# request to F1_OUT; the PLoT spec posts them to PLoT's real POST /v2/run with PLoT's real ISL client pointed at a REAL
# local ISL. No provider or staging calls. F1_CEE / F1_PLOT may name a mutant or scratch worktree.
# Usage: scripts/track2/run-chain.sh <cee spec> <plot spec>   (TRACK2_ROOT holds cee/ plot/ isl/; isl/.venv has ISL's deps)
# Exit: 0 = both halves green; 1 = a half is red; 2 = could not measure (never a pass).
setopt pipefail
CEE_SPEC=${1:?cee spec} PLOT_SPEC=${2:?plot spec}
ROOT=${TRACK2_ROOT:-/private/tmp/track2-identity}
CEE=${F1_CEE:-$ROOT/cee} PLOT=${F1_PLOT:-$ROOT/plot} ISL=$ROOT/isl OUT=${F1_OUT:-$ROOT/out-chain} PORT=${F1_ISL_PORT:-18917}
L1=$(sysctl -n vm.loadavg | awk '{print $2}'); (( ${L1%.*} < 25 )) || { echo "load $L1 >= 25: not starting"; exit 2; }
for d in $CEE $PLOT $ISL; do print -r -- "$d $(git -C $d rev-parse HEAD) dirty=$(git -C $d status --porcelain | wc -l | tr -d ' ')"; done
rm -rf "$OUT"; mkdir -p "$OUT"
(cd $ISL && ISL_AUTH_DISABLED=true exec .venv/bin/python -m uvicorn src.api.main:app --host 127.0.0.1 --port $PORT --log-level warning) >"$OUT/isl.log" 2>&1 &
ISLPID=$!
trap 'kill $ISLPID 2>/dev/null' EXIT
for i in {1..60}; do curl -sf -m 2 "http://127.0.0.1:$PORT/health" >/dev/null && break; sleep 1; done
curl -sf -m 2 "http://127.0.0.1:$PORT/health" >/dev/null || { echo "local ISL did not start (see $OUT/isl.log)"; exit 2; }
(cd $CEE && F1_OUT=$OUT node_modules/.bin/vitest run "$CEE_SPEC") >"$OUT/cee.log" 2>&1; C=$?
ls "$OUT"/*.cee-to-plot.json >/dev/null 2>&1 || { echo "CEE half wrote no request (see $OUT/cee.log)"; exit 2; }
(cd $PLOT && F1_OUT=$OUT F1_ISL_URL=http://127.0.0.1:$PORT node_modules/.bin/vitest run "$PLOT_SPEC") >"$OUT/plot.log" 2>&1; P=$?
grep -hE "Tests +[0-9]|✓|×" "$OUT/cee.log" "$OUT/plot.log"
grep -qE "Tests .*(passed|failed)" "$OUT/plot.log" || { echo "PLoT half collected no tests (see $OUT/plot.log)"; exit 2; }
print -r -- "CEE half exit $C · PLoT→ISL half exit $P · outputs in $OUT"
(( C == 0 && P == 0 )) && exit 0 || exit 1
