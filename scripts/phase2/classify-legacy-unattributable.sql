-- ONE batch in its own short transaction. Stop on scanned=0, never inserted=0.
-- Cursor ownership is in TS; source is READ ONLY, with no row locks or source FK.
\set ON_ERROR_STOP on
\if :{?classify_scenario_id}
\else
  \set classify_scenario_id ''
\endif
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';
WITH scanned AS MATERIALIZED (
  -- Exactly the sweep index predicate and key order. No payload or anti-join
  -- may enter this fence: the cap is on scanned facts, regardless of disposition.
  SELECT id,created_at
  FROM public.v5_handler_facts
  WHERE action_type = 'run_analysis' AND NOT noop
    AND (created_at,id) > (:'classify_last_created_at'::timestamptz,:'classify_last_id'::uuid)
    AND (NULLIF(:'classify_scenario_id','') IS NULL OR scenario_id=NULLIF(:'classify_scenario_id','')::uuid)
  ORDER BY created_at,id LIMIT 250
), undisposed AS MATERIALIZED (
  -- Terminal disposition checks use ids only, before any payload fetch/detoast.
  SELECT s.id FROM scanned s
  WHERE NOT EXISTS (SELECT 1 FROM public.analysis_runs r WHERE r.fact_id=s.id)
    AND NOT EXISTS (SELECT 1 FROM public.analysis_run_unattributable u WHERE u.fact_id=s.id)
    AND NOT EXISTS (SELECT 1 FROM public.analysis_run_quarantine malformed
      WHERE malformed.fact_id=s.id AND malformed.reason IS DISTINCT FROM 'run_id_absent')
), evaluated AS MATERIALIZED (
  SELECT d.id,
    -- legacy-predicate-begin
    COALESCE(
    jsonb_typeof(h.payload) = 'object'
    AND h.payload->'fact_type' = '"run_analysis"'::jsonb
    AND h.payload->'fact_version' = '1'::jsonb
    AND jsonb_typeof(p.result) = 'object'
    AND (NOT (p.result ? 'run_id') OR p.result->'run_id' = 'null'::jsonb)
    AND (jsonb_typeof(p.result->'enrichment') = 'object'
      AND p.result->'enrichment'->'analysis_status' = '"refused"'::jsonb) IS NOT TRUE,
    false)
    -- legacy-predicate-end
    AS is_legacy
  FROM undisposed d
  -- Correlate each payload fetch to its scanned id; avoid a full source hash join.
  CROSS JOIN LATERAL (SELECT h.payload FROM public.v5_handler_facts h WHERE h.id=d.id OFFSET 0) h
  -- OFFSET 0 prevents pull-up/repeated extraction of the large result subtree.
  CROSS JOIN LATERAL (SELECT h.payload->'result' AS result OFFSET 0) p
), candidates AS MATERIALIZED (
  SELECT e.id, COALESCE(q.seen_at, now()) AS seen_at
  FROM evaluated e
  LEFT JOIN public.analysis_run_quarantine q ON q.fact_id=e.id AND q.reason='run_id_absent'
  WHERE e.is_legacy
), inserted AS (
  INSERT INTO public.analysis_run_unattributable(fact_id,reason,seen_at)
    SELECT id,'run_id_absent',seen_at FROM candidates ON CONFLICT (fact_id) DO NOTHING
    RETURNING fact_id
), removed AS (
  DELETE FROM public.analysis_run_quarantine q USING candidates c
    WHERE q.fact_id=c.id AND q.reason='run_id_absent'
      AND (EXISTS (SELECT 1 FROM inserted i WHERE i.fact_id=c.id)
        OR EXISTS (SELECT 1 FROM public.analysis_run_unattributable u WHERE u.fact_id=c.id))
    RETURNING q.fact_id
)
SELECT jsonb_build_object('scanned',(SELECT count(*) FROM scanned),
  'inserted',(SELECT count(*) FROM inserted),'removed',(SELECT count(*) FROM removed),
  'next_created_at',(SELECT created_at FROM scanned ORDER BY created_at DESC,id DESC LIMIT 1),
  'next_id',(SELECT id FROM scanned ORDER BY created_at DESC,id DESC LIMIT 1));
COMMIT;
