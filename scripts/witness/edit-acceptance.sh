#!/usr/bin/env bash
# ⭐ THE EDITING JOURNEY, DRIVEN ON THE SERVED BUILD.
# Paul's acceptance for #1767, verbatim: approve changing 70 to 50 -> save raw 50 and
# model 0.5 where the declared scale is 100 -> read back 50 -> Run only when explicitly
# requested -> reload retains 50.
# Every gate here requires a NON-EMPTY read before it compares anything, because a
# failed read that compares equal is the exact vacuity this estate keeps getting caught by.
set -uo pipefail
BASE="${CEE_BASE:-https://cee-staging.onrender.com}"
ENVF="${ENVF:-$(dirname "$0")/../../.env.staging.local}"
say(){ printf '%s\n' "$*"; }
KEY=$(grep -m1 '^ASSIST_API_KEY=' "$ENVF" 2>/dev/null | cut -d= -f2- | tr -d '"'"'"' \r')
[ "${#KEY}" -eq 64 ] || { say "STOP: key not resolved (${#KEY} chars)"; exit 2; }
SERVED=""
for a in 1 2 3 4 5; do
  SERVED=$(curl -s --max-time 20 "$BASE/healthz" | sed -n 's/.*"build":"\([0-9a-f]*\)".*/\1/p')
  [ -n "$SERVED" ] && break; say "  /healthz no build (try $a/5)"; sleep 10
done
[ -n "$SERVED" ] || { say "STOP: no served build"; exit 2; }
say "SERVED CEE: $SERVED"
post(){ curl -s --max-time 300 -X POST -H "X-Olumi-Assist-Key: $KEY" -H 'Content-Type: application/json' -d "$2" "$BASE$1"; }
jqv(){ printf '%s' "$1" | jq -r "$2" 2>/dev/null; }
pass=0; fail=0
gate(){ if [ "$2" = "1" ]; then say "  PASS  $1 — $3"; pass=$((pass+1)); else say "  FAIL  $1 — $3"; fail=$((fail+1)); fi; }

SCEN=$(uuidgen | tr 'A-Z' 'a-z'); say "scenario: $SCEN"
BRIEF='We must decide how to cut customer churn next quarter. Options: rebuild onboarding, add a success manager for the top 50 accounts, or ship the requested integrations. Our evidence strength on what actually drives churn is about 70 out of 100, and we have £400k.'

say ""; say "1) build the model from a brief"
R1=$(post /agent/v1/turn "$(jq -nc --arg s "$SCEN" --arg m "$BRIEF" '{scenario_id:$s,message:$m}')")
EX=$(jqv "$R1" '._diagnostic_trace.exit_path // "-"')
say "   exit_path=$EX  chars=$(jqv "$R1" '((.assistant_text // .message // "")|length)')"
[ "$EX" = "agent_lane_v1" ] && gate "the OpenAI lane served this turn" 1 "exit_path=$EX" || gate "the OpenAI lane served this turn" 0 "exit_path=$EX — wrong lane, the rest is not about the PoC"

# Find a factor that carries a FRAME (cap + raw_value). That is the shape the bug lived on.
G=$(post "/assist/v1/scenarios/$SCEN/graph" '{}')
[ -n "$G" ] || { say "STOP: graph read empty"; exit 2; }
FRAMED=$(jqv "$G" '[(.graph.nodes//.nodes//[])[]|select(.kind=="factor")|select((.observed_state.cap//null)!=null)|{id,label,cap:.observed_state.cap,raw:(.observed_state.raw_value//.observed_state.value),model:.observed_state.value}]')
N=$(printf '%s' "$FRAMED" | jq 'length' 2>/dev/null || echo 0)
say "   framed factors (cap present): $N"
printf '%s' "$FRAMED" | jq -r '.[]|"     \(.label): model=\(.model) raw=\(.raw) cap=\(.cap)"' 2>/dev/null | head -6
if [ "${N:-0}" -lt 1 ]; then
  gate "the constructed model frames its factors" 0 "0 factors carry a cap — the acceptance needs one; construction framing did not run on this build"
  say ""; say "==== $pass passed · $((fail+1)) failed · served $SERVED ===="; exit 0
fi
gate "the constructed model frames its factors" 1 "$N carry a cap"

FID=$(printf '%s' "$FRAMED" | jq -r '.[0].id'); FLAB=$(printf '%s' "$FRAMED" | jq -r '.[0].label')
FCAP=$(printf '%s' "$FRAMED" | jq -r '.[0].cap'); FRAW=$(printf '%s' "$FRAMED" | jq -r '.[0].raw')
TARGET=$(printf '%s' "$FRAMED" | jq -r '(.[0].cap*0.5)|floor')
say "   target: $FLAB  raw $FRAW -> $TARGET  (cap $FCAP)"

say ""; say "2) ask, in conversation, to change that value"
R2=$(post /agent/v1/turn "$(jq -nc --arg s "$SCEN" --arg m "Change $FLAB to $TARGET." '{scenario_id:$s,message:$m}')")
# ⛔ THE PROPOSAL REACHES THE CLIENT AS A TYPED CHIP, not a bare field. My first probe
# searched for a `proposal_id` key anywhere in the body and found none on TWO different
# working paths — the probe was wrong, not the product. Authority: morning-check.sh:95.
APPROVE=$(jqv "$R2" '[.suggested_actions[]?|select(.id|startswith("agent-approve-proposal:"))|.id]|first // ""')
PID="${APPROVE#agent-approve-proposal:}"
[ "$APPROVE" = "null" ] && { APPROVE=""; PID=""; }
LABEL=$(jqv "$R2" '[._agent.tool_calls[]?|.result?.public_label? // empty] | first // ([.suggested_actions[]?|select(.id|startswith("agent-approve-proposal:"))|(.label // .title // empty)]|first) // ""')
TOOLS2=$(jqv "$R2" '[._agent.tool_calls[]?|.name]|join(",")')
say "   tools on the edit turn: ${TOOLS2:--}"
say "   approve chip=${APPROVE:0:44}"; say "   label: $LABEL"
[ -n "$APPROVE" ] && gate "the Agent offers a proposal for the change" 1 "typed approve chip offered" || gate "the Agent offers a proposal for the change" 0 "no agent-approve-proposal chip in suggested_actions — the conversational edit never got as far as an approval"

if [ -n "$LABEL" ]; then
  # ⛔ ITEM 1: the chip must show the user's OWN number, never the model's divisor.
  MODELV=$(printf '%s' "$FRAMED" | jq -r '.[0].model')
  if printf '%s' "$LABEL" | grep -qF "$FRAW"; then
    gate "the approval shows the NATIVE figure" 1 "the label carries $FRAW"
  else
    gate "the approval shows the NATIVE figure" 0 "the label does not carry $FRAW — this is Codex item 1"
  fi
  if printf '%s' "$LABEL" | grep -qF "$MODELV" && [ "$MODELV" != "$FRAW" ]; then
    gate "the model divisor never reaches the chip" 0 "the label carries $MODELV, the internal value"
  else
    gate "the model divisor never reaches the chip" 1 "no bare $MODELV in the label"
  fi
fi

if [ -z "$APPROVE" ]; then say ""; say "==== $pass passed · $fail failed · served $SERVED ===="; exit 0; fi

say ""; say "3) approve it"
H0=$(jqv "$G" '.analysis_state.graph_hash // .graph_hash')
[ -n "$H0" ] && [ "$H0" != "null" ] || { say "STOP: no graph_hash before the write — refusing to compare"; exit 2; }
R3=$(post /agent/v1/turn "$(jq -nc --arg s "$SCEN" --arg c "$APPROVE" '{scenario_id:$s,message:"Yes, do that.",chip:{id:$c}}')")
CALLS=$(jqv "$R3" '[._provider_calls[]?]|length'); TOOLS=$(jqv "$R3" '[._agent.tool_calls[]?|.name]|unique|join(",")')
say "   provider calls=$CALLS  tools=$TOOLS"
say "   said: $(jqv "$R3" '((.assistant_text // .message // "")[0:220])')"

# ⛔ ITEM 2: no automatic Run in the approve turn.
RAN=$(jqv "$R3" '[.. | objects | select(has("analysis_result")) ] | length')
if printf '%s' "$TOOLS" | grep -q 'run_analysis'; then
  gate "NO automatic Run after the revision" 0 "run_analysis was called in the approve turn — this is Codex item 2"
else
  gate "NO automatic Run after the revision" 1 "run_analysis not called (tools=${TOOLS:--})"
fi

say ""; say "4) read the canonical state back"
G2=$(post "/assist/v1/scenarios/$SCEN/graph" '{}')
NODE=$(jqv "$G2" "[(.graph.nodes//.nodes//[])[]|select(.id==\"$FID\")]|first // {}")
SRAW=$(printf '%s' "$NODE" | jq -r '.observed_state.raw_value // "none"')
SVAL=$(printf '%s' "$NODE" | jq -r '.observed_state.value // "none"')
SCAP=$(printf '%s' "$NODE" | jq -r '.observed_state.cap // "none"')
H1=$(jqv "$G2" '.analysis_state.graph_hash // .graph_hash')
say "   stored: value=$SVAL raw_value=$SRAW cap=$SCAP"
[ -n "$H1" ] && [ "$H1" != "null" ] || { say "STOP: no graph_hash after the write"; exit 2; }
[ "$H0" != "$H1" ] && gate "the model actually changed" 1 "hash moved ${H0:0:8} -> ${H1:0:8}" || gate "the model actually changed" 0 "hash did not move (${H0:0:8}) — nothing was written"

# ⛔ ITEM 3/5: the coherent pair must be what landed.
if [ "$SRAW" = "$TARGET" ]; then
  gate "raw_value is the user's own number" 1 "raw_value=$SRAW"
else
  gate "raw_value is the user's own number" 0 "raw_value=$SRAW, expected $TARGET — this is Codex items 3/5 (raw_value dropped)"
fi
EXPV=$(python3 -c "print($TARGET/$FCAP)" 2>/dev/null)
if [ "$SVAL" != "none" ] && python3 -c "import sys;sys.exit(0 if abs($SVAL-$EXPV)<1e-9 else 1)" 2>/dev/null; then
  gate "the model value is on the factor's own scale" 1 "value=$SVAL = $TARGET/$FCAP"
else
  gate "the model value is on the factor's own scale" 0 "value=$SVAL, expected $EXPV ($TARGET/$FCAP)"
fi

say ""; say "5) reload — the value must survive"
G3=$(post "/assist/v1/scenarios/$SCEN/graph" '{}')
RRAW=$(jqv "$G3" "[(.graph.nodes//.nodes//[])[]|select(.id==\"$FID\")]|first|.observed_state.raw_value // \"none\"")
if [ "$RRAW" = "$TARGET" ]; then gate "reload retains the revised value" 1 "raw_value=$RRAW"; else gate "reload retains the revised value" 0 "raw_value=$RRAW after reload, expected $TARGET"; fi

say ""; say "==== $pass passed · $fail failed · served $SERVED ===="
say "scenario for follow-up: $SCEN"
