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
# ⭐ OR, WITHOUT CHECKING THIS BRANCH OUT — the invocation to use on a machine
# where iCloud has evicted part of the repo, because `git fetch` HANGS on a
# dataless object (measured: it hung indefinitely in the working tree at
# ~/Documents/GitHub/olumi-assistants-service). `gh api` needs no local git:
#
#   gh api "repos/Talchain/olumi-assistants-service/contents/scripts/witness/morning-check.sh?ref=morning-check" \
#     --jq .content | base64 -d > /tmp/olumi-morning-check.sh
#   ENVF=/Users/<you>/Documents/GitHub/olumi-assistants-service/.env.staging.local \
#     bash /tmp/olumi-morning-check.sh
#
# Both forms are tested end to end against served 6dfb56f. `ENVF` must be passed
# explicitly in the second form: `$0` is the temp path, so the default relative
# lookup below would miss.
#
# Needs ASSIST_API_KEY in olumi-assistants-service/.env.staging.local, plus `gh`
# and `jq`.
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
# ⛔ A STRUCTURAL REFUSAL IS A DEFECT, NOT A LEGITIMATE OUTCOME.
#
# "needs more values" is the product working — the user supplies them. A CIRCULAR
# DEPENDENCY is different in kind: it is decided at CONSTRUCTION, and the user only
# meets it after paying the whole journey (brief, suggested assumptions, one
# approval). Measured on served 6dfb56f: the A2 churn-cause brief came back "The
# analysis is currently blocked by a circular dependency in the model, so it cannot
# yet calculate a defensible ordering of the four paths." 1 of 4 briefs.
#
# The asymmetry that makes it a defect: `graph-structure-validator.ts:184` REFUSES
# an edit that "would create a circular dependency", and `:185` reports one during
# analysis — but construction never runs that check, so a first model is allowed to
# be born with the condition an edit is forbidden from creating.
#
# Gated separately from the interpretation check, because that one passes on a
# blocked run: a paragraph explaining the block IS substantive prose.
gate "Run: not blocked by a model-structure defect" \
  "$(printf '%s' "$RTXT" | grep -qiE "circular dependenc|cyclic|dependency cycle" && echo 0 || echo 1)" \
  "a cycle is decided at construction and costs the user the whole journey"

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

# ⭐ RELOAD PRESERVES CURRENTNESS — a named item on RC's shared test gate that
# nothing here tested until now. Read from the PERSISTED graph, not the turn:
# `analysis_ready`/`may_run` are computed per turn and never stored, but
# `analysis_result` and `analysis_state` ARE, and they carry the currentness
# instruments the product uses itself.
say "6b) reload — the analysis is still current against the model"
RELOAD=$(post "/assist/v1/scenarios/$SCEN/graph" '{}')
R_STATE=$(jqv "$RELOAD" '.analysis_state.run_state.kind // "absent"')
R_RERUN=$(jqv "$RELOAD" '.analysis_state.requires_rerun')
R_AGAINST=$(jqv "$RELOAD" '.analysis_result.computed_against_hash // ""')
R_HASH=$(jqv "$RELOAD" '.graph_hash // ""')
say "   run_state=$R_STATE requires_rerun=$R_RERUN computed_against=${R_AGAINST:0:16} graph_hash=${R_HASH:0:16}"
gate "reload: the run persisted" "$(jqv "$RELOAD" 'has("analysis_result") and (.analysis_result != null)|if . then 1 else 0 end')" "analysis_result survives a reload"
gate "reload: run_state is complete_current" "$([ "$R_STATE" = "complete_current" ] && echo 1 || echo 0)" "got $R_STATE"
gate "reload: no rerun required" "$([ "$R_RERUN" = "false" ] && echo 1 || echo 0)" "requires_rerun=$R_RERUN"
# ⛔ THE ACTUAL CURRENTNESS INVARIANT, not a proxy: the analysis records which model
# it was computed against. If that drifts from the live hash the result is stale,
# whatever run_state says.
gate "reload: analysis was computed against THIS model" \
  "$([ -n "$R_AGAINST" ] && [ "$R_AGAINST" = "$R_HASH" ] && echo 1 || echo 0)" \
  "computed_against_hash must equal graph_hash"

# ⭐ CLAIM SAFETY: the structured gate and the prose must not disagree.
# Measured on served 6dfb56f: `leader_claim` came back
# {permitted: false, withheld_reason: "options_do_not_separate", separation: "near_tie"}
# while `analysis_result.leading_option_id` WAS populated. A surface that renders
# the leading option without consulting `leader_claim.permitted` would show a winner
# the gate withheld — the leak shape this estate has hit before (a producer sending
# "robust" while the same panel forbade the word). So when the claim is withheld,
# the words the user reads must carry the hedge, not drop it silently.
PERMITTED=$(jqv "$RELOAD" '.analysis_state.leader_claim.permitted')
WITHHELD=$(jqv "$RELOAD" '.analysis_state.leader_claim.withheld_reason // "-"')
LEADING=$(jqv "$RELOAD" '.analysis_result.leading_option_id // "-"')
SUMMARY=$(jqv "$RELOAD" '.analysis_result.summary // ""')
say "   leader_claim.permitted=$PERMITTED withheld=$WITHHELD leading_option_id=$LEADING"
if [ "$PERMITTED" = "false" ]; then
  HEDGED=$(printf '%s %s' "$SUMMARY" "$RTXT" | grep -ciE "close call|not (yet )?robust|near tie|could flip|too fragile|do(es)? not separate|not a meaningful ordering|fragile|not enough confidence" || true)
  gate "claim safety: a WITHHELD leader is hedged in the words, not dropped" \
    "$([ "${HEDGED:-0}" -gt 0 ] && echo 1 || echo 0)" \
    "leader withheld ($WITHHELD) while leading_option_id=$LEADING — the prose must say so"
  say "   summary: $(printf '%s' "$SUMMARY" | head -c 150)"
else
  say "   leader claim permitted, so no withholding to communicate"
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

# ⛔⛔ THE TURN AFTER THE RUN. This witness ran the Run LAST, so it never took another
# turn — and that is exactly where CEE #1809's served P0 lands: fast path 3 saved only
# the interpreting call's `message` items into the conversation of record and dropped
# the `reasoning` item each belongs to, so the NEXT turn is refused
#   openai_400: Item 'msg_…' of type 'message' was provided without its required
#               'reasoning' item: 'rs_…'
# and the user gets HTTP 502 UPSTREAM_ERROR, losing the conversation. Witness c9-f828a61
# hit it in both journeys.
#
# My own six-dimension review of #1786 FOUND this mechanism and filed it non-blocking,
# and this witness then went 24/24 green over a build that had it. A journey check whose
# last step is the thing under test cannot see what the thing under test breaks. So the
# journey now continues past the Run, always.
say "8) the turn AFTER the Run — the conversation must survive it"
T0=$(date +%s)
AFTER=$(post /agent/v1/turn "$(jq -nc --arg s "$SCEN" '{scenario_id:$s,message:"Which assumption would change that conclusion most?"}')")
EL=$(( $(date +%s) - T0 ))
A_ERR=$(jqv "$AFTER" '.error // ""')
A_TXT=$(jqv "$AFTER" '.assistant_text // ""')
say "   ${EL}s · error=${A_ERR:-none} · $(printf '%s' "$A_TXT" | wc -c | tr -d ' ') chars"
gate "after the Run: the turn is not refused" "$([ -z "$A_ERR" ] && echo 1 || echo 0)" "error=${A_ERR:-none}"
gate "after the Run: a substantive answer came back" "$([ "$(printf '%s' "$A_TXT" | wc -c | tr -d ' ')" -gt 120 ] && echo 1 || echo 0)" "$(printf '%s' "$A_TXT" | wc -c | tr -d ' ') chars"
if [ -n "$A_ERR" ]; then
  say "   ⛔ CEE #1809 is the fix for this. What the turn returned:"
  printf '%s' "$AFTER" | jq -r '.detail // .message // "(no detail)"' 2>/dev/null | head -3 | sed 's/^/        /'
fi
say ""

say "==== $pass passed · $fail failed · served $SERVED ===="
say "scenario for follow-up: $SCEN"
[ "$fail" = "0" ] || exit 1
