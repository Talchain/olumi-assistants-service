#!/usr/bin/env bash
# What the OpenAI PoC actually does on the build that is SERVED right now.
#
# One command, no arguments. Reads the served SHA from /healthz (no key needed),
# reports which fast paths are on it, then drives the journey and prints a
# pass/fail line per gate. It never claims a path is live without checking the
# served source first: a green gate for code the deployment does not carry is
# the failure mode this script exists to prevent.
#
#   bash scripts/witness/morning-check.sh
#
# Needs ASSIST_API_KEY in olumi-assistants-service/.env.staging.local.
# NOTE: `set -a; . .env.staging.local` does NOT export on this machine — the
# key is parsed explicitly below.
set -uo pipefail
BASE="${CEE_BASE:-https://cee-staging.onrender.com}"
REPO="${CEE_REPO:-Talchain/olumi-assistants-service}"
ENVF="${ENVF:-$(dirname "$0")/../../.env.staging.local}"

say(){ printf '%s\n' "$*"; }
KEY=$(grep -m1 '^ASSIST_API_KEY=' "$ENVF" 2>/dev/null | cut -d= -f2- | tr -d '"'"'"' \r')
if [ "${#KEY}" -ne 64 ]; then say "STOP: ASSIST_API_KEY not resolved from $ENVF (got ${#KEY} chars)"; exit 2; fi

SERVED=$(curl -s --max-time 20 "$BASE/healthz" | sed -n 's/.*"build":"\([0-9a-f]*\)".*/\1/p')
[ -n "$SERVED" ] || { say "STOP: could not read the served build from $BASE/healthz"; exit 2; }
say "SERVED CEE: $SERVED"

# Which fast paths does the SERVED source actually carry?
SRC=$(mktemp)
gh api "repos/$REPO/contents/src/routes/agent-v1-turn.ts?ref=$SERVED" --jq '.content' 2>/dev/null | base64 -d > "$SRC" || true
have(){ [ -s "$SRC" ] && [ "$(grep -c "$1" "$SRC")" -gt 0 ] && echo yes || echo no; }
FP1=$(have isFirstBriefCandidate); FP2=$(have typedApprovalOf); FP3=$(have typedRunOf)
say "on the served source:  FP1 first-brief=$FP1   FP2 typed-approve=$FP2   FP3 explicit-Run=$FP3"
say ""

pass=0; fail=0
gate(){ if [ "$2" = "1" ]; then say "  PASS  $1 — $3"; pass=$((pass+1)); else say "  FAIL  $1 — $3"; fail=$((fail+1)); fi; }
post(){ curl -s --max-time 300 -X POST -H "X-Olumi-Assist-Key: $KEY" -H 'Content-Type: application/json' -d "$2" "$BASE$1"; }
jqv(){ printf '%s' "$1" | jq -r "$2" 2>/dev/null; }

SCEN=$(uuidgen | tr 'A-Z' 'a-z')
say "scenario: $SCEN"
BRIEF='We are choosing between three go-to-market moves for next year: expand the outbound sales team by six reps, invest the same budget in a self-serve product-led motion, or partner with two systems integrators to resell. Budget is £900k either way and we want to add £3m of new ARR within eighteen months.'

say "1) fresh brief"
T0=$(date +%s)
R1=$(post /agent/v1/turn "$(jq -nc --arg s "$SCEN" --arg m "$BRIEF" '{scenario_id:$s,message:$m}')")
EL=$(( $(date +%s) - T0 ))
ANTH=$(jqv "$R1" '[._provider_calls[]?|select(.provider=="anthropic")]|length')
OAI=$(jqv "$R1" '[._provider_calls[]?|select(.provider=="openai")]|length')
CHIP=$(jqv "$R1" '[.suggested_actions[]?|.id]|join(",")')
say "   ${EL}s · openai=${OAI:-0} anthropic=${ANTH:-0} · chips=${CHIP:-none}"
gate "brief returns a model" "$([ "$(jqv "$R1" '[.analysis_ready.options[]?]|length')" -gt 0 ] && echo 1 || echo 0)" "$(jqv "$R1" '[.analysis_ready.options[]?]|length') options"
gate "provider purity (0 anthropic)" "$([ "${ANTH:-0}" = "0" ] && echo 1 || echo 0)" "anthropic calls=${ANTH:-0}"
gate "truncation key absent (omitted when false)" "$(jqv "$R1" 'has("_provider_calls_truncated")|if . then 0 else 1 end')" "presence is the only sound test"
gate "no implicit analysis on the build turn" "$(jqv "$R1" 'has("analysis_result")|if . then 0 else 1 end')" "analysis_result must be absent"

# The typed approve chip carries the proposal's identity.
APPROVE=$(jqv "$R1" '[.suggested_actions[]?|select(.id|startswith("agent-approve-proposal:"))|.id]|first')
if [ -z "$APPROVE" ] || [ "$APPROVE" = "null" ]; then
  say "2) asking for starting assumptions (the brief offered no typed approve chip yet)"
  R2=$(post /agent/v1/turn "$(jq -nc --arg s "$SCEN" '{scenario_id:$s,message:"Suggest starting values for everything this model still needs, so I can approve them.",chip:{id:"agent-suggest-starting-point"}}')")
  APPROVE=$(jqv "$R2" '[.suggested_actions[]?|select(.id|startswith("agent-approve-proposal:"))|.id]|first')
fi
gate "a typed approve chip is offered" "$([ -n "$APPROVE" ] && [ "$APPROVE" != "null" ] && echo 1 || echo 0)" "${APPROVE:-none}"

if [ -n "$APPROVE" ] && [ "$APPROVE" != "null" ]; then
  H_BEFORE=$(jqv "$(post "/assist/v1/scenarios/$SCEN/graph" '{}')" '.analysis_state.graph_hash // .graph_hash')

  say "3) NEGATIVE: a well-formed but non-existent typed target must change nothing"
  RN=$(post /agent/v1/turn "$(jq -nc --arg s "$SCEN" '{scenario_id:$s,message:"Yes, use those.",chip:{id:"agent-approve-proposal:prop_dededededededededededededededede"}}')")
  H_AFTER_BAD=$(jqv "$(post "/assist/v1/scenarios/$SCEN/graph" '{}')" '.analysis_state.graph_hash // .graph_hash')
  NCALLS=$(jqv "$RN" '[._provider_calls[]?]|length')
  gate "bad target: 0 model calls" "$([ "${NCALLS:-1}" = "0" ] && echo 1 || echo 0)" "calls=${NCALLS:-?}"
  gate "bad target: 0 writes" "$([ "$H_BEFORE" = "$H_AFTER_BAD" ] && echo 1 || echo 0)" "graph hash unchanged"
  gate "bad target: refused by name" "$(jqv "$RN" '[._agent.tool_calls[]?|select(.refusal=="unknown_proposal")]|length|if .>0 then 1 else 0 end')" "expects unknown_proposal"

  say "4) the real typed approval"
  T0=$(date +%s); RA=$(post /agent/v1/turn "$(jq -nc --arg s "$SCEN" --arg c "$APPROVE" '{scenario_id:$s,message:"Yes, use those.",chip:{id:$c}}')"); EL=$(( $(date +%s) - T0 ))
  H_AFTER=$(jqv "$(post "/assist/v1/scenarios/$SCEN/graph" '{}')" '.analysis_state.graph_hash // .graph_hash')
  ACALLS=$(jqv "$RA" '[._provider_calls[]?]|length')
  say "   ${EL}s · provider calls=${ACALLS:-?}"
  gate "approve: 0 model calls" "$([ "${ACALLS:-1}" = "0" ] && echo 1 || echo 0)" "calls=${ACALLS:-?}"
  gate "approve: applied exactly once" "$([ "$H_BEFORE" != "$H_AFTER" ] && echo 1 || echo 0)" "hash advanced"
  gate "approve: no implicit Run" "$(jqv "$RA" 'has("analysis_result")|if . then 0 else 1 end')" "analysis_result must be absent"
  # ⚠ `may_run` is computed PER TURN and is never persisted, so it can only be read
  # from the turn response — a graph read cannot answer it. When this gate fails, the
  # reason matters more than the flag, so print what the same payload says is missing.
  MAYRUN=$(jqv "$RA" '.analysis_ready.may_run')
  gate "approve: model becomes runnable" "$([ "$MAYRUN" = "true" ] && echo 1 || echo 0)" "may_run=$MAYRUN"
  if [ "$MAYRUN" != "true" ]; then
    say "        status=$(jqv "$RA" '.analysis_ready.status') mode=$(jqv "$RA" '.analysis_ready.analysis_admission.permitted_analysis_mode')"
    say "        blockers:"
    printf '%s' "$RA" | jq -r '.analysis_ready.blockers[]? | "          \(.blocker_type // "?"): \(.message // "?")"' 2>/dev/null | head -8
    say "        admission reasons:"
    printf '%s' "$RA" | jq -r '.analysis_ready.analysis_admission.reasons[]? | "          \(.code // "?"): \(.message // "?")"' 2>/dev/null | head -6
    say "        options still not ready:"
    printf '%s' "$RA" | jq -r '.analysis_ready.options[]? | select(.status != "ready") | "          \(.option_id): \(.status) — \(.status_reason // "?")"' 2>/dev/null | head -6
  fi

  say "5) REPLAY the same chip — must be idempotent"
  RR=$(post /agent/v1/turn "$(jq -nc --arg s "$SCEN" --arg c "$APPROVE" '{scenario_id:$s,message:"Yes, use those.",chip:{id:$c}}')")
  H_REPLAY=$(jqv "$(post "/assist/v1/scenarios/$SCEN/graph" '{}')" '.analysis_state.graph_hash // .graph_hash')
  gate "replay: no second apply" "$([ "$H_AFTER" = "$H_REPLAY" ] && echo 1 || echo 0)" "hash identical"
  gate "replay: 0 model calls" "$([ "$(jqv "$RR" '[._provider_calls[]?]|length')" = "0" ] && echo 1 || echo 0)" "calls=$(jqv "$RR" '[._provider_calls[]?]|length')"
fi

# ⭐ THE JOURNEY DOES NOT END AT `may_run`. Measured on served c6393cf: five approved
# scenarios were all `may_run: true` with `mode: comparative_leader`, yet ONE had the
# engine decline the run ("List-price change would be silently rescaled"). Readiness can
# promise a run the engine then refuses, so the only honest gate is to RUN it and read
# what came back. This uses the ordinary Agent path, which works on every build — FP3
# only changes how the Run is routed, not whether it can run.
#
# ⚠ Do NOT probe top-level `analysis_result` for "did it run": measured absent on 4 of 4
# turns whose prose carried real figures ("leads in 77% of simulated runs"). The
# interpretation is the evidence.
say "6) explicit Run through the Agent (works on every build)"
T0=$(date +%s)
RUN1=$(post /agent/v1/turn "$(jq -nc --arg s "$SCEN" '{scenario_id:$s,message:"Run the analysis and tell me what it shows."}')")
EL=$(( $(date +%s) - T0 ))
RTXT=$(jqv "$RUN1" '.assistant_text // ""')
RTOOLS=$(jqv "$RUN1" '[._agent.tool_calls[]?|.name]|join(",")')
say "   ${EL}s · tools=${RTOOLS:-none} · $(printf '%s' "$RTXT" | wc -c | tr -d ' ') chars"
gate "Run: run_analysis was called" "$(printf '%s' "$RTOOLS" | grep -q run_analysis && echo 1 || echo 0)" "tools=${RTOOLS:-none}"
gate "Run: a substantive interpretation came back" "$([ "$(printf '%s' "$RTXT" | wc -c | tr -d ' ')" -gt 200 ] && echo 1 || echo 0)" "$(printf '%s' "$RTXT" | wc -c | tr -d ' ') chars"
# A declined run is a legitimate outcome, but the user must be TOLD, not left guessing.
if printf '%s' "$RTXT" | grep -qiE "declin|could not run|cannot run|unable to run"; then
  say "   NOTE: the engine DECLINED this run and said so. That is honest, not a failure —"
  say "         but it means `may_run: true` promised a run the engine then refused."
  say "         first two lines of what the user is told:"
  printf '%s' "$RTXT" | head -2 | sed 's/^/           /'
else
  say "   the run produced an interpretation; first two lines:"
  printf '%s' "$RTXT" | head -2 | sed 's/^/           /'
fi
say ""

if [ "$FP3" = "yes" ]; then
  say "7) the same Run through FP3's typed chip (FP3 is on the served build)"
  T0=$(date +%s); RUN=$(post /agent/v1/turn "$(jq -nc --arg s "$SCEN" '{scenario_id:$s,message:"Run the analysis.",chip:{id:"agent-run-analysis",action_type:"run_analysis"}}')"); EL=$(( $(date +%s) - T0 ))
  RCALLS=$(jqv "$RUN" '[._provider_calls[]?]|length')
  say "   ${EL}s · provider calls=${RCALLS:-?}"
  gate "Run: exactly ONE interpreting call" "$([ "${RCALLS:-0}" = "1" ] && echo 1 || echo 0)" "calls=${RCALLS:-?}"
  gate "Run: produces an interpretation" "$([ "$(jqv "$RUN" '.assistant_text|length')" -gt 0 ] && echo 1 || echo 0)" "$(jqv "$RUN" '.assistant_text|length') chars"
else
  say "7) FP3's typed Run chip — SKIPPED, FP3 is not on the served build (typedRunOf absent)"
fi

say ""
say "==== $pass passed · $fail failed · served $SERVED ===="
say "scenario for follow-up: $SCEN"
[ "$fail" = "0" ] || exit 1
