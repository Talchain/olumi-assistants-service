-- LOCAL lock-harness helper; -v expect_index=true/false. No planner forcing.
-- Reconstruct the actual claim's bounded-window/anti-join SQL from its stored
-- definition, substituting only PL/pgSQL variables. Fail rather than drift.
\set ON_ERROR_STOP on
CREATE FUNCTION pg_temp.phase2_sweep_plan() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE source text; query text; plan jsonb;
BEGIN
  IF current_setting('enable_seqscan') <> 'on' OR current_setting('enable_indexscan') <> 'on'
     OR current_setting('enable_bitmapscan') <> 'on' THEN
    RAISE EXCEPTION 'Proof requires normal planner settings (no forced scan)';
  END IF;
  source := pg_get_functiondef('public.claim_analysis_run_facts(integer)'::regprocedure);
  IF strpos(source,'WITH fact_window AS MATERIALIZED (')=0
     OR strpos(source,'INTO batch, last_at, last_id, window_count;')=0 THEN
    RAISE EXCEPTION 'Claim query changed: update extraction before rehearsing';
  END IF;
  query := 'WITH fact_window AS MATERIALIZED (' || split_part(split_part(source,
    'WITH fact_window AS MATERIALIZED (',2),'INTO batch, last_at, last_id, window_count;',1);
  query := replace(query,'s.processed_at',quote_literal('-infinity')||'::timestamptz');
  query := replace(query,'s.processed_id',quote_literal('00000000-0000-0000-0000-000000000000')||'::uuid');
  query := replace(query,'p_sweep_limit','20');
  query := replace(query,'cutoff','statement_timestamp()');
  EXECUTE 'EXPLAIN (FORMAT JSON) '||query INTO plan;
  RETURN plan;
END;
$$;
SELECT pg_temp.phase2_sweep_plan() AS sweep_plan
\gset
\echo :sweep_plan
WITH RECURSIVE nodes(node) AS (
  SELECT :'sweep_plan'::jsonb->0->'Plan'
  UNION ALL
  SELECT child FROM nodes CROSS JOIN LATERAL jsonb_array_elements(COALESCE(node->'Plans','[]')) AS children(child)
)
SELECT
  COALESCE(bool_or(node->>'Index Name'='analysis_run_facts_sweep_idx'
    AND node->>'Node Type' IN ('Index Scan','Index Only Scan','Bitmap Index Scan')),false) AS sweep_index_used,
  COALESCE(bool_or(node->>'Relation Name'='v5_handler_facts' AND node->>'Node Type'='Seq Scan'),false) AS facts_seq_scan
FROM nodes
\gset
\if :expect_index
  SELECT :'sweep_index_used'::boolean AND NOT :'facts_seq_scan'::boolean AS plan_passed
  \gset
  \if :plan_passed
    \echo 'PASS normal EXPLAIN uses analysis_run_facts_sweep_idx; no facts Seq Scan'
  \else
    \echo 'FAIL indexed sweep plan (JSON printed above)'
    \quit 1
  \endif
\else
  SELECT :'facts_seq_scan'::boolean AND NOT :'sweep_index_used'::boolean AS contrast_passed
  \gset
  \if :contrast_passed
    \echo 'PASS absent-index contrast has a facts Seq Scan under the normal planner'
  \else
    \echo 'FAIL absent-index contrast (JSON printed above)'
    \quit 1
  \endif
\endif
