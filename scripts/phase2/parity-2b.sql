-- Run from repository root on an isolated LOCAL DB with Phase 2(a) applied:
-- psql -X -qAt -f scripts/phase2/parity-2b.sql > /tmp/parity-2b-actual.json
-- Compare JSON values to corpus-2b/expected.json (object key order/whitespace are immaterial).
-- Generated timestamps/IDs (run.created_at, quarantine.id/seen_at) are intentionally omitted.
-- Input facts and fixed fact/scenario/revision identity are shared with the TS half.
\set ON_ERROR_STOP on
\set QUIET on
\pset format unaligned
\pset tuples_only on
SELECT :'HOST' IN ('localhost', '127.0.0.1', '::1') OR :'HOST' LIKE '/%' AS local_endpoint
\gset
\if :local_endpoint
\else
  \quit 3
\endif
BEGIN;
SET LOCAL timezone = 'UTC';
CREATE TEMP TABLE parity_2b_source (ordinal BIGSERIAL, raw JSONB) ON COMMIT DROP;
\copy parity_2b_source(raw) FROM 'scripts/phase2/corpus-2b/01-success.json' WITH (FORMAT csv, QUOTE E'\x01', DELIMITER E'\x02')
\copy parity_2b_source(raw) FROM 'scripts/phase2/corpus-2b/02-legacy-missing-run.json' WITH (FORMAT csv, QUOTE E'\x01', DELIMITER E'\x02')
\copy parity_2b_source(raw) FROM 'scripts/phase2/corpus-2b/03-legacy-null-run.json' WITH (FORMAT csv, QUOTE E'\x01', DELIMITER E'\x02')
\copy parity_2b_source(raw) FROM 'scripts/phase2/corpus-2b/04-refusal-marker.json' WITH (FORMAT csv, QUOTE E'\x01', DELIMITER E'\x02')
\copy parity_2b_source(raw) FROM 'scripts/phase2/corpus-2b/05-refusal-with-run.json' WITH (FORMAT csv, QUOTE E'\x01', DELIMITER E'\x02')
\copy parity_2b_source(raw) FROM 'scripts/phase2/corpus-2b/06-degraded.json' WITH (FORMAT csv, QUOTE E'\x01', DELIMITER E'\x02')
\copy parity_2b_source(raw) FROM 'scripts/phase2/corpus-2b/07-partial.json' WITH (FORMAT csv, QUOTE E'\x01', DELIMITER E'\x02')
\copy parity_2b_source(raw) FROM 'scripts/phase2/corpus-2b/08-failed.json' WITH (FORMAT csv, QUOTE E'\x01', DELIMITER E'\x02')
\copy parity_2b_source(raw) FROM 'scripts/phase2/corpus-2b/09-blocked.json' WITH (FORMAT csv, QUOTE E'\x01', DELIMITER E'\x02')
\copy parity_2b_source(raw) FROM 'scripts/phase2/corpus-2b/10-multiple-options.json' WITH (FORMAT csv, QUOTE E'\x01', DELIMITER E'\x02')
\copy parity_2b_source(raw) FROM 'scripts/phase2/corpus-2b/11-missing-probability.json' WITH (FORMAT csv, QUOTE E'\x01', DELIMITER E'\x02')
\copy parity_2b_source(raw) FROM 'scripts/phase2/corpus-2b/12-null-probability.json' WITH (FORMAT csv, QUOTE E'\x01', DELIMITER E'\x02')
\copy parity_2b_source(raw) FROM 'scripts/phase2/corpus-2b/13-above-one.json' WITH (FORMAT csv, QUOTE E'\x01', DELIMITER E'\x02')
\copy parity_2b_source(raw) FROM 'scripts/phase2/corpus-2b/14-below-zero.json' WITH (FORMAT csv, QUOTE E'\x01', DELIMITER E'\x02')
\copy parity_2b_source(raw) FROM 'scripts/phase2/corpus-2b/15-string-probability.json' WITH (FORMAT csv, QUOTE E'\x01', DELIMITER E'\x02')
\copy parity_2b_source(raw) FROM 'scripts/phase2/corpus-2b/16-boolean-probability.json' WITH (FORMAT csv, QUOTE E'\x01', DELIMITER E'\x02')
\copy parity_2b_source(raw) FROM 'scripts/phase2/corpus-2b/17-wrong-summary.json' WITH (FORMAT csv, QUOTE E'\x01', DELIMITER E'\x02')
\copy parity_2b_source(raw) FROM 'scripts/phase2/corpus-2b/18-wrong-leader.json' WITH (FORMAT csv, QUOTE E'\x01', DELIMITER E'\x02')
\copy parity_2b_source(raw) FROM 'scripts/phase2/corpus-2b/19-wrong-run-id.json' WITH (FORMAT csv, QUOTE E'\x01', DELIMITER E'\x02')
\copy parity_2b_source(raw) FROM 'scripts/phase2/corpus-2b/20-unknown-enrichment.json' WITH (FORMAT csv, QUOTE E'\x01', DELIMITER E'\x02')
\copy parity_2b_source(raw) FROM 'scripts/phase2/corpus-2b/21-enrichment-absent.json' WITH (FORMAT csv, QUOTE E'\x01', DELIMITER E'\x02')
\copy parity_2b_source(raw) FROM 'scripts/phase2/corpus-2b/22-enrichment-wrong-type.json' WITH (FORMAT csv, QUOTE E'\x01', DELIMITER E'\x02')
\copy parity_2b_source(raw) FROM 'scripts/phase2/corpus-2b/23-computed-at-missing.json' WITH (FORMAT csv, QUOTE E'\x01', DELIMITER E'\x02')
\copy parity_2b_source(raw) FROM 'scripts/phase2/corpus-2b/24-computed-at-invalid.json' WITH (FORMAT csv, QUOTE E'\x01', DELIMITER E'\x02')
\copy parity_2b_source(raw) FROM 'scripts/phase2/corpus-2b/25-clock-skew.json' WITH (FORMAT csv, QUOTE E'\x01', DELIMITER E'\x02')
\copy parity_2b_source(raw) FROM 'scripts/phase2/corpus-2b/26-duplicate-run-id.json' WITH (FORMAT csv, QUOTE E'\x01', DELIMITER E'\x02')
\copy parity_2b_source(raw) FROM 'scripts/phase2/corpus-2b/27-invalid-precision.json' WITH (FORMAT csv, QUOTE E'\x01', DELIMITER E'\x02')
\copy parity_2b_source(raw) FROM 'scripts/phase2/corpus-2b/28-no-licence.json' WITH (FORMAT csv, QUOTE E'\x01', DELIMITER E'\x02')
\copy parity_2b_source(raw) FROM 'scripts/phase2/corpus-2b/29-legacy-success-status.json' WITH (FORMAT csv, QUOTE E'\x01', DELIMITER E'\x02')
\copy parity_2b_source(raw) FROM 'scripts/phase2/corpus-2b/30-huge-100-options.json' WITH (FORMAT csv, QUOTE E'\x01', DELIMITER E'\x02')

INSERT INTO public.scenarios (id, user_id, graph, revision)
SELECT DISTINCT (raw->>'scenario_id')::uuid, NULL::uuid, '{"nodes":[],"edges":[]}'::jsonb,
       (raw->>'scenario_revision')::bigint FROM parity_2b_source;
INSERT INTO public.v5_conversation_turns
  (id, scenario_id, user_id, turn_id, turn_class, handler_id, request_hash)
SELECT (raw->>'fact_id')::uuid, (raw->>'scenario_id')::uuid, NULL::uuid,
       'parity-2b-' || (raw->>'case_id'), 'handler', 'run_analysis', 'parity-2b-request'
FROM parity_2b_source ORDER BY ordinal;
-- Separate inserts pin duplicate-run resolution to file order. The real AFTER INSERT trigger stays installed.
DO $insert$
DECLARE entry RECORD;
BEGIN
  FOR entry IN SELECT raw FROM parity_2b_source ORDER BY ordinal LOOP
    INSERT INTO public.v5_handler_facts
      (id, v5_conversation_turn_id, scenario_id, user_id, handler_id, action_type, noop, payload, created_at)
    VALUES ((entry.raw->>'fact_id')::uuid, (entry.raw->>'fact_id')::uuid,
      (entry.raw->>'scenario_id')::uuid, NULL, 'run_analysis', 'run_analysis',
      (entry.raw #>> '{fact,noop}')::boolean, (entry.raw->'fact') - 'noop',
      (entry.raw->>'created_at')::timestamptz);
  END LOOP;
END;
$insert$;
CREATE FUNCTION pg_temp.quarantine_code(reason TEXT) RETURNS TEXT LANGUAGE plpgsql AS $code$
BEGIN
  IF reason IN ('result_shape','run_id_absent','run_id_invalid','scenario_id_mismatch',
    'leading_option_id_shape','summary_shape','constraint_may_name_leading_option_shape') THEN RETURN reason;
  ELSIF reason LIKE '%duplicate key value%analysis_runs_pkey%' THEN RETURN 'duplicate_run_id';
  ELSIF reason LIKE '%computed_at%' OR reason LIKE '[22007]%' OR reason LIKE '[22008]%' THEN RETURN 'computed_at_invalid';
  ELSIF reason LIKE '%analysis_status%' THEN RETURN 'analysis_status_unsupported';
  ELSIF reason LIKE '%Wilson%' OR reason LIKE '%precision%' THEN RETURN 'precision_invalid';
  ELSIF reason LIKE '%probability_of_goal%' THEN RETURN 'probability_invalid';
  ELSIF reason LIKE '%option_comparison%' THEN RETURN 'option_comparison_invalid';
  ELSIF reason LIKE '%result.enrichment must be an object%' THEN RETURN 'enrichment_invalid';
  ELSE RAISE EXCEPTION 'Unrecognised quarantine diagnostic: %', reason;
  END IF;
END;
$code$;
-- Never classify a missing derivation/quarantine as a refusal unless the source proves that predicate.
DO $assert$
BEGIN
  IF EXISTS (SELECT 1 FROM parity_2b_source s
    LEFT JOIN public.analysis_runs r ON r.fact_id = (s.raw->>'fact_id')::uuid
    LEFT JOIN public.analysis_run_quarantine q ON q.fact_id = (s.raw->>'fact_id')::uuid
    WHERE r.run_id IS NULL AND q.fact_id IS NULL AND NOT COALESCE(
      s.raw #>> '{fact,fact_type}' = 'run_analysis' AND s.raw #> '{fact,noop}' = 'false'::jsonb
      AND s.raw #>> '{fact,result,enrichment,analysis_status}' = 'refused'
      AND (s.raw #> '{fact,result,run_id}' IS NULL OR s.raw #> '{fact,result,run_id}' = 'null'::jsonb), FALSE)) THEN
    RAISE EXCEPTION 'Missing derived row/quarantine for a non-refusal corpus fact';
  END IF;
  IF EXISTS (SELECT 1 FROM parity_2b_source s JOIN public.analysis_run_quarantine q
    ON q.fact_id = (s.raw->>'fact_id')::uuid GROUP BY q.fact_id HAVING count(*) <> 1) THEN
    RAISE EXCEPTION 'Quarantine must be exactly one row per fact';
  END IF;
END;
$assert$;
SELECT jsonb_agg(jsonb_build_object(
  'case_id', s.raw->>'case_id',
  'disposition', CASE WHEN r.run_id IS NOT NULL THEN 'derived'
                      WHEN q.fact_id IS NOT NULL THEN 'quarantined' ELSE 'skipped_refusal' END,
  'run', CASE WHEN r.run_id IS NULL THEN NULL ELSE (to_jsonb(r) - 'created_at') || jsonb_build_object(
    'computed_at', to_char(r.computed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) END,
  'options', COALESCE((SELECT jsonb_agg(to_jsonb(o) - 'run_id' ORDER BY o.option_id COLLATE "C")
                      FROM public.analysis_run_options o WHERE o.run_id = r.run_id), '[]'::jsonb),
  'quarantine', CASE WHEN q.fact_id IS NULL THEN NULL ELSE jsonb_build_object(
    'fact_id', q.fact_id, 'scenario_id', q.scenario_id, 'reason', pg_temp.quarantine_code(q.reason)) END
) ORDER BY s.ordinal)
FROM parity_2b_source s
LEFT JOIN public.analysis_runs r ON r.fact_id = (s.raw->>'fact_id')::uuid
LEFT JOIN public.analysis_run_quarantine q ON q.fact_id = (s.raw->>'fact_id')::uuid;
ROLLBACK;
