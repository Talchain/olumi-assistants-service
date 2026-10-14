#!/usr/bin/env bash
# D5-B rehearsal (B0): psql-driven checks of D5-B-MIGRATION.sql / D5-B-ROLLBACK.sql against the recorded live
# delegates, on a DISPOSABLE Postgres (the GitHub Actions service container). Never the shared Supabase.
# Every case prints PASS or FAIL; the script exits 1 on any FAIL. A failing case is never loosened.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="${B0_OUT:-$PWD/d5-b0-out}"
mkdir -p "$OUT_DIR"
RES="$OUT_DIR/results.tsv"; LOG="$OUT_DIR/detail.log"; : >"$RES"; : >"$LOG"
TMP="$(mktemp -d)"
MIG="$HERE/D5-B-MIGRATION.sql"; RB="$HERE/D5-B-ROLLBACK.sql"
FIX="$HERE/recorded-delegates.sql"; LIB="$HERE/b0-lib.sql"; FP="$HERE/live-fingerprints.tsv"

case "${PGHOST:-}" in
  localhost|127.0.0.1) ;;
  *) echo "REFUSING: PGHOST='${PGHOST:-}' is not the local disposable service container"; exit 2 ;;
esac

U1=11111111-1111-4111-8111-111111111111   # owner
U2=22222222-2222-4222-8222-222222222222   # another signed-in user
UM=33333333-3333-4333-8333-333333333333   # viewer member
D5SIG='public.append_agent_answer_with_construction_questions(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,jsonb,jsonb,text,jsonb,boolean,uuid,uuid,jsonb)'
D5NAME=append_agent_answer_with_construction_questions

NPASS=0; NFAIL=0; FINISHED=0
pass() { NPASS=$((NPASS + 1)); printf 'PASS\t%s\t%s\n' "$1" "$2" | tee -a "$RES"; }
fail() { NFAIL=$((NFAIL + 1)); printf 'FAIL\t%s\t%s\n' "$1" "$2" | tee -a "$RES"; }
log()  { printf '%s\n' "$*" >>"$LOG"; }
finish() {
  echo
  echo "== B0 SUMMARY: PASS=$NPASS FAIL=$NFAIL TOTAL=$((NPASS + NFAIL))"
  [ "$FINISHED" = 1 ] || echo "HARNESS INCOMPLETE: the script stopped before its last case"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    { echo "### D5 B0 rehearsal: PASS=$NPASS FAIL=$NFAIL"; [ "$FINISHED" = 1 ] || echo "**HARNESS INCOMPLETE**"
      echo; echo '| Result | Case | Detail |'; echo '|---|---|---|'
      awk -F'\t' '{d=$3; gsub(/\|/, "/", d); if (length(d) > 600) d = substr(d, 1, 600) "..."; printf "| %s | %s | %s |\n", $1, $2, d}' "$RES"
    } >>"$GITHUB_STEP_SUMMARY"
  fi
  rm -rf "$TMP"
}
trap finish EXIT

# ---------------------------------------------------------------------------------------------------------
# psql helpers
# ---------------------------------------------------------------------------------------------------------
DB=b0
q()  { psql -X -q -t -A -v ON_ERROR_STOP=1 -d "$DB" -c "$1" 2>>"$LOG"; }          # as postgres, on $DB
qq() { psql -X -q -t -A -v ON_ERROR_STOP=1 -d "$2" -c "$1" 2>>"$LOG"; }           # as postgres, on db $2
ROLE=service_role; PRE=""
# One call = one session = one transaction (as PostgREST runs one RPC). Sets RC OUT ERR STATE.
call() {
  local ef="$TMP/call.err"
  local args=(-X -q -t -A -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -d "$DB" -c "SET ROLE $ROLE")
  [ -n "$PRE" ] && args+=(-c "$PRE")
  args+=(-c "$1")
  OUT=$(psql "${args[@]}" 2>"$ef"); RC=$?
  ERR=$(tr '\n' ' ' <"$ef")
  STATE=$(grep -oE 'ERROR:  [0-9A-Z]{5}:' "$ef" | head -1 | cut -c9-13)
  log "[$DB] $ROLE> $1 :: rc=$RC state=$STATE out=${OUT:0:300} err=${ERR:0:400}"
}
apply_file() { # db file → APRC, APERR (whole file in ONE transaction, as the Supabase runner applies it)
  local ef="$TMP/apply.err"
  psql -X -q -1 -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -d "$1" -f "$2" >>"$LOG" 2>"$ef"; APRC=$?
  APERR=$(tr '\n' ' ' <"$ef"); log "[apply $1 $(basename "$2")] rc=$APRC err=${APERR:0:600}"
}

OK=0; MSG=""
chk() { if [ "$1" == "$2" ]; then MSG+="$3: ok; "; else MSG+="$3: expected [$2] got [$1]; "; OK=1; fi; }
run() { local id="$1"; shift; OK=0; MSG=""; "$@"; if [ "$OK" = 0 ]; then pass "$id" "$MSG"; else fail "$id" "$MSG"; fi; }
run_mutant() { # id db case-fn args… — PASS when the mutant turns the case red
  local id="$1" db="$2"; shift 2; local keep="$DB"; DB="$db"; OK=0; MSG=""; "$@"; DB="$keep"
  if [ "$OK" != 0 ]; then pass "$id" "mutant KILLED -> $MSG"; else fail "$id" "mutant SURVIVED -> $MSG"; fi
}

st()    { q "SELECT b0.st('$1')"; }
evmd5() { q "SELECT md5(events::text) FROM public.scenarios WHERE id = '$1'"; }

# d5ok S T HASH RECSQL [COND EXPECTEDSQL CALLERSQL GSQL OSQL KEYSQL NSQL]: the call succeeds and BOTH the
# answer row and its record are present, bound by identity (verify_written).
d5ok() {
  local S="$1" T="$2" H="$3" R="$4" C="${5:-false}" E="${6:-NULL}" W="${7:-NULL}" G="${8:-NULL}" O="${9:-NULL}" K="${10:-NULL}" N="${11:-NULL}"
  local seq0 rev0 v
  seq0=$(q "SELECT event_seq FROM public.scenarios WHERE id = '$S'")
  rev0=$(q "SELECT revision FROM public.scenarios WHERE id = '$S'")
  call "SELECT b0.d5('$S', '$T', '$H', $R, $C, $E, $W, $G, $O, $K, $N)"
  chk "$RC" 0 "$T rc"
  if [ "$RC" = 0 ]; then
    v=$(q "SELECT b0.verify_written('$S', '$T', '$H', $R, '$OUT'::jsonb, $seq0, $rev0, $G, $O, $K, $N)")
    chk "$v" ok "$T answer+record by identity"
  else
    MSG+="error: ${ERR:0:300}; "
  fi
}
# d5no S T SQLSTATE CALLSQL [MESSAGE-SUBSTRING]: the call raises, and NOTHING is written (state and events
# byte-identical, no answer row for T).
d5no() {
  local S="$1" T="$2" XS="$3" SQL="$4" SUB="${5:-}"
  local st0 ev0; st0=$(st "$S"); ev0=$(evmd5 "$S")
  call "$SQL"
  chk "$([ "$RC" != 0 ] && echo raised || echo "returned ${OUT:0:200}")" raised "$T raises"
  chk "$STATE" "$XS" "$T sqlstate"
  [ -n "$SUB" ] && chk "$(grep -cF -- "$SUB" <<<"$ERR")" 1 "$T message names '$SUB'"
  chk "$(st "$S")" "$st0" "$T state unchanged"
  chk "$(evmd5 "$S")" "$ev0" "$T events byte-identical"
  chk "$(q "SELECT count(*) FROM public.v5_conversation_turns WHERE scenario_id = '$S' AND turn_id = '$T'")" 0 "$T no answer row"
}
jget() { q "SELECT coalesce(('$1'::jsonb ->> '$2'), 'null')"; }

# ---------------------------------------------------------------------------------------------------------
# S: the files under test
# ---------------------------------------------------------------------------------------------------------
s_sha() {
  local line
  while read -r line; do log "sha256: $line"; done < <(sha256sum "$MIG" "$RB")
  chk "$(cd "$HERE" && sha256sum -c SHA256SUMS >/dev/null 2>&1 && echo match || echo MISMATCH)" match "SHA256SUMS"
  MSG+="migration=$(sha256sum "$MIG" | cut -c1-64); rollback=$(sha256sum "$RB" | cut -c1-64); "
}
s_static() {
  local m r; m=$(sed 's/--.*$//' "$MIG"); r=$(sed 's/--.*$//' "$RB")
  chk "$(grep -ciE '^[[:space:]]*CREATE[[:space:]]+FUNCTION' <<<"$m")" 1 "exactly one CREATE FUNCTION"
  chk "$(grep -ciE 'CREATE[[:space:]]+OR[[:space:]]+REPLACE' <<<"$m")" 0 "no CREATE OR REPLACE"
  chk "$(grep -ciE '^[[:space:]]*(ALTER|DROP|TRUNCATE|COMMENT[[:space:]]+ON[[:space:]]+(TABLE|COLUMN))[[:space:]]' <<<"$m")" 0 "no ALTER/DROP/TRUNCATE"
  chk "$(grep -ciE 'CREATE[[:space:]]+(UNIQUE[[:space:]]+)?(TABLE|INDEX|TRIGGER|POLICY|VIEW|TYPE|SCHEMA|EXTENSION|RULE|SEQUENCE)' <<<"$m")" 0 "no other CREATE"
  chk "$(grep -ciE '^[[:space:]]*GRANT[[:space:]]' <<<"$m")" 1 "one GRANT"
  chk "$(grep -ciE '^[[:space:]]*REVOKE[[:space:]]' <<<"$m")" 1 "one REVOKE"
  chk "$(grep -ciE '^[[:space:]]*DROP[[:space:]]+FUNCTION' <<<"$r")" 1 "rollback: one DROP FUNCTION"
  chk "$(grep -ciE '^[[:space:]]*(CREATE|ALTER|UPDATE|DELETE|INSERT|TRUNCATE|GRANT|REVOKE)[[:space:]]' <<<"$r")" 0 "rollback: nothing else"
}

# ---------------------------------------------------------------------------------------------------------
# FIX: the fixture reproduces live (md5 of pg_get_functiondef; ACL text)
# ---------------------------------------------------------------------------------------------------------
fix_server() { chk "$(qq "SHOW server_version_num" postgres | cut -c1-2)" 15 "server major (live is 15.8)"; MSG+="server=$(qq "SHOW server_version" postgres); "; }
fix_load() { chk "$FIXRC/$LIBRC" "0/0" "fixture/lib load rc"; }
fix_one() { # kind schema name md5 acl
  local kind="$1" schema="$2" name="$3" md5="$4" acl="$5" got
  if [ "$kind" = func ]; then
    got=$(qq "SELECT string_agg(md5(pg_get_functiondef(p.oid)), ',') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = '$schema' AND p.proname = '$name'" b0_tpl)
    chk "$got" "$md5" "md5(pg_get_functiondef) = live"
    if [ "$acl" != - ]; then
      chk "$(qq "SELECT p.proacl::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = '$schema' AND p.proname = '$name'" b0_tpl)" "$acl" "proacl = live"
    fi
  else
    chk "$(qq "SELECT c.relacl::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = '$schema' AND c.relname = '$name'" b0_tpl)" "$acl" "relacl = live"
  fi
}

# ---------------------------------------------------------------------------------------------------------
# A: apply
# ---------------------------------------------------------------------------------------------------------
a0_abort() { # the whole file inside one transaction that then aborts: nothing may remain
  qq "CREATE DATABASE b0_a0 TEMPLATE b0_tpl" postgres
  local ef="$TMP/a0.err"
  psql -X -q -1 -v ON_ERROR_STOP=1 -d b0_a0 -f "$MIG" -c "DO \$x\$ BEGIN RAISE EXCEPTION 'b0 forced abort after the migration'; END \$x\$" >>"$LOG" 2>"$ef"
  local rc=$?
  chk "$([ "$rc" != 0 ] && echo aborted || echo committed)" aborted "forced abort fails the transaction"
  chk "$(grep -cF 'b0 forced abort' "$ef")" 1 "it failed at the forced abort, after the whole migration ran"
  chk "$(qq "SELECT to_regprocedure('$D5SIG') IS NULL" b0_a0)" t "no D5 function remains"
  chk "$(qq "SELECT count(*) FROM pg_proc WHERE proname LIKE '%construction_questions%'" b0_a0)" 0 "no construction_questions function at all"
}
a1_missing_delegate() {
  qq "CREATE DATABASE b0_a1 TEMPLATE b0_tpl" postgres
  qq "DROP FUNCTION public.append_agent_answer_narrated(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,jsonb,jsonb,text,jsonb)" b0_a1
  apply_file b0_a1 "$MIG"
  chk "$([ "$APRC" != 0 ] && echo refused || echo applied)" refused "apply refused"
  chk "$(grep -cF 'an answer-writer delegate is missing' <<<"$APERR")" 1 "precondition names the missing delegate"
  chk "$(qq "SELECT to_regprocedure('$D5SIG') IS NULL" b0_a1)" t "nothing created"
}
a2_apply() {
  q "INSERT INTO b0.snap VALUES ('fn0', b0.fn_snapshot()), ('cat0', b0.cat_snapshot())"
  apply_file "$DB" "$MIG"
  chk "$APRC" 0 "psql --single-transaction -f D5-B-MIGRATION.sql"
  chk "$(q "SELECT to_regprocedure('$D5SIG') IS NOT NULL")" t "D5 function present"
  q "INSERT INTO b0.snap VALUES ('d5_def_md5', to_jsonb((SELECT md5(pg_get_functiondef(to_regprocedure('$D5SIG'))))))"
}
a3_nothing_else() {
  chk "$(q "SELECT b0.fn_snapshot('$D5NAME') = (SELECT val FROM b0.snap WHERE name = 'fn0')")" t "every pre-existing function body and ACL unchanged"
  chk "$(q "SELECT b0.cat_snapshot() = (SELECT val FROM b0.snap WHERE name = 'cat0')")" t "tables, columns, constraints, triggers, policies, indexes, default ACLs unchanged"
  chk "$(q "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('append_construction_questions_event', '$D5NAME')")" 1 "exactly one D5 function (round-1 helper absent)"
}
a4_attributes() {
  chk "$(q "SELECT format('secdef=%s vol=%s config=%s ret=%s nargs=%s acl=%s comment=%s', p.prosecdef, p.provolatile, array_to_string(p.proconfig, ';'), p.prorettype::regtype, p.pronargs, p.proacl::text, obj_description(p.oid, 'pg_proc') IS NOT NULL) FROM pg_proc p WHERE p.oid = to_regprocedure('$D5SIG')")" \
      "secdef=false vol=v config=search_path=pg_catalog, public ret=jsonb nargs=23 acl={postgres=X/postgres,service_role=X/postgres} comment=true" "attributes"
  chk "$(q "SELECT has_function_privilege('anon', '$D5SIG', 'EXECUTE')||'/'||has_function_privilege('authenticated', '$D5SIG', 'EXECUTE')||'/'||has_function_privilege('b0_nobody', '$D5SIG', 'EXECUTE')||'/'||has_function_privilege('service_role', '$D5SIG', 'EXECUTE')")" \
      "false/false/false/true" "EXECUTE anon/authenticated/PUBLIC-only/service_role"
}
a5_reapply_present() {
  local oid0; oid0=$(q "SELECT to_regprocedure('$D5SIG')::oid")
  apply_file "$DB" "$MIG"
  chk "$([ "$APRC" != 0 ] && echo refused || echo applied)" refused "second apply refused while present"
  chk "$(grep -cF 'already exists; nothing was created' <<<"$APERR")" 1 "precondition message"
  chk "$(q "SELECT to_regprocedure('$D5SIG')::oid")" "$oid0" "same function, untouched"
}

# ---------------------------------------------------------------------------------------------------------
# D: every dispatch branch, proven by per-function call counters (track_functions = all)
# ---------------------------------------------------------------------------------------------------------
dispatch() { # COND NARRATED OFFERS GUIDANCE EXPECTED-CALLS
  local C="$1" NR="$2" OF="$3" GD="$4" XD="$5" S P E="NULL" G="NULL" O="NULL" K="NULL" N="NULL"
  S=$(q "SELECT b0.mk(NULL)")
  if [ "$C" = true ]; then  # a prior answer, so the conditional writer checks a real expected-latest id
    call "SELECT b0.d5('$S', 'prior', 'agent_turn:prior', b0.rec(1))"; chk "$RC" 0 "prior answer rc"
    P=$(q "SELECT id FROM public.v5_conversation_turns WHERE scenario_id = '$S' AND turn_id = 'prior'"); E="'$P'"
  fi
  [ "$NR" = 1 ] && N="b0.n()"
  [ "$OF" = 1 ] && { O="b0.o()"; K="'0123456789abcdef'"; }
  [ "$GD" = 1 ] && G="b0.g()"
  local seq0 rev0 lines rc rec calls v ef="$TMP/dispatch.err"
  seq0=$(q "SELECT event_seq FROM public.scenarios WHERE id = '$S'")
  rev0=$(q "SELECT revision FROM public.scenarios WHERE id = '$S'")
  lines=$(psql -X -q -t -A -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -d "$DB" -c "SET ROLE service_role" -c "BEGIN" \
    -c "SELECT b0.d5('$S', 't1', 'agent_turn:t1', b0.rec(3), $C, $E, NULL, $G, $O, $K, $N)" -c "SELECT b0.xcalls()" -c "COMMIT" 2>"$ef"); rc=$?
  log "[dispatch $C/$NR/$OF/$GD] rc=$rc :: $(tr '\n' ' ' <<<"$lines") :: $(tr '\n' ' ' <"$ef")"
  chk "$rc" 0 "rc"
  rec=$(sed -n 1p <<<"$lines"); calls=$(sed -n 2p <<<"$lines")
  chk "$calls" "$XD" "functions called in this transaction"
  v=$(q "SELECT b0.verify_written('$S', 't1', 'agent_turn:t1', b0.rec(3), '${rec:-null}'::jsonb, $seq0, $rev0, $G, $O, $K, $N)")
  chk "$v" ok "answer+record by identity"
}

# ---------------------------------------------------------------------------------------------------------
# B1: writes
# ---------------------------------------------------------------------------------------------------------
S_B1=""
b1_guest() { local S; S=$(q "SELECT b0.mk(NULL)"); S_B1="$S"; d5ok "$S" b1 agent_turn:b1 "b0.rec(2)"; chk "$(st "$S")" "answers=1 cq=1 events=1 seq=1 rev=0" "state"; }
b1_owner() { local S; S=$(q "SELECT b0.mk('$U1')"); d5ok "$S" b1o agent_turn:b1o "b0.rec(2)" false NULL "'$U1'"; chk "$(q "SELECT user_id FROM public.v5_conversation_turns WHERE scenario_id = '$S'")" "$U1" "answer row stamped with the owner"; }
b1_guest_signed_in() { local S; S=$(q "SELECT b0.mk(NULL)"); d5ok "$S" b1g agent_turn:b1g "b0.rec(1)" false NULL "'$U2'"; }
b1_rev_nonzero() {
  local S; S=$(q "SELECT b0.mk(NULL)")
  q "UPDATE public.scenarios SET graph = '{\"nodes\":[1]}'::jsonb WHERE id = '$S'" >/dev/null
  q "UPDATE public.scenarios SET graph = '{\"nodes\":[2]}'::jsonb WHERE id = '$S'" >/dev/null
  chk "$(q "SELECT revision FROM public.scenarios WHERE id = '$S'")" 2 "graph writes moved revision to 2"
  d5ok "$S" b1r agent_turn:b1r "b0.rec(2)"
  chk "$(q "SELECT revision FROM public.scenarios WHERE id = '$S'")" 2 "revision unchanged by the append"
}
b1_sequential() { # several answers on one scenario: one record each, seq 1..3, all retained
  local S; S=$(q "SELECT b0.mk(NULL)")
  d5ok "$S" s1 agent_turn:s1 "b0.rec(1)"; d5ok "$S" s2 agent_turn:s2 "b0.rec(2)"; d5ok "$S" s3 agent_turn:s3 "b0.rec(0)"
  chk "$(q "SELECT b0.evseq('$S')")" "construction_questions:1,construction_questions:2,construction_questions:3" "three records, seq 1..3"
}

# ---------------------------------------------------------------------------------------------------------
# B2/B3/B4: replay, conflict, stale latest
# ---------------------------------------------------------------------------------------------------------
b2_replay() {
  local S st0; S=$(q "SELECT b0.mk(NULL)")
  d5ok "$S" b2 agent_turn:b2 "b0.rec(2)"; st0=$(st "$S")
  call "SELECT b0.d5('$S', 'b2', 'agent_turn:b2', b0.rec(2))"
  chk "$RC" 0 "replay rc"
  [ "$RC" = 0 ] && chk "$(jget "$OUT" replayed_prior_turn)/$(jget "$OUT" prior_turn_conflict)/$(jget "$OUT" construction_event_id)" "true/false/null" "replayed, no record"
  chk "$(st "$S")" "$st0" "state unchanged (one answer, one record, event_seq unchanged)"
}
b2_replay_new_record() {
  local S; S=$(q "SELECT b0.mk(NULL)")
  d5ok "$S" b2n agent_turn:b2n "b0.rec(2)"
  call "SELECT b0.d5('$S', 'b2n', 'agent_turn:b2n', b0.rec(5))"
  chk "$RC/$(jget "${OUT:-null}" replayed_prior_turn)" "0/true" "replay with a different record"
  chk "$(q "SELECT (SELECT e->'details' FROM public.scenarios s, jsonb_array_elements(s.events) e WHERE s.id = '$S' AND e->>'event_id' = 'construction_questions_b2n') = b0.rec(2)")" t "first record kept, never overwritten"
  chk "$(st "$S")" "answers=1 cq=1 events=1 seq=1 rev=0" "state"
}
b2_replay_guidance() {
  local S; S=$(q "SELECT b0.mk(NULL)")
  d5ok "$S" b2g agent_turn:b2g "b0.rec(1)" false NULL NULL "b0.g()"
  call "SELECT b0.d5('$S', 'b2g', 'agent_turn:b2g', b0.rec(1), false, NULL, NULL, b0.g())"
  chk "$RC/$(jget "${OUT:-null}" replayed_prior_turn)/$(jget "${OUT:-null}" construction_event_id)" "0/true/null" "guidance-path replay"
  chk "$(st "$S")" "answers=1 cq=1 events=1 seq=1 rev=0" "state"
}
b2_replay_conditional() {
  local S P; S=$(q "SELECT b0.mk(NULL)")
  d5ok "$S" b2c agent_turn:b2c "b0.rec(1)"
  P=$(q "SELECT id FROM public.v5_conversation_turns WHERE scenario_id = '$S' AND turn_id = 'b2c'")
  call "SELECT b0.d5('$S', 'b2c', 'agent_turn:b2c', b0.rec(1), true, '$P')"
  chk "$RC/$(jget "${OUT:-null}" replayed_prior_turn)/$(jget "${OUT:-null}" construction_event_id)" "0/true/null" "conditional replay (expected = the row itself)"
  chk "$(st "$S")" "answers=1 cq=1 events=1 seq=1 rev=0" "state"
}
b3_conflict() {
  local S; S=$(q "SELECT b0.mk(NULL)")
  d5ok "$S" b3 agent_turn:b3 "b0.rec(2)"
  call "SELECT b0.d5('$S', 'b3', 'agent_turn:b3-other', b0.rec(2))"
  chk "$RC/$(jget "${OUT:-null}" prior_turn_conflict)/$(jget "${OUT:-null}" replayed_prior_turn)/$(jget "${OUT:-null}" construction_event_id)" "0/true/false/null" "conflict, no record"
  chk "$(q "SELECT request_hash FROM public.v5_conversation_turns WHERE scenario_id = '$S' AND turn_id = 'b3'")" "agent_turn:b3" "first answer kept"
  chk "$(st "$S")" "answers=1 cq=1 events=1 seq=1 rev=0" "state"
}
b3_conflict_offers() {
  local S; S=$(q "SELECT b0.mk(NULL)")
  d5ok "$S" b3o agent_turn:b3o "b0.rec(1)" false NULL NULL NULL "b0.o()" "'0123456789abcdef'"
  call "SELECT b0.d5('$S', 'b3o', 'agent_turn:b3o-other', b0.rec(1), false, NULL, NULL, NULL, b0.o(), '0123456789abcdef')"
  chk "$RC/$(jget "${OUT:-null}" prior_turn_conflict)/$(jget "${OUT:-null}" construction_event_id)" "0/true/null" "offers-path conflict"
  chk "$(st "$S")" "answers=1 cq=1 events=1 seq=1 rev=0" "state"
}
b4_stale_common() { # NARR EXPECTED(any|null)
  local S P st0 ev0 E; S=$(q "SELECT b0.mk(NULL)")
  d5ok "$S" p1 agent_turn:p1 "b0.rec(1)"; P=$(q "SELECT id FROM public.v5_conversation_turns WHERE scenario_id = '$S' AND turn_id = 'p1'")
  d5ok "$S" p2 agent_turn:p2 "b0.rec(1)"           # p2 is now latest, so p1 is stale
  st0=$(st "$S"); ev0=$(evmd5 "$S")
  if [ "$2" = null ]; then E=NULL; else E="'$P'"; fi
  if [ "$1" = 1 ]; then call "SELECT b0.d5('$S', 'b4', 'agent_turn:b4', b0.rec(2), true, $E, NULL, NULL, NULL, NULL, b0.n())"
  else call "SELECT b0.d5('$S', 'b4', 'agent_turn:b4', b0.rec(2), true, $E)"; fi
  chk "$RC" 0 "rc"
  chk "$OUT" '{"status": "latest_moved"}' "receipt is exactly latest_moved (no record keys)"
  chk "$(st "$S")" "$st0" "state unchanged"
  chk "$(evmd5 "$S")" "$ev0" "events byte-identical"
  chk "$(q "SELECT count(*) FROM public.v5_conversation_turns WHERE scenario_id = '$S' AND turn_id = 'b4'")" 0 "no answer row"
}

# ---------------------------------------------------------------------------------------------------------
# B5: permissions (the existing guest/owner contract, and the grants)
# ---------------------------------------------------------------------------------------------------------
b5_owner_null() { local S; S=$(q "SELECT b0.mk('$U1')"); d5no "$S" b5 42501 "SELECT b0.d5('$S', 'b5', 'agent_turn:b5', b0.rec(1))" "caller may not write scenario"; }
b5_other() { local S; S=$(q "SELECT b0.mk('$U1')"); d5no "$S" b5x 42501 "SELECT b0.d5('$S', 'b5x', 'agent_turn:b5x', b0.rec(1), false, NULL, '$U2')" "caller may not write scenario"; }
b5_member() {
  local S; S=$(q "SELECT b0.mk('$U1')")
  q "INSERT INTO public.scenario_members (scenario_id, email, role, invited_by) VALUES ('$S', 'viewer@example.com', 'viewer', '$U1')" >/dev/null
  d5no "$S" b5m 42501 "SELECT b0.d5('$S', 'b5m', 'agent_turn:b5m', b0.rec(1), false, NULL, '$UM')" "caller may not write scenario"
}
b5_conditional_other() {
  local S; S=$(q "SELECT b0.mk('$U1')")
  d5no "$S" b5c 42501 "SELECT b0.d5('$S', 'b5c', 'agent_turn:b5c', b0.rec(1), true, NULL, '$U2', b0.g())" "caller may not write scenario"
}
b5_missing_scenario() {
  call "SELECT b0.d5('99999999-9999-4999-8999-999999999999', 'b5n', 'agent_turn:b5n', b0.rec(1))"
  chk "$([ "$RC" != 0 ] && echo raised || echo returned)/$STATE" "raised/P0001" "raises"
  chk "$(grep -cF 'not found' <<<"$ERR")" 1 "scenario not found"
  chk "$(q "SELECT count(*) FROM public.v5_conversation_turns WHERE turn_id = 'b5n'")" 0 "no answer row"
}
b5_role() { # ROLE: anon | authenticated | b0_nobody
  local S; S=$(q "SELECT b0.mk(NULL)")
  ROLE="$1"; d5no "$S" "b5r" 42501 "SELECT b0.d5('$S', 'b5r', 'agent_turn:b5r', b0.rec(1))" "permission denied for function $D5NAME"; ROLE=service_role
}

# ---------------------------------------------------------------------------------------------------------
# G: the answer guard (only a final non-graph Agent answer)
# ---------------------------------------------------------------------------------------------------------
g_case() { # T SQLSTATE extra-args MESSAGE
  local S; S=$(q "SELECT b0.mk(NULL)")
  d5no "$S" "$1" "$2" "SELECT b0.d5('$S', '$1', $3)" "$4"
}

# ---------------------------------------------------------------------------------------------------------
# R / MAL: records
# ---------------------------------------------------------------------------------------------------------
r_ok() { # T RECSQL
  local S; S=$(q "SELECT b0.mk(NULL)")
  d5ok "$S" "$1" "agent_turn:$1" "$2"
  MSG+="record bytes=$(q "SELECT octet_length(($2)::text)"), questions=$(q "SELECT jsonb_array_length(($2)->'questions')"); "
}
mal() { # KIND
  local S; S=$(q "SELECT b0.mk(NULL)")
  d5no "$S" "mal" 22023 "SELECT b0.d5('$S', 'mal', 'agent_turn:mal', b0.bad('$1'))" "construction questions append: invalid"
}

# ---------------------------------------------------------------------------------------------------------
# F: forced failures after the answer is written — the answer must roll back with the record
# ---------------------------------------------------------------------------------------------------------
F1_S=""
f1_event_failure() {
  local S; S=$(q "SELECT b0.mk(NULL)"); F1_S="$S"
  q "CREATE TRIGGER zz_b0_force_event_failure BEFORE UPDATE ON public.scenarios FOR EACH ROW EXECUTE FUNCTION b0.force_event_failure()" >/dev/null
  q "INSERT INTO b0.fail_targets VALUES ('$S')" >/dev/null
  d5no "$S" f1 P0001 "SELECT b0.d5('$S', 'f1', 'agent_turn:f1', b0.rec(2))" "b0 forced event failure"
  q "DELETE FROM b0.fail_targets" >/dev/null
  q "DROP TRIGGER zz_b0_force_event_failure ON public.scenarios" >/dev/null
}
f1b_retry() { # the same answer, retried once the failure is gone, writes BOTH (no partial state blocks it)
  d5ok "$F1_S" f1 agent_turn:f1 "b0.rec(2)"
  chk "$(st "$F1_S")" "answers=1 cq=1 events=1 seq=1 rev=0" "state"
}
f2_storage_limit() { # a storage-level refusal of the record (simulated limit) rolls back the answer too
  local S; S=$(q "SELECT b0.mk(NULL)")
  q "ALTER TABLE public.scenarios ADD CONSTRAINT b0_events_storage_limit CHECK (octet_length(events::text) < 100000) NOT VALID" >/dev/null
  d5ok "$S" f2small agent_turn:f2small "b0.rec(2)"                                   # contrast: under the limit, both
  d5no "$S" f2 23514 "SELECT b0.d5('$S', 'f2', 'agent_turn:f2', b0.rec(4, 40000))" "b0_events_storage_limit"
  q "ALTER TABLE public.scenarios DROP CONSTRAINT b0_events_storage_limit" >/dev/null
}
f3_delegate_failure() {
  local S; S=$(q "SELECT b0.mk(NULL)")
  d5no "$S" f3 P0001 "SELECT b0.d5('$S', 'f3', 'agent_turn:f3', b0.rec(1), false, NULL, NULL, '{\"version\":2,\"entries\":{}}'::jsonb)" "invalid guidance envelope"
}

# ---------------------------------------------------------------------------------------------------------
# B14: orphans
# ---------------------------------------------------------------------------------------------------------
b14a_scan() {
  chk "$(q "SELECT coalesce(string_agg(p.proname, ',' ORDER BY p.proname), '') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname IN ('public', 'auth') AND p.prosrc LIKE '%construction_questions%'")" "$D5NAME" "only D5 names construction_questions"
  chk "$([ "$(q "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.prosrc LIKE '%model_version_created%'")" -ge 1 ] && echo seen || echo blind)" seen "contrast: the scan sees model_version_created"
  chk "$(q "SELECT to_regproc('public.append_construction_questions_event') IS NULL")" t "round-1 helper absent"
}
b14b_forced_miss() {
  local S; S=$(q "SELECT b0.mk(NULL)")
  q "CREATE TRIGGER b0_tamper_hash BEFORE INSERT ON public.v5_conversation_turns FOR EACH ROW EXECUTE FUNCTION b0.tamper_hash()" >/dev/null
  d5no "$S" b14b-1 P0001 "SELECT b0.d5('$S', 'b14b-1', 'agent_turn:b14b', b0.rec(2))" "not found; nothing is kept"
  q "DROP TRIGGER b0_tamper_hash ON public.v5_conversation_turns" >/dev/null
}
b14c_leftover() {
  local S; S=$(q "SELECT b0.mk(NULL)")
  q "UPDATE public.scenarios SET events = events || jsonb_build_array(jsonb_build_object('event_id', 'construction_questions_b14c', 'event_type', 'construction_questions', 'seq', event_seq + 1, 'details', '{}'::jsonb)), event_seq = event_seq + 1 WHERE id = '$S'" >/dev/null
  d5no "$S" b14c P0001 "SELECT b0.d5('$S', 'b14c', 'agent_turn:b14c', b0.rec(2))" "already exists for a new answer row"
  chk "$(st "$S")" "answers=0 cq=1 events=1 seq=1 rev=0" "only the leftover remains"
}
b14d_generic_writer() {
  # The contract: "no other writer of construction_questions events … no orphan record can be written".
  # Attempt: a signed-in OWNER (role authenticated, as the browser's anon-key + JWT) calls the live generic
  # writer append_scenario_event with event_type 'construction_questions'. Expected by the contract: refused.
  local S; S=$(q "SELECT b0.mk('$U1')")
  ROLE=authenticated; PRE="SET request.jwt.claim.sub = '$U1'"
  call "SELECT public.append_scenario_event('$S', 'construction_questions_b14d', 'construction_questions', b0.rec(1), NULL, 'b14d')"
  ROLE=service_role; PRE=""
  chk "$([ "$RC" != 0 ] && echo refused || echo appended)" refused "generic writer refuses a construction_questions event"
  chk "$(st "$S")" "answers=0 cq=0 events=0 seq=0 rev=0" "no orphan record"
  # Consequence, recorded: the D5 answer for that turn.
  call "SELECT b0.d5('$S', 'b14d', 'agent_turn:b14d', b0.rec(2), false, NULL, '$U1')"
  MSG+="then D5 for turn b14d: rc=$RC state=${STATE:-none}; final $(st "$S"); "
}
b14d_guest_contrast() {
  local S; S=$(q "SELECT b0.mk(NULL)")
  ROLE=authenticated; PRE="SET request.jwt.claim.sub = '$U1'"
  call "SELECT public.append_scenario_event('$S', 'construction_questions_b14g', 'construction_questions', b0.rec(1), NULL, 'b14g')"
  ROLE=service_role; PRE=""
  chk "$([ "$RC" != 0 ] && echo refused || echo appended)" refused "guest rows are not reachable through it"
  chk "$(st "$S")" "answers=0 cq=0 events=0 seq=0 rev=0" "nothing written"
}

# ---------------------------------------------------------------------------------------------------------
# C: concurrency — two psql sessions. A: BEGIN; <A>; pg_sleep(3); COMMIT.  B starts 1 s later.
# ---------------------------------------------------------------------------------------------------------
conc() {
  local fa="$TMP/A.out" fb="$TMP/B.out" pa pb; rm -f "$TMP/B.meta"
  psql -X -q -t -A -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -d "$DB" \
    -c "SET application_name = 'b0_A'" -c "SET ROLE service_role" -c "BEGIN" -c "$1" -c "SELECT pg_sleep(3)" -c "COMMIT" >"$fa" 2>&1 &
  pa=$!
  sleep 1
  ( t0=$(date +%s%3N)
    psql -X -q -t -A -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -d "$DB" \
      -c "SET application_name = 'b0_B'" -c "SET ROLE service_role" -c "$2" >"$fb" 2>&1
    r=$?; echo "$r $(( $(date +%s%3N) - t0 ))" >"$TMP/B.meta" ) &
  pb=$!
  sleep 1
  CWAIT=$(q "SELECT coalesce(string_agg(coalesce(wait_event_type, '-') || ':' || coalesce(wait_event, '-'), ','), 'none') FROM pg_stat_activity WHERE application_name = 'b0_B'")
  wait "$pa"; ARC=$?
  wait "$pb"
  BRC=harness; BMS=0
  [ -f "$TMP/B.meta" ] && read -r BRC BMS <"$TMP/B.meta"
  AREC=$(grep -m1 '^{' "$fa" || true); BREC=$(grep -m1 '^{' "$fb" || true)
  BSTATE=$(grep -oE 'ERROR:  [0-9A-Z]{5}:' "$fb" | head -1 | cut -c9-13)
  log "[conc] A rc=$ARC :: $(tr '\n' ' ' <"$fa") || B rc=$BRC ms=$BMS wait=$CWAIT :: $(tr '\n' ' ' <"$fb")"
  if grep -q '40P01' "$fa" "$fb"; then DEADLOCK=yes; else DEADLOCK=no; fi
  MSG+="B waited ${BMS} ms on [$CWAIT]; "
}
blocked() { chk "$([ "$BMS" -ge 1500 ] && echo blocked || echo "not blocked (${BMS} ms)")" blocked "B blocked until A committed"; chk "$DEADLOCK" no "no deadlock"; }
c1_duplicate() {
  local S; S=$(q "SELECT b0.mk(NULL)")
  conc "SELECT b0.d5('$S', 'c1', 'agent_turn:c1', b0.rec(2))" "SELECT b0.d5('$S', 'c1', 'agent_turn:c1', b0.rec(2))"
  chk "$ARC/$BRC" "0/0" "rc A/B"; blocked
  chk "$(grep -c 'Lock:advisory' <<<"$CWAIT")" 1 "B queued on the scenario advisory lock"
  chk "$(jget "${AREC:-null}" construction_event_id)" construction_questions_c1 "A wrote the record"
  chk "$(jget "${BREC:-null}" replayed_prior_turn)/$(jget "${BREC:-null}" construction_event_id)" "true/null" "B replayed, no record"
  chk "$(st "$S")" "answers=1 cq=1 events=1 seq=1 rev=0" "one answer, one record"
}
c2_conflict() {
  local S; S=$(q "SELECT b0.mk(NULL)")
  conc "SELECT b0.d5('$S', 'c2', 'agent_turn:c2', b0.rec(2))" "SELECT b0.d5('$S', 'c2', 'agent_turn:c2-other', b0.rec(3))"
  chk "$ARC/$BRC" "0/0" "rc A/B"; blocked
  chk "$(jget "${BREC:-null}" prior_turn_conflict)/$(jget "${BREC:-null}" construction_event_id)" "true/null" "B conflict, no record"
  chk "$(q "SELECT request_hash FROM public.v5_conversation_turns WHERE scenario_id = '$S'")" agent_turn:c2 "A's answer kept"
  chk "$(st "$S")" "answers=1 cq=1 events=1 seq=1 rev=0" "state"
}
c3_legacy_after() {
  local S; S=$(q "SELECT b0.mk(NULL)")
  conc "SELECT b0.d5('$S', 'c3', 'agent_turn:c3', b0.rec(2), false, NULL, NULL, b0.g())" "SELECT b0.legacy_guidance('$S', 'c3', 'agent_turn:c3', b0.g2())"
  chk "$ARC/$BRC" "0/0" "rc A/B"; blocked
  chk "$(jget "${BREC:-null}" replayed_prior_turn)" true "legacy writer replayed"
  chk "$(q "SELECT agent_guidance = b0.g() FROM public.v5_conversation_turns WHERE scenario_id = '$S'")" t "D5's answer kept, not overwritten"
  chk "$(st "$S")" "answers=1 cq=1 events=1 seq=1 rev=0" "state"
}
c4_legacy_first() {
  local S; S=$(q "SELECT b0.mk(NULL)")
  conc "SELECT b0.legacy_guidance('$S', 'c4', 'agent_turn:c4', b0.g2())" "SELECT b0.d5('$S', 'c4', 'agent_turn:c4', b0.rec(2))"
  chk "$ARC/$BRC" "0/0" "rc A/B"; blocked
  chk "$(jget "${BREC:-null}" replayed_prior_turn)/$(jget "${BREC:-null}" construction_event_id)" "true/null" "D5 replayed the legacy answer, no record"
  chk "$(st "$S")" "answers=1 cq=0 events=0 seq=0 rev=0" "an answer WITHOUT a record exists after D5 (missing != predates D5)"
}
c5_stale_race() {
  local S P; S=$(q "SELECT b0.mk(NULL)")
  d5ok "$S" c5p agent_turn:c5p "b0.rec(1)"; P=$(q "SELECT id FROM public.v5_conversation_turns WHERE scenario_id = '$S' AND turn_id = 'c5p'")
  conc "SELECT b0.d5('$S', 'c5a', 'agent_turn:c5a', b0.rec(1), true, '$P')" "SELECT b0.legacy_if_latest('$S', 'c5b', 'agent_turn:c5b', '$P')"
  chk "$ARC/$BRC" "0/0" "rc A/B"; blocked
  chk "$(grep -c 'Lock:advisory' <<<"$CWAIT")" 1 "legacy conditional writer queued on the same advisory lock"
  chk "$(jget "${AREC:-null}" construction_event_id)" construction_questions_c5a "A wrote answer+record"
  chk "$BREC" '{"status": "latest_moved"}' "B saw latest_moved"
  chk "$(st "$S")" "answers=2 cq=2 events=2 seq=2 rev=0" "state"
}
c5r_stale_race_reverse() {
  local S P; S=$(q "SELECT b0.mk(NULL)")
  d5ok "$S" c5p agent_turn:c5p "b0.rec(1)"; P=$(q "SELECT id FROM public.v5_conversation_turns WHERE scenario_id = '$S' AND turn_id = 'c5p'")
  conc "SELECT b0.legacy_if_latest('$S', 'c5b', 'agent_turn:c5b', '$P')" "SELECT b0.d5('$S', 'c5a', 'agent_turn:c5a', b0.rec(1), true, '$P')"
  chk "$ARC/$BRC" "0/0" "rc A/B"; blocked
  chk "$(grep -c 'Lock:advisory' <<<"$CWAIT")" 1 "D5 queued on the advisory lock"
  chk "$BREC" '{"status": "latest_moved"}' "D5 saw latest_moved and wrote nothing"
  chk "$(st "$S")" "answers=2 cq=1 events=1 seq=1 rev=0" "state"
}
c6_graph_after() {
  local S; S=$(q "SELECT b0.mk(NULL)")
  conc "SELECT b0.d5('$S', 'c6', 'agent_turn:c6', b0.rec(2))" "UPDATE public.scenarios SET graph = '{\"nodes\":[\"c6\"]}'::jsonb WHERE id = '$S'"
  chk "$ARC/$BRC" "0/0" "rc A/B"; blocked
  chk "$(st "$S")" "answers=1 cq=1 events=1 seq=1 rev=1" "record survives; revision moved once, by the graph"
}
c7_graph_first() {
  local S; S=$(q "SELECT b0.mk(NULL)")
  conc "UPDATE public.scenarios SET graph = '{\"nodes\":[\"c7\"]}'::jsonb WHERE id = '$S'" "SELECT b0.d5('$S', 'c7', 'agent_turn:c7', b0.rec(2))"
  chk "$ARC/$BRC" "0/0" "rc A/B"; blocked
  chk "$(jget "${BREC:-null}" construction_event_seq)" 1 "record seq"
  chk "$(st "$S")" "answers=1 cq=1 events=1 seq=1 rev=1" "state"
  chk "$(q "SELECT graph = '{\"nodes\":[\"c7\"]}'::jsonb FROM public.scenarios WHERE id = '$S'")" t "graph kept"
}
c8_version_after() {
  local S; S=$(q "SELECT b0.mk('$U1')")
  conc "SELECT b0.d5('$S', 'c8', 'agent_turn:c8', b0.rec(1), false, NULL, '$U1')" "SELECT b0.cas_v1('$S', 0)"
  chk "$ARC/$BRC" "0/0" "rc A/B (revision CAS still passes after the append)"; blocked
  chk "$(q "SELECT b0.evseq('$S')")" "construction_questions:1,model_version_created:2" "both events, distinct seq"
  chk "$(st "$S")" "answers=1 cq=1 events=2 seq=2 rev=1" "state"
}
c9_version_first() {
  local S; S=$(q "SELECT b0.mk('$U1')")
  conc "SELECT b0.cas_v1('$S', 0)" "SELECT b0.d5('$S', 'c9', 'agent_turn:c9', b0.rec(1), false, NULL, '$U1')"
  chk "$ARC/$BRC" "0/0" "rc A/B"; blocked
  chk "$(q "SELECT b0.evseq('$S')")" "model_version_created:1,construction_questions:2" "both events, distinct seq"
  chk "$(st "$S")" "answers=1 cq=1 events=2 seq=2 rev=1" "state"
}
c10_claim_first() {
  local S; S=$(q "SELECT b0.mk(NULL)")
  conc "SELECT public.claim_guest_scenario('$S', '$U1')" "SELECT b0.d5('$S', 'c10', 'agent_turn:c10', b0.rec(1))"
  chk "$ARC" 0 "claim rc"; blocked
  chk "$([ "$BRC" != 0 ] && echo raised || echo returned)/$BSTATE" "raised/42501" "guest answer refused once the row is claimed"
  chk "$(st "$S")" "answers=0 cq=0 events=1 seq=1 rev=0" "neither answer nor record; claim event kept"
}
c11_claim_after() {
  local S; S=$(q "SELECT b0.mk(NULL)")
  conc "SELECT b0.d5('$S', 'c11', 'agent_turn:c11', b0.rec(1))" "SELECT public.claim_guest_scenario('$S', '$U1')"
  chk "$ARC/$BRC" "0/0" "rc A/B"; blocked
  chk "$(q "SELECT b0.evseq('$S')")" "construction_questions:1,guest_claimed:2" "both events, distinct seq"
  chk "$(q "SELECT user_id FROM public.v5_conversation_turns WHERE scenario_id = '$S'")" "$U1" "claim stamped the answer row"
  chk "$(st "$S")" "answers=1 cq=1 events=2 seq=2 rev=0" "state"
}

# ---------------------------------------------------------------------------------------------------------
# RB / RA: rollback, then re-apply
# ---------------------------------------------------------------------------------------------------------
rb1_rollback() {
  q "INSERT INTO b0.snap VALUES ('data_before_rb', b0.data_snapshot())" >/dev/null
  apply_file "$DB" "$RB"
  chk "$APRC" 0 "psql --single-transaction -f D5-B-ROLLBACK.sql"
  chk "$(q "SELECT to_regprocedure('$D5SIG') IS NULL")" t "D5 function dropped"
  chk "$(q "SELECT b0.fn_snapshot() = (SELECT val FROM b0.snap WHERE name = 'fn0')")" t "every other function body and ACL as before the apply"
  chk "$(q "SELECT b0.cat_snapshot() = (SELECT val FROM b0.snap WHERE name = 'cat0')")" t "catalogue as before the apply"
}
rb2_data_survives() {
  chk "$(q "SELECT b0.data_snapshot() = (SELECT val FROM b0.snap WHERE name = 'data_before_rb')")" t "scenarios (events, event_seq, revision, updated_at) and answer rows byte-identical"
  local n; n=$(q "SELECT b0.data_snapshot()->>'n_cq_events'")
  chk "$([ "${n:-0}" -gt 0 ] && echo yes || echo no)" yes "non-vacuous: $n construction_questions events survived"
}
rb3_missing_rpc() {
  local S; S=$(q "SELECT b0.mk(NULL)")
  d5no "$S" rb3 42883 "SELECT b0.d5('$S', 'rb3', 'agent_turn:rb3', b0.rec(1))" "does not exist"
  call "SELECT b0.legacy_guidance('$S', 'rb3-plain', 'agent_turn:rb3-plain', b0.g())"
  chk "$RC" 0 "contrast: today's answer writer still writes after the rollback"
}
rb4_again() { apply_file "$DB" "$RB"; chk "$APRC" 0 "rollback is repeatable"; }
ra1_reapply() {
  apply_file "$DB" "$MIG"
  chk "$APRC" 0 "re-apply"
  chk "$(q "SELECT to_jsonb(md5(pg_get_functiondef(to_regprocedure('$D5SIG')))) = (SELECT val FROM b0.snap WHERE name = 'd5_def_md5')")" t "same function as the first apply"
  chk "$(q "SELECT has_function_privilege('anon', '$D5SIG', 'EXECUTE')||'/'||has_function_privilege('authenticated', '$D5SIG', 'EXECUTE')||'/'||has_function_privilege('service_role', '$D5SIG', 'EXECUTE')")" "false/false/true" "grants"
}
ra2_write_after() {
  local n0; n0=$(q "SELECT count(*) FROM public.scenarios s, jsonb_array_elements(s.events) e WHERE s.id = '$S_B1'")
  d5ok "$S_B1" ra2 agent_turn:ra2 "b0.rec(2)"
  chk "$(q "SELECT count(*) FROM public.scenarios s, jsonb_array_elements(s.events) e WHERE s.id = '$S_B1'")" "$((n0 + 1))" "earlier record kept, new one appended"
  chk "$(q "SELECT b0.evseq('$S_B1')")" "construction_questions:1,construction_questions:2" "seq continues"
}

# =========================================================================================================
# Run
# =========================================================================================================
echo "== D5 B0 rehearsal on $(qq "SELECT version()" postgres)"
run S-sha256 s_sha
run S-static s_static

qq "DROP DATABASE IF EXISTS b0_tpl" postgres >/dev/null
qq "DO \$x\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'b0_nobody') THEN CREATE ROLE b0_nobody NOLOGIN; END IF; END \$x\$" postgres
qq "CREATE DATABASE b0_tpl" postgres
psql -X -q -v ON_ERROR_STOP=1 -d b0_tpl -f "$FIX" >>"$LOG" 2>&1; FIXRC=$?
psql -X -q -v ON_ERROR_STOP=1 -d b0_tpl -f "$LIB" >>"$LOG" 2>&1; LIBRC=$?
run FIX-server fix_server
run FIX-load fix_load
while IFS=$'\t' read -r kind schema name md5 acl; do
  case "$kind" in ''|\#*) continue ;; esac
  run "FIX-$schema.$name" fix_one "$kind" "$schema" "$name" "$md5" "$acl"
done <"$FP"

qq "CREATE DATABASE b0 TEMPLATE b0_tpl" postgres
qq "ALTER DATABASE b0 SET track_functions = 'all'" postgres   # for b0.xcalls()

run A0-abort-leaves-nothing a0_abort
run A1-missing-delegate-refused a1_missing_delegate
run A2-apply a2_apply
run A3-nothing-else-changed a3_nothing_else
run A4-attributes-and-grants a4_attributes
run A5-second-apply-refused a5_reapply_present

#                              COND  NARR OFFERS GUIDANCE  expected delegate calls
run D01-plain-v2         dispatch false 0 0 0 "d5=1 v2=1"
run D02-guidance         dispatch false 0 0 1 "d5=1 guidance=1 v2=1"
run D03-offers           dispatch false 0 1 0 "d5=1 offers=1 v2=1"
run D04-offers+guidance  dispatch false 0 1 1 "d5=1 guidance=1 offers=1 v2=1"
run D05-narrated         dispatch false 1 0 0 "d5=1 narrated=1 v2=1"
run D06-narrated+offers+guidance dispatch false 1 1 1 "d5=1 guidance=1 narrated=1 offers=1 v2=1"
run D07-conditional      dispatch true 0 0 0 "d5=1 if_latest=1 v2=1"
run D08-conditional+guidance dispatch true 0 0 1 "d5=1 guidance=1 if_latest=1 v2=1"
run D09-conditional+offers dispatch true 0 1 0 "d5=1 if_latest=1 offers=1 v2=1"
run D10-conditional+offers+guidance dispatch true 0 1 1 "d5=1 guidance=1 if_latest=1 offers=1 v2=1"
run D11-conditional-narrated dispatch true 1 0 0 "d5=1 if_latest_narrated=1 narrated=1 v2=1"
run D12-conditional-narrated+offers+guidance dispatch true 1 1 1 "d5=1 guidance=1 if_latest_narrated=1 narrated=1 offers=1 v2=1"

run B1-guest b1_guest
run B1-owner b1_owner
run B1-guest-row-signed-in-caller b1_guest_signed_in
run B1-revision-unchanged b1_rev_nonzero
run B1-three-answers-three-records b1_sequential
run B2-replay b2_replay
run B2-replay-different-record b2_replay_new_record
run B2-replay-guidance-path b2_replay_guidance
run B2-replay-conditional b2_replay_conditional
run B3-conflict b3_conflict
run B3-conflict-offers-path b3_conflict_offers
run B4-stale-latest b4_stale_common 0 any
run B4-stale-latest-narrated b4_stale_common 1 any
run B4-stale-latest-null-expected b4_stale_common 0 null
run B5-owned-row-null-caller b5_owner_null
run B5-owned-row-other-user b5_other
run B5-member-viewer b5_member
run B5-conditional-other-user b5_conditional_other
run B5-missing-scenario b5_missing_scenario
run B5-role-anon b5_role anon
run B5-role-authenticated b5_role authenticated
run B5-role-public-only b5_role b0_nobody

run G1-graph-present g_case g1 P0001 "'agent_turn:g1', b0.rec(1), false, NULL, NULL, NULL, NULL, NULL, NULL, '{\"nodes\":[]}'::jsonb" "require a final non-graph Agent answer"
run G2-hash-not-agent-turn g_case g2 P0001 "'other:g2', b0.rec(1)" "require a final non-graph Agent answer"
run G3-claim-turn-id g_case "g3:claim" P0001 "'agent_turn:g3', b0.rec(1)" "require a final non-graph Agent answer"
run G4-turn-class-clarify g_case g4 P0001 "'agent_turn:g4', b0.rec(1), false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'clarify'" "require a final non-graph Agent answer"
run G5-conditional-null g_case g5 22023 "'agent_turn:g5', b0.rec(1), NULL" "p_conditional is required"

run R1-questions-empty r_ok r1 "b0.rec(0)"
run R2-ids-null r_ok r2 "b0.rec(2)"
run R3-ids-absent r_ok r3 "b0.rec(2) - 'operation_id' - 'model_version_id'"
run R4-ids-uuid r_ok r4 "b0.rec(2, 0, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', 'ffffffff-1111-4222-8333-444444444444')"
run R5-verbatim-unicode r_ok r5 "b0.rec_unicode()"
run R6-12k-token-record r_ok r6 "b0.rec(40, 1150)"
run R7-one-48k-char-question r_ok r7 "b0.rec(1, 48000)"
run R8-1000-questions r_ok r8 "b0.rec(1000)"
run R9-1MB-record r_ok r9 "b0.rec(100, 10000)"
for k in sql_null json_null array string no_schema wrong_schema top_target_id top_label top_summary op_not_uuid op_free_text \
         op_number mv_not_uuid no_questions questions_object q_not_object q_source_x q_status_resolved q_ids_q2_q1 q_id_q0 \
         q_id_number q_text_empty q_text_blank q_text_number q_target_id q_no_concerns q_concerns_object c_from_without_to \
         c_to_without_from c_node_and_link c_empty_node_id c_no_label c_blank_label c_extra_key c_string c_node_id_number; do
  run "MAL-$k" mal "$k"
done

run F1-forced-event-failure f1_event_failure
run F1b-retry-writes-both f1b_retry
run F2-storage-limit f2_storage_limit
run F3-delegate-failure f3_delegate_failure

run B14a-only-writer-scan b14a_scan
run B14b-identity-recheck-miss b14b_forced_miss
run B14c-leftover-event b14c_leftover
run B14d-orphan-via-append_scenario_event b14d_generic_writer
run B14d-guest-row-contrast b14d_guest_contrast

run C01-duplicate c1_duplicate
run C02-conflicting-resend c2_conflict
run C03-legacy-writer-after-D5 c3_legacy_after
run C04-legacy-writer-before-D5 c4_legacy_first
run C05-stale-latest-race c5_stale_race
run C05r-stale-latest-race-reverse c5r_stale_race_reverse
run C06-graph-write-after-D5 c6_graph_after
run C07-graph-write-before-D5 c7_graph_first
run C08-version-after-D5 c8_version_after
run C09-version-before-D5 c9_version_first
run C10-claim-before-D5 c10_claim_first
run C11-claim-after-D5 c11_claim_after

run RB1-rollback rb1_rollback
run RB2-records-and-revision-survive rb2_data_survives
run RB3-missing-rpc-fails-closed rb3_missing_rpc
run RB4-rollback-again rb4_again
run RA1-reapply ra1_reapply
run RA2-write-after-reapply ra2_write_after

# Mutants: each must turn its row red.
mutant_db() { # name → MDB, MRC, MERR
  MDB="b0_$1"
  qq "CREATE DATABASE $MDB TEMPLATE b0_tpl" postgres
  if python3 "$HERE/mutate.py" "$1" "$MIG" "$TMP/$1.sql" 2>>"$LOG"; then apply_file "$MDB" "$TMP/$1.sql"; MRC=$APRC; MERR=$APERR
  else MRC=harness; MERR="mutant fragment not found"; fi
}
for m in m1 m2 m3 m4 m5 m7 m8 m9; do
  mutant_db "$m"
  if [ "$MRC" != 0 ]; then fail "M-$m" "harness: mutant did not apply (rc=$MRC): ${MERR:0:300}"; continue; fi
  case "$m" in
    m1) run_mutant M1-no-inline-append "$MDB" b1_guest ;;
    m2) run_mutant M2-append-on-existing-row "$MDB" b2_replay ;;
    m3) run_mutant M3-append-before-latest_moved "$MDB" b4_stale_common 0 any ;;
    m4) run_mutant M4-no-identity-recheck "$MDB" b14b_forced_miss ;;
    m5) run_mutant M5-no-owner-check "$MDB" b5_other ;;
    m7) run_mutant M7-swallow-event-failure "$MDB" f1_event_failure ;;
    m8) run_mutant M8-no-envelope-check "$MDB" mal top_target_id ;;
    m9) run_mutant M9-no-question-check "$MDB" mal q_source_x ;;
  esac
done
m6_case() { mutant_db m6; chk "$([ "$MRC" != 0 ] && echo refused || echo applied)" refused "apply refused"; chk "$(grep -cF 'grants are not service_role-only' <<<"$MERR")" 1 "by the migration's own postcondition"; }
run M6-anon-execute-left-in-place m6_case

FINISHED=1
[ "$NFAIL" -eq 0 ]
