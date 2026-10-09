-- LOCAL disposable, quiescent schema/data copy only; proposal NOT executed here.
-- The concurrent index stays absent in THIS transactional rehearsal. The lock
-- harness separately applies it outside a transaction, proves both plans and
-- rolls it back FIRST before rolling back these transactional objects.
-- psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 54322 -U postgres -d postgres -f scripts/phase2/rehearse-a.sql
\set ON_ERROR_STOP on
SELECT :'HOST' IN ('localhost','127.0.0.1','::1') OR :'HOST' LIKE '/%' AS local_endpoint
\gset
\if :local_endpoint
\else
  \echo 'REFUSED: local endpoint required'
  \quit 3
\endif
BEGIN;
DO $$ BEGIN
  IF to_regclass('public.analysis_runs') IS NOT NULL OR to_regclass('public.analysis_run_facts_sweep_idx') IS NOT NULL THEN RAISE EXCEPTION 'Requires Phase 2(a) and sweep index absent'; END IF;
END $$;
\ir catalogue-a.sql
CREATE TEMP TABLE phase2_a_before AS SELECT pg_temp.phase2_catalogue() AS catalogue;
CREATE FUNCTION pg_temp.phase2_check(label text, passed boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF passed IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'FAIL %',label; END IF;
  RAISE NOTICE 'PASS %',label;
END;
$$;
\ir ../../supabase/migrations/20261009010000_phase2_a_typed_runs.sql
SELECT pg_temp.phase2_check('migration applies; existing catalogue entries EXACTLY unchanged',
  to_regclass('public.analysis_run_sweep_state') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM phase2_a_before b, jsonb_array_elements(b.catalogue) old
    WHERE NOT pg_temp.phase2_catalogue() @> jsonb_build_array(old)));
SELECT pg_temp.phase2_check('all five new tables RLS; no client privileges or policies',
  (SELECT count(*)=5 AND bool_and(c.relrowsecurity)
    AND bool_and(NOT has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
    AND bool_and(NOT has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
    AND bool_and(has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE'))
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
      AND c.relname IN ('analysis_runs','analysis_run_options','analysis_run_quarantine','analysis_run_attempts','analysis_run_sweep_state'))
  AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename LIKE 'analysis_run%'));
SELECT pg_temp.phase2_check('five RPCs definer/pinned path; service EXECUTE only',
  (SELECT count(*)=5 AND bool_and(p.prosecdef) AND bool_and('search_path=pg_catalog, public'=ANY(p.proconfig))
    AND bool_and(NOT has_function_privilege('anon',p.oid,'EXECUTE'))
    AND bool_and(NOT has_function_privilege('authenticated',p.oid,'EXECUTE'))
    AND bool_and(has_function_privilege('service_role',p.oid,'EXECUTE'))
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
      AND p.proname IN ('claim_analysis_run_facts','finish_analysis_run_sweep','store_typed_analysis_run','quarantine_analysis_fact','record_analysis_run_failure')));
\ir rehearse-a-fixture.sql
INSERT INTO public.scenarios(id,user_id,graph) VALUES ('f2a00000-0000-4000-8000-000000000001',NULL,NULL);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
CREATE FUNCTION pg_temp.phase2_append(turn_id text,facts jsonb) RETURNS uuid LANGUAGE sql AS $$
  SELECT public.append_turn_atomic_v4(
    p_scenario_id=>'f2a00000-0000-4000-8000-000000000001',p_turn_id=>turn_id,
    p_turn_class=>'handler',p_handler_id=>'run_analysis',p_request_hash=>'phase2-a-rehearsal',
    p_response_emitted=>true,p_llm_calls_used=>0,p_duration_ms=>1,p_handler_facts=>facts,
    p_graph=>NULL,p_brief_text=>NULL,p_pending_actions=>'[]',p_coaching_state=>NULL,
    p_user_message=>NULL,p_assistant_message=>NULL,p_expected_graph_identity_hash=>NULL,
    p_incoming_graph_identity_hash=>NULL,p_cas_enforce=>false,p_fence_generation=>NULL);
$$;
-- All fixture writes precede watermark advancement. Real writers use DEFAULT
-- now(); the claim's open-transaction horizon protects separate writer sessions.
SELECT pg_temp.phase2_append('phase2-a-valid',jsonb_build_array(
  jsonb_build_object('handler_id','run_analysis','action_type','run_analysis','noop',false,'payload',:'phase2_a_payload'::jsonb),
  jsonb_build_object('handler_id','run_analysis','action_type','run_analysis','noop',true,'payload',:'phase2_a_payload'::jsonb),
  jsonb_build_object('handler_id','set_factor_value','action_type','set_factor_value','noop',false,'payload','{}'::jsonb))) AS valid_turn
\gset
SELECT id AS valid_fact FROM public.v5_handler_facts WHERE v5_conversation_turn_id=:'valid_turn' AND action_type='run_analysis' AND NOT noop
\gset
SELECT pg_temp.phase2_append('phase2-a-bad','[{"handler_id":"run_analysis","action_type":"run_analysis","noop":false,"payload":{"result":null}}]') AS bad_turn
\gset
SELECT id AS bad_fact FROM public.v5_handler_facts WHERE v5_conversation_turn_id=:'bad_turn'
\gset
SELECT pg_temp.phase2_append('phase2-a-window-'||i,jsonb_build_array(jsonb_build_object(
  'handler_id','run_analysis','action_type','run_analysis','noop',false,'payload',:'phase2_a_payload'::jsonb))) FROM generate_series(1,25) i;
SELECT public.store_typed_analysis_run(:'valid_fact',:'phase2_a_run'::jsonb,:'phase2_a_options'::jsonb) AS first_store
\gset
SELECT public.store_typed_analysis_run(:'valid_fact',:'phase2_a_run'::jsonb,:'phase2_a_options'::jsonb) AS repeat_store
\gset
SELECT pg_temp.phase2_check('store idempotent, options atomic, evaluated revision unknown',
  :'first_store'::boolean AND NOT :'repeat_store'::boolean
  AND (SELECT scenario_revision IS NULL AND revision_source='legacy_unknown' FROM public.analysis_runs WHERE fact_id=:'valid_fact')
  AND (SELECT count(*)=jsonb_array_length(:'phase2_a_options'::jsonb) FROM public.analysis_run_options WHERE run_id=:'phase2_a_run'::jsonb->>'run_id'));
SELECT public.quarantine_analysis_fact(:'bad_fact','result_shape',NULL) AS first_bad
\gset
SELECT public.quarantine_analysis_fact(:'bad_fact','other','other') AS repeat_bad
\gset
SELECT pg_temp.phase2_check('quarantine idempotent/compact, source append retained',
  :'first_bad'::boolean AND NOT :'repeat_bad'::boolean
  AND EXISTS (SELECT 1 FROM public.analysis_run_quarantine WHERE fact_id=:'bad_fact' AND reason='result_shape' AND detail IS NULL)
  AND EXISTS (SELECT 1 FROM public.v5_handler_facts WHERE id=:'bad_fact'));
-- Restrict this fixture proof to its newly written timestamp range, retaining
-- all pre-existing local facts/data unchanged. The production cursor starts -infinity.
UPDATE public.analysis_run_sweep_state SET processed_at=transaction_timestamp()-interval '1 microsecond';
CREATE TEMP TABLE phase2_a_golden AS SELECT :'phase2_a_run'::jsonb AS run, :'phase2_a_options'::jsonb AS options;
DO $$
DECLARE receipt jsonb; f jsonb; poison uuid; before_at timestamptz; before_id uuid; n integer; terminal boolean;
BEGIN
  SELECT h.id INTO poison FROM public.v5_handler_facts h WHERE h.scenario_id='f2a00000-0000-4000-8000-000000000001'
    AND action_type='run_analysis' AND NOT noop
    AND NOT EXISTS (SELECT 1 FROM public.analysis_runs r WHERE r.fact_id=h.id)
    AND NOT EXISTS (SELECT 1 FROM public.analysis_run_quarantine q WHERE q.fact_id=h.id) ORDER BY h.created_at,h.id LIMIT 1;
  SELECT processed_at,processed_id INTO before_at,before_id FROM public.analysis_run_sweep_state;
  FOR n IN 1..5 LOOP
    receipt := public.claim_analysis_run_facts(20);
    PERFORM pg_temp.phase2_check('bounded window <=20; legacy writer anti-join',
      (receipt->>'window_count')::integer<=20 AND jsonb_array_length(receipt->'facts')<=20
      AND receipt->'facts' @> jsonb_build_array(jsonb_build_object('fact_id',poison)));
    -- A simultaneous claim cannot enter the leased window, even with no row lock held.
    PERFORM pg_temp.phase2_check('concurrent claim safely skipped',jsonb_array_length(public.claim_analysis_run_facts(20)->'facts')=0);
    FOR f IN SELECT value FROM jsonb_array_elements(receipt->'facts') LOOP
      IF (f->>'fact_id')::uuid<>poison THEN
        PERFORM public.store_typed_analysis_run((f->>'fact_id')::uuid,
          (SELECT jsonb_set(run,'{run_id}',to_jsonb(f->>'fact_id')) FROM phase2_a_golden),(SELECT options FROM phase2_a_golden));
      END IF;
    END LOOP;
    terminal := public.record_analysis_run_failure(poison,'55P03','last injected storage error '||n);
    PERFORM pg_temp.phase2_check('poison terminal exactly on fifth attempt',terminal=(n=5));
    PERFORM public.finish_analysis_run_sweep((receipt->>'lease_id')::uuid);
  END LOOP;
  PERFORM pg_temp.phase2_check('poison records last error, count capped at five',
    EXISTS (SELECT 1 FROM public.analysis_run_attempts WHERE fact_id=poison AND failure_count=5)
    AND EXISTS (SELECT 1 FROM public.analysis_run_quarantine WHERE fact_id=poison AND reason='derivation_failed' AND detail='55P03: last injected storage error 5'));
  PERFORM pg_temp.phase2_check('watermark advances only terminal prefix including ties',
    (SELECT (processed_at,processed_id)>(before_at,before_id) FROM public.analysis_run_sweep_state));
  LOOP
    receipt := public.claim_analysis_run_facts(20);
    FOR f IN SELECT value FROM jsonb_array_elements(receipt->'facts') LOOP
      PERFORM public.store_typed_analysis_run((f->>'fact_id')::uuid,
        (SELECT jsonb_set(run,'{run_id}',to_jsonb(f->>'fact_id')) FROM phase2_a_golden),(SELECT options FROM phase2_a_golden));
    END LOOP;
    PERFORM public.finish_analysis_run_sweep((receipt->>'lease_id')::uuid);
    EXIT WHEN (receipt->>'window_count')::integer=0;
  END LOOP;
  PERFORM pg_temp.phase2_check('25 historical Runs reach terminal disposition; noop/other action excluded',
    (SELECT count(*)=25 FROM public.analysis_runs WHERE scenario_id='f2a00000-0000-4000-8000-000000000001')
    AND (SELECT count(*)=2 FROM public.analysis_run_quarantine WHERE scenario_id='f2a00000-0000-4000-8000-000000000001'));
END;
$$;
\ir ../../supabase/migrations/rollback/20261009010000_phase2_a_typed_runs_rollback.sql.do-not-apply
SELECT pg_temp.phase2_check('rollback restores catalogue EXACTLY',pg_temp.phase2_catalogue()=(SELECT catalogue FROM phase2_a_before));
ROLLBACK;
\echo 'PASS transaction cleanup; run rehearse-a-lock.sh for the independent two-session append proof'
