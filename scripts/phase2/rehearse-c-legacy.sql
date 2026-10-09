-- LOCAL disposable, quiescent schema/data copy only. This script commits the
-- explicit slice-C transaction, then exercises rollback and removes fixtures.
-- A failure leaves a disposable copy for inspection. Never use the shared DB.
-- psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 54322 -U postgres -d postgres -f scripts/phase2/rehearse-c-legacy.sql
\set ON_ERROR_STOP on
SELECT :'HOST' IN ('localhost','127.0.0.1','::1') OR :'HOST' LIKE '/%' AS local_endpoint
\gset
\if :local_endpoint
\else
  \echo 'REFUSED: local endpoint required'
  \quit 3
\endif
DO $$ BEGIN
  IF to_regclass('public.analysis_runs') IS NOT NULL OR to_regclass('public.analysis_run_unattributable') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires #2893 typed-run objects and slice C absent';
  END IF;
  IF EXISTS (SELECT 1 FROM public.scenarios WHERE id='f2c00000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'Fixture scenario already exists';
  END IF;
END $$;
-- Children use the same libpq endpoint/credentials as this local connection.
\setenv PGHOST :HOST
\setenv PGPORT :PORT
\setenv PGUSER :USER
\setenv PGDATABASE :DBNAME
SELECT '/tmp/phase2-c-rehearsal-'||pg_backend_pid() AS phase2_c_rehearsal_dir
\gset
\setenv PHASE2_C_REHEARSAL_DIR :phase2_c_rehearsal_dir
\! node --import tsx scripts/phase2/legacy-classification-corpus.ts "$PHASE2_C_REHEARSAL_DIR"
\if :SHELL_ERROR
  \quit 3
\endif
\set phase2_c_open_migration :phase2_c_rehearsal_dir '/migration-open.sql'
\set phase2_c_parity_fixture :phase2_c_rehearsal_dir '/parity-fixture.sql'
\set phase2_c_bulk_stats :phase2_c_rehearsal_dir '/bulk-stats.sql'
\setenv PHASE2_C_BULK_STATS :phase2_c_bulk_stats
\ir catalogue-a.sql
CREATE TEMP TABLE phase2_c_original AS SELECT pg_temp.phase2_catalogue() AS catalogue;
CREATE FUNCTION pg_temp.phase2_c_check(label text, passed boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF passed IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'FAIL %',label; END IF;
  RAISE NOTICE 'PASS %',label;
END;
$$;
-- #2893 first, inside its required explicit transaction.
BEGIN;
\ir ../../supabase/migrations/20261009010000_phase2_a_typed_runs.sql
COMMIT;
CREATE TEMP TABLE phase2_c_before AS SELECT pg_temp.phase2_catalogue() AS catalogue;
CREATE TEMP TABLE phase2_c_functions AS
  SELECT p.oid, p.proname, p.prosrc, pg_get_functiondef(p.oid) AS definition, p.proacl
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('claim_analysis_run_facts','claim_analysis_run_reconciliation','finish_analysis_run_sweep');
CREATE TEMP TABLE phase2_c_source_objects_before AS
  SELECT 'trigger' AS kind,t.oid,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t
  WHERE t.tgrelid=(SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='v5_handler_facts')
  UNION ALL SELECT 'constraint',x.oid,pg_get_constraintdef(x.oid) FROM pg_constraint x
  WHERE x.conrelid=(SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='v5_handler_facts')
    OR x.confrelid=(SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='v5_handler_facts');
-- Six real source facts: three already quarantined legacy rows, one genuinely
-- malformed quarantine row carrying a run_id, one fresh legacy marker control,
-- and one unclassified with-run-id claim control. Put them before other local
-- history so the reconciliation cap cannot hide a failed anti-join.
BEGIN;
INSERT INTO public.scenarios(id,user_id,graph) VALUES ('f2c00000-0000-4000-8000-000000000001',NULL,NULL);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
CREATE FUNCTION pg_temp.phase2_c_append(turn_id text, payload jsonb) RETURNS uuid LANGUAGE sql AS $$
  SELECT public.append_turn_atomic_v4(
    p_scenario_id=>'f2c00000-0000-4000-8000-000000000001',p_turn_id=>turn_id,
    p_turn_class=>'handler',p_handler_id=>'run_analysis',p_request_hash=>'phase2-c-rehearsal',
    p_response_emitted=>true,p_llm_calls_used=>0,p_duration_ms=>1,
    p_handler_facts=>jsonb_build_array(jsonb_build_object('handler_id','run_analysis','action_type','run_analysis','noop',false,'payload',payload)),
    p_graph=>NULL,p_brief_text=>NULL,p_pending_actions=>'[]',p_coaching_state=>NULL,
    p_user_message=>NULL,p_assistant_message=>NULL,p_expected_graph_identity_hash=>NULL,
    p_incoming_graph_identity_hash=>NULL,p_cas_enforce=>false,p_fence_generation=>NULL);
$$;
CREATE TEMP TABLE phase2_c_seed_time AS
  SELECT COALESCE(min(created_at),now())-interval '1 day' AS first_at FROM public.v5_handler_facts;
SELECT pg_temp.phase2_c_append('phase2-c-'||i,
  jsonb_build_object('fact_type','run_analysis','fact_version',CASE WHEN i=5 THEN 2 ELSE 1 END,'result',
    CASE WHEN i IN (1,3,5) THEN '{}'::jsonb WHEN i=2 THEN '{"run_id":null}'::jsonb
    ELSE jsonb_build_object('run_id','phase2-c-'||i,'input_snapshot',jsonb_build_object('options',jsonb_build_array(NULL))) END))
  FROM generate_series(1,6) i;
CREATE TEMP TABLE phase2_c_facts AS
  SELECT h.id AS fact_id, t.turn_id, substring(t.turn_id FROM '([0-9]+)$')::integer AS ordinal
  FROM public.v5_handler_facts h JOIN public.v5_conversation_turns t ON t.id=h.v5_conversation_turn_id
  WHERE h.scenario_id='f2c00000-0000-4000-8000-000000000001';
UPDATE public.v5_handler_facts h SET created_at=s.first_at+f.ordinal*interval '1 second'
  FROM phase2_c_facts f CROSS JOIN phase2_c_seed_time s WHERE h.id=f.fact_id;
INSERT INTO public.analysis_run_quarantine(fact_id,scenario_id,reason,seen_at)
  SELECT f.fact_id,'f2c00000-0000-4000-8000-000000000001',
    CASE WHEN ordinal<=3 THEN 'run_id_absent' ELSE 'input_snapshot_invalid' END,
    '2026-10-08T01:00:00Z'::timestamptz+ordinal*interval '1 second'
  FROM phase2_c_facts f WHERE ordinal<=4;
INSERT INTO public.analysis_run_attempts(fact_id,failure_count,last_error)
  SELECT fact_id,2,'prior attempt' FROM phase2_c_facts WHERE ordinal<=5;
CREATE TEMP TABLE phase2_c_quarantine_before AS
  SELECT fact_id,scenario_id,reason,seen_at FROM public.analysis_run_quarantine;
CREATE TEMP TABLE phase2_c_attempts_before AS SELECT * FROM public.analysis_run_attempts;
UPDATE public.analysis_run_sweep_state SET processed_at=(SELECT first_at FROM phase2_c_seed_time);
COMMIT;

-- Exact apply bytes with ONLY final COMMIT withheld; probe BEFORE any source
-- query in this transaction. No regclass cast / source relation lookup in the
-- probe: its OID comes from system catalogues, avoiding a probe-induced lock.
\ir :phase2_c_open_migration
SELECT pg_temp.phase2_c_check('apply transaction holds NO lock on v5_handler_facts',
  NOT EXISTS (SELECT 1 FROM pg_locks l WHERE l.pid=pg_backend_pid()
    AND l.relation=(SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname='v5_handler_facts')));
SELECT l.mode,l.granted FROM pg_locks l WHERE l.pid=pg_backend_pid()
  AND l.relation=(SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='v5_handler_facts');
COMMIT;
RESET lock_timeout;
SELECT pg_temp.phase2_c_check('migration moves the quarantined legacy rows (DL ruling); malformed stays',
  (SELECT count(*)=3 FROM public.analysis_run_unattributable)
  AND (SELECT count(*)=1 FROM public.analysis_run_quarantine));
\ir legacy-unattributable-predicate.sql
\ir :phase2_c_parity_fixture
SELECT pg_temp.phase2_c_check('SQL predicate set EXACTLY equals TS mapper set over all 53 persisted cases',
  (SELECT count(*)=53 FROM phase2_c_parity)
  AND NOT EXISTS ((SELECT case_id FROM phase2_c_parity WHERE pg_temp.is_legacy_run_analysis(payload,noop,action_type)
    EXCEPT SELECT case_id FROM phase2_c_parity WHERE ts_unattributable)
    UNION ALL (SELECT case_id FROM phase2_c_parity WHERE ts_unattributable
    EXCEPT SELECT case_id FROM phase2_c_parity WHERE pg_temp.is_legacy_run_analysis(payload,noop,action_type))));
-- The operator scope is only to isolate rehearsal fixtures from other local
-- history; production defaults to ALL scenarios. Every child batch commits.
CREATE TEMP TABLE phase2_c_source_before AS SELECT * FROM public.v5_handler_facts WHERE scenario_id='f2c00000-0000-4000-8000-000000000001';
\! node --import tsx scripts/phase2/classify-legacy-unattributable.ts --scenario-id f2c00000-0000-4000-8000-000000000001
\if :SHELL_ERROR
  \quit 3
\endif
SELECT pg_temp.phase2_c_check('operator leaves source facts byte-for-byte untouched',
  NOT EXISTS ((SELECT * FROM public.v5_handler_facts WHERE scenario_id='f2c00000-0000-4000-8000-000000000001' EXCEPT SELECT * FROM phase2_c_source_before)
    UNION ALL (SELECT * FROM phase2_c_source_before EXCEPT SELECT * FROM public.v5_handler_facts WHERE scenario_id='f2c00000-0000-4000-8000-000000000001')));
SELECT pg_temp.phase2_c_check('three legacy rows move with exact fact_id/seen_at; one malformed stays',
  (SELECT count(*)=3 FROM public.analysis_run_unattributable)
  AND (SELECT count(*)=1 AND bool_and(reason='input_snapshot_invalid') FROM public.analysis_run_quarantine)
  AND NOT EXISTS (SELECT 1 FROM phase2_c_quarantine_before b
    LEFT JOIN public.analysis_run_unattributable u USING(fact_id)
    WHERE b.reason='run_id_absent' AND (u.fact_id IS NULL OR u.reason<>b.reason OR u.seen_at<>b.seen_at)));
SELECT pg_temp.phase2_c_check('existing catalogue unchanged: three replaced functions + new objects',
  NOT EXISTS (SELECT 1 FROM phase2_c_before b, jsonb_array_elements(b.catalogue) old
    WHERE NOT (old->>'kind'='function' AND (old->>'id')::oid IN (SELECT oid FROM phase2_c_functions))
      AND NOT pg_temp.phase2_catalogue() @> jsonb_build_array(old))
  AND (SELECT count(*)=3 FROM phase2_c_functions)
  AND (SELECT bool_and(p.oid=f.oid AND p.proacl IS NOT DISTINCT FROM f.proacl
    AND p.prosrc=CASE WHEN f.proname='finish_analysis_run_sweep' THEN replace(f.prosrc,
      '      OR EXISTS (SELECT 1 FROM public.analysis_run_quarantine q WHERE q.fact_id = h.id) AS terminal',
      '      OR EXISTS (SELECT 1 FROM public.analysis_run_quarantine q WHERE q.fact_id = h.id)'||chr(10)||
      '      OR EXISTS (SELECT 1 FROM public.analysis_run_unattributable u WHERE u.fact_id = h.id) AS terminal')
    ELSE replace(f.prosrc,
      '      AND NOT EXISTS (SELECT 1 FROM public.analysis_run_quarantine q WHERE q.fact_id = h.id)'||chr(10),
      '      AND NOT EXISTS (SELECT 1 FROM public.analysis_run_quarantine q WHERE q.fact_id = h.id)'||chr(10)||
      '      AND NOT EXISTS (SELECT 1 FROM public.analysis_run_unattributable u WHERE u.fact_id = h.id)'||chr(10)) END)
    FROM phase2_c_functions f JOIN pg_proc p ON p.oid=f.oid));
SELECT pg_temp.phase2_c_check('RLS, cascade NOT APPLICABLE (logical reference), client privileges denied; definer pinned and service-only',
  (SELECT c.relrowsecurity
    AND NOT has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    AND NOT has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    FROM pg_class c WHERE c.oid='public.analysis_run_unattributable'::regclass)
  AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='analysis_run_unattributable')
  AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.analysis_run_unattributable'::regclass AND contype='f')
  AND (SELECT p.prosecdef AND 'search_path=pg_catalog, public'=ANY(p.proconfig)
    AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
    AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
    AND has_function_privilege('service_role',p.oid,'EXECUTE')
    FROM pg_proc p WHERE p.oid='public.mark_analysis_fact_unattributable(uuid,text)'::regprocedure));
SELECT pg_temp.phase2_c_check('no new source constraint or trigger; existing source catalogue EXACTLY unchanged',
  NOT EXISTS ((SELECT 'trigger' AS kind,t.oid,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t WHERE t.tgrelid='public.v5_handler_facts'::regclass
    UNION ALL SELECT 'constraint',x.oid,pg_get_constraintdef(x.oid) FROM pg_constraint x WHERE x.conrelid='public.v5_handler_facts'::regclass OR x.confrelid='public.v5_handler_facts'::regclass)
    EXCEPT SELECT * FROM phase2_c_source_objects_before)
  AND NOT EXISTS (SELECT * FROM phase2_c_source_objects_before EXCEPT
    (SELECT 'trigger',t.oid,pg_get_triggerdef(t.oid) FROM pg_trigger t WHERE t.tgrelid='public.v5_handler_facts'::regclass
    UNION ALL SELECT 'constraint',x.oid,pg_get_constraintdef(x.oid) FROM pg_constraint x WHERE x.conrelid='public.v5_handler_facts'::regclass OR x.confrelid='public.v5_handler_facts'::regclass)));
\! node --import tsx scripts/phase2/classify-legacy-unattributable.ts --scenario-id f2c00000-0000-4000-8000-000000000001
\if :SHELL_ERROR
  \quit 3
\endif
SELECT pg_temp.phase2_c_check('operator idempotent; original durable attempts untouched',
  (SELECT count(*)=3 FROM public.analysis_run_unattributable)
  AND NOT EXISTS ((SELECT * FROM public.analysis_run_attempts EXCEPT SELECT * FROM phase2_c_attempts_before)
    UNION ALL (SELECT * FROM phase2_c_attempts_before EXCEPT SELECT * FROM public.analysis_run_attempts)));
UPDATE public.v5_handler_facts h SET payload=jsonb_set(h.payload,'{fact_version}','1')
  FROM phase2_c_facts f WHERE h.id=f.fact_id AND f.ordinal=5;
SELECT fact_id AS fresh_legacy FROM phase2_c_facts WHERE ordinal=5
\gset
SELECT public.mark_analysis_fact_unattributable(:'fresh_legacy','run_id_absent') AS first_mark
\gset
SELECT public.mark_analysis_fact_unattributable(:'fresh_legacy','run_id_absent') AS repeat_mark
\gset
SELECT pg_temp.phase2_c_check('marker is idempotent and retains quarantine-style attempt state',
  :'first_mark'::boolean AND NOT :'repeat_mark'::boolean
  AND EXISTS (SELECT 1 FROM public.analysis_run_attempts WHERE fact_id=:'fresh_legacy' AND failure_count=2 AND last_error='prior attempt'));
DO $$ BEGIN
  BEGIN
    UPDATE public.analysis_run_unattributable SET reason='unsupported';
    RAISE EXCEPTION 'FAIL reason constraint';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS reason constraint'; END;
END $$;
-- Both claims must return the with-run-id control, proving the anti-joins are
-- exercised; neither may return any of the four unattributable legacy facts.
-- Bound this first claim to the six fixture facts so unrelated local history
-- cannot enter the positive/negative control window.
SELECT public.claim_analysis_run_facts(6) AS sweep_receipt
\gset
SELECT pg_temp.phase2_c_check('sweep excludes legacy and malformed; returns positive control',
  jsonb_array_length(:'sweep_receipt'::jsonb->'facts')=1
  AND :'sweep_receipt'::jsonb->'facts' @> (SELECT jsonb_build_array(jsonb_build_object('fact_id',fact_id)) FROM phase2_c_facts WHERE ordinal=6));
SELECT public.finish_analysis_run_sweep((:'sweep_receipt'::jsonb->>'lease_id')::uuid);
SELECT pg_temp.phase2_c_check('finisher advances through moved legacy prefix, stops at pending with-run-id control',
  (SELECT (s.processed_at,s.processed_id)=(h.created_at,h.id)
    FROM public.analysis_run_sweep_state s CROSS JOIN public.v5_handler_facts h
    JOIN phase2_c_facts f ON f.fact_id=h.id WHERE f.ordinal=5));
CREATE TEMP TABLE phase2_c_cursor_before AS SELECT processed_at,processed_id FROM public.analysis_run_sweep_state;
SELECT public.claim_analysis_run_reconciliation(20) AS reconcile_receipt
\gset
SELECT pg_temp.phase2_c_check('reconciliation excludes every legacy fact and retains its positive control',
  jsonb_array_length(:'reconcile_receipt'::jsonb->'facts')>=1
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(:'reconcile_receipt'::jsonb->'facts') x
    JOIN public.analysis_run_unattributable u ON u.fact_id=(x->>'fact_id')::uuid)
  AND :'reconcile_receipt'::jsonb->'facts' @> (SELECT jsonb_build_array(jsonb_build_object('fact_id',fact_id)) FROM phase2_c_facts WHERE ordinal=6));
SELECT public.finish_analysis_run_sweep((:'reconcile_receipt'::jsonb->>'lease_id')::uuid);
SELECT pg_temp.phase2_c_check('reconciliation leaves cursor exactly unchanged',
  (SELECT (s.processed_at,s.processed_id)=(b.processed_at,b.processed_id) FROM public.analysis_run_sweep_state s CROSS JOIN phase2_c_cursor_before b));
-- Backdated legacy-only window; place the cursor immediately BEFORE it.
-- Facts strictly older than a cursor are reconciliation-only, as checked above.
-- All 20 timestamps tie, so the processed_id assertion also proves the tie-break.
CREATE TEMP TABLE phase2_c_installed_finisher AS
  SELECT pg_get_functiondef('public.finish_analysis_run_sweep(uuid)'::regprocedure) AS definition;
BEGIN;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT pg_temp.phase2_c_append('phase2-c-'||i,
  jsonb_build_object('fact_type','run_analysis','fact_version',1,'result',
    CASE WHEN i%2=0 THEN '{"run_id":null}'::jsonb ELSE '{}'::jsonb END))
  FROM generate_series(7,26) i;
INSERT INTO phase2_c_facts(fact_id,turn_id,ordinal)
  SELECT h.id,t.turn_id,substring(t.turn_id FROM '([0-9]+)$')::integer
  FROM public.v5_handler_facts h JOIN public.v5_conversation_turns t ON t.id=h.v5_conversation_turn_id
  WHERE h.scenario_id='f2c00000-0000-4000-8000-000000000001'
    AND substring(t.turn_id FROM '([0-9]+)$')::integer>=7;
UPDATE public.v5_handler_facts h SET created_at=s.first_at+interval '7 seconds'
  FROM phase2_c_facts f CROSS JOIN phase2_c_seed_time s WHERE h.id=f.fact_id AND f.ordinal>=7;
UPDATE public.analysis_run_sweep_state SET processed_at=h.created_at,processed_id=h.id
  FROM public.v5_handler_facts h JOIN phase2_c_facts f ON f.fact_id=h.id WHERE f.ordinal=6;
CREATE TEMP TABLE phase2_c_legacy_cursor_before AS SELECT processed_at,processed_id FROM public.analysis_run_sweep_state;
COMMIT;
-- Execute the exact #2893 definition saved BEFORE C (no copied approximate body).
BEGIN;
SET LOCAL lock_timeout = '3s';
SELECT definition FROM phase2_c_functions WHERE proname='finish_analysis_run_sweep'
\gexec
COMMIT;
SELECT public.claim_analysis_run_facts(20) AS old_legacy_receipt
\gset
SELECT pg_temp.phase2_c_check('old-finisher contrast claims exactly the 20-fact legacy window',
  (:'old_legacy_receipt'::jsonb->>'window_count')::integer=20
  AND jsonb_array_length(:'old_legacy_receipt'::jsonb->'facts')=20
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(:'old_legacy_receipt'::jsonb->'facts') x
    LEFT JOIN phase2_c_facts f ON f.fact_id=(x->>'fact_id')::uuid WHERE f.ordinal IS NULL OR f.ordinal<7));
SELECT public.mark_analysis_fact_unattributable((x->>'fact_id')::uuid,'run_id_absent')
  FROM jsonb_array_elements(:'old_legacy_receipt'::jsonb->'facts') x;
SELECT public.finish_analysis_run_sweep((:'old_legacy_receipt'::jsonb->>'lease_id')::uuid) AS old_legacy_finish
\gset
SELECT pg_temp.phase2_c_check('old finisher returns true but watermark remains EXACTLY pinned after all 20 legacy markers',
  :'old_legacy_finish'::boolean
  AND (SELECT count(*)=20 FROM public.analysis_run_unattributable u JOIN phase2_c_facts f USING(fact_id) WHERE f.ordinal>=7)
  AND (SELECT (s.processed_at,s.processed_id)=(b.processed_at,b.processed_id)
    FROM public.analysis_run_sweep_state s CROSS JOIN phase2_c_legacy_cursor_before b));
-- Restore the approved C body. Retry the SAME source window and cursor; the
-- anti-join is now empty, but window_count remains 20 and must advance.
BEGIN;
SET LOCAL lock_timeout = '3s';
SELECT definition FROM phase2_c_installed_finisher
\gexec
COMMIT;
SELECT public.claim_analysis_run_facts(20) AS new_legacy_receipt
\gset
SELECT pg_temp.phase2_c_check('same legacy source window is terminal: 20 scanned, none re-claimed',
  (:'new_legacy_receipt'::jsonb->>'window_count')::integer=20
  AND jsonb_array_length(:'new_legacy_receipt'::jsonb->'facts')=0);
SELECT public.finish_analysis_run_sweep((:'new_legacy_receipt'::jsonb->>'lease_id')::uuid) AS new_legacy_finish
\gset
SELECT pg_temp.phase2_c_check('approved finisher receipt advances processed_at/processed_id past ALL 20 legacy facts',
  :'new_legacy_finish'::boolean
  AND (SELECT (s.processed_at,s.processed_id)>(b.processed_at,b.processed_id)
    FROM public.analysis_run_sweep_state s CROSS JOIN phase2_c_legacy_cursor_before b)
  AND (SELECT (s.processed_at,s.processed_id)=(last.created_at,last.id)
    FROM public.analysis_run_sweep_state s CROSS JOIN LATERAL (
      SELECT h.created_at,h.id FROM public.v5_handler_facts h JOIN phase2_c_facts f ON f.fact_id=h.id
      WHERE f.ordinal>=7 ORDER BY h.created_at DESC,h.id DESC LIMIT 1) last)
  AND NOT EXISTS (SELECT 1 FROM public.v5_handler_facts h JOIN phase2_c_facts f ON f.fact_id=h.id
    CROSS JOIN public.analysis_run_sweep_state s WHERE f.ordinal>=7 AND (h.created_at,h.id)>(s.processed_at,s.processed_id)));
\ir rehearse-c-legacy-bulk.sql
-- Remove only fresh marker/window controls. Rollback restores the original
-- three legacy observations plus the untouched malformed observation.
DELETE FROM public.analysis_run_unattributable WHERE fact_id=:'fresh_legacy'
  OR fact_id IN (SELECT fact_id FROM phase2_c_facts WHERE ordinal>=7);
DELETE FROM public.analysis_run_quarantine WHERE fact_id IN (SELECT fact_id FROM phase2_c_facts WHERE ordinal>=1000);
\ir ../../supabase/migrations/rollback/20261009040000_phase2_a_legacy_unattributable_rollback.sql.do-not-apply
SELECT pg_temp.phase2_c_check('rollback restores catalogue and all three function bodies/ACLs EXACTLY',
  pg_temp.phase2_catalogue()=(SELECT catalogue FROM phase2_c_before)
  AND (SELECT bool_and(p.prosrc=f.prosrc AND pg_get_functiondef(p.oid)=f.definition AND p.proacl IS NOT DISTINCT FROM f.proacl)
    FROM phase2_c_functions f JOIN pg_proc p ON p.oid=f.oid));
SELECT pg_temp.phase2_c_check('rollback restores legacy observations with exact fact_id/scenario/reason/seen_at',
  NOT EXISTS ((SELECT fact_id,scenario_id,reason,seen_at FROM public.analysis_run_quarantine EXCEPT SELECT * FROM phase2_c_quarantine_before)
    UNION ALL (SELECT * FROM phase2_c_quarantine_before EXCEPT SELECT fact_id,scenario_id,reason,seen_at FROM public.analysis_run_quarantine)));
BEGIN;
\ir ../../supabase/migrations/rollback/20261009010000_phase2_a_typed_runs_rollback.sql.do-not-apply
DELETE FROM public.scenarios WHERE id='f2c00000-0000-4000-8000-000000000001';
COMMIT;
SELECT pg_temp.phase2_c_check('fixture cleanup restores original catalogue EXACTLY',pg_temp.phase2_catalogue()=(SELECT catalogue FROM phase2_c_original));
\echo 'PASS slice C legacy reclassification, cursor advancement, old-finisher contrast and exact rollback'
