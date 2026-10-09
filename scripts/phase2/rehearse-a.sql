-- PROPOSAL REHEARSAL: isolated LOCAL schema/data copy only; never shared DB.
-- psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 54322 -U postgres -d postgres -f scripts/phase2/rehearse-a.sql
-- One transaction: apply, exercise real append/storage RPCs, exact catalogue
-- rollback comparison, then ROLLBACK synthetic data. Held-lock proof is the
-- separately committed two-session rehearse-a-lock.sh (DDL must be visible).
\set ON_ERROR_STOP on
SELECT :'HOST' IN ('localhost', '127.0.0.1', '::1') OR :'HOST' LIKE '/%' AS local_endpoint
\gset
\if :local_endpoint
\else
  \echo 'REFUSED: local endpoint required'
  \quit 3
\endif
BEGIN;
DO $preflight$
BEGIN
  IF to_regclass('public.analysis_runs') IS NOT NULL OR to_regclass('public.analysis_run_queue') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires Phase 2(a) absent in an isolated local copy';
  END IF;
  IF to_regclass('public.v5_handler_facts') IS NULL THEN RAISE EXCEPTION 'Existing V5 schema required'; END IF;
END;
$preflight$;
\ir catalogue-a.sql
CREATE TEMP TABLE phase2_a_before AS SELECT pg_temp.phase2_catalogue() AS catalogue;
CREATE FUNCTION pg_temp.phase2_check(label text, passed boolean) RETURNS void LANGUAGE plpgsql AS $check$
BEGIN
  IF passed IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'FAIL %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END;
$check$;
\ir ../../supabase/migrations/20261009010000_phase2_a_typed_runs.sql
SELECT pg_temp.phase2_check('migration applies',
  to_regclass('public.analysis_runs') IS NOT NULL AND to_regclass('public.analysis_run_queue') IS NOT NULL);
SELECT pg_temp.phase2_check('RLS on all four; no client table privileges/policies',
  (SELECT count(*) = 4 AND bool_and(c.relrowsecurity)
     AND bool_and(NOT has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
     AND bool_and(NOT has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
     AND bool_and(has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE'))
   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'
    AND c.relname IN ('analysis_runs','analysis_run_options','analysis_run_quarantine','analysis_run_queue'))
  AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename IN
    ('analysis_runs','analysis_run_options','analysis_run_quarantine','analysis_run_queue')));
SELECT pg_temp.phase2_check('definer/search_path/EXECUTE service only; enqueue lock bound',
  (SELECT count(*) = 4 AND bool_and(p.prosecdef)
     AND bool_and('search_path=pg_catalog, public' = ANY(p.proconfig))
     AND bool_and(NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
     AND bool_and(NOT has_function_privilege('authenticated', p.oid, 'EXECUTE'))
     AND bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE'))
   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
    AND p.proname IN ('v5_handler_facts_enqueue_run','claim_analysis_run_facts','store_typed_analysis_run','quarantine_analysis_fact'))
  AND (SELECT 'lock_timeout=50ms' = ANY(proconfig) FROM pg_proc WHERE oid = 'public.v5_handler_facts_enqueue_run()'::regprocedure));
\ir rehearse-a-fixture.sql
CREATE TEMP TABLE phase2_a_ids (label text primary key, id uuid not null);
INSERT INTO public.scenarios(id, user_id, graph) VALUES ('f2a00000-0000-4000-8000-000000000001', NULL, NULL);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
CREATE FUNCTION pg_temp.phase2_append(turn_id text, facts jsonb) RETURNS uuid LANGUAGE sql AS $append$
  SELECT public.append_turn_atomic_v4(
    p_scenario_id => 'f2a00000-0000-4000-8000-000000000001', p_turn_id => turn_id,
    p_turn_class => 'handler', p_handler_id => 'run_analysis', p_request_hash => 'phase2-a-rehearsal',
    p_response_emitted => true, p_llm_calls_used => 0, p_duration_ms => 1, p_handler_facts => facts,
    p_graph => NULL, p_brief_text => NULL, p_pending_actions => '[]', p_coaching_state => NULL,
    p_user_message => NULL, p_assistant_message => NULL, p_expected_graph_identity_hash => NULL,
    p_incoming_graph_identity_hash => NULL, p_cas_enforce => false, p_fence_generation => NULL);
$append$;
SELECT pg_temp.phase2_append('phase2-a-run', jsonb_build_array(
  jsonb_build_object('handler_id','run_analysis','action_type','run_analysis','noop',false,'payload', :'phase2_a_payload'::jsonb),
  jsonb_build_object('handler_id','run_analysis','action_type','run_analysis','noop',true,'payload', :'phase2_a_payload'::jsonb),
  jsonb_build_object('handler_id','set_factor_value','action_type','set_factor_value','noop',false,'payload','{}'::jsonb))) AS first_turn
\gset
INSERT INTO phase2_a_ids SELECT 'run', id FROM public.v5_handler_facts WHERE v5_conversation_turn_id = :'first_turn' AND action_type = 'run_analysis' AND NOT noop;
SELECT pg_temp.phase2_check('real append enqueues non-noop Run only; other action/noop contrasts',
  (SELECT count(*) = 1 FROM public.analysis_run_queue q JOIN public.v5_handler_facts f ON f.id = q.fact_id WHERE f.v5_conversation_turn_id = :'first_turn')
  AND NOT EXISTS (SELECT 1 FROM public.analysis_runs));
SELECT public.store_typed_analysis_run((SELECT id FROM phase2_a_ids WHERE label='run'), :'phase2_a_run'::jsonb, :'phase2_a_options'::jsonb) AS first_store
\gset
SELECT public.store_typed_analysis_run((SELECT id FROM phase2_a_ids WHERE label='run'), :'phase2_a_run'::jsonb, :'phase2_a_options'::jsonb) AS repeat_store
\gset
SELECT pg_temp.phase2_check('store idempotent on fact_id; queue deleted; full options stored atomically',
  :'first_store'::boolean AND NOT :'repeat_store'::boolean
  AND (SELECT count(*) = 1 FROM public.analysis_runs WHERE fact_id = (SELECT id FROM phase2_a_ids WHERE label='run'))
  AND (SELECT count(*) = jsonb_array_length(:'phase2_a_options'::jsonb) FROM public.analysis_run_options WHERE run_id = :'phase2_a_run'::jsonb->>'run_id')
  AND NOT EXISTS (SELECT 1 FROM public.analysis_run_queue WHERE fact_id = (SELECT id FROM phase2_a_ids WHERE label='run')));
-- Backfill may race a completed disposition: the queued half must include it
-- so the idempotent finisher clears it, rather than leaving permanent queue debt.
INSERT INTO public.analysis_run_queue(fact_id) SELECT id FROM phase2_a_ids WHERE label='run';
SELECT pg_temp.phase2_check('queued completed fact remains claimable for idempotent cleanup',
  public.claim_analysis_run_facts(ARRAY[(SELECT id FROM phase2_a_ids WHERE label='run')],1)->'facts' @> jsonb_build_array(jsonb_build_object('fact_id',(SELECT id FROM phase2_a_ids WHERE label='run'))));
SELECT public.store_typed_analysis_run((SELECT id FROM phase2_a_ids WHERE label='run'), :'phase2_a_run'::jsonb, :'phase2_a_options'::jsonb);
SELECT pg_temp.phase2_check('terminal enqueue race cleared', NOT EXISTS (SELECT 1 FROM public.analysis_run_queue WHERE fact_id = (SELECT id FROM phase2_a_ids WHERE label='run')));
UPDATE public.scenarios SET graph = '{"nodes":[],"edges":[]}' WHERE id = 'f2a00000-0000-4000-8000-000000000001';
SELECT pg_temp.phase2_check('unknown evaluated revision stays NULL despite later scenario revision',
  (SELECT scenario_revision IS NULL AND revision_source = 'legacy_unknown' FROM public.analysis_runs WHERE fact_id = (SELECT id FROM phase2_a_ids WHERE label='run')));
DO $revision_check$
BEGIN
  BEGIN
    UPDATE public.analysis_runs SET revision_source = 'recorded' WHERE fact_id = (SELECT id FROM phase2_a_ids WHERE label='run');
    RAISE EXCEPTION 'FAIL revision nullness constraint';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS revision source/nullness constraint'; END;
END;
$revision_check$;
SELECT pg_temp.phase2_append('phase2-a-malformed', '[{"handler_id":"run_analysis","action_type":"run_analysis","noop":false,"payload":{"result":null}}]') AS bad_turn
\gset
INSERT INTO phase2_a_ids SELECT 'bad', id FROM public.v5_handler_facts WHERE v5_conversation_turn_id = :'bad_turn';
SELECT public.quarantine_analysis_fact((SELECT id FROM phase2_a_ids WHERE label='bad'), 'result_shape', NULL) AS first_quarantine
\gset
SELECT public.quarantine_analysis_fact((SELECT id FROM phase2_a_ids WHERE label='bad'), 'different_reason', 'different_detail') AS repeat_quarantine
\gset
SELECT pg_temp.phase2_check('quarantine idempotent, compact and terminal; malformed append retained',
  :'first_quarantine'::boolean AND NOT :'repeat_quarantine'::boolean
  AND (SELECT count(*) = 1 AND bool_and(reason = 'result_shape' AND detail IS NULL) FROM public.analysis_run_quarantine WHERE fact_id = (SELECT id FROM phase2_a_ids WHERE label='bad'))
  AND EXISTS (SELECT 1 FROM public.v5_handler_facts WHERE id = (SELECT id FROM phase2_a_ids WHERE label='bad'))
  AND NOT EXISTS (SELECT 1 FROM public.analysis_run_queue WHERE fact_id = (SELECT id FROM phase2_a_ids WHERE label='bad')));
DELETE FROM public.v5_handler_facts WHERE id IN (SELECT id FROM phase2_a_ids);
SELECT pg_temp.phase2_check('fact delete cascades run/options/quarantine',
  NOT EXISTS (SELECT 1 FROM public.analysis_runs) AND NOT EXISTS (SELECT 1 FROM public.analysis_run_options)
  AND NOT EXISTS (SELECT 1 FROM public.analysis_run_quarantine));
SELECT pg_temp.phase2_append('phase2-a-crash', jsonb_build_array(jsonb_build_object(
  'handler_id','run_analysis','action_type','run_analysis','noop',false,'payload', :'phase2_a_payload'::jsonb))) AS crash_turn
\gset
INSERT INTO phase2_a_ids SELECT 'crash', id FROM public.v5_handler_facts WHERE v5_conversation_turn_id = :'crash_turn';
SELECT public.claim_analysis_run_facts(ARRAY[(SELECT id FROM phase2_a_ids WHERE label='crash')],1) AS first_claim
\gset
SELECT pg_temp.phase2_check('claim capped and leased; concurrent claim skips it',
  jsonb_array_length(:'first_claim'::jsonb->'facts') = 1
  AND NOT (public.claim_analysis_run_facts(ARRAY[(SELECT id FROM phase2_a_ids WHERE label='crash')],1)->'facts') @> jsonb_build_array(jsonb_build_object('fact_id',(SELECT id FROM phase2_a_ids WHERE label='crash'))));
-- Crash recovery is deterministic: expire the lease, do not sleep in the harness.
UPDATE public.analysis_run_queue SET claimed_until = now()-interval '1 second' WHERE fact_id = (SELECT id FROM phase2_a_ids WHERE label='crash');
SELECT pg_temp.phase2_check('crashed lease recovered by next sweep',
  public.claim_analysis_run_facts(ARRAY[(SELECT id FROM phase2_a_ids WHERE label='crash')],1)->'facts' @> jsonb_build_array(jsonb_build_object('fact_id',(SELECT id FROM phase2_a_ids WHERE label='crash'))));
SELECT public.store_typed_analysis_run((SELECT id FROM phase2_a_ids WHERE label='crash'), :'phase2_a_run'::jsonb, :'phase2_a_options'::jsonb);
SELECT pg_temp.phase2_check('recovered claim derives the golden TS row',
  EXISTS (SELECT 1 FROM public.analysis_runs WHERE fact_id = (SELECT id FROM phase2_a_ids WHERE label='crash')));
-- A queued row also cascades without being drained.
SELECT pg_temp.phase2_append('phase2-a-queue-cascade', jsonb_build_array(jsonb_build_object(
  'handler_id','run_analysis','action_type','run_analysis','noop',false,'payload', :'phase2_a_payload'::jsonb))) AS queue_turn
\gset
INSERT INTO phase2_a_ids SELECT 'queue-cascade', id FROM public.v5_handler_facts WHERE v5_conversation_turn_id = :'queue_turn';
DELETE FROM public.v5_handler_facts WHERE id = (SELECT id FROM phase2_a_ids WHERE label='queue-cascade');
SELECT pg_temp.phase2_check('fact delete cascades undrained queue row',
  NOT EXISTS (SELECT 1 FROM public.analysis_run_queue WHERE fact_id = (SELECT id FROM phase2_a_ids WHERE label='queue-cascade')));
\ir ../../supabase/migrations/rollback/20261009010000_phase2_a_typed_runs_rollback.sql.do-not-apply
SELECT pg_temp.phase2_check('rollback restores catalogue EXACTLY',
  pg_temp.phase2_catalogue() = (SELECT catalogue FROM phase2_a_before));
ROLLBACK;
\echo 'PASS transaction cleanup; run rehearse-a-lock.sh separately for the committed two-session held-lock proof'
