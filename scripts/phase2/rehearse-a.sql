-- PROPOSAL REHEARSAL — NOT EXECUTED; LOCAL STACK ONLY.
-- Requires an isolated schema copy with append_turn_atomic_v6 and Phase 2(c)'s
-- revision trigger already installed. No shared DB/data or Docker provisioning.
-- Example (supply the local password separately):
--   psql -X --host=127.0.0.1 --port=54322 --username=postgres --dbname=postgres \
--     --file=scripts/phase2/rehearse-a.sql
-- Migration, seeds, checks and proposal rollback share one transaction; the
-- final ROLLBACK discards everything. Each assertion prints PASS/FAIL, and the
-- aggregate RAISE refuses any FAIL. Disconnection also rolls the work back.

\set ON_ERROR_STOP on
\set ON_ERROR_ROLLBACK off

SELECT :'HOST' IN ('localhost', '127.0.0.1', '::1')
       OR :'HOST' LIKE '/%' AS phase2_a_local_endpoint
\gset
\if :phase2_a_local_endpoint
\else
  \echo 'REFUSED: rehearse-a.sql requires a loopback host or local Unix socket.'
  \quit 3
\endif

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.scenarios') IS NULL
     OR to_regclass('public.v5_conversation_turns') IS NULL
     OR to_regclass('public.v5_handler_facts') IS NULL
     OR to_regprocedure('public.append_turn_atomic_v6(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,text,text,boolean,bigint,uuid,text,text,text,text,text,text,text,text,text,boolean,bigint)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.scenarios'::regclass
                    AND attname = 'revision' AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.scenarios'::regclass
                    AND tgname = 'scenarios_bump_revision' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Local schema copy must already contain Phase 2(c), its v6 RPC, and existing scenario/turn/fact tables';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relname IN
               ('analysis_runs', 'analysis_run_options', 'analysis_run_quarantine', 'latest_successful_run'))
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public' AND p.proname = 'append_turn_atomic_v7') THEN
    RAISE EXCEPTION 'Rehearsal requires every Phase 2(a) object and every v7 overload to be absent';
  END IF;
  RAISE NOTICE 'PASS preflight (local Phase 2(c) schema, no Phase 2(a) objects)';
END;
$preflight$;

CREATE TEMP TABLE phase2_a_counts_before ON COMMIT DROP AS
SELECT (SELECT count(*) FROM public.scenarios) AS scenarios,
       (SELECT count(*) FROM public.v5_conversation_turns) AS turns,
       (SELECT count(*) FROM public.v5_handler_facts) AS facts;
SELECT scenarios AS phase2_a_original_scenarios,
       turns AS phase2_a_original_turns,
       facts AS phase2_a_original_facts FROM phase2_a_counts_before
\gset

-- Capture existing public relations/ACLs and exact function bodies so the
-- rollback check detects collateral schema changes, including any v2-v6 edit.
CREATE TEMP TABLE phase2_a_schema_before ON COMMIT DROP AS
SELECT 'relation'::text AS kind, c.oid,
       jsonb_build_object('name', c.relname, 'kind', c.relkind,
                          'acl', c.relacl, 'options', c.reloptions) AS definition
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'
UNION ALL
SELECT 'function', p.oid,
       jsonb_build_object('definition', pg_get_functiondef(p.oid), 'acl', p.proacl)
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prokind <> 'a';

SELECT 'before proposal and synthetic seed' AS phase,
       scenarios AS scenarios_rows, turns AS v5_conversation_turns_rows,
       facts AS v5_handler_facts_rows FROM phase2_a_counts_before;

\ir ../../supabase/migrations/20261008170000_phase2_a_typed_runs.sql

CREATE TEMP TABLE phase2_a_results (
  check_name TEXT PRIMARY KEY, passed BOOLEAN NOT NULL, detail TEXT
) ON COMMIT DROP;
CREATE TEMP TABLE phase2_a_seed (scenario_id UUID NOT NULL) ON COMMIT DROP;

-- Anonymous-role probes may only append their PASS/FAIL report to this temporary
-- local harness table. No access to the proposed product tables is granted.
GRANT INSERT ON TABLE phase2_a_results TO anon, authenticated;
DO $temporary_report_access$
BEGIN
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO anon, authenticated',
                 (SELECT nspname FROM pg_namespace WHERE oid = pg_my_temp_schema()));
END;
$temporary_report_access$;

CREATE FUNCTION pg_temp.phase2_a_append(
  scenario_id UUID, turn_id TEXT, mutation_id UUID, expected_revision BIGINT,
  graph JSONB, incoming_hash TEXT, facts JSONB, runs JSONB
)
RETURNS JSONB
LANGUAGE SQL
AS $helper$
  SELECT public.append_turn_atomic_v7(
    p_scenario_id => scenario_id, p_turn_id => turn_id,
    p_turn_class => 'handler', p_handler_id => 'run_analysis',
    p_request_hash => 'phase2-a:request:' || turn_id,
    p_response_emitted => TRUE, p_llm_calls_used => 0, p_duration_ms => 0,
    p_handler_facts => facts, p_graph => graph, p_brief_text => NULL,
    p_pending_actions => '[]'::jsonb, p_coaching_state => NULL,
    p_user_message => 'Synthetic local typed-run rehearsal.',
    p_assistant_message => 'Synthetic local typed-run receipt.',
    p_expected_graph_identity_hash => NULL,
    p_incoming_graph_identity_hash => incoming_hash, p_cas_enforce => FALSE,
    p_fence_generation => NULL, p_version_mutation_id => mutation_id,
    p_version_analysis_affecting_hash => incoming_hash,
    p_version_hash_algorithm => 'sha256', p_version_projection_version => '1',
    p_version_normaliser_version => '1', p_version_graph_schema_version => '1',
    p_version_actor_kind => 'system', p_version_authored_by => NULL,
    p_version_creation_kind => 'committed_mutation',
    p_version_source_turn_id => turn_id, p_expected_base_known => FALSE,
    p_expected_revision => expected_revision, p_runs => runs
  );
$helper$;

DO $rehearsal$
DECLARE
  v_scenario UUID := gen_random_uuid();
  v_mutation_r1 UUID := gen_random_uuid();
  v_case RECORD;
  v_run JSONB;
  v_fact JSONB;
  v_graph JSONB;
  v_snapshot JSONB;
  v_result JSONB;
  v_fresh_result JSONB;
  v_scenario_before JSONB;
  v_turns_before BIGINT;
  v_facts_before BIGINT;
  v_runs_before BIGINT;
  v_options_before BIGINT;
  v_refused BOOLEAN;
  v_latest TEXT;
BEGIN
  INSERT INTO public.scenarios (id, user_id, graph)
  VALUES (v_scenario, NULL, '{"nodes":[],"edges":[]}'::jsonb);
  INSERT INTO phase2_a_seed VALUES (v_scenario);

  FOR v_case IN SELECT * FROM (VALUES
    ('fresh_R1', 'R1', 'turn-R1', 1, 'succeeded'),
    ('replay_R1', 'R1', 'turn-R1', 1, 'succeeded'),
    ('succeeded_revision_2', 'R2', 'turn-R2', 2, 'succeeded'),
    ('failed_revision_3', 'R3', 'turn-R3', 3, 'failed'),
    ('missing_fact_atomic_refusal', 'R-missing', 'turn-missing', 4, 'succeeded')
  ) AS cases(check_name, run_id, turn_id, revision, status)
  LOOP
    BEGIN
      SELECT to_jsonb(s) INTO v_scenario_before FROM public.scenarios s WHERE id = v_scenario;
      SELECT count(*) INTO v_turns_before FROM public.v5_conversation_turns;
      SELECT count(*) INTO v_facts_before FROM public.v5_handler_facts;
      SELECT count(*) INTO v_runs_before FROM public.analysis_runs;
      SELECT count(*) INTO v_options_before FROM public.analysis_run_options;
      v_graph := jsonb_build_object('nodes', jsonb_build_array(jsonb_build_object(
        'id', 'phase2-a-goal', 'type', 'goal', 'label', 'Synthetic revision ' || v_case.revision)),
        'edges', '[]'::jsonb);
      v_snapshot := jsonb_build_object('sent_digest', repeat(v_case.revision::text, 64),
                                       'graph', v_graph, 'options', '[]'::jsonb);
      v_run := jsonb_build_object(
        'run_id', v_case.run_id, 'canonical_request_hash', repeat(v_case.revision::text, 64),
        'status', v_case.status, 'computed_at', '2026-10-08T17:00:00Z',
        -- graph_hash_at_run is an analysis-affecting hash, not graph identity.
        -- The mapper has no trusted same-run full identity here, so it stores NULL.
        'graph_identity_hash', NULL, 'input_snapshot', v_snapshot,
        'options', CASE WHEN v_case.status = 'failed' THEN '[]'::jsonb
          WHEN v_case.run_id = 'R1' THEN '[{"option_id":"option-a","chance":0.6,"low":0.4,"high":0.8,"licence_status":"permitted","withheld_reason":null,"driver":null},{"option_id":"option-b","chance":null,"low":null,"high":null,"licence_status":"withheld","withheld_reason":"GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED","driver":null}]'::jsonb
          ELSE '[{"option_id":"option-a","chance":0.7,"low":0.5,"high":0.9,"licence_status":"permitted_with_caveat","withheld_reason":null,"driver":null}]'::jsonb END
      );
      -- Match the production serializer's payload.result path. The orphan case
      -- deliberately carries a different run identity in its otherwise valid fact.
      v_fact := jsonb_build_object('handler_id', 'run_analysis', 'action_type', 'run_analysis',
        'noop', FALSE, 'payload', jsonb_build_object('fact_type', 'run_analysis', 'fact_version', 1,
          'result', jsonb_build_object('scenario_id', v_scenario,
            'run_id', CASE WHEN v_case.check_name = 'missing_fact_atomic_refusal' THEN 'R-other' ELSE v_case.run_id END,
            'computed_at', '2026-10-08T17:00:00Z', 'input_snapshot', v_snapshot,
            'graph_hash_at_run', repeat(v_case.revision::text, 16))));
      v_result := NULL;
      v_refused := FALSE;
      BEGIN
        v_result := pg_temp.phase2_a_append(
          v_scenario, v_case.turn_id,
          CASE WHEN v_case.run_id = 'R1' THEN v_mutation_r1 ELSE gen_random_uuid() END,
          CASE WHEN v_case.check_name = 'replay_R1' THEN 0 ELSE (v_scenario_before->>'revision')::bigint END,
          v_graph, repeat(v_case.revision::text, 64), jsonb_build_array(v_fact), jsonb_build_array(v_run)
        );
      EXCEPTION WHEN foreign_key_violation THEN
        IF v_case.check_name <> 'missing_fact_atomic_refusal'
           OR SQLERRM NOT LIKE 'append_turn_atomic_v7: run % must match exactly one handler fact%' THEN
          RAISE;
        END IF;
        v_refused := TRUE;
      END;

      IF v_case.check_name = 'missing_fact_atomic_refusal' THEN
        IF NOT v_refused OR v_result IS NOT NULL
           OR (SELECT to_jsonb(s) FROM public.scenarios s WHERE id = v_scenario) IS DISTINCT FROM v_scenario_before
           OR (SELECT count(*) FROM public.v5_conversation_turns) <> v_turns_before
           OR (SELECT count(*) FROM public.v5_handler_facts) <> v_facts_before
           OR (SELECT count(*) FROM public.analysis_runs) <> v_runs_before
           OR (SELECT count(*) FROM public.analysis_run_options) <> v_options_before
           OR EXISTS (SELECT 1 FROM public.v5_conversation_turns WHERE scenario_id = v_scenario AND turn_id = v_case.turn_id) THEN
          RAISE EXCEPTION 'Missing fact must RAISE and leave scenario, turn, fact, run and option rows unchanged';
        END IF;
      ELSIF v_case.check_name = 'replay_R1' THEN
        IF v_result IS DISTINCT FROM v_fresh_result
           OR (SELECT to_jsonb(s) FROM public.scenarios s WHERE id = v_scenario) IS DISTINCT FROM v_scenario_before
           OR (SELECT count(*) FROM public.v5_conversation_turns) <> v_turns_before
           OR (SELECT count(*) FROM public.v5_handler_facts) <> v_facts_before
           OR (SELECT count(*) FROM public.analysis_runs) <> v_runs_before
           OR (SELECT count(*) FROM public.analysis_run_options) <> v_options_before THEN
          RAISE EXCEPTION 'Replay with stale expected revision and p_runs must recover the same receipt and write nothing';
        END IF;
      ELSE
        IF v_result IS NULL OR (v_result->>'revision')::bigint <> v_case.revision
           OR (SELECT count(*) FROM public.v5_conversation_turns) <> v_turns_before + 1
           OR (SELECT count(*) FROM public.v5_handler_facts) <> v_facts_before + 1
           OR (SELECT count(*) FROM public.analysis_runs) <> v_runs_before + 1
           OR (SELECT count(*) FROM public.analysis_run_options) <> v_options_before + jsonb_array_length(v_run->'options')
           OR NOT EXISTS (
             SELECT 1 FROM public.analysis_runs r JOIN public.v5_handler_facts f ON f.id = r.fact_id
             WHERE r.run_id = v_case.run_id AND r.scenario_id = v_scenario
               AND r.scenario_revision = (v_result->>'revision')::bigint
               AND r.user_id IS NULL AND r.status = v_case.status
               AND r.canonical_request_hash = v_snapshot->>'sent_digest'
               AND r.input_snapshot = v_snapshot
               AND f.v5_conversation_turn_id = (v_result->>'turn_row_id')::uuid
               AND f.payload #>> '{result,run_id}' = r.run_id
           ) THEN
          RAISE EXCEPTION 'Fresh run must bind its revision, canonical hash, snapshot, fact and every option atomically';
        END IF;
        IF v_case.check_name = 'fresh_R1' THEN
          v_fresh_result := v_result;
          IF NOT EXISTS (SELECT 1 FROM public.analysis_run_options
                         WHERE run_id = 'R1' AND option_id = 'option-b' AND chance IS NULL
                           AND licence_status = 'withheld' AND withheld_reason IS NOT NULL) THEN
            RAISE EXCEPTION 'Withheld option must have NULL chance and a reason';
          END IF;
        END IF;
        SELECT run_id INTO v_latest FROM public.latest_successful_run WHERE scenario_id = v_scenario;
        IF v_latest IS DISTINCT FROM CASE WHEN v_case.status = 'failed' THEN 'R2' ELSE v_case.run_id END THEN
          RAISE EXCEPTION 'Latest successful run must choose R2 at revision 2 and ignore failed R3 at revision 3; got %', v_latest;
        END IF;
      END IF;
      INSERT INTO phase2_a_results VALUES (v_case.check_name, TRUE, NULL);
      RAISE NOTICE 'PASS %', v_case.check_name;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO phase2_a_results VALUES (v_case.check_name, FALSE, format('[%s] %s', SQLSTATE, SQLERRM));
      RAISE NOTICE 'FAIL % [%]: %', v_case.check_name, SQLSTATE, SQLERRM;
    END;
  END LOOP;

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
               AND tablename IN ('analysis_runs', 'analysis_run_options', 'analysis_run_quarantine'))
       OR (SELECT count(*) FROM pg_class WHERE oid IN ('public.analysis_runs'::regclass,
                 'public.analysis_run_options'::regclass, 'public.analysis_run_quarantine'::regclass)
           AND relrowsecurity) <> 3
       OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.latest_successful_run'::regclass
                       AND reloptions @> ARRAY['security_invoker=true'])
       OR NOT has_table_privilege('service_role', 'public.analysis_runs', 'SELECT')
       OR NOT has_table_privilege('service_role', 'public.analysis_run_options', 'SELECT')
       OR NOT has_table_privilege('service_role', 'public.analysis_run_quarantine', 'SELECT')
       OR NOT has_table_privilege('service_role', 'public.latest_successful_run', 'SELECT')
       OR NOT has_function_privilege('service_role', 'public.append_turn_atomic_v7(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,text,text,boolean,bigint,uuid,text,text,text,text,text,text,text,text,text,boolean,bigint,jsonb)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.append_turn_atomic_v7(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,text,text,boolean,bigint,uuid,text,text,text,text,text,text,text,text,text,boolean,bigint,jsonb)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.append_turn_atomic_v7(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,text,text,boolean,bigint,uuid,text,text,text,text,text,text,text,text,text,boolean,bigint,jsonb)', 'EXECUTE') THEN
      RAISE EXCEPTION 'RLS, invoker view and service-only v7 ACLs must match the proposal';
    END IF;
    INSERT INTO phase2_a_results VALUES ('rls_view_rpc_acl', TRUE, NULL);
    RAISE NOTICE 'PASS rls_view_rpc_acl';
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO phase2_a_results VALUES ('rls_view_rpc_acl', FALSE, format('[%s] %s', SQLSTATE, SQLERRM));
    RAISE NOTICE 'FAIL rls_view_rpc_acl [%]: %', SQLSTATE, SQLERRM;
  END;
END;
$rehearsal$;

-- Run actual SELECT attempts as each restricted role inside an explicit savepoint.
-- Catch expected permission errors locally so all four surfaces report a row.
SAVEPOINT phase2_a_anon_acl;
SET LOCAL ROLE anon;
DO $anon_acl$
DECLARE v_table TEXT; v_denied BOOLEAN; v_detail TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['analysis_runs', 'analysis_run_options', 'analysis_run_quarantine', 'latest_successful_run'] LOOP
    v_denied := FALSE; v_detail := NULL;
    BEGIN
      EXECUTE format('SELECT 1 FROM public.%I LIMIT 1', v_table);
    EXCEPTION WHEN insufficient_privilege THEN
      v_denied := TRUE;
    WHEN OTHERS THEN
      v_detail := format('[%s] %s', SQLSTATE, SQLERRM);
    END;
    INSERT INTO pg_temp.phase2_a_results VALUES ('anon_cannot_select_' || v_table, v_denied, v_detail);
    RAISE NOTICE '% anon_cannot_select_%', CASE WHEN v_denied THEN 'PASS' ELSE 'FAIL' END, v_table;
  END LOOP;
END;
$anon_acl$;
RESET ROLE;
RELEASE SAVEPOINT phase2_a_anon_acl;

SAVEPOINT phase2_a_authenticated_acl;
SET LOCAL ROLE authenticated;
DO $authenticated_acl$
DECLARE v_table TEXT; v_denied BOOLEAN; v_detail TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['analysis_runs', 'analysis_run_options', 'analysis_run_quarantine', 'latest_successful_run'] LOOP
    v_denied := FALSE; v_detail := NULL;
    BEGIN
      EXECUTE format('SELECT 1 FROM public.%I LIMIT 1', v_table);
    EXCEPTION WHEN insufficient_privilege THEN
      v_denied := TRUE;
    WHEN OTHERS THEN
      v_detail := format('[%s] %s', SQLSTATE, SQLERRM);
    END;
    INSERT INTO pg_temp.phase2_a_results VALUES ('authenticated_cannot_select_' || v_table, v_denied, v_detail);
    RAISE NOTICE '% authenticated_cannot_select_%', CASE WHEN v_denied THEN 'PASS' ELSE 'FAIL' END, v_table;
  END LOOP;
END;
$authenticated_acl$;
RESET ROLE;
RELEASE SAVEPOINT phase2_a_authenticated_acl;

SELECT 'after fresh turns, replay and refusal' AS phase,
       (SELECT count(*) FROM public.scenarios) AS scenarios_rows,
       (SELECT count(*) FROM public.v5_conversation_turns) AS v5_conversation_turns_rows,
       (SELECT count(*) FROM public.v5_handler_facts) AS v5_handler_facts_rows,
       (SELECT count(*) FROM public.analysis_runs) AS analysis_runs_rows,
       (SELECT count(*) FROM public.analysis_run_options) AS analysis_run_options_rows,
       (SELECT count(*) FROM public.analysis_run_quarantine) AS analysis_run_quarantine_rows;

CREATE TEMP TABLE phase2_a_counts_after ON COMMIT DROP AS
SELECT (SELECT count(*) FROM public.scenarios) AS scenarios,
       (SELECT count(*) FROM public.v5_conversation_turns) AS turns,
       (SELECT count(*) FROM public.v5_handler_facts) AS facts;

\ir ../../supabase/migrations/rollback/20261008170000_phase2_a_typed_runs_rollback.sql.do-not-apply

DO $rollback_assertions$
DECLARE v_failures TEXT;
BEGIN
  BEGIN
    IF to_regclass('public.analysis_runs') IS NOT NULL
       OR to_regclass('public.analysis_run_options') IS NOT NULL
       OR to_regclass('public.analysis_run_quarantine') IS NOT NULL
       OR to_regclass('public.latest_successful_run') IS NOT NULL
       OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'append_turn_atomic_v7') THEN
      RAISE EXCEPTION 'Rollback left a Phase 2(a) object installed';
    END IF;
    IF EXISTS (
      WITH current_schema AS (
        SELECT 'relation'::text AS kind, c.oid,
               jsonb_build_object('name', c.relname, 'kind', c.relkind, 'acl', c.relacl, 'options', c.reloptions) AS definition
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'
        UNION ALL
        SELECT 'function', p.oid, jsonb_build_object('definition', pg_get_functiondef(p.oid), 'acl', p.proacl)
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prokind <> 'a'
      )
      SELECT 1 FROM current_schema c FULL JOIN phase2_a_schema_before b USING (kind, oid)
      WHERE c.definition IS DISTINCT FROM b.definition
    ) OR EXISTS (
      SELECT 1 FROM phase2_a_counts_after
      WHERE scenarios <> (SELECT count(*) FROM public.scenarios)
         OR turns <> (SELECT count(*) FROM public.v5_conversation_turns)
         OR facts <> (SELECT count(*) FROM public.v5_handler_facts)
    ) THEN
      RAISE EXCEPTION 'Rollback must remove exactly the new objects and preserve existing schema, ACLs, RPC bodies and data';
    END IF;
    INSERT INTO phase2_a_results VALUES ('rollback_exact_new_objects', TRUE, NULL);
    RAISE NOTICE 'PASS rollback_exact_new_objects';
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO phase2_a_results VALUES ('rollback_exact_new_objects', FALSE, format('[%s] %s', SQLSTATE, SQLERRM));
    RAISE NOTICE 'FAIL rollback_exact_new_objects [%]: %', SQLSTATE, SQLERRM;
  END;

  BEGIN
    IF (SELECT count(*) FROM public.scenarios) <> (SELECT scenarios + 1 FROM phase2_a_counts_before)
       OR (SELECT count(*) FROM public.v5_conversation_turns) <> (SELECT turns + 3 FROM phase2_a_counts_before)
       OR (SELECT count(*) FROM public.v5_handler_facts) <> (SELECT facts + 3 FROM phase2_a_counts_before) THEN
      RAISE EXCEPTION 'Final existing-table counts must be exactly one scenario, three fresh turns and three facts above baseline';
    END IF;
    INSERT INTO phase2_a_results VALUES ('final_counts', TRUE, NULL);
    RAISE NOTICE 'PASS final_counts';
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO phase2_a_results VALUES ('final_counts', FALSE, format('[%s] %s', SQLSTATE, SQLERRM));
    RAISE NOTICE 'FAIL final_counts [%]: %', SQLSTATE, SQLERRM;
  END;

  SELECT string_agg(check_name || ': ' || COALESCE(detail, 'expected permission denial did not occur'), '; ' ORDER BY check_name)
    INTO v_failures FROM phase2_a_results WHERE NOT passed;
  IF v_failures IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 2(a) rehearsal FAIL: %', v_failures;
  END IF;
END;
$rollback_assertions$;

SELECT CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS result, check_name, detail
FROM phase2_a_results ORDER BY check_name;
SELECT 'after proposal rollback (synthetic data still inside transaction)' AS phase,
       (SELECT count(*) FROM public.scenarios) AS scenarios_rows,
       (SELECT count(*) FROM public.v5_conversation_turns) AS v5_conversation_turns_rows,
       (SELECT count(*) FROM public.v5_handler_facts) AS v5_handler_facts_rows;

ROLLBACK;

SELECT 'after transaction cleanup (original counts restored)' AS phase,
       (SELECT count(*) FROM public.scenarios) AS scenarios_rows,
       (SELECT count(*) FROM public.v5_conversation_turns) AS v5_conversation_turns_rows,
       (SELECT count(*) FROM public.v5_handler_facts) AS v5_handler_facts_rows;
SELECT (SELECT count(*) FROM public.scenarios) = :phase2_a_original_scenarios
   AND (SELECT count(*) FROM public.v5_conversation_turns) = :phase2_a_original_turns
   AND (SELECT count(*) FROM public.v5_handler_facts) = :phase2_a_original_facts
   AS phase2_a_counts_restored
\gset
\if :phase2_a_counts_restored
  \echo 'PASS transaction cleanup restored original row counts.'
\else
  \echo 'FAIL transaction cleanup changed original row counts.'
  DO $cleanup_failure$ BEGIN RAISE EXCEPTION 'Phase 2(a) cleanup row-count mismatch'; END; $cleanup_failure$;
\endif
