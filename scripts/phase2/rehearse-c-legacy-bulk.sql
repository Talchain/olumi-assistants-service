-- Included by rehearse-c-legacy.sql, after the source-lock/parity/finisher proofs.
-- Scale only the legacy seed; all expected counts come from the seed manifest.
\if :{?phase2_c_payload_pad_bytes}
\else
  \set phase2_c_payload_pad_bytes 0
\endif
\if :{?phase2_c_bulk_scale}
\else
  \set phase2_c_bulk_scale 1
\endif
CREATE TEMP TABLE phase2_c_bulk_config AS
  SELECT :'phase2_c_payload_pad_bytes'::integer AS pad_bytes, :'phase2_c_bulk_scale'::integer AS scale;
DO $$ BEGIN
  IF (SELECT pad_bytes<0 OR scale<1 FROM phase2_c_bulk_config) THEN
    RAISE EXCEPTION 'Padding must be nonnegative and bulk scale must be positive';
  END IF;
END $$;
-- Match #2893's sweep index (local, non-concurrent); restore catalogue at end.
CREATE TEMP TABLE phase2_c_bulk_index_before AS
  SELECT to_regclass('public.analysis_run_facts_sweep_idx') IS NULL AS created_here;
CREATE INDEX IF NOT EXISTS analysis_run_facts_sweep_idx ON public.v5_handler_facts (created_at, id) WHERE action_type = 'run_analysis' AND NOT noop;
-- Runtime extraction from the operator file, not an embedded statement/predicate.
\set phase2_c_batch_source :phase2_c_rehearsal_dir '/batch-source.sql'
\setenv PHASE2_C_BATCH_SOURCE :phase2_c_batch_source
\! node --import tsx scripts/phase2/classify-legacy-unattributable.ts --rehearsal-sql "$PHASE2_C_BATCH_SOURCE"
\if :SHELL_ERROR
  \quit 3
\endif
\ir :phase2_c_batch_source

CREATE FUNCTION pg_temp.phase2_c_pad(p_payload jsonb, p_bytes integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
DECLARE pad text;
BEGIN
  IF p_bytes=0 THEN RETURN p_payload; END IF;
  IF jsonb_typeof(p_payload->'result') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Padded source fixture must have an object result';
  END IF;
  -- Fresh random blocks for every fact: no repeated/compressible fill string.
  SELECT left(string_agg(md5(random()::text),''),p_bytes) INTO pad
    FROM generate_series(1,ceil(p_bytes/32.0)::integer);
  RETURN jsonb_set(p_payload,'{result,pad}',to_jsonb(pad));
END $$;
BEGIN;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
CREATE TEMP TABLE phase2_c_bulk_seed(ordinal integer PRIMARY KEY, kind text NOT NULL);
INSERT INTO phase2_c_bulk_seed SELECT i,'legacy'
  FROM phase2_c_bulk_config c CROSS JOIN LATERAL generate_series(1000,999+2005*c.scale) i;
-- Allocate later controls after the actual legacy range, avoiding scale collisions.
INSERT INTO phase2_c_bulk_seed SELECT s.last+i,'run_id'
  FROM (SELECT max(ordinal) AS last FROM phase2_c_bulk_seed) s CROSS JOIN generate_series(1,50) i;
INSERT INTO phase2_c_bulk_seed SELECT s.last+i,'malformed'
  FROM (SELECT max(ordinal) AS last FROM phase2_c_bulk_seed) s CROSS JOIN generate_series(1,5) i;
INSERT INTO phase2_c_bulk_seed SELECT max(ordinal)+1,'typed_guard' FROM phase2_c_bulk_seed;
INSERT INTO phase2_c_bulk_seed SELECT max(ordinal)+1,'quarantine_guard' FROM phase2_c_bulk_seed;
SELECT pg_temp.phase2_c_append('phase2-c-'||b.ordinal,
  CASE b.kind
    WHEN 'legacy' THEN jsonb_build_object('fact_type','run_analysis','fact_version',1,'result',
      CASE WHEN b.ordinal%2=0 THEN '{"run_id":null}'::jsonb ELSE '{}'::jsonb END)
    WHEN 'run_id' THEN jsonb_set(t.payload,'{result,run_id}',to_jsonb('phase2-c-bulk-'||b.ordinal))
    -- An invalid numeric identity stays non-legacy, while its object result can
    -- carry padding. Unlike result:null, this allows every seeded result to pad.
    WHEN 'malformed' THEN '{"fact_type":"run_analysis","fact_version":1,"result":{"run_id":17}}'::jsonb
    ELSE '{"fact_type":"run_analysis","fact_version":1,"result":{}}'::jsonb END)
  FROM phase2_c_bulk_seed b CROSS JOIN phase2_c_bulk_template t;
INSERT INTO phase2_c_facts(fact_id,turn_id,ordinal)
  SELECT h.id,t.turn_id,b.ordinal
  FROM public.v5_handler_facts h JOIN public.v5_conversation_turns t ON t.id=h.v5_conversation_turn_id
  JOIN phase2_c_bulk_seed b ON t.turn_id='phase2-c-'||b.ordinal
  WHERE h.scenario_id='f2c00000-0000-4000-8000-000000000001';
UPDATE public.v5_handler_facts h SET created_at=s.first_at+
  CASE b.kind WHEN 'run_id' THEN interval '11 seconds'
    WHEN 'malformed' THEN interval '12 seconds' ELSE interval '10 seconds' END
  FROM phase2_c_facts f JOIN phase2_c_bulk_seed b USING(ordinal) CROSS JOIN phase2_c_seed_time s WHERE h.id=f.fact_id;
-- Include the parent's earlier source fixtures too; all have object results.
UPDATE public.v5_handler_facts h SET payload=pg_temp.phase2_c_pad(h.payload,c.pad_bytes)
  FROM phase2_c_facts f CROSS JOIN phase2_c_bulk_config c WHERE h.id=f.fact_id AND c.pad_bytes>0;
SELECT pg_temp.phase2_c_check('every source fixture has exactly the requested result.pad bytes',
  (SELECT c.pad_bytes=0 OR bool_and(COALESCE(octet_length(h.payload->'result'->>'pad')=c.pad_bytes
      AND h.payload->'result' ? 'pad',false))
    FROM public.v5_handler_facts h JOIN phase2_c_facts f ON f.fact_id=h.id
    CROSS JOIN phase2_c_bulk_config c GROUP BY c.pad_bytes));
-- 860 mirrors the measured live legacy-quarantine case, preserving seen_at.
INSERT INTO public.analysis_run_quarantine(fact_id,scenario_id,reason,seen_at)
  SELECT f.fact_id,'f2c00000-0000-4000-8000-000000000001','run_id_absent','2026-07-31T00:00:00Z'
  FROM phase2_c_facts f JOIN phase2_c_bulk_seed b USING(ordinal)
  WHERE b.kind='legacy' ORDER BY b.ordinal LIMIT 860;
INSERT INTO public.analysis_run_quarantine(fact_id,scenario_id,reason)
  SELECT f.fact_id,'f2c00000-0000-4000-8000-000000000001',
    CASE b.kind WHEN 'malformed' THEN 'run_id_invalid' ELSE 'result_shape' END
  FROM phase2_c_facts f JOIN phase2_c_bulk_seed b USING(ordinal) WHERE b.kind IN ('malformed','quarantine_guard');
SELECT public.store_typed_analysis_run(f.fact_id,jsonb_set(t.run,'{run_id}','"phase2-c-existing-typed-guard"'),t.options)
  FROM phase2_c_facts f JOIN phase2_c_bulk_seed b USING(ordinal) CROSS JOIN phase2_c_bulk_template t WHERE b.kind='typed_guard';
CREATE TEMP TABLE phase2_c_bulk_source_before AS
  SELECT h.* FROM public.v5_handler_facts h JOIN phase2_c_facts f ON f.fact_id=h.id JOIN phase2_c_bulk_seed b USING(ordinal);
CREATE TEMP TABLE phase2_c_bulk_runs_before AS SELECT * FROM public.analysis_runs;
CREATE TEMP TABLE phase2_c_bulk_bad_before AS
  SELECT q.* FROM public.analysis_run_quarantine q JOIN phase2_c_facts f USING(fact_id) JOIN phase2_c_bulk_seed b USING(ordinal)
  WHERE b.kind IN ('malformed','quarantine_guard');
CREATE TEMP TABLE phase2_c_bulk_legacy_quarantine_before AS
  SELECT q.fact_id,q.seen_at FROM public.analysis_run_quarantine q JOIN phase2_c_facts f USING(fact_id) JOIN phase2_c_bulk_seed b USING(ordinal)
  WHERE b.kind='legacy';
UPDATE public.analysis_run_sweep_state SET processed_at=(SELECT first_at+interval '9 seconds' FROM phase2_c_seed_time),
  processed_id='00000000-0000-0000-0000-000000000000';
CREATE TEMP TABLE phase2_c_bulk_cursor_before AS SELECT processed_at,processed_id FROM public.analysis_run_sweep_state;
CREATE TEMP TABLE phase2_c_bulk_expected AS
  SELECT count(*)::integer AS scanned, ceil(count(*)/250.0)::integer AS productive_scans,
    count(*) FILTER (WHERE b.kind='legacy')::integer AS legacy,
    count(*) FILTER (WHERE b.kind='run_id')::integer AS run_ids,
    (SELECT count(*)::integer FROM phase2_c_bulk_legacy_quarantine_before) AS removed
  FROM public.v5_handler_facts h JOIN phase2_c_facts f ON f.fact_id=h.id JOIN phase2_c_bulk_seed b USING(ordinal)
  WHERE action_type = 'run_analysis' AND NOT noop;
SELECT pg_temp.phase2_c_check('eligible source counts equal the complete seed manifest',
  (SELECT scanned=(SELECT count(*) FROM phase2_c_bulk_seed)
    AND legacy=(SELECT count(*) FROM phase2_c_bulk_seed WHERE kind='legacy') FROM phase2_c_bulk_expected));
SELECT * FROM phase2_c_bulk_expected;
SELECT first_at+interval '9 seconds' AS phase2_c_bulk_start_at FROM phase2_c_seed_time
\gset
\setenv PHASE2_C_BULK_START_AT :phase2_c_bulk_start_at
COMMIT;
ANALYZE public.v5_handler_facts;
ANALYZE public.analysis_runs;
ANALYZE public.analysis_run_unattributable;
ANALYZE public.analysis_run_quarantine;
-- Build the parity function FROM the batch's extracted predicate, binding the
-- payload alias and adding the source action/noop eligibility for corpus rows.
DO $$
DECLARE predicate_sql text; body text;
BEGIN
  SELECT predicate INTO STRICT predicate_sql FROM phase2_c_batch_source;
  body:='SELECT COALESCE(p_action_type = ''run_analysis'' AND p_noop IS FALSE AND ('
    ||replace(predicate_sql,'h.payload','p_payload')||'),false)'
    ||' FROM LATERAL (SELECT p_payload->''result'' AS result OFFSET 0) p';
  EXECUTE format('CREATE FUNCTION pg_temp.phase2_c_legacy_v2(p_payload jsonb, p_noop boolean, p_action_type text)'
    ||' RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS %L',body);
END $$;
SELECT pg_temp.phase2_c_check('extracted v2 predicate parity remains 53/53 against canonical SQL and TS, including padding',
  (SELECT count(*)=53 AND bool_and(
    pg_temp.phase2_c_legacy_v2(payload,noop,action_type)=ts_unattributable
    AND pg_temp.phase2_c_legacy_v2(payload,noop,action_type)=pg_temp.is_legacy_run_analysis(payload,noop,action_type)
    AND pg_temp.phase2_c_legacy_v2(CASE WHEN jsonb_typeof(payload->'result')='object'
      THEN pg_temp.phase2_c_pad(payload,c.pad_bytes) ELSE payload END,noop,action_type)=ts_unattributable)
    FROM phase2_c_parity CROSS JOIN phase2_c_bulk_config c));
-- EXPLAIN runs the actual extracted DML statement, then rolls it back.
CREATE FUNCTION pg_temp.phase2_c_explain_batch(p_at timestamptz, p_id uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE batch_sql text; plan jsonb;
BEGIN
  SELECT statement INTO STRICT batch_sql FROM phase2_c_batch_source;
  BEGIN
    EXECUTE 'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '||batch_sql INTO plan USING p_at,p_id,'';
    RAISE EXCEPTION USING ERRCODE='P2C01',MESSAGE='roll back explained batch';
  EXCEPTION WHEN SQLSTATE 'P2C01' THEN NULL;
  END;
  RETURN plan;
END $$;
CREATE TEMP TABLE phase2_c_bulk_mid_cursor AS
  SELECT h.created_at,h.id FROM public.v5_handler_facts h JOIN phase2_c_facts f ON f.fact_id=h.id
    JOIN phase2_c_bulk_seed b USING(ordinal) WHERE b.kind='legacy'
  ORDER BY h.created_at,h.id OFFSET (SELECT legacy/2 FROM phase2_c_bulk_expected) LIMIT 1;
CREATE TEMP TABLE phase2_c_bulk_plan(plan jsonb);
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';
INSERT INTO phase2_c_bulk_plan SELECT pg_temp.phase2_c_explain_batch(created_at,id) FROM phase2_c_bulk_mid_cursor;
COMMIT;
SELECT jsonb_pretty(plan) AS "EXPLAIN (ANALYZE, BUFFERS) — one mid-region batch" FROM phase2_c_bulk_plan;
SELECT pg_temp.phase2_c_check('plan: sweep Index Scan/Index Only Scan below Limit 250, before payload predicate',
  EXISTS (SELECT 1 FROM phase2_c_bulk_plan,
    LATERAL jsonb_path_query(plan,'$.** ? (@."Subplan Name" == "CTE scanned")') n
    WHERE n->>'Node Type'='Limit' AND (n->>'Actual Rows')::integer=250
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(n->'Plans') child
        WHERE child->>'Index Name'='analysis_run_facts_sweep_idx'
          AND child->>'Node Type' IN ('Index Scan','Index Only Scan')
          AND COALESCE(child->>'Filter','') !~* 'payload|is_legacy')));
\! node --import tsx scripts/phase2/classify-legacy-unattributable.ts --scenario-id f2c00000-0000-4000-8000-000000000001 --start-created-at "$PHASE2_C_BULK_START_AT" --start-id 00000000-0000-0000-0000-000000000000 --stats-sql "$PHASE2_C_BULK_STATS"
\if :SHELL_ERROR
  \quit 3
\endif
\ir :phase2_c_bulk_stats
SELECT count(*) AS batches_including_empty, count(*) FILTER (WHERE scanned>0) AS productive_scans,
  sum(scanned) AS scanned, sum(inserted) AS classified, max(scanned) AS largest_scan,
  max(duration_ms) AS max_batch_ms, avg(duration_ms) AS avg_batch_ms FROM phase2_c_bulk_stats;
SELECT pg_temp.phase2_c_check('every seeded legacy classified in <=250 scans plus one empty stop',
  (SELECT count(*)=e.productive_scans+1 AND count(*) FILTER (WHERE s.scanned>0)=e.productive_scans
    AND sum(s.scanned)=e.scanned AND sum(inserted)=e.legacy AND max(s.scanned)=250 AND sum(s.removed)=e.removed
    AND bool_and(s.scanned BETWEEN 0 AND 250 AND inserted BETWEEN 0 AND s.scanned)
    FROM phase2_c_bulk_stats s CROSS JOIN phase2_c_bulk_expected e GROUP BY e.productive_scans,e.scanned,e.legacy,e.removed)
  AND (SELECT scanned=0 AND inserted=0 FROM phase2_c_bulk_stats ORDER BY batch DESC LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM (SELECT scanned,last_created_at,last_id,
      lag(last_created_at) OVER (ORDER BY batch) AS prior_at,lag(last_id) OVER (ORDER BY batch) AS prior_id
      FROM phase2_c_bulk_stats) s WHERE scanned>0 AND prior_at IS NOT NULL
      AND (last_created_at,last_id)<=(prior_at,prior_id))
  AND (SELECT count(*)=(SELECT legacy FROM phase2_c_bulk_expected)
    FROM public.analysis_run_unattributable u JOIN phase2_c_facts f USING(fact_id) JOIN phase2_c_bulk_seed b USING(ordinal) WHERE b.kind='legacy')
  AND NOT EXISTS (SELECT 1 FROM public.analysis_run_quarantine q JOIN phase2_c_facts f USING(fact_id) JOIN phase2_c_bulk_seed b USING(ordinal) WHERE b.kind='legacy')
  AND NOT EXISTS (SELECT 1 FROM phase2_c_bulk_legacy_quarantine_before q JOIN public.analysis_run_unattributable u USING(fact_id) WHERE u.seen_at<>q.seen_at));
SELECT pg_temp.phase2_c_check('all source bytes, run_id facts, typed guard and malformed quarantine untouched by classifier',
  NOT EXISTS ((SELECT h.* FROM public.v5_handler_facts h JOIN phase2_c_facts f ON f.fact_id=h.id JOIN phase2_c_bulk_seed b USING(ordinal)
    EXCEPT SELECT * FROM phase2_c_bulk_source_before)
    UNION ALL (SELECT * FROM phase2_c_bulk_source_before EXCEPT
      SELECT h.* FROM public.v5_handler_facts h JOIN phase2_c_facts f ON f.fact_id=h.id JOIN phase2_c_bulk_seed b USING(ordinal)))
  AND NOT EXISTS ((SELECT * FROM public.analysis_runs EXCEPT SELECT * FROM phase2_c_bulk_runs_before)
    UNION ALL (SELECT * FROM phase2_c_bulk_runs_before EXCEPT SELECT * FROM public.analysis_runs))
  AND NOT EXISTS ((SELECT q.* FROM public.analysis_run_quarantine q JOIN phase2_c_facts f USING(fact_id) JOIN phase2_c_bulk_seed b USING(ordinal) WHERE b.kind IN ('malformed','quarantine_guard')
    EXCEPT SELECT * FROM phase2_c_bulk_bad_before)
    UNION ALL (SELECT * FROM phase2_c_bulk_bad_before EXCEPT
      SELECT q.* FROM public.analysis_run_quarantine q JOIN phase2_c_facts f USING(fact_id) JOIN phase2_c_bulk_seed b USING(ordinal) WHERE b.kind IN ('malformed','quarantine_guard')))
  AND NOT EXISTS (SELECT 1 FROM public.analysis_run_unattributable u JOIN phase2_c_facts f USING(fact_id) JOIN phase2_c_bulk_seed b USING(ordinal) WHERE b.kind<>'legacy')
  AND (SELECT (s.processed_at,s.processed_id)=(b.processed_at,b.processed_id) FROM public.analysis_run_sweep_state s CROSS JOIN phase2_c_bulk_cursor_before b));
-- Re-explain the SAME mid-region key after classification: terminal ids must
-- produce zero evaluated rows and never execute the correlated payload fetch.
ANALYZE public.analysis_run_unattributable;
CREATE TEMP TABLE phase2_c_disposed_plan(plan jsonb);
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';
INSERT INTO phase2_c_disposed_plan SELECT pg_temp.phase2_c_explain_batch(created_at,id) FROM phase2_c_bulk_mid_cursor;
COMMIT;
SELECT jsonb_pretty(plan) AS "EXPLAIN — already-disposed scan, no payload fetch" FROM phase2_c_disposed_plan;
SELECT pg_temp.phase2_c_check('disposed ids scan 250 but evaluate zero payloads and never execute payload fetch',
  EXISTS (SELECT 1 FROM phase2_c_disposed_plan,LATERAL jsonb_path_query(plan,'$.** ? (@."Subplan Name" == "CTE scanned")') n WHERE (n->>'Actual Rows')::integer=250)
  AND EXISTS (SELECT 1 FROM phase2_c_disposed_plan,LATERAL jsonb_path_query(plan,'$.** ? (@."Subplan Name" == "CTE evaluated")') n WHERE (n->>'Actual Rows')::integer=0)
  AND NOT EXISTS (SELECT 1 FROM phase2_c_disposed_plan,LATERAL jsonb_path_query(plan,'$.** ? (@."Alias" == "h")') n WHERE (n->>'Actual Loops')::integer>0));
-- Actual <=20-row claim/store/finish passes retain the positive run_id control.
DO $$
DECLARE receipt jsonb; fact jsonb; remaining integer; windows integer:=0; derived integer:=0; stored boolean; prior_at timestamptz; prior_id uuid;
BEGIN
  LOOP
    SELECT LEAST(20,count(*))::integer INTO remaining
      FROM public.v5_handler_facts h JOIN phase2_c_facts f ON f.fact_id=h.id JOIN phase2_c_bulk_seed b USING(ordinal)
      CROSS JOIN public.analysis_run_sweep_state s WHERE (h.created_at,h.id)>(s.processed_at,s.processed_id);
    EXIT WHEN remaining=0;
    SELECT processed_at,processed_id INTO prior_at,prior_id FROM public.analysis_run_sweep_state;
    receipt:=public.claim_analysis_run_facts(remaining); windows:=windows+1;
    PERFORM pg_temp.phase2_c_check('bulk recovery claim bounded and leased',
      (receipt->>'window_count')::integer BETWEEN 1 AND 20 AND receipt->>'lease_id' IS NOT NULL);
    FOR fact IN SELECT value FROM jsonb_array_elements(receipt->'facts') LOOP
      PERFORM pg_temp.phase2_c_check('bulk recovery claims only untouched real run_id facts',
        EXISTS (SELECT 1 FROM phase2_c_facts f JOIN phase2_c_bulk_seed b USING(ordinal) WHERE f.fact_id=(fact->>'fact_id')::uuid AND b.kind='run_id'));
      SELECT public.store_typed_analysis_run((fact->>'fact_id')::uuid,
        jsonb_set(t.run,'{run_id}',fact->'payload'->'result'->'run_id'),t.options) INTO stored FROM phase2_c_bulk_template t;
      IF stored THEN derived:=derived+1; END IF;
    END LOOP;
    PERFORM public.finish_analysis_run_sweep((receipt->>'lease_id')::uuid);
    PERFORM pg_temp.phase2_c_check('every bulk recovery window advances; fail instead of spinning',
      (SELECT (processed_at,processed_id)>(prior_at,prior_id) FROM public.analysis_run_sweep_state));
  END LOOP;
  PERFORM pg_temp.phase2_c_check('sweep then derives every real Run; legacy never re-claimed',
    derived=(SELECT run_ids FROM phase2_c_bulk_expected)
    AND (SELECT count(*)=(SELECT run_ids FROM phase2_c_bulk_expected) FROM public.analysis_runs r
      JOIN phase2_c_facts f USING(fact_id) JOIN phase2_c_bulk_seed b USING(ordinal) WHERE b.kind='run_id'));
  RAISE NOTICE 'BULK RECOVERY windows=%, derived=%',windows,derived;
END $$;
-- Remove only an index created here, for the parent's exact catalogue rollback.
DO $$ BEGIN
  IF (SELECT created_here FROM phase2_c_bulk_index_before) THEN DROP INDEX public.analysis_run_facts_sweep_idx; END IF;
END $$;
