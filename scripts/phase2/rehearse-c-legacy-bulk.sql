-- Included by rehearse-c-legacy.sql, after the source-lock/parity/finisher proofs.
-- Seed 2,005 legacy + 50 valid run_id facts + 5 malformed, plus two disposition
-- guards whose payload looks legacy but is already typed or malformed-quarantined.
BEGIN;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT pg_temp.phase2_c_append('phase2-c-'||i,
  jsonb_build_object('fact_type','run_analysis','fact_version',1,'result',
    CASE WHEN i%2=0 THEN '{"run_id":null}'::jsonb ELSE '{}'::jsonb END))
  FROM generate_series(1000,3004) i;
SELECT pg_temp.phase2_c_append('phase2-c-'||i,
  jsonb_set(payload,'{result,run_id}',to_jsonb('phase2-c-bulk-'||i)))
  FROM generate_series(4000,4049) i CROSS JOIN phase2_c_bulk_template;
SELECT pg_temp.phase2_c_append('phase2-c-'||i,
  '{"fact_type":"run_analysis","fact_version":1,"result":null}'::jsonb)
  FROM generate_series(5000,5004) i;
SELECT pg_temp.phase2_c_append('phase2-c-'||i,
  '{"fact_type":"run_analysis","fact_version":1,"result":{}}'::jsonb)
  FROM generate_series(6000,6001) i;
INSERT INTO phase2_c_facts(fact_id,turn_id,ordinal)
  SELECT h.id,t.turn_id,substring(t.turn_id FROM '([0-9]+)$')::integer
  FROM public.v5_handler_facts h JOIN public.v5_conversation_turns t ON t.id=h.v5_conversation_turn_id
  WHERE h.scenario_id='f2c00000-0000-4000-8000-000000000001'
    AND substring(t.turn_id FROM '([0-9]+)$')::integer>=1000;
UPDATE public.v5_handler_facts h SET created_at=s.first_at+
  CASE WHEN f.ordinal BETWEEN 4000 AND 4049 THEN interval '11 seconds'
    WHEN f.ordinal BETWEEN 5000 AND 5004 THEN interval '12 seconds' ELSE interval '10 seconds' END
  FROM phase2_c_facts f CROSS JOIN phase2_c_seed_time s WHERE h.id=f.fact_id AND f.ordinal>=1000;
-- 860 mirrors the measured live legacy-quarantine case, preserving seen_at.
INSERT INTO public.analysis_run_quarantine(fact_id,scenario_id,reason,seen_at)
  SELECT fact_id,'f2c00000-0000-4000-8000-000000000001','run_id_absent','2026-07-31T00:00:00Z'
  FROM phase2_c_facts WHERE ordinal BETWEEN 1000 AND 1859;
INSERT INTO public.analysis_run_quarantine(fact_id,scenario_id,reason)
  SELECT fact_id,'f2c00000-0000-4000-8000-000000000001','result_shape'
  FROM phase2_c_facts WHERE ordinal BETWEEN 5000 AND 5004 OR ordinal=6001;
-- Existing typed guard: source payload lacks identity but storage already has
-- a Run. The bulk classifier must preserve that disposition, never overwrite it.
SELECT public.store_typed_analysis_run(f.fact_id,jsonb_set(t.run,'{run_id}','"phase2-c-existing-typed-guard"'),t.options)
  FROM phase2_c_facts f CROSS JOIN phase2_c_bulk_template t WHERE f.ordinal=6000;
CREATE TEMP TABLE phase2_c_bulk_source_before AS
  SELECT h.* FROM public.v5_handler_facts h JOIN phase2_c_facts f ON f.fact_id=h.id WHERE f.ordinal>=1000;
CREATE TEMP TABLE phase2_c_bulk_runs_before AS SELECT * FROM public.analysis_runs;
CREATE TEMP TABLE phase2_c_bulk_bad_before AS
  SELECT q.* FROM public.analysis_run_quarantine q JOIN phase2_c_facts f USING(fact_id)
  WHERE f.ordinal BETWEEN 5000 AND 5004 OR f.ordinal=6001;
CREATE TEMP TABLE phase2_c_bulk_legacy_quarantine_before AS
  SELECT q.fact_id,q.seen_at FROM public.analysis_run_quarantine q JOIN phase2_c_facts f USING(fact_id)
  WHERE f.ordinal BETWEEN 1000 AND 3004;
UPDATE public.analysis_run_sweep_state SET processed_at=(SELECT first_at+interval '9 seconds' FROM phase2_c_seed_time),
  processed_id='00000000-0000-0000-0000-000000000000';
CREATE TEMP TABLE phase2_c_bulk_cursor_before AS SELECT processed_at,processed_id FROM public.analysis_run_sweep_state;
COMMIT;
\! node --import tsx scripts/phase2/classify-legacy-unattributable.ts --scenario-id f2c00000-0000-4000-8000-000000000001 --stats-sql "$PHASE2_C_BULK_STATS"
\if :SHELL_ERROR
  \quit 3
\endif
\ir :phase2_c_bulk_stats
SELECT count(*) AS batches_including_empty, count(*) FILTER (WHERE inserted>0) AS productive_batches,
  sum(inserted) AS classified, max(inserted) AS largest_batch, max(duration_ms) AS max_batch_ms,
  avg(duration_ms) AS avg_batch_ms FROM phase2_c_bulk_stats;
SELECT pg_temp.phase2_c_check('2,005 legacy classified in five <=500 productive batches plus one zero-insert stop',
  (SELECT count(*)=6 AND count(*) FILTER (WHERE inserted>0)=5 AND sum(inserted)=2005
    AND max(inserted)=500 AND sum(removed)=860 FROM phase2_c_bulk_stats)
  AND (SELECT inserted=0 FROM phase2_c_bulk_stats ORDER BY batch DESC LIMIT 1)
  AND (SELECT count(*)=2005 FROM public.analysis_run_unattributable u JOIN phase2_c_facts f USING(fact_id) WHERE ordinal BETWEEN 1000 AND 3004)
  AND NOT EXISTS (SELECT 1 FROM public.analysis_run_quarantine q JOIN phase2_c_facts f USING(fact_id) WHERE ordinal BETWEEN 1000 AND 3004)
  AND NOT EXISTS (SELECT 1 FROM phase2_c_bulk_legacy_quarantine_before q JOIN public.analysis_run_unattributable u USING(fact_id) WHERE u.seen_at<>q.seen_at));
SELECT pg_temp.phase2_c_check('all source bytes, run_id facts, typed guard and malformed quarantine untouched by classifier',
  NOT EXISTS ((SELECT h.* FROM public.v5_handler_facts h JOIN phase2_c_facts f ON f.fact_id=h.id WHERE ordinal>=1000
    EXCEPT SELECT * FROM phase2_c_bulk_source_before)
    UNION ALL (SELECT * FROM phase2_c_bulk_source_before EXCEPT
      SELECT h.* FROM public.v5_handler_facts h JOIN phase2_c_facts f ON f.fact_id=h.id WHERE ordinal>=1000))
  AND NOT EXISTS ((SELECT * FROM public.analysis_runs EXCEPT SELECT * FROM phase2_c_bulk_runs_before)
    UNION ALL (SELECT * FROM phase2_c_bulk_runs_before EXCEPT SELECT * FROM public.analysis_runs))
  AND NOT EXISTS ((SELECT q.* FROM public.analysis_run_quarantine q JOIN phase2_c_facts f USING(fact_id) WHERE ordinal BETWEEN 5000 AND 5004 OR ordinal=6001
    EXCEPT SELECT * FROM phase2_c_bulk_bad_before)
    UNION ALL (SELECT * FROM phase2_c_bulk_bad_before EXCEPT
      SELECT q.* FROM public.analysis_run_quarantine q JOIN phase2_c_facts f USING(fact_id) WHERE ordinal BETWEEN 5000 AND 5004 OR ordinal=6001))
  AND NOT EXISTS (SELECT 1 FROM public.analysis_run_unattributable u JOIN phase2_c_facts f USING(fact_id)
    WHERE ordinal BETWEEN 4000 AND 4049 OR ordinal BETWEEN 5000 AND 5004 OR ordinal IN (6000,6001))
  AND (SELECT (s.processed_at,s.processed_id)=(b.processed_at,b.processed_id) FROM public.analysis_run_sweep_state s CROSS JOIN phase2_c_bulk_cursor_before b));
-- Execute actual <=20-row claim/store/finish passes. TS already mapped the valid
-- template; SQL substitutes identities only, never derives a payload mapping.
-- Bound the last window to fixture facts so unrelated local history stays out.
DO $$
DECLARE receipt jsonb; fact jsonb; remaining integer; windows integer:=0; derived integer:=0; stored boolean; prior_at timestamptz; prior_id uuid;
BEGIN
  LOOP
    SELECT LEAST(20,count(*))::integer INTO remaining
      FROM public.v5_handler_facts h JOIN phase2_c_facts f ON f.fact_id=h.id
      CROSS JOIN public.analysis_run_sweep_state s WHERE f.ordinal>=1000
        AND (h.created_at,h.id)>(s.processed_at,s.processed_id);
    EXIT WHEN remaining=0;
    SELECT processed_at,processed_id INTO prior_at,prior_id FROM public.analysis_run_sweep_state;
    receipt:=public.claim_analysis_run_facts(remaining); windows:=windows+1;
    PERFORM pg_temp.phase2_c_check('bulk recovery claim bounded and leased',
      (receipt->>'window_count')::integer BETWEEN 1 AND 20 AND receipt->>'lease_id' IS NOT NULL);
    FOR fact IN SELECT value FROM jsonb_array_elements(receipt->'facts') LOOP
      PERFORM pg_temp.phase2_c_check('bulk recovery claims only untouched real run_id facts',
        EXISTS (SELECT 1 FROM phase2_c_facts f WHERE f.fact_id=(fact->>'fact_id')::uuid AND ordinal BETWEEN 4000 AND 4049));
      SELECT public.store_typed_analysis_run((fact->>'fact_id')::uuid,
        jsonb_set(t.run,'{run_id}',fact->'payload'->'result'->'run_id'),t.options) INTO stored
        FROM phase2_c_bulk_template t;
      IF stored THEN derived:=derived+1; END IF;
    END LOOP;
    PERFORM public.finish_analysis_run_sweep((receipt->>'lease_id')::uuid);
    PERFORM pg_temp.phase2_c_check('every bulk recovery window advances; fail instead of spinning',
      (SELECT (processed_at,processed_id)>(prior_at,prior_id) FROM public.analysis_run_sweep_state));
  END LOOP;
  PERFORM pg_temp.phase2_c_check('sweep then derives all 50 real Runs; legacy never re-claimed',
    derived=50 AND (SELECT count(*)=50 FROM public.analysis_runs r JOIN phase2_c_facts f USING(fact_id) WHERE ordinal BETWEEN 4000 AND 4049));
  RAISE NOTICE 'BULK RECOVERY windows=%, derived=%',windows,derived;
END $$;
