-- ONE batch. Use the TS operator to repeat this file in independent sessions /
-- transactions, until inserted=0. Source is READ ONLY; no source FK or row locks.
\set ON_ERROR_STOP on
\if :{?classify_scenario_id}
\else
  \set classify_scenario_id ''
\endif
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';
\ir legacy-unattributable-predicate.sql
WITH candidates AS MATERIALIZED (
  SELECT h.id, COALESCE(q.seen_at, now()) AS seen_at
  FROM public.v5_handler_facts h
  LEFT JOIN public.analysis_run_quarantine q ON q.fact_id=h.id AND q.reason='run_id_absent'
  WHERE h.action_type='run_analysis' AND NOT h.noop
    AND (NULLIF(:'classify_scenario_id','') IS NULL OR h.scenario_id=NULLIF(:'classify_scenario_id','')::uuid)
    AND pg_temp.is_legacy_run_analysis(h.payload,h.noop,h.action_type)
    AND NOT EXISTS (SELECT 1 FROM public.analysis_runs r WHERE r.fact_id=h.id)
    AND NOT EXISTS (SELECT 1 FROM public.analysis_run_unattributable u WHERE u.fact_id=h.id)
    AND NOT EXISTS (SELECT 1 FROM public.analysis_run_quarantine malformed
      WHERE malformed.fact_id=h.id AND malformed.reason IS DISTINCT FROM 'run_id_absent')
  ORDER BY h.created_at,h.id LIMIT 500
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
SELECT jsonb_build_object('inserted',(SELECT count(*) FROM inserted),'removed',(SELECT count(*) FROM removed));
COMMIT;
