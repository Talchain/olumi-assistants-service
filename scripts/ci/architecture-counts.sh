#!/usr/bin/env bash
#
# Architecture counts: SHRINK-ONLY (Paul, 14 Oct 2026: stop per-journey mechanisms).
#
# Each journey kept getting its own mechanism: a bespoke `propose_*` agent tool, a new member on the CAS write door, a
# new drafter output field. Prose rules did not stop it, so the REQUIRED merge check refuses any INCREASE. Each count
# below is derived from source by the exact pattern documented beside it, and compared with the committed baseline
# (scripts/ci/architecture-counts.baseline, lines `name=value`).
#
#   exit 0  every count is at or below its baseline (a fall prints "lower the baseline to <now> in this PR")
#   exit 1  a count ROSE above its baseline
#   exit 2  a pattern BROKE (it found 0, a block marker or spread could not be found, or a self-check disagreed):
#           a 0 means the pattern no longer sees the code, never that the count fell. Fix the pattern in this PR.
#
# THE COUNTS (each "key" is an object/type member, read by the KEYS tokenizer below, which skips strings and comments
# and tracks {}/()/[] nesting; a member's "owner chain" is the dot-joined keys of the objects it sits inside):
#   agent_tools             src/orchestrator-v5/agent-lane/runtime/agent-tools.ts, the `export const AGENT_TOOLS` array
#                           (its opening line to the first `];`): distinct tool names on a tool object's own `name:` line,
#                           ^    (type: 'function', )?name: '<snake_case>'
#                           SELF-CHECK: equals the number of tool objects in the array (objects with a top-level `name`).
#   user_statement_tools    tests/contract/statement-door-tools.guard.test.ts: quoted entries of `const USER_STATEMENT_TOOLS = [`
#   user_statement_args     the same file: quoted entries of `const USER_STATEMENT_ARGS = [`
#   cas_door_members        src/orchestrator-v5/system-events/dispatch.ts, `export type CommitOptionLevelsInput = {` to the
#                           first `};`: its top-level members (the in-process CAS door `commitOptionLevelsInProcess` takes
#                           this type; a new member = a new save path through the door).
#   door_write_members      src/orchestrator-v5/statement-door/write.ts, `export type DoorWriteMember =` to the first line
#                           ending `;`: the quoted members of the union (the carriers the ONE statement door may write).
#   drafter_fields          src/orchestrator-v5/agent-lane/runtime/build-model.ts, `buildCandidateSchema()` from its
#                           `  return obj({` to the function's closing `}`: the top-level output properties.
#   drafter_node_fields     the same schema: the direct properties of each node kind, summed: `goal`, `factors[]`,
#                           `risks[]`, `outcomes[]` (owner chains goal, factors.items, risks.items, outcomes.items).
#   drafter_option_fields   the same schema: the direct properties of an option (`options[]`, owner chain options.items).
#   drafter_link_fields     the same schema: the direct properties of a link (`links[]`, owner chain links.items).
#   A spread (`...NAME`) at a counted level counts the top-level keys of `const NAME = {` in the same file.
#
# NOT HERE (run as their own specs in the same required job): the provenance direct-read ratchet
# (src/cee/provenance/__tests__/provenance-reads-guard.test.ts) and the statement-door FREEZE
# (tests/contract/statement-door-tools.guard.test.ts, which also fails on any new `propose_*` name).
#
# Dependencies: bash + POSIX awk only. Runs in well under 2 s.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT" || exit 2

BASELINE="scripts/ci/architecture-counts.baseline"
TOOLS_FILE="src/orchestrator-v5/agent-lane/runtime/agent-tools.ts"
DOOR_GUARD="tests/contract/statement-door-tools.guard.test.ts"
DISPATCH_FILE="src/orchestrator-v5/system-events/dispatch.ts"
DOOR_WRITE_FILE="src/orchestrator-v5/statement-door/write.ts"
DRAFTER_FILE="src/orchestrator-v5/agent-lane/runtime/build-model.ts"

export LC_ALL=C
BROKEN=0
broken() { echo "::error::Architecture counts: a pattern broke: $*"; BROKEN=1; }

# block FILE START_ERE END_ERE: the lines from the first START match through the first END match at or after it.
block() {
  S="$2" E="$3" awk 'BEGIN { s = ENVIRON["S"]; e = ENVIRON["E"] }
    !f && $0 ~ s { f = 1 }
    f { print; if ($0 ~ e) { done = 1; exit } }
    END { exit done ? 0 : 1 }' "$1"
}

# KEYS: reads TypeScript on stdin, prints "<owner chain>|<key>" for every member of an object literal or type literal
# ("" chain = the block's outermost objects). Strings, template literals and comments are skipped; `readonly`, `?` and
# shorthand properties are understood; a spread prints as "...NAME".
# (A single-quoted assignment, not a heredoc in $(...): bash 3.2 misparses a quote inside that. "\047" is the quote.)
KEYS_AWK='
function top_obj() { return sp > 0 && kind[sp] == "{" }
function emit(k) { if (!top_obj()) return; lastkey[sp] = k; print chain[sp] "|" k }
function open_obj(   e, ch) {
  e = sp; while (e > 0 && kind[e] != "{") e--
  ch = (e == 0) ? "" : (chain[e] == "" ? lastkey[e] : chain[e] "." lastkey[e])
  sp++; kind[sp] = "{"; chain[sp] = ch; lastkey[sp] = ""
}
BEGIN { sp = 0; incomment = 0; inq = ""; keypos = 0; cand = "" }
{
  line = $0; n = length(line); i = 1
  while (i <= n) {
    c = substr(line, i, 1)
    if (incomment) { j = index(substr(line, i), "*/"); if (j == 0) break; i += j + 1; incomment = 0; continue }
    if (inq != "") {
      if (c == "\\") { i += 2; continue }
      if (c == inq) { inq = ""; if (strkey) cand = strbuf; i++; continue }
      if (strkey) strbuf = strbuf c
      i++; continue
    }
    if (c == " " || c == "\t" || c == "\r") { i++; continue }
    if (c == "/" && substr(line, i + 1, 1) == "/") break
    if (c == "/" && substr(line, i + 1, 1) == "*") { incomment = 1; i += 2; continue }
    if (c == "\047" || c == "\"" || c == "`") {
      inq = c; strkey = (keypos && top_obj()); strbuf = ""; keypos = 0; cand = ""; i++; continue
    }
    if (c ~ /[A-Za-z_$]/) {
      match(substr(line, i), /^[A-Za-z_$][A-Za-z0-9_$]*/); id = substr(line, i, RLENGTH); i += RLENGTH
      if (keypos && top_obj()) {
        if (id == "readonly" && cand == "") cand = id
        else { cand = id; keypos = 0 }
      } else { cand = ""; keypos = 0 }
      continue
    }
    if (c ~ /[0-9]/) { match(substr(line, i), /^[0-9.]+/); i += RLENGTH; cand = ""; keypos = 0; continue }
    if (c == ".") {
      if (substr(line, i, 3) == "..." && keypos && top_obj()) {
        i += 3; match(substr(line, i), /^[A-Za-z_$][A-Za-z0-9_$]*/)
        if (RLENGTH > 0) { emit("..." substr(line, i, RLENGTH)); i += RLENGTH }
        cand = ""; keypos = 0; continue
      }
      cand = ""; keypos = 0; i++; continue
    }
    if (c == "{") { cand = ""; open_obj(); keypos = 1; i++; continue }
    if (c == "(" || c == "[") { cand = ""; sp++; kind[sp] = c; keypos = 0; i++; continue }
    if (c == "}") { if (cand != "") emit(cand); cand = ""; if (sp > 0) sp--; keypos = 0; i++; continue }
    if (c == ")" || c == "]") { cand = ""; if (sp > 0) sp--; keypos = 0; i++; continue }
    if (c == "," || c == ";") { if (cand != "") emit(cand); cand = ""; keypos = top_obj(); i++; continue }
    if (c == ":") { if (cand != "") emit(cand); cand = ""; keypos = 0; i++; continue }
    if (c == "?") { if (cand == "") keypos = 0; i++; continue }
    cand = ""; keypos = 0; i++
  }
}
'
keys() { awk "$KEYS_AWK"; }

# count_at FILE TOKENS CHAIN: members at exactly that owner chain; a spread counts its const's top-level keys.
count_at() {
  local file="$1" toks="$2" want="$3" n=0 ch k name sub sk
  while IFS='|' read -r ch k; do
    [ "$ch" = "$want" ] || continue
    case "$k" in
      ...*)
        name="${k#...}"
        if ! sub=$(block "$file" "^(export )?const ${name} = [{]\$" '^[}]( as const)?;$'); then
          broken "spread ...${name} at '${want}' in ${file}: no 'const ${name} = {' block in that file"; continue
        fi
        if printf '%s\n' "$sub" | keys | awk -F'|' '$1 == "" && $2 ~ /^\.\.\./ { f = 1 } END { exit f ? 0 : 1 }'; then
          broken "spread ...${name} at '${want}' in ${file} itself spreads another object: count it by hand and extend this pattern"
        fi
        sk=$(printf '%s\n' "$sub" | keys | awk -F'|' '$1 == "" { n++ } END { print n + 0 }')
        n=$((n + sk)) ;;
      *) n=$((n + 1)) ;;
    esac
  done <<<"$toks"
  echo "$n"
}

COUNTS=""
put() { COUNTS="${COUNTS}$1=$2"$'\n'; }

# ── agent_tools ───────────────────────────────────────────────────────────────────────────────────────────────────────
if TOOLS_BLOCK=$(block "$TOOLS_FILE" '^export const AGENT_TOOLS: readonly ToolDefinition\[\] = \[$' '^\];$'); then
  tool_names=$(printf '%s\n' "$TOOLS_BLOCK" | grep -oE "^    (type: 'function', )?name: '[a-z_]+'" | sed -E "s/.*name: '([a-z_]+)'/\1/" | sort -u | awk 'END { print NR }')
  tool_objects=$(printf '%s\n' "$TOOLS_BLOCK" | keys | awk -F'|' '$1 == "" && $2 == "name" { n++ } END { print n + 0 }')
  if [ "$tool_names" != "$tool_objects" ]; then
    broken "agent_tools: ${tool_names} tool names on a tool object's own name line, but ${tool_objects} tool objects in AGENT_TOOLS (${TOOLS_FILE}). Keep each tool's name on its own '    name: ...' line."
  fi
  put agent_tools "$tool_names"
else
  broken "agent_tools: no 'export const AGENT_TOOLS: readonly ToolDefinition[] = [' ... '];' block in ${TOOLS_FILE}"
  put agent_tools 0
fi

# ── user_statement_tools / user_statement_args ────────────────────────────────────────────────────────────────────────
for pair in "user_statement_tools:USER_STATEMENT_TOOLS" "user_statement_args:USER_STATEMENT_ARGS"; do
  cname="${pair%%:*}"; const="${pair#*:}"
  if LIST=$(block "$DOOR_GUARD" "^const ${const} = \\[" '\];'); then
    put "$cname" "$(printf '%s\n' "$LIST" | sed -E "s/^const ${const} = //" | grep -oE "'[a-z_]+'" | awk 'END { print NR }')"
  else
    broken "${cname}: no 'const ${const} = [' ... '];' in ${DOOR_GUARD}"; put "$cname" 0
  fi
done

# ── cas_door_members ──────────────────────────────────────────────────────────────────────────────────────────────────
if grep -qE '^export async function commitOptionLevelsInProcess\(input: CommitOptionLevelsInput,' "$DISPATCH_FILE" \
  && DOOR_BLOCK=$(block "$DISPATCH_FILE" '^export type CommitOptionLevelsInput = [{]$' '^[}];$'); then
  put cas_door_members "$(count_at "$DISPATCH_FILE" "$(printf '%s\n' "$DOOR_BLOCK" | keys)" "")"
else
  broken "cas_door_members: commitOptionLevelsInProcess no longer takes 'export type CommitOptionLevelsInput = {' ... '};' in ${DISPATCH_FILE}"
  put cas_door_members 0
fi

# ── door_write_members ────────────────────────────────────────────────────────────────────────────────────────────────
if UNION=$(block "$DOOR_WRITE_FILE" '^export type DoorWriteMember =' ';$'); then
  put door_write_members "$(printf '%s\n' "$UNION" | sed -E 's/^export type DoorWriteMember =//' | grep -oE "'[a-z_]+'" | awk 'END { print NR }')"
else
  broken "door_write_members: no 'export type DoorWriteMember =' union in ${DOOR_WRITE_FILE}"; put door_write_members 0
fi

# ── drafter_* ─────────────────────────────────────────────────────────────────────────────────────────────────────────
SCHEMA_BLOCK=$(awk '/^export function buildCandidateSchema\(\)/ { f = 1 } f && /^  return obj\(\{/ { g = 1 } g { print; if ($0 ~ /^}$/) { done = 1; exit } } END { exit done ? 0 : 1 }' "$DRAFTER_FILE")
schema_ok=$?
if [ "$schema_ok" -eq 0 ] && grep -qF 'schema: strictForTheDrafter(buildCandidateSchema()' "$DRAFTER_FILE"; then
  ST=$(printf '%s\n' "$SCHEMA_BLOCK" | keys)
  put drafter_fields "$(count_at "$DRAFTER_FILE" "$ST" "")"
  node_sum=0; node_detail=""
  for ch in goal factors.items risks.items outcomes.items; do
    c=$(count_at "$DRAFTER_FILE" "$ST" "$ch"); node_sum=$((node_sum + c)); node_detail="${node_detail} ${ch}=${c}"
    [ "$c" -gt 0 ] || broken "drafter_node_fields: 0 properties at '${ch}' in buildCandidateSchema (${DRAFTER_FILE})"
  done
  put drafter_node_fields "$node_sum"
  put drafter_option_fields "$(count_at "$DRAFTER_FILE" "$ST" options.items)"
  put drafter_link_fields "$(count_at "$DRAFTER_FILE" "$ST" links.items)"
else
  broken "drafter_*: no 'export function buildCandidateSchema()' with '  return obj({' ... '}', or the drafter call no longer sends strictForTheDrafter(buildCandidateSchema()), in ${DRAFTER_FILE}"
  for n in drafter_fields drafter_node_fields drafter_option_fields drafter_link_fields; do put "$n" 0; done
  node_detail=""
fi

# ── compare with the baseline ─────────────────────────────────────────────────────────────────────────────────────────
if [ ! -f "$BASELINE" ]; then echo "::error::Missing baseline file: ${BASELINE}"; exit 2; fi

ROSE=0
printf '%-24s %6s %9s\n' "Architecture count" "now" "baseline"
while IFS='=' read -r name now; do
  [ -n "$name" ] || continue
  base=$(awk -F'=' -v k="$name" '$1 == k { print $2; found = 1; exit } END { if (!found) print "" }' "$BASELINE")
  printf '%-24s %6s %9s\n' "$name" "$now" "${base:-MISSING}"
  if [ "$now" = "0" ]; then broken "${name} found 0: the pattern no longer sees the code (a 0 is never a fall)"; continue; fi
  if [ -z "$base" ]; then broken "${name} has no line in ${BASELINE}"; continue; fi
  if [ "$now" -gt "$base" ]; then
    echo "::error::Architecture count ${name} rose ${base} → ${now}. Extend the existing mechanism instead (SYSTEMS-REPLAN). If this increase is genuinely necessary, raise the baseline in THIS PR; the DL reports every rise to Paul."
    ROSE=1
  elif [ "$now" -lt "$base" ]; then
    echo "Architecture count ${name} fell ${base} → ${now}: lower the baseline to ${now} in this PR."
  fi
done <<<"$COUNTS"
[ -z "$node_detail" ] || echo "(drafter_node_fields =${node_detail})"

# A baseline line for a count this script no longer computes is a broken pattern too.
while IFS='=' read -r name _; do
  case "$name" in ''|'#'*) continue ;; esac
  printf '%s' "$COUNTS" | grep -q "^${name}=" || broken "${BASELINE} names '${name}', which this script does not compute"
done <"$BASELINE"

if [ "$BROKEN" -ne 0 ]; then exit 2; fi
if [ "$ROSE" -ne 0 ]; then exit 1; fi
echo "Architecture counts: none above baseline."
exit 0
