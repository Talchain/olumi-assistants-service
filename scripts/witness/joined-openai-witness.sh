#!/usr/bin/env bash
# JOINED SIGNED-IN OPENAI WITNESS — RC 30-minute sprint gate.
#   fresh brief -> graph -> suggest assumptions -> deterministic approve
#   -> explicit Run -> reload -> provider purity
#
# Every assertion below comes from a control I falsified live on served cd9b6158.
# Run it the moment FP2 -> FP1 -> FP3 are served. It prints PASS/FAIL per gate line
# and a final verdict; it writes nothing except its own JSON captures.
set -uo pipefail
cd /Users/paulslee/Documents/GitHub/olumi-assistants-service
export $(grep -E '^(RENDER_API_KEY|ASSIST_API_KEY)=' .env.staging.local | sed 's/#.*//' | xargs) 2>/dev/null || true
OUT="${1:-/tmp/joined-witness-$$}"; mkdir -p "$OUT"
BASE=https://cee-staging.onrender.com

# ── served SHA is derived, never assumed: take the deploy whose status == "live"
SERVED=$(python3 -c "
import os,json,urllib.request
r=urllib.request.Request('https://api.render.com/v1/services/srv-d4slpaili9vc73eiq4og/deploys?limit=20',
  headers={'Authorization':'Bearer '+os.environ['RENDER_API_KEY'],'Accept':'application/json'})
for x in json.load(urllib.request.urlopen(r)):
    d=x.get('deploy',x)
    if d.get('status')=='live': print((d.get('commit') or {}).get('id') or ''); break
")
echo "SERVED (status=live) = ${SERVED}"
[ ${#SERVED} -eq 40 ] || { echo "FAIL: could not derive a 40-char served sha"; exit 2; }

SID=$(python3 -c "import uuid;print(uuid.uuid4())")
echo "SCENARIO = $SID   (fresh, so no other lane's witness can collide)"

turn(){ # $1 label  $2 message  [$3 extra-json]
  local extra="${3:-}"
  local payload
  payload=$(python3 -c "
import json,sys
b={'scenario_id':sys.argv[1],'message':sys.argv[2]}
if len(sys.argv)>3 and sys.argv[3]: b.update(json.loads(sys.argv[3]))
print(json.dumps(b))" "$SID" "$2" "$extra")
  local t0 t1
  t0=$(python3 -c 'import time;print(time.time())')
  curl -s --max-time 300 -o "$OUT/$1.json" -w "%{http_code}" \
    -X POST "$BASE/agent/v1/turn" \
    -H "X-Olumi-Assist-Key: ${ASSIST_API_KEY}" -H 'content-type: application/json' \
    -d "$payload" > "$OUT/$1.code"
  t1=$(python3 -c 'import time;print(time.time())')
  python3 -c "print(f'  {\"$1\":<10} HTTP {open(\"$OUT/$1.code\").read()}  {$t1-$t0:.1f}s')"
}

echo; echo "── driving the journey ──"
turn brief   'We are a 40-person B2B SaaS company. Our enterprise renewal rate fell from 91% to 78% in two quarters. We are deciding whether to build a customer-success team, cut prices, or invest in product reliability.'
# the approve chip id is read back from the brief turn, never guessed
CHIP=$(python3 -c "
import json;d=json.load(open('$OUT/brief.json'))
ids=[a.get('id','') for a in (d.get('suggested_actions') or [])]
print(next((i for i in ids if i.startswith('agent-approve-proposal')), ''))")
echo "  approve chip id = ${CHIP:-<none offered>}"
if [ -n "$CHIP" ]; then
  turn approve 'Yes, use those.' "$(python3 -c "import json,sys;print(json.dumps({'source':'chip_click','chip':{'id':sys.argv[1]}}))" "$CHIP")"
else
  turn approve 'Yes, use those.'
fi
turn run 'Run the analysis.' '{"source":"chip_click","chip":{"action_type":"run_analysis"}}'
turn reload 'What does the model say right now?'

echo; echo "── gate assertions ──"
python3 - "$OUT" "$SERVED" <<'PY'
import sys,json,os
OUT,SERVED=sys.argv[1],sys.argv[2]
def load(n):
    try: return json.load(open(f"{OUT}/{n}.json"))
    except Exception: return {}
fails=[]
def gate(ok,label,detail=""):
    print(f"  {'PASS' if ok else 'FAIL'}  {label}" + (f"   [{detail}]" if detail else ""))
    if not ok: fails.append(label)

allcalls=[]
for n in ("brief","approve","run","reload"):
    d=load(n); allcalls += (d.get("_provider_calls") or [])
    if d and '_provider_calls_truncated' in d:
        gate(False,f"{n}: ledger TRUNCATED", "omitted-when-false, so presence == truncated")

b,a,r,rl = load("brief"),load("approve"),load("run"),load("reload")

# 1 graph appears from the brief
gate((b.get("draft_graph") or {}).get("node_count",0) > 0, "brief -> a graph is on the wire",
     f"node_count={(b.get('draft_graph') or {}).get('node_count')}")
# 2 fresh brief took the constructor fast path: one construction call, no conversation
bp=[c.get("purpose") for c in (b.get("_provider_calls") or [])]
gate(bp==["construction"], "FP1: fresh brief = exactly ONE construction call", f"purposes={bp}")
# 3 assumptions were suggested
gate(any(str(x.get("id","")).startswith("agent-approve-proposal") or "starting-point" in str(x.get("id",""))
         for x in (b.get("suggested_actions") or [])), "brief -> assumptions offered as a chip")
# 4 deterministic approve: zero model calls, a write, and NO implicit Run
ap=[c.get("purpose") for c in (a.get("_provider_calls") or [])]
atools=[t.get("name") for t in ((a.get("_agent") or {}).get("tool_calls") or [])]
gate(len(ap)==0, "FP2: approve = ZERO provider calls", f"purposes={ap}")
gate((a.get("_agent") or {}).get("mutated") is True, "FP2: approve WROTE", f"tools={atools}")
gate("run_analysis" not in atools, "FP2: NO implicit Run on approve", f"tools={atools}")
# 5 explicit Run: deterministic analysis + exactly one interpreting call
rp=[c.get("purpose") for c in (r.get("_provider_calls") or [])]
rtools=[t.get("name") for t in ((r.get("_agent") or {}).get("tool_calls") or [])]
gate(len(rp)==1, "FP3: explicit Run = exactly ONE interpreting call", f"purposes={rp}")
gate(rtools==["run_analysis"], "FP3: exactly one deterministic run_analysis", f"tools={rtools}")
# 6 reload preserves currentness
gate(bool(rl.get("analysis_state") or rl.get("analysis_ready")), "reload -> currentness preserved")
# 7 provider purity across the whole journey, non-vacuous
prov={}
for c in allcalls: prov[c.get("provider")]=prov.get(c.get("provider"),0)+1
models=sorted({c.get("model") for c in allcalls})
gate(len(allcalls)>0 and sum(prov.values())==len(allcalls), "purity: ledger non-empty and buckets sum",
     f"n={len(allcalls)} {prov}")
gate(prov.get("anthropic",0)==0, "purity: ZERO Anthropic (allowed OR refused_before_network)", f"{prov} models={models}")

print()
print(f"  served      : {SERVED[:12]}")
print(f"  total calls : {len(allcalls)}  {prov}")
print(f"  VERDICT     : {'✅ JOURNEY WITNESSED' if not fails else '⛔ FAILED: ' + '; '.join(fails)}")
sys.exit(0 if not fails else 1)
PY
