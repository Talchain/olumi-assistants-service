-- PROPOSAL REHEARSAL — NOT EXECUTED; LOCAL STACK ONLY.
-- Run against an isolated, schema-only copy with the existing v5 RPC and its
-- dependencies already installed. The repository cannot reconstruct scenarios.
-- Example (from the repository root; supply the local password separately):
--   psql -X --host=127.0.0.1 --port=54322 --username=postgres --dbname=postgres \
--     --file=scripts/phase2/rehearse-c.sql
-- No shared DB/data, Docker provisioning, or production migration execution.
-- Every seed and both DDL scripts run in one transaction, rolled back at end.
-- Each row prints PASS/FAIL; any FAIL raises after all rows and stops psql.
-- Disconnection rolls back the transaction.

\set ON_ERROR_STOP on
\set ON_ERROR_ROLLBACK off

-- Fail closed on the actual psql connection host before any DDL or seed write.
-- Unix sockets and loopback hosts are the only supported local endpoints.
SELECT :'HOST' IN ('localhost', '127.0.0.1', '::1')
       OR :'HOST' LIKE '/%' AS phase2_c_local_endpoint
\gset
\if :phase2_c_local_endpoint
\else
  \echo 'REFUSED: rehearse-c.sql requires a loopback host or local Unix socket.'
  \quit 3
\endif

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.scenarios') IS NULL
     OR to_regclass('public.v5_conversation_turns') IS NULL
     OR to_regclass('public.v5_handler_facts') IS NULL THEN
    RAISE EXCEPTION 'Local schema copy is missing the existing scenario/turn/fact tables';
  END IF;
  IF to_regprocedure('public.append_turn_atomic_v5(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,text,text,boolean,bigint,uuid,text,text,text,text,text,text,text,text,text,boolean)') IS NULL THEN
    RAISE EXCEPTION 'Local schema copy is missing append_turn_atomic_v5 with the expected signature';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.scenarios'::regclass
      AND attname = 'revision' AND NOT attisdropped
  ) OR EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'append_turn_atomic_v6'
  ) THEN
    RAISE EXCEPTION 'Rehearsal requires revision and every append_turn_atomic_v6 overload to be absent; rollback must remove only this proposal';
  END IF;
END;
$preflight$;

CREATE TEMP TABLE phase2_c_counts_before ON COMMIT DROP AS
SELECT (SELECT count(*) FROM public.scenarios) AS scenarios,
       (SELECT count(*) FROM public.v5_conversation_turns) AS turns,
       (SELECT count(*) FROM public.v5_handler_facts) AS facts;

SELECT 'before proposal and synthetic seeds' AS phase,
       scenarios AS scenarios_rows,
       turns AS v5_conversation_turns_rows,
       facts AS v5_handler_facts_rows
FROM phase2_c_counts_before;

\ir ../../supabase/migrations/20261008160000_phase2_c_scenario_revision.sql

DO $rehearsal$
DECLARE
  v_scenario_a UUID := gen_random_uuid();
  v_scenario_b UUID := gen_random_uuid();
  v_mutation_a UUID := gen_random_uuid();
  v_mutation_b UUID := gen_random_uuid();
  v_mutation_current UUID := gen_random_uuid();
  v_mutation_refused UUID := gen_random_uuid();
  v_graph JSONB := '{"nodes":[],"edges":[]}'::jsonb;
  v_case RECORD;
  v_result JSONB;
  v_fresh_result JSONB;
  v_turn_row_id UUID;
  v_revision BIGINT;
  v_scenario_before JSONB;
  v_turns_before BIGINT;
  v_facts_before BIGINT;
  v_cas_refused BOOLEAN;
  v_revision_refused BOOLEAN;
  v_error_detail TEXT;
  v_failures TEXT[] := ARRAY[]::text[];
BEGIN
  -- Minimal synthetic guests: the existing ensure_scenario_exists writer uses
  -- exactly these columns. No auth users or model-version rows are required.
  INSERT INTO public.scenarios (id, user_id)
  VALUES (v_scenario_a, NULL), (v_scenario_b, NULL);
  IF (SELECT count(*) FROM public.scenarios
      WHERE id IN (v_scenario_a, v_scenario_b) AND revision = 0) <> 2 THEN
    RAISE EXCEPTION 'Both synthetic scenarios must start at revision 0';
  END IF;

  -- Each call carries a real fact, so a refusal/replay that leaks side effects
  -- is observable. The replay repeats scenario, turn, request hash AND mutation.
  -- Its stale expected revision proves replay recovery skips revision CAS;
  -- v5 retains authority over the supplied stale graph expectation.
  FOR v_case IN
    SELECT * FROM (VALUES
      ('seed_fresh', v_scenario_a, 'phase2-c-fresh', 'phase2-c:request-a',
       0::bigint, v_mutation_a, NULL::text, repeat('a', 64), FALSE, 'seed_fresh'),
      ('replay_stale_expected', v_scenario_a, 'phase2-c-fresh', 'phase2-c:request-a',
       0::bigint, v_mutation_a, repeat('c', 64), repeat('a', 64), TRUE, 'seed_fresh'),
      ('fresh_stale_expected', v_scenario_a, 'phase2-c-stale', 'phase2-c:request-stale',
       0::bigint, v_mutation_refused, repeat('a', 64), repeat('b', 64), TRUE, 'fresh_stale_expected'),
      ('fresh_current_expected', v_scenario_a, 'phase2-c-current', 'phase2-c:request-current',
       1::bigint, v_mutation_current, repeat('a', 64), repeat('b', 64), TRUE, 'fresh_current_expected'),
      ('independent_fresh', v_scenario_b, 'phase2-c-fresh-b', 'phase2-c:request-b',
       0::bigint, v_mutation_b, NULL::text, repeat('a', 64), FALSE, 'independent_fresh'),
      ('v5_cas_refusal', v_scenario_a, 'phase2-c-v5-cas', 'phase2-c:request-cas',
       2::bigint, v_mutation_refused, repeat('c', 64), repeat('d', 64), TRUE, 'v5_cas_refusal')
    ) AS cases(stage, scenario_id, turn_id, request_hash, expected_revision,
               mutation_id, expected_hash, incoming_hash, expected_base_known, fact_marker)
  LOOP
    -- An assertion failure rolls back this row's work, records FAIL and allows
    -- every remaining row to report. The final aggregate refuses any failure.
    BEGIN
      SELECT to_jsonb(s) INTO v_scenario_before
        FROM public.scenarios s WHERE s.id = v_case.scenario_id;
      SELECT count(*) INTO v_turns_before FROM public.v5_conversation_turns;
      SELECT count(*) INTO v_facts_before FROM public.v5_handler_facts;
      v_cas_refused := FALSE;
      v_revision_refused := FALSE;
      v_error_detail := NULL;
      v_result := NULL;

      BEGIN
        v_result := public.append_turn_atomic_v6(
          p_scenario_id => v_case.scenario_id,
          p_turn_id => v_case.turn_id,
          p_turn_class => 'handler',
          p_handler_id => 'phase2_c.rehearsal',
          p_request_hash => v_case.request_hash,
          p_response_emitted => TRUE,
          p_llm_calls_used => 0,
          p_duration_ms => 0,
          p_handler_facts => jsonb_build_array(jsonb_build_object(
            'handler_id', 'phase2_c.rehearsal',
            'action_type', 'scenario_revision_probe',
            'noop', FALSE,
            'payload', jsonb_build_object(
              'fixture', v_case.fact_marker, 'turn_id', v_case.turn_id)
          )),
          p_graph => v_graph,
          p_brief_text => NULL,
          p_pending_actions => '[]'::jsonb,
          p_coaching_state => NULL,
          p_user_message => 'Synthetic local revision rehearsal.',
          p_assistant_message => 'Synthetic local revision rehearsal receipt.',
          p_expected_graph_identity_hash => v_case.expected_hash,
          p_incoming_graph_identity_hash => v_case.incoming_hash,
          p_cas_enforce => TRUE,
          p_fence_generation => NULL,
          p_version_mutation_id => v_case.mutation_id,
          p_version_analysis_affecting_hash => v_case.incoming_hash,
          p_version_hash_algorithm => 'sha256',
          p_version_projection_version => '1',
          p_version_normaliser_version => '1',
          p_version_graph_schema_version => '1',
          p_version_actor_kind => 'system',
          p_version_authored_by => NULL,
          p_version_creation_kind => 'committed_mutation',
          p_version_source_turn_id => v_case.turn_id,
          p_expected_base_known => v_case.expected_base_known,
          p_expected_revision => v_case.expected_revision
        );
      EXCEPTION WHEN SQLSTATE 'OLRV1' THEN
        IF v_case.stage <> 'fresh_stale_expected' THEN
          RAISE;
        END IF;
        v_revision_refused := TRUE;
        GET STACKED DIAGNOSTICS v_error_detail = PG_EXCEPTION_DETAIL;
      WHEN SQLSTATE 'OLGC1' THEN
        IF v_case.stage <> 'v5_cas_refusal' THEN
          RAISE;
        END IF;
        v_cas_refused := TRUE;
      END;

      SELECT revision INTO v_revision FROM public.scenarios
        WHERE id = v_case.scenario_id;

      IF v_case.stage IN ('seed_fresh', 'fresh_current_expected', 'independent_fresh') THEN
        IF v_result IS NULL
           OR (v_result->>'revision')::bigint IS DISTINCT FROM v_case.expected_revision + 1
           OR v_revision IS DISTINCT FROM v_case.expected_revision + 1
           OR v_revision IS DISTINCT FROM (v_scenario_before->>'revision')::bigint + 1
           OR v_result->>'turn_row_id' IS NULL
           OR NOT v_result ? 'model_version_receipt'
           OR v_result->'model_version_receipt' IS DISTINCT FROM 'null'::jsonb
           OR v_result ? 'reason' THEN
          RAISE EXCEPTION '%: fresh guest commit must return the v5 envelope and bump revision once; got %', v_case.stage, v_result;
        END IF;
        v_turn_row_id := (v_result->>'turn_row_id')::uuid;
        IF (SELECT count(*) FROM public.v5_conversation_turns) <> v_turns_before + 1
           OR (SELECT count(*) FROM public.v5_handler_facts) <> v_facts_before + 1
           OR NOT EXISTS (
             SELECT 1 FROM public.v5_conversation_turns
             WHERE id = v_turn_row_id AND scenario_id = v_case.scenario_id
               AND turn_id = v_case.turn_id AND request_hash = v_case.request_hash
           ) OR (SELECT count(*) FROM public.v5_handler_facts
                 WHERE v5_conversation_turn_id = v_turn_row_id
                   AND scenario_id = v_case.scenario_id
                   AND payload->>'turn_id' = v_case.turn_id) <> 1 THEN
          RAISE EXCEPTION '%: fresh commit must persist exactly one matching turn and fact', v_case.stage;
        END IF;
        IF v_case.stage = 'seed_fresh' THEN
          v_fresh_result := v_result;
        END IF;
        IF v_case.stage IN ('seed_fresh', 'fresh_current_expected') THEN
          IF (SELECT revision FROM public.scenarios WHERE id = v_scenario_b) <> 0 THEN
            RAISE EXCEPTION 'Committing scenario A must leave scenario B at revision 0';
          END IF;
        ELSE
          IF (SELECT revision FROM public.scenarios WHERE id = v_scenario_a) <> 2 THEN
            RAISE EXCEPTION 'Committing scenario B must leave scenario A at revision 2';
          END IF;
        END IF;
      ELSE
        IF v_case.stage = 'fresh_stale_expected' THEN
          IF NOT v_revision_refused
             OR v_result IS NOT NULL
             OR v_error_detail::jsonb IS DISTINCT FROM jsonb_build_object(
               'reason', 'revision_conflict', 'expected', v_case.expected_revision,
               'current', (v_scenario_before->>'revision')::bigint
             ) THEN
            RAISE EXCEPTION 'Fresh turn with stale expected revision must raise OLRV1 with expected/current DETAIL; got result %, detail %', v_result, v_error_detail;
          END IF;
        ELSIF v_case.stage = 'replay_stale_expected' THEN
          IF v_result IS NULL
             OR (v_result->>'turn_row_id') IS DISTINCT FROM (v_fresh_result->>'turn_row_id')
             OR (v_result - 'revision') IS DISTINCT FROM (v_fresh_result - 'revision')
             OR (v_result->>'revision')::bigint IS DISTINCT FROM (v_scenario_before->>'revision')::bigint THEN
            RAISE EXCEPTION 'Replay with stale expected revision must return the original v5 row/receipt and current unchanged revision; fresh %, replay %', v_fresh_result, v_result;
          END IF;
        ELSIF NOT v_cas_refused OR v_result IS NOT NULL THEN
          RAISE EXCEPTION 'Matching revision must propagate the existing v5 graph-CAS refusal SQLSTATE OLGC1';
        END IF;

        IF v_revision IS DISTINCT FROM (v_scenario_before->>'revision')::bigint
           OR (SELECT to_jsonb(s) FROM public.scenarios s
               WHERE s.id = v_case.scenario_id) IS DISTINCT FROM v_scenario_before
           OR (SELECT count(*) FROM public.v5_conversation_turns) <> v_turns_before
           OR (SELECT count(*) FROM public.v5_handler_facts) <> v_facts_before THEN
          RAISE EXCEPTION '%: refusal/replay must leave revision, scenario and all turn/fact counts unchanged', v_case.stage;
        END IF;
        IF v_case.stage <> 'replay_stale_expected' AND (
          EXISTS (SELECT 1 FROM public.v5_conversation_turns
                  WHERE scenario_id = v_case.scenario_id AND turn_id = v_case.turn_id)
          OR EXISTS (SELECT 1 FROM public.v5_handler_facts
                     WHERE scenario_id = v_case.scenario_id
                       AND payload->>'turn_id' = v_case.turn_id)
        ) THEN
          RAISE EXCEPTION '%: refused turn/fact identity must be absent', v_case.stage;
        END IF;
      END IF;
      RAISE NOTICE 'PASS % (scenario %, revision %)', v_case.stage, v_case.scenario_id, v_revision;
    EXCEPTION WHEN OTHERS THEN
      v_failures := array_append(v_failures, format('%s [%s]: %s', v_case.stage, SQLSTATE, SQLERRM));
      RAISE NOTICE 'FAIL % (SQLSTATE %): %', v_case.stage, SQLSTATE, SQLERRM;
    END;
  END LOOP;

  BEGIN
    IF (SELECT count(*) FROM public.scenarios) <>
       (SELECT scenarios + 2 FROM phase2_c_counts_before)
       OR (SELECT count(*) FROM public.v5_conversation_turns) <>
       (SELECT turns + 3 FROM phase2_c_counts_before)
       OR (SELECT count(*) FROM public.v5_handler_facts) <>
       (SELECT facts + 3 FROM phase2_c_counts_before) THEN
      RAISE EXCEPTION 'Final counts must be exactly two synthetic scenarios, three fresh turns and three facts above baseline';
    END IF;
    RAISE NOTICE 'PASS final_counts (two scenarios, three turns, three facts above baseline)';
  EXCEPTION WHEN OTHERS THEN
    v_failures := array_append(v_failures, format('final_counts [%s]: %s', SQLSTATE, SQLERRM));
    RAISE NOTICE 'FAIL final_counts (SQLSTATE %): %', SQLSTATE, SQLERRM;
  END;

  IF cardinality(v_failures) > 0 THEN
    RAISE EXCEPTION 'Phase 2(c) rehearsal failed % row(s): %', cardinality(v_failures), array_to_string(v_failures, '; ');
  END IF;
END;
$rehearsal$;

SELECT 'after synthetic commits, refusals and replay' AS phase,
       (SELECT count(*) FROM public.scenarios) AS scenarios_rows,
       (SELECT count(*) FROM public.v5_conversation_turns) AS v5_conversation_turns_rows,
       (SELECT count(*) FROM public.v5_handler_facts) AS v5_handler_facts_rows;

\ir ../../supabase/migrations/rollback/20261008160000_phase2_c_scenario_revision_rollback.sql.do-not-apply

DO $rollback_assertions$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.scenarios'::regclass
      AND attname = 'revision' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'Rollback left scenarios.revision installed';
  END IF;
  IF to_regprocedure('public.append_turn_atomic_v6(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,text,text,boolean,bigint,uuid,text,text,text,text,text,text,text,text,text,boolean,bigint)') IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'append_turn_atomic_v6'
     ) THEN
    RAISE EXCEPTION 'Rollback left append_turn_atomic_v6 installed';
  END IF;
  IF (SELECT count(*) FROM public.scenarios) <>
     (SELECT scenarios + 2 FROM phase2_c_counts_before)
     OR (SELECT count(*) FROM public.v5_conversation_turns) <>
     (SELECT turns + 3 FROM phase2_c_counts_before)
     OR (SELECT count(*) FROM public.v5_handler_facts) <>
     (SELECT facts + 3 FROM phase2_c_counts_before) THEN
    RAISE EXCEPTION 'Proposal rollback unexpectedly changed existing table data';
  END IF;
  RAISE NOTICE 'PASS rollback removed exactly the proposed column/function';
END;
$rollback_assertions$;

SELECT 'after proposal rollback (synthetic data still inside transaction)' AS phase,
       (SELECT count(*) FROM public.scenarios) AS scenarios_rows,
       (SELECT count(*) FROM public.v5_conversation_turns) AS v5_conversation_turns_rows,
       (SELECT count(*) FROM public.v5_handler_facts) AS v5_handler_facts_rows;

-- Discard the synthetic rows and all temporary/DDL changes, even on success.
ROLLBACK;

SELECT 'after transaction cleanup (original counts restored)' AS phase,
       (SELECT count(*) FROM public.scenarios) AS scenarios_rows,
       (SELECT count(*) FROM public.v5_conversation_turns) AS v5_conversation_turns_rows,
       (SELECT count(*) FROM public.v5_handler_facts) AS v5_handler_facts_rows;
