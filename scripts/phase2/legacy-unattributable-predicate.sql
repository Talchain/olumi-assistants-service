-- Matches typed-run-rows.ts's pre-schema legacy branch on persisted JSONB.
-- The claim's action_type/noop eligibility runs before the mapper. The source
-- noop column overrides any payload noop; payload fact_version (not the column)
-- must be JSON number 1. Unreadable payload/result and refusal markers stay out.
-- Session-local helper only: no persistent catalogue or source-table changes.
CREATE OR REPLACE FUNCTION pg_temp.is_legacy_run_analysis(p_payload jsonb, p_noop boolean, p_action_type text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $predicate$
  SELECT COALESCE(
    p_action_type = 'run_analysis'
    AND p_noop IS FALSE
    AND jsonb_typeof(p_payload) = 'object'
    AND p_payload->'fact_type' = '"run_analysis"'::jsonb
    AND p_payload->'fact_version' = '1'::jsonb
    AND jsonb_typeof(p_payload->'result') = 'object'
    AND (NOT ((p_payload->'result') ? 'run_id') OR p_payload->'result'->'run_id' = 'null'::jsonb)
    AND (jsonb_typeof(p_payload->'result'->'enrichment') = 'object'
      AND p_payload->'result'->'enrichment'->'analysis_status' = '"refused"'::jsonb) IS NOT TRUE,
    false);
$predicate$;
