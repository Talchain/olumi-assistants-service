#!/usr/bin/env bash
# MG&Q acceptance probe — drives the goal's own journey at the WIRE and prints
# the rung for each clause. Written 24 Sep 2026; safe to re-run any time.
#
#   bash output/mgq-lane/witness-state-authority.sh
#
# ⛔ It creates a real scenario on staging and costs one LLM draft (~50-60s).
# ⛔ It reads ASSIST_API_KEY from .env.staging.local and NEVER prints it.
# ⚠  No browser. This is the wire beneath the journey, not the journey.
set -uo pipefail

BASE=${BASE:-https://cee-staging.onrender.com}
ENVF=${ENVF:-olumi-assistants-service/.env.staging.local}
if [ ! -f "$ENVF" ]; then
  echo "FATAL: no $ENVF (resolved relative to \$PWD=$PWD)"
  echo "  This script reads ASSIST_API_KEY from the CEE repo's staging env file."
  echo "  Run it from the estate root, or point ENVF at the file:"
  echo "      ENVF=/path/to/olumi-assistants-service/.env.staging.local bash \$0"
  exit 2
fi
K=$(grep -m1 '^ASSIST_API_KEY=' "$ENVF" | cut -d= -f2- | tr -d '"'"'"'' | tr -d '\r\n')
[ ${#K} -gt 20 ] || { echo "FATAL: key looks wrong (len ${#K})"; exit 2; }
echo "key len=${#K} (value never printed)"

SERVED=$(curl -s --max-time 20 "$BASE/healthz" | python3 -c "import sys,json;print(json.load(sys.stdin).get('build',''))")
echo "SERVED BUILD: $SERVED"

SC=$(python3 -c "import uuid;print(uuid.uuid4())")
USR=$(python3 -c "import uuid;print(uuid.uuid4())")
TID=$(python3 -c "import uuid;print(uuid.uuid4())")
echo "scenario=$SC"

# ── AUTH CONTROL FIRST. A fabricated path must 404, not 401 — auth precedes
#    routing here, so a 401 would make every later probe blind.
CTRL=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -H "X-Olumi-Assist-Key: $K" "$BASE/assist/v1/scenarios/$SC/definitely-not-a-route")
echo "AUTH CONTROL (fabricated path, expect 404): $CTRL"

# ── 1. a draft turn. NOTE the enums: stage/turn_class lowercase, source=composer.
curl -s --max-time 300 -X POST "$BASE/orchestrate/v2/turn" \
  -H "X-Olumi-Assist-Key: $K" -H 'content-type: application/json' \
  -d "{\"kind\":\"message\",\"scenario_id\":\"$SC\",\"turn_id\":\"$TID\",\"stage\":\"frame\",\"turn_class\":\"frame\",\"source\":\"composer\",\"user_id\":\"$USR\",\"message\":\"We want to maximise retained annual revenue. Decide whether to launch a paid Enterprise tier. Enterprise sales effort is currently 0, plausibly up to 200. Enterprise customers is currently 0, plausibly up to 500. Options: launch at 89 per seat, or hold.\"}" \
  -o /tmp/w_turn.json -w 'TURN HTTP %{http_code} in %{time_total}s\n'

python3 - <<'PY'
import json, sys
d=json.load(open('/tmp/w_turn.json'))
g=d.get('draft_graph')
# ⛔⛔ ABORT IF THERE IS NO DRAFT. Do NOT proceed and report fabricated defects.
#
# Measured on served `1e7e08a`: this brief produced NO `draft_graph` at all — the
# product asked a clarifying question instead ("I could not tell what they should be
# judged against"). That is CORRECT behaviour: it declined to build a model that would
# not hold together. But the script then posted `{graph: null}`, the register correctly
# returned 422 GRAPH_SHAPE_INVALID, and every downstream clause printed a DEFECT that
# did not exist — "provenance envelope MISSING", "freshness DEFECT PRESENT", a KeyError.
#
# A probe that cries wolf gets ignored, so this exits non-zero with the reason instead.
if not isinstance(g, dict) or not isinstance(g.get('nodes'), list) or len(g['nodes']) == 0:
    print()
    print("⛔ ABORTED — this turn produced NO draft_graph, so nothing downstream is testable.")
    print("   That is NOT a defect: the product asked a clarifying question rather than")
    print("   building an incoherent model. Its reply began:")
    print("     " + (str(d.get('assistant_text')) or '')[:160].replace("\n", " "))
    print("   Re-run with a brief that states the GOAL explicitly, e.g. 'we want to")
    print("   maximise retained revenue', so the constructor has an objective to build against.")
    sys.exit(3)
json.dump({'graph': g}, open('/tmp/w_reg.json','w'))
print("\n--- CLAUSE: consistent values at CONSTRUCTION (#63 item 1) ---")
bad=[]; other=[]
for n in (g.get('nodes') or []):
    if n.get('kind')!='factor': continue
    os_=n.get('observed_state') or {}
    if os_.get('value') is None: continue
    framed = os_.get('cap') is not None or n.get('scale_frame') is not None
    decl = os_.get('declared_scale')
    print("  %-34s value=%-7s cap=%-7s scale_frame=%-6s declared=%-13s FRAMED=%s" % (
        str(n.get('label'))[:34], os_.get('value'), os_.get('cap'), n.get('scale_frame'), decl, framed))
    # ⛔⛔ ITEM 1 IS SPECIFICALLY A SELF-CONTRADICTION, NOT "UNFRAMED".
    #
    # My first version flagged ANY unframed zero baseline and reported "DEFECT PRESENT"
    # on served `1e7e08a` for `Enterprise Customer Count` — which declares
    # `raw_count`, unit `customers`. That is NOT item 1: a factor declaring itself a
    # raw count of customers is COHERENTLY unframed. Item 1's defect was a factor
    # claiming `unit_interval` with no cap — a claim its own value contradicts.
    #
    # Conflating them makes the probe cry wolf, so the two are now reported apart.
    if not framed and os_.get('value') == 0:
        if decl == 'unit_interval':
            bad.append(n.get('label'))          # the item-1 contradiction
        else:
            other.append((n.get('label'), decl))  # a different question, not this one
print("  UNFRAMED + declares unit_interval (the item-1 contradiction):", bad or "none")
print("  → item 1 DEFECT PRESENT" if bad else "  → item 1 not reproduced on this brief (it is BRIEF-DEPENDENT; try again)")
if other:
    print("  ⚠ ALSO unframed, but declaring something else — NOT item 1 and NOT scored here:")
    for lbl, dc in other:
        print("      %-34s declared=%s" % (str(lbl)[:34], dc))
    print("      Whether an unframed factor with this declaration is ANALYSABLE is UNVERIFIED.")
    print("      Drive a Run against it before treating it as either a defect or acceptable.")
PY

# ── 2. register (owner-attributed), then exercise the identity expectation.
python3 -c "
import json;d=json.load(open('/tmp/w_reg.json'));d['user_id']='$USR';json.dump(d,open('/tmp/w_reg.json','w'))"
curl -s --max-time 60 -X POST "$BASE/assist/v1/scenarios/$SC/graph/register" \
  -H "X-Olumi-Assist-Key: $K" -H 'content-type: application/json' -d @/tmp/w_reg.json \
  -o /tmp/w_r.json -w 'REGISTER HTTP %{http_code}\n'
python3 -c "
import json,sys
d=json.load(open('/tmp/w_r.json'))
if d.get('registered') is not True:
    det=(d.get('details') or {}).get('code')
    print('  ⛔ ABORTED — the register did not succeed (details.code=%s): %s' % (det, str(d.get('message'))[:120]))
    print('     Nothing downstream is testable, so no clause verdict is printed. This is a')
    print('     PROBE precondition failure, not a product defect.')
    sys.exit(3)
gih=d.get('graph_identity_hash')
print('  identity on the wire is a', type(gih).__name__, '- kind=', (gih or {}).get('kind') if isinstance(gih,dict) else None)
print('  → provenance envelope', 'PRESENT' if isinstance(gih,dict) else 'MISSING')
import json as j; j.dump(gih, open('/tmp/w_gih.json','w'))"

echo "--- CLAUSE: edits cannot overwrite committed state (#1810/#1820) ---"
for CASE in envelope null stale; do
  python3 - "$CASE" <<'PY'
import json,sys
base=json.load(open('/tmp/w_reg.json'))
case=sys.argv[1]
v = json.load(open('/tmp/w_gih.json')) if case=='envelope' else (None if case=='null' else 'f'*64)
base=dict(base); base['expected_graph_identity_hash']=v
json.dump(base, open('/tmp/w_case.json','w'))
PY
  CODE=$(curl -s --max-time 60 -X POST "$BASE/assist/v1/scenarios/$SC/graph/register" \
    -H "X-Olumi-Assist-Key: $K" -H 'content-type: application/json' -d @/tmp/w_case.json \
    -o /tmp/w_out.json -w '%{http_code}')
  FE=$(python3 -c "import json;print((json.load(open('/tmp/w_out.json')).get('details') or {}).get('failed_expectation'))" 2>/dev/null)
  echo "  expectation=$CASE → HTTP $CODE  failed_expectation=$FE"
done
echo "  → EXPECTED: envelope 200 · null 409/absence · stale 409/identity"

# ── 3. the edit, then the reload. This is the goal's own journey step.
# ⭐ PREFER a factor that actually carries a unit_interval claim, so the
#   falsified-declaration clause is TESTABLE rather than vacuous. Fall back to an
#   unframed factor, then to any factor — and the check below states which case it got.
FID=$(python3 -c "
import json;g=json.load(open('/tmp/w_reg.json'))['graph']
fac=[n for n in g['nodes'] if n.get('kind')=='factor']
def claim(n):
    os_=n.get('observed_state') or {}
    return os_.get('declared_scale')=='unit_interval' or os_.get('unit')=='unit_interval'
best=[n for n in fac if claim(n)]
unframed=[n for n in fac if (n.get('observed_state') or {}).get('cap') is None and n.get('scale_frame') is None]
print((best or unframed or fac)[0]['id'])")
echo "--- editing factor $FID to 40 ---"
TID2=$(python3 -c "import uuid;print(uuid.uuid4())")
curl -s --max-time 120 -X POST "$BASE/orchestrate/v2/turn" \
  -H "X-Olumi-Assist-Key: $K" -H 'content-type: application/json' \
  -d "{\"kind\":\"system_event\",\"scenario_id\":\"$SC\",\"turn_id\":\"$TID2\",\"stage\":\"frame\",\"user_id\":\"$USR\",\"event\":{\"kind\":\"factor_value_edit\",\"target_id\":\"$FID\",\"value\":40}}" \
  -o /tmp/w_edit.json -w 'EDIT HTTP %{http_code}\n'
python3 -c "
import json;ar=(json.load(open('/tmp/w_edit.json')).get('analysis_ready') or {})
f=ar.get('freshness')
print('--- CLAUSE: freshness on an edit (#63 item 15 / PR #1822) ---')
print('  freshness =', f if f is not None else '<<ABSENT>>')
print('  →', 'SATISFIED' if f is not None else 'DEFECT PRESENT (item 15 not yet served)')"

# ⚠ POST, not GET. The read route is app.post; a GET returns 404 and that is a
#    METHOD mismatch, never an auth failure. (This cost a wrong published claim.)
curl -s --max-time 60 -X POST "$BASE/assist/v1/scenarios/$SC/graph" \
  -H "X-Olumi-Assist-Key: $K" -H 'content-type: application/json' -d "{\"user_id\":\"$USR\"}" \
  -o /tmp/w_reload.json -w 'RELOAD HTTP %{http_code}\n'
python3 - "$FID" <<'PY'
import json,sys
d=json.load(open('/tmp/w_reload.json')); fid=sys.argv[1]
print("--- CLAUSE: reloads read one authoritative current model ---")
print("  graph_present=%s  identity=%s  graph_hash=%s" % (
    d.get('graph_present'), type(d.get('graph_identity_hash')).__name__, d.get('graph_hash')))
aa=d.get('analysis_admission') or {}
print("  admission: admitted=%s mode=%s missing=%s demanded=%s waived=%s" % (
    aa.get('admitted'), aa.get('permitted_analysis_mode'), aa.get('missing_input_count'),
    aa.get('inputs_demanded_of_user'), aa.get('inputs_waived_by_exclusion')))
for n in ((d.get('graph') or {}).get('nodes') or []):
    if n.get('id')==fid:
        os_=n.get('observed_state') or {}
        ds=os_.get('declared_scale'); val=os_.get('value'); cap=os_.get('cap')
        print("--- CLAUSE: no self-contradictory stored data (PR #1832) ---")
        print("  value=%s raw_value=%s cap=%s declared_scale=%s" % (val, os_.get('raw_value'), cap, ds))
        # ⛔⛔ THE PRECONDITION MUST BE STATED, OR "SATISFIED" IS UNEARNED.
        #
        # This printed "SATISFIED: no false declaration" on served 31847a8 while
        # PR #1832 was still UNMERGED — because that brief's factors carried
        # `scale_frame`, never `declared_scale`, so there was no declaration to
        # falsify in the first place. A pass with no precondition is a VACUOUS pass,
        # and an instrument that can emit one is worse than no instrument.
        pre = json.load(open('/tmp/w_reg.json'))['graph']
        prenode = next((x for x in pre.get('nodes') or [] if x.get('id')==fid), {}) or {}
        preos = prenode.get('observed_state') or {}
        predecl = preos.get('declared_scale')
        preunit = preos.get('unit')
        print("  PRE-EDIT: declared_scale=%r unit=%r" % (predecl, preunit))
        testable = predecl == 'unit_interval' or preunit == 'unit_interval'
        falsified = (ds=='unit_interval' or os_.get('unit')=='unit_interval') and cap is None                     and isinstance(val,(int,float)) and abs(val)>1
        if not testable:
            print("  → NOT TESTABLE on this brief: the factor carried no unit_interval claim")
            print("    before the edit, so there was nothing to falsify. This is NOT a pass.")
        elif falsified:
            print("  → DEFECT PRESENT: declares unit_interval while holding %s" % val)
        else:
            print("  → SATISFIED: the claim was present before the edit and is gone after it")
        if aa.get('admitted') and falsified:
            print("  ⛔ AND readiness ADMITS it (#63 item 3) — mode=%s" % aa.get('permitted_analysis_mode'))
PY

# ── 4. versions. ⚠ A zero here from a key-authed caller is VACUOUS: it cannot
#    distinguish "broken" from "correctly declined for an anonymous writer".
curl -s --max-time 60 -X POST "$BASE/assist/v1/scenarios/$SC/versions" \
  -H "X-Olumi-Assist-Key: $K" -H 'content-type: application/json' -d "{\"user_id\":\"$USR\"}" \
  -o /tmp/w_ver.json -w 'VERSIONS HTTP %{http_code}\n'
python3 -c "
import json;d=json.load(open('/tmp/w_ver.json'))
print('--- CLAUSE: versions / receipts ---')
print('  versions=%s current_version_id=%s' % (len(d.get('versions') or []), d.get('current_version_id')))
print('  ⚠ VACUOUS from a key-authed caller — needs a SIGNED-IN session to mean anything.')"
echo
echo "SERVED BUILD WAS: $SERVED   scenario: $SC"
