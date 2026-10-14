-- PROPOSAL REHEARSAL, NOT EXECUTED — isolated local schema copy only.
-- Requires existing v4, scenarios.revision and scenarios_bump_revision (c).
-- de rehearses; the DL applies the migration after Paul's approval.
-- Example (provide the local password separately):
--   psql -X --host=127.0.0.1 --port=54322 --username=postgres --dbname=postgres \
--     --file=scripts/phase2/rehearse-v4r.sql
-- All DDL, synthetic rows and role changes share ONE transaction, rolled back.
-- Rows print PASS/FAIL; any failure raises at the end. Disconnect also rolls back.

\set ON_ERROR_STOP on
\set ON_ERROR_ROLLBACK off

-- Same fail-closed endpoint check as rehearse-c.sql, before any write.
SELECT :'HOST' IN ('localhost', '127.0.0.1', '::1')
       OR :'HOST' LIKE '/%' AS phase2_v4r_local_endpoint
\gset
\if :phase2_v4r_local_endpoint
\else
  \echo 'REFUSED: rehearse-v4r.sql requires a loopback host or local Unix socket.'
  \quit 3
\endif

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.scenarios') IS NULL
     OR to_regclass('public.v5_conversation_turns') IS NULL
     OR to_regclass('public.v5_handler_facts') IS NULL
     OR to_regclass('public.v5_turn_fence') IS NULL
     OR to_regprocedure('public.append_turn_atomic_v4(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,text,text,boolean,bigint)') IS NULL THEN
    RAISE EXCEPTION 'Local schema copy is missing existing v4 or its tables';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.scenarios'::regclass AND attname = 'revision'
      AND atttypid = 'bigint'::regtype AND attnotnull AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.scenarios'::regclass
      AND tgname = 'scenarios_bump_revision' AND tgenabled = 'O'
      AND tgfoid = to_regprocedure('public.scenarios_bump_revision()')
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Install the (c) revision column and trigger before this rehearsal';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'append_turn_atomic_v4r'
  ) THEN
    RAISE EXCEPTION 'Every v4r overload must be absent: rehearsal must remove only its proposal';
  END IF;
  IF (SELECT count(*) FROM pg_roles
      WHERE rolname IN ('anon', 'authenticated', 'service_role')) <> 3 THEN
    RAISE EXCEPTION 'Local schema copy must include anon, authenticated and service_role';
  END IF;
END;
$preflight$;

-- Exact catalog snapshots detect changes to v4 or any other public function.
CREATE TEMP TABLE phase2_v4r_functions_before ON COMMIT DROP AS
SELECT p.oid, to_jsonb(p) AS definition
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public';

CREATE TEMP TABLE phase2_v4r_revision_before ON COMMIT DROP AS
SELECT to_jsonb(a) AS column_definition, to_jsonb(t) AS trigger_definition
FROM pg_attribute a JOIN pg_trigger t ON t.tgrelid = a.attrelid
WHERE a.attrelid = 'public.scenarios'::regclass AND a.attname = 'revision'
  AND t.tgname = 'scenarios_bump_revision' AND NOT t.tgisinternal;

CREATE TEMP TABLE phase2_v4r_results (
  row_name TEXT PRIMARY KEY, passed BOOLEAN NOT NULL, detail TEXT
) ON COMMIT DROP;
CREATE TEMP TABLE phase2_v4r_fixture (
  scenario_id UUID PRIMARY KEY
) ON COMMIT DROP;

\ir ../../supabase/migrations/20261008200000_phase2_c_v4_revision_cas.sql

DO $rows$
DECLARE
  v_scenario UUID := gen_random_uuid();
  v_graph_empty JSONB := '{"nodes":[],"edges":[]}'::jsonb;
  v_graph_a JSONB := '{"nodes":[{"id":"v4r-goal","type":"goal","label":"Synthetic local goal"}],"edges":[]}'::jsonb;
  v_graph_b JSONB := '{"nodes":[{"id":"v4r-goal","type":"goal","label":"Changed synthetic local goal"}],"edges":[]}'::jsonb;
  v_stage TEXT;
  v_turn TEXT;
  v_graph JSONB;
  v_expected BIGINT;
  v_before BIGINT;
  v_after BIGINT;
  v_fresh_expected BIGINT;
  v_fresh_result JSONB;
  v_result JSONB;
  v_scenario_before JSONB;
  v_turns_before BIGINT;
  v_facts_before BIGINT;
  v_refused BOOLEAN;
  v_detail TEXT;
  v_message TEXT;
BEGIN
  INSERT INTO public.scenarios (id, user_id, graph)
  VALUES (v_scenario, NULL, v_graph_empty);
  INSERT INTO phase2_v4r_fixture VALUES (v_scenario);

  FOREACH v_stage IN ARRAY ARRAY[
    'fresh_graph', 'stale_expected', 'replay_stale_expected',
    'non_graph', 'delegated_fence_OLTF3'
  ] LOOP
    BEGIN
      SELECT revision, to_jsonb(s) INTO v_before, v_scenario_before
      FROM public.scenarios s WHERE id = v_scenario;
      SELECT count(*) INTO v_turns_before FROM public.v5_conversation_turns
      WHERE scenario_id = v_scenario;
      SELECT count(*) INTO v_facts_before FROM public.v5_handler_facts
      WHERE scenario_id = v_scenario;

      v_turn := CASE WHEN v_stage = 'replay_stale_expected'
                     THEN 'v4r-fresh_graph' ELSE 'v4r-' || v_stage END;
      v_graph := CASE v_stage WHEN 'fresh_graph' THEN v_graph_a
                              WHEN 'non_graph' THEN NULL ELSE v_graph_b END;
      v_expected := CASE v_stage WHEN 'stale_expected' THEN v_before - 1
                                 WHEN 'replay_stale_expected' THEN v_fresh_expected
                                 ELSE v_before END;
      v_result := NULL;
      v_refused := FALSE;
      v_detail := NULL;
      v_message := NULL;
      IF v_stage = 'delegated_fence_OLTF3' AND EXISTS (
        SELECT 1 FROM public.v5_turn_fence
        WHERE scenario_id = v_scenario AND generation = 9223372036854775807
      ) THEN
        RAISE EXCEPTION 'Bogus fence generation unexpectedly exists';
      END IF;
      IF v_stage = 'replay_stale_expected' AND
         (v_fresh_result IS NULL OR v_expected IS NOT DISTINCT FROM v_before) THEN
        RAISE EXCEPTION 'Replay requires a successful fresh append and stale expected revision';
      END IF;

      BEGIN
        v_result := public.append_turn_atomic_v4r(
          p_scenario_id => v_scenario,
          p_turn_id => v_turn,
          p_turn_class => CASE WHEN v_stage = 'non_graph' THEN 'direct_answer' ELSE 'handler' END,
          p_handler_id => CASE WHEN v_stage = 'non_graph' THEN NULL ELSE 'phase2_v4r.rehearsal' END,
          p_request_hash => CASE WHEN v_stage = 'replay_stale_expected'
                                 THEN 'v4r-fresh_graph' ELSE v_turn END,
          p_response_emitted => TRUE,
          p_llm_calls_used => 0,
          p_duration_ms => 0,
          p_handler_facts => '[]'::jsonb,
          p_graph => v_graph,
          p_brief_text => NULL,
          p_pending_actions => '[]'::jsonb,
          p_coaching_state => NULL,
          p_user_message => 'Synthetic local v4r rehearsal.',
          p_assistant_message => 'Synthetic local v4r receipt.',
          p_expected_graph_identity_hash => NULL,
          p_incoming_graph_identity_hash => CASE WHEN v_graph IS NULL THEN NULL ELSE repeat('a', 64) END,
          p_cas_enforce => FALSE,
          p_fence_generation => CASE WHEN v_stage = 'delegated_fence_OLTF3'
                                     THEN 9223372036854775807::bigint ELSE NULL END,
          p_expected_revision => v_expected
        );
      EXCEPTION
        WHEN SQLSTATE 'OLRV1' THEN
          IF v_stage <> 'stale_expected' THEN RAISE; END IF;
          GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
          v_refused := TRUE;
        WHEN SQLSTATE 'OLTF3' THEN
          IF v_stage <> 'delegated_fence_OLTF3' THEN RAISE; END IF;
          GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
          v_refused := TRUE;
      END;

      SELECT revision INTO v_after FROM public.scenarios WHERE id = v_scenario;
      IF v_stage IN ('stale_expected', 'delegated_fence_OLTF3', 'replay_stale_expected') THEN
        IF v_after IS DISTINCT FROM v_before OR
           (SELECT to_jsonb(s) FROM public.scenarios s WHERE id = v_scenario)
             IS DISTINCT FROM v_scenario_before OR
           (SELECT count(*) FROM public.v5_conversation_turns WHERE scenario_id = v_scenario)
             <> v_turns_before OR
           (SELECT count(*) FROM public.v5_handler_facts WHERE scenario_id = v_scenario)
             <> v_facts_before THEN
          RAISE EXCEPTION 'Refusal/replay changed scenario, revision, turns or facts';
        END IF;
      END IF;

      IF v_stage IN ('stale_expected', 'delegated_fence_OLTF3') THEN
        IF NOT v_refused OR v_result IS NOT NULL OR EXISTS (
          SELECT 1 FROM public.v5_conversation_turns
          WHERE scenario_id = v_scenario AND turn_id = v_turn
        ) THEN
          RAISE EXCEPTION 'Expected refusal with no appended turn';
        END IF;
        IF v_stage = 'stale_expected' AND (
          v_message IS DISTINCT FROM 'append_turn_atomic_v4r: revision_conflict' OR
          v_detail::jsonb IS DISTINCT FROM jsonb_build_object(
            'reason', 'revision_conflict', 'expected', v_expected, 'current', v_before)
        ) THEN
          RAISE EXCEPTION 'OLRV1 message/detail differs from revision-CAS contract';
        END IF;
        IF v_stage = 'delegated_fence_OLTF3' AND (
          v_message NOT LIKE 'append_turn_atomic_v4: no fence row for scenario %' OR
          v_detail::jsonb IS DISTINCT FROM '{}'::jsonb
        ) THEN
          RAISE EXCEPTION 'OLTF3 was not propagated from v4 unchanged';
        END IF;
      ELSE
        IF v_result IS NULL OR (v_result->>'revision')::bigint IS DISTINCT FROM v_after OR
           (v_result->>'turn_row_id')::uuid IS DISTINCT FROM (
             SELECT id FROM public.v5_conversation_turns
             WHERE scenario_id = v_scenario AND turn_id = v_turn
           ) OR v_result->>'turn_row_id' IS NULL THEN
          RAISE EXCEPTION 'Returned UUID/revision does not match persisted turn/scenario';
        END IF;
        IF v_stage = 'replay_stale_expected' THEN
          IF v_result->>'turn_row_id' IS DISTINCT FROM v_fresh_result->>'turn_row_id' THEN
            RAISE EXCEPTION 'Replay returned a different turn UUID';
          END IF;
        ELSE
          IF (SELECT count(*) FROM public.v5_conversation_turns WHERE scenario_id = v_scenario)
               <> v_turns_before + 1 OR
             (SELECT count(*) FROM public.v5_handler_facts WHERE scenario_id = v_scenario)
               <> v_facts_before THEN
            RAISE EXCEPTION 'Fresh append did not persist exactly one turn and zero facts';
          END IF;
          IF v_stage = 'fresh_graph' THEN
            IF v_after IS DISTINCT FROM v_before + 1 OR
               (SELECT graph FROM public.scenarios WHERE id = v_scenario) IS DISTINCT FROM v_graph_a THEN
              RAISE EXCEPTION 'Fresh graph must persist with exactly one revision bump';
            END IF;
            v_fresh_expected := v_before;
            v_fresh_result := v_result;
          ELSIF v_after IS DISTINCT FROM v_before OR
                (SELECT to_jsonb(s) FROM public.scenarios s WHERE id = v_scenario)
                  IS DISTINCT FROM v_scenario_before THEN
            RAISE EXCEPTION 'Non-graph append changed scenario or bumped revision';
          END IF;
        END IF;
      END IF;
      INSERT INTO phase2_v4r_results VALUES (v_stage, TRUE, NULL);
      RAISE NOTICE 'PASS %', v_stage;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO phase2_v4r_results VALUES (v_stage, FALSE, SQLSTATE || ': ' || SQLERRM);
      RAISE NOTICE 'FAIL %: % %', v_stage, SQLSTATE, SQLERRM;
    END;
  END LOOP;
END;
$rows$;

DO $acl_rows$
DECLARE
  v_role TEXT;
  v_original_role TEXT := current_user;
  v_scenario UUID := (SELECT scenario_id FROM phase2_v4r_fixture);
  v_revision BIGINT := (SELECT revision FROM public.scenarios
                       WHERE id = (SELECT scenario_id FROM phase2_v4r_fixture));
  v_denied BOOLEAN;
  v_message TEXT;
  v_signature TEXT := 'public.append_turn_atomic_v4r(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,text,text,boolean,bigint,bigint)';
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    BEGIN
      IF has_function_privilege(v_role, v_signature, 'EXECUTE') THEN
        RAISE EXCEPTION '% retains EXECUTE', v_role;
      END IF;
      v_denied := FALSE;
      BEGIN
        EXECUTE format('SET LOCAL ROLE %I', v_role);
        PERFORM public.append_turn_atomic_v4r(
          v_scenario, 'v4r-acl-' || v_role, 'direct_answer', NULL,
          'v4r-acl-' || v_role, TRUE, 0, 0, '[]'::jsonb, NULL, NULL,
          '[]'::jsonb, NULL, NULL, NULL, NULL, NULL, FALSE, NULL, v_revision
        );
      EXCEPTION WHEN insufficient_privilege THEN
        GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
        IF v_message NOT LIKE 'permission denied for function append_turn_atomic_v4r%' THEN
          RAISE; -- A SET ROLE or schema denial is not evidence of function denial.
        END IF;
        v_denied := TRUE;
      END;
      EXECUTE format('SET LOCAL ROLE %I', v_original_role);
      IF NOT v_denied THEN RAISE EXCEPTION '% executed v4r', v_role; END IF;
      INSERT INTO phase2_v4r_results VALUES (v_role || '_cannot_execute', TRUE, NULL);
      RAISE NOTICE 'PASS %_cannot_execute', v_role;
    EXCEPTION WHEN OTHERS THEN
      -- The failed row's subtransaction also restores any SET LOCAL ROLE.
      INSERT INTO phase2_v4r_results VALUES (v_role || '_cannot_execute', FALSE, SQLSTATE || ': ' || SQLERRM);
      RAISE NOTICE 'FAIL %_cannot_execute: % %', v_role, SQLSTATE, SQLERRM;
    END;
  END LOOP;
  BEGIN
    IF NOT has_function_privilege('service_role', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role lacks EXECUTE';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc wrapper JOIN pg_proc base
        ON base.oid = 'public.append_turn_atomic_v4(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,text,text,boolean,bigint)'::regprocedure
      WHERE wrapper.oid = v_signature::regprocedure
        AND wrapper.pronargs = 20 AND wrapper.pronargdefaults = 0
        AND wrapper.proargnames[1:19] = base.proargnames
        AND wrapper.proargnames[20] = 'p_expected_revision'
        AND wrapper.prosecdef
        AND wrapper.proconfig = ARRAY['search_path=pg_catalog, public']::text[]
    ) THEN
      RAISE EXCEPTION 'Wrapper signature, required inputs, security or search_path differs from contract';
    END IF;
    INSERT INTO phase2_v4r_results VALUES ('service_role_and_required_arguments', TRUE, NULL);
    RAISE NOTICE 'PASS service_role_and_required_arguments';
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO phase2_v4r_results VALUES ('service_role_and_required_arguments', FALSE, SQLSTATE || ': ' || SQLERRM);
    RAISE NOTICE 'FAIL service_role_and_required_arguments: % %', SQLSTATE, SQLERRM;
  END;
END;
$acl_rows$;

\ir ../../supabase/migrations/rollback/20261008200000_phase2_c_v4_revision_cas_rollback.sql.do-not-apply

DO $rollback_row$
BEGIN
  BEGIN
    IF EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'append_turn_atomic_v4r'
    ) OR EXISTS (
      (SELECT p.oid, to_jsonb(p) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
       EXCEPT SELECT oid, definition FROM phase2_v4r_functions_before)
      UNION ALL
      (SELECT oid, definition FROM phase2_v4r_functions_before
       EXCEPT SELECT p.oid, to_jsonb(p) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public')
    ) OR NOT EXISTS (
      SELECT 1 FROM pg_attribute a JOIN pg_trigger t ON t.tgrelid = a.attrelid
      JOIN phase2_v4r_revision_before b
        ON b.column_definition = to_jsonb(a) AND b.trigger_definition = to_jsonb(t)
      WHERE a.attrelid = 'public.scenarios'::regclass AND a.attname = 'revision'
        AND t.tgname = 'scenarios_bump_revision' AND NOT t.tgisinternal
    ) THEN
      RAISE EXCEPTION 'Rollback must remove only v4r, retaining every prior function and revision trigger/column';
    END IF;
    INSERT INTO phase2_v4r_results VALUES ('rollback_exact_function', TRUE, NULL);
    RAISE NOTICE 'PASS rollback_exact_function';
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO phase2_v4r_results VALUES ('rollback_exact_function', FALSE, SQLSTATE || ': ' || SQLERRM);
    RAISE NOTICE 'FAIL rollback_exact_function: % %', SQLSTATE, SQLERRM;
  END;
END;
$rollback_row$;

TABLE phase2_v4r_results;

DO $verdict$
DECLARE
  v_failures TEXT;
BEGIN
  SELECT string_agg(row_name || ': ' || detail, E'\n' ORDER BY row_name)
  INTO v_failures FROM phase2_v4r_results WHERE NOT passed;
  IF v_failures IS NOT NULL THEN
    RAISE EXCEPTION 'v4r rehearsal failed:%', E'\n' || v_failures;
  END IF;
  IF (SELECT count(*) FROM phase2_v4r_results) <> 9 THEN
    RAISE EXCEPTION 'Expected all nine rehearsal rows';
  END IF;
  RAISE NOTICE 'PASS all v4r rehearsal rows; rolling back proposal and synthetic data';
END;
$verdict$;

ROLLBACK;
