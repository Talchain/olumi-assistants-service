#!/usr/bin/env bash
# LOCAL disposable schema/data copy only. Two independent psql sessions.
# bash scripts/phase2/rehearse-a-lock.sh -h 127.0.0.1 -p 54322 -U postgres -d postgres
# Requires Phase 2(a) absent; applies/commits it temporarily, then rolls it back.
# PGPASSWORD/pgpass supply credentials; this script never prints connection args.
set -euo pipefail
root=$(git rev-parse --show-toplevel)
cd "$root"
work=$(mktemp -d)
applied=0
created=0
lock_pid=''
lock_backend=''
psql_local() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
cleanup() {
  if [[ -n "$lock_backend" ]]; then
    psql_local "$@" -c "SELECT pg_terminate_backend($lock_backend) WHERE $lock_backend <> pg_backend_pid()" >/dev/null 2>&1 || true
  fi
  if [[ -n "$lock_pid" ]]; then wait "$lock_pid" 2>/dev/null || true; fi
  if [[ "$created" == 1 ]]; then
    psql_local "$@" -c "DELETE FROM public.scenarios WHERE id = 'f2a00000-0000-4000-8000-000000000001'" >/dev/null
    created=0
  fi
  if [[ "$applied" == 1 ]]; then
    psql_local "$@" --single-transaction -f supabase/migrations/rollback/20261009010000_phase2_a_typed_runs_rollback.sql.do-not-apply >/dev/null
    applied=0
  fi
}
trap 'cleanup "$@"; rm -rf "$work"' EXIT
# Validate the actual connected host, not only PGHOST (CLI args can override it).
psql_local "$@" <<'SQL'
SELECT :'HOST' IN ('localhost','127.0.0.1','::1') OR :'HOST' LIKE '/%' AS local_endpoint
\gset
\if :local_endpoint
\else
  \echo 'REFUSED: local endpoint required'
  \quit 3
\endif
DO $$ BEGIN
  IF to_regclass('public.analysis_runs') IS NOT NULL OR to_regclass('public.analysis_run_queue') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires Phase 2(a) absent in an isolated local copy';
  END IF;
END $$;
SQL
psql_local "$@" -At -f scripts/phase2/catalogue-a.sql -c 'SELECT pg_temp.phase2_catalogue()' > "$work/before.json"
psql_local "$@" --single-transaction -f supabase/migrations/20261009010000_phase2_a_typed_runs.sql
applied=1
psql_local "$@" -c "INSERT INTO public.scenarios(id,user_id,graph) VALUES ('f2a00000-0000-4000-8000-000000000001',NULL,NULL)"
created=1
# Deliberate adversarial ACCESS EXCLUSIVE is harness-only. Drain claims use row
# locks/SKIP LOCKED; application code never acquires this table lock on the queue.
psql_local "$@" -At > "$work/lock.log" 2>&1 <<SQL &
BEGIN;
LOCK TABLE public.analysis_run_queue, public.analysis_runs, public.analysis_run_options IN ACCESS EXCLUSIVE MODE;
\o $work/ready
SELECT pg_backend_pid();
\o
SELECT pg_sleep(10);
COMMIT;
SQL
lock_pid=$!
for ((attempt=0; attempt<200; attempt++)); do
  [[ -s "$work/ready" ]] && break
  if ! kill -0 "$lock_pid" 2>/dev/null; then cat "$work/lock.log"; exit 1; fi
  sleep 0.1
done
[[ -s "$work/ready" ]] || { echo 'FAIL held-lock setup'; exit 1; }
lock_backend=$(tr -d '[:space:]' < "$work/ready")
[[ "$lock_backend" =~ ^[0-9]+$ ]] || { echo 'FAIL lock session identity'; exit 1; }
# The real append has statement_timeout 2s, including trigger/planning/locking.
# Success is a committed turn/fact, never an exception swallowed by the harness.
fact_id=$(psql_local "$@" -At <<'SQL'
\ir scripts/phase2/rehearse-a-fixture.sql
SET statement_timeout = '2s';
SET request.jwt.claims = '{"role":"service_role"}';
SELECT public.append_turn_atomic_v4(
  p_scenario_id => 'f2a00000-0000-4000-8000-000000000001', p_turn_id => 'phase2-a-held-lock',
  p_turn_class => 'handler', p_handler_id => 'run_analysis', p_request_hash => 'phase2-a-held-lock',
  p_response_emitted => true, p_llm_calls_used => 0, p_duration_ms => 1,
  p_handler_facts => jsonb_build_array(jsonb_build_object('handler_id','run_analysis','action_type','run_analysis','noop',false,'payload', :'phase2_a_payload'::jsonb)),
  p_graph => NULL, p_brief_text => NULL, p_pending_actions => '[]', p_coaching_state => NULL,
  p_user_message => NULL, p_assistant_message => NULL, p_expected_graph_identity_hash => NULL,
  p_incoming_graph_identity_hash => NULL, p_cas_enforce => false, p_fence_generation => NULL) AS turn_row
\gset
SELECT id FROM public.v5_handler_facts WHERE v5_conversation_turn_id = :'turn_row';
SQL
)
[[ "$fact_id" =~ ^[0-9a-f-]{36}$ ]] || { echo 'FAIL append fact identity'; exit 1; }
echo 'PASS real append committed within statement_timeout 2s under queue + typed-table ACCESS EXCLUSIVE locks'
wait "$lock_pid"
lock_pid=''
lock_backend=''
psql_local "$@" -v fact_id="$fact_id" <<'SQL'
\ir scripts/phase2/rehearse-a-fixture.sql
SELECT NOT EXISTS (SELECT 1 FROM public.analysis_run_queue WHERE fact_id = :'fact_id') AS enqueue_skipped
\gset
\if :enqueue_skipped
  \echo 'PASS enqueue skipped under held queue lock (55P03 logged by trigger)'
\else
  \echo 'FAIL enqueue unexpectedly present'
  \quit 1
\endif
SELECT public.claim_analysis_run_facts(ARRAY[:'fact_id'::uuid],1)->'facts' @> jsonb_build_array(jsonb_build_object('fact_id',:'fact_id')) AS recovered
\gset
\if :recovered
  \echo 'PASS next sweep recovered missed enqueue via anti-join'
\else
  \echo 'FAIL anti-join recovery'
  \quit 1
\endif
-- The mapper already generated the fixture's golden run/options, not SQL.
SELECT public.store_typed_analysis_run(:'fact_id', :'phase2_a_run'::jsonb, :'phase2_a_options'::jsonb) AS stored
\gset
SELECT EXISTS (SELECT 1 FROM public.analysis_runs WHERE fact_id = :'fact_id' AND scenario_revision IS NULL AND revision_source = 'legacy_unknown')
  AND NOT EXISTS (SELECT 1 FROM public.analysis_run_queue WHERE fact_id = :'fact_id') AS derived
\gset
\if :derived
  \echo 'PASS recovered fact derived through TS golden values + storage RPC'
\else
  \echo 'FAIL recovered derivation'
  \quit 1
\endif
SQL
cleanup "$@"
psql_local "$@" -At -f scripts/phase2/catalogue-a.sql -c 'SELECT pg_temp.phase2_catalogue()' > "$work/after.json"
cmp "$work/before.json" "$work/after.json"
echo 'PASS rollback restored catalogue EXACTLY; synthetic scenario/turn/fact removed'
