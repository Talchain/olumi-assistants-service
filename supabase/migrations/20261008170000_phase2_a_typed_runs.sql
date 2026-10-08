-- =============================================================================
-- PROPOSAL, NOT EXECUTED — Shared Data Phase 2(a): typed analysis runs
-- this trigger fires on PRODUCTION fact inserts; derivation errors never raise
-- Cancellation and assertion failures propagate; they are never quarantined.
-- =============================================================================
-- Prerequisite: 20261008160000_phase2_c_scenario_revision.sql.
-- Three new tables, one index/view, three functions and one AFTER INSERT trigger.
-- No append RPC is replaced: every writer of v5_handler_facts is covered.
-- Discriminator: src/orchestrator-v5/session/supabase-store.ts:2972-2975 writes
-- action_type = f.fact_type and payload = {fact_type, fact_version, result}.
-- Either run_analysis discriminator selects a fact; inconsistent carriers quarantine.
-- noop is the fact column. The paths below are pinned by TYPED_RUN_PAYLOAD_PATHS
-- in src/orchestrator-v5/runs/typed-run-rows.ts and its existing test file.
-- Warning child paths apply equally to result.inference_warnings when present.
-- payload_path: fact_type
-- payload_path: fact_version
-- payload_path: result.scenario_id
-- payload_path: result.run_id
-- payload_path: result.leading_option_id
-- payload_path: result.constraint_verdict.may_name_leading_option
-- payload_path: result.computed_at
-- payload_path: result.input_snapshot
-- payload_path: result.input_snapshot.sent_digest
-- payload_path: result.enrichment.analysis_status
-- payload_path: result.enrichment.option_comparison
-- payload_path: result.enrichment.option_comparison[].option_id
-- payload_path: result.enrichment.option_comparison[].probability_of_goal
-- payload_path: result.enrichment.option_comparison[].probability_of_goal_precision.basis
-- payload_path: result.enrichment.option_comparison[].probability_of_goal_precision.method
-- payload_path: result.enrichment.option_comparison[].probability_of_goal_precision.confidence_level
-- payload_path: result.enrichment.option_comparison[].probability_of_goal_precision.n_informative
-- payload_path: result.enrichment.option_comparison[].probability_of_goal_precision.n_met
-- payload_path: result.enrichment.option_comparison[].probability_of_goal_precision.interval_lower
-- payload_path: result.enrichment.option_comparison[].probability_of_goal_precision.interval_upper
-- payload_path: result.enrichment.inference_warnings[]
-- payload_path: result.inference_warnings[]
-- payload_path: result.enrichment.inference_warnings[].code
-- payload_path: result.enrichment.inference_warnings[].option_ids
-- payload_path: result.enrichment.inference_warnings[].form
-- payload_path: result.enrichment.inference_warnings[].similar_option_ids
-- payload_path: result.enrichment.inference_warnings[].leader_option_id
-- payload_path: result.enrichment.inference_warnings[].next_option_id
-- payload_path: result.enrichment.inference_warnings[].withheld_option_ids
-- payload_path: result.enrichment.inference_warnings[].pct_by_option.{option_id}
-- payload_path: result.enrichment.inference_warnings[].horizon_untested
-- payload_path: result.enrichment.inference_warnings[].summary_withheld
-- payload_path: result.enrichment.inference_warnings[].driver_by_option.{option_id}
--
-- The frozen input_snapshot.sent_digest is the canonical request hash; never
-- use the turn request hash or rebuild inputs. graph_identity_hash remains NULL:
-- graph_hash_at_run is an analysis-affecting hash, not an attested graph identity.
-- Status/licence/Wilson/driver policy mirrors the r1 TypeScript spec and helpers.
-- A leader withhold does not suppress independently licensed option chances.
-- Runs/options share one exception subtransaction. A malformed fact quarantines
-- without aborting its production INSERT; ordinary quarantine errors are swallowed.
-- producer verdict at Run time; compose applies further remove-only gates; NOT the final permission
-- leading_option_id and constraint_may_name_leading_option copy producer fields only.
-- Quarantine stores a fact reference, never another copy of its payload.
-- RLS has no anon/authenticated policies. Tables/view/functions are service-only.
-- Backfill is explicit, bounded, and is NOT invoked by this migration. It skips
-- already derived/quarantined IDs and valid pre-run-identity facts whose run_id
-- is absent/null.
-- Such live inserts quarantine as run_id_absent. Actionable backfill facts sort
-- before legacy facts, so the historical prefix cannot consume every batch.
-- skipped_legacy counts rows observed in this call, not a durable skip marker.
-- Historical revision is unknowable:
-- both trigger and backfill record scenarios.revision at derivation time.
-- Latest v4: 20260806120000_v5_turn_fence_first_write_exemption.sql:322-347
-- updates graph BEFORE inserting facts. Later brief_text/model-version updates
-- can bump revision again; insertion-time revision need not be final turn revision.
-- =============================================================================

SET LOCAL lock_timeout = '3s';

CREATE TABLE public.analysis_runs (
  run_id                 TEXT PRIMARY KEY,
  scenario_id            UUID NOT NULL REFERENCES public.scenarios(id) ON DELETE CASCADE,
  user_id                UUID,
  scenario_revision      BIGINT NOT NULL,
  canonical_request_hash TEXT NOT NULL,
  status                 TEXT NOT NULL CHECK (status IN ('succeeded', 'failed', 'withheld')),
  computed_at            TIMESTAMPTZ NOT NULL,
  leading_option_id      TEXT NULL,
  constraint_may_name_leading_option BOOLEAN NULL,
  graph_identity_hash    TEXT,
  input_snapshot         JSONB NOT NULL,
  fact_id                UUID NOT NULL REFERENCES public.v5_handler_facts(id) ON DELETE CASCADE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX analysis_runs_scenario_revision_computed_idx
  ON public.analysis_runs (scenario_id, scenario_revision DESC, computed_at DESC, run_id DESC);

CREATE TABLE public.analysis_run_options (
  run_id          TEXT NOT NULL REFERENCES public.analysis_runs(run_id) ON DELETE CASCADE,
  option_id       TEXT NOT NULL,
  chance          NUMERIC NULL CHECK (chance >= 0 AND chance <= 1),
  low             NUMERIC NULL,
  high            NUMERIC NULL,
  licence_status  TEXT NOT NULL CHECK (licence_status IN ('permitted', 'permitted_with_caveat', 'withheld')),
  withheld_reason TEXT NULL,
  driver          JSONB NULL,
  PRIMARY KEY (run_id, option_id),
  CHECK (licence_status <> 'withheld' OR (chance IS NULL AND NULLIF(btrim(withheld_reason), '') IS NOT NULL))
);

CREATE TABLE public.analysis_run_quarantine (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fact_id     UUID,
  scenario_id UUID,
  reason      TEXT NOT NULL,
  seen_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.analysis_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_run_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_run_quarantine ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.analysis_runs, public.analysis_run_options,
  public.analysis_run_quarantine FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.analysis_runs, public.analysis_run_options,
  public.analysis_run_quarantine TO service_role;

CREATE VIEW public.latest_successful_run
WITH (security_invoker = true)
AS
SELECT DISTINCT ON (scenario_id) *
FROM public.analysis_runs
WHERE status = 'succeeded'
ORDER BY scenario_id, scenario_revision DESC, computed_at DESC, run_id DESC;

REVOKE ALL ON TABLE public.latest_successful_run FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.latest_successful_run TO service_role;

CREATE FUNCTION public.analysis_run_from_fact(p_fact public.v5_handler_facts, p_mode text DEFAULT 'trigger')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_result JSONB;
  v_snapshot JSONB;
  v_enrichment JSONB;
  v_comparisons JSONB;
  v_warnings JSONB;
  v_all_warnings JSONB;
  v_licence JSONB;
  v_option JSONB;
  v_precision JSONB;
  v_driver JSONB;
  v_licence_valid BOOLEAN;
  v_licence_count INTEGER;
  v_licence_recorded BOOLEAN;
  v_withheld BOOLEAN;
  v_scope_valid BOOLEAN;
  v_warning JSONB;
  v_option_id TEXT;
  v_run_id TEXT;
  v_constraint_may_name_leading_option BOOLEAN;
  v_raw_status TEXT;
  v_status TEXT;
  v_reason TEXT;
  v_licence_status TEXT;
  v_revision BIGINT;
  v_computed_at TIMESTAMPTZ;
  v_chance NUMERIC;
  v_low NUMERIC;
  v_high NUMERIC;
  v_n NUMERIC;
  v_met NUMERIC;
  v_pct NUMERIC;
  v_ids TEXT[] := ARRAY[]::TEXT[];
  v_trim_chars CONSTANT TEXT := E' \t\n\r\f\013\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF';
  v_withhold_codes CONSTANT TEXT[] := ARRAY[
    'GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED', 'GOAL_FIGURES_USER_EFFECT_CLAMPED',
    'GOAL_FIGURES_PLACEHOLDER_PATH', 'GOAL_FIGURES_PRODUCT_NOT_READ',
    'GOAL_FIGURES_TARGET_NOT_TESTABLE', 'GOAL_FIGURES_OPTIONS_IDENTICAL',
    'GOAL_FIGURES_PROBABILITY_UNUSABLE', 'GOAL_FIGURES_SHARE_APPROXIMATION',
    'GOAL_FIGURES_CHANCE_AS_GOAL'
  ];
BEGIN
  -- This block includes ALL derivation work, so an option failure rolls back
  -- its run and every earlier option before the exception handler quarantines.
  BEGIN
    IF p_fact.action_type IS DISTINCT FROM 'run_analysis'
       AND p_fact.payload->>'fact_type' IS DISTINCT FROM 'run_analysis' THEN
      RETURN;
    END IF;
    IF p_fact.action_type IS DISTINCT FROM 'run_analysis'
       OR p_fact.payload->>'fact_type' IS DISTINCT FROM 'run_analysis'
       OR p_fact.payload->'fact_version' IS DISTINCT FROM '1'::jsonb
       OR p_fact.noop IS DISTINCT FROM FALSE THEN
      RAISE EXCEPTION 'invalid run_analysis discriminator, fact_version or noop';
    END IF;
    v_result := p_fact.payload->'result';
    IF jsonb_typeof(v_result) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'result_shape';
    END IF;
    IF v_result->'run_id' IS NULL OR v_result->'run_id' = 'null'::jsonb THEN
      IF p_mode = 'backfill' THEN RETURN; END IF;
      RAISE EXCEPTION 'run_id_absent';
    END IF;
    IF jsonb_typeof(v_result->'run_id') IS DISTINCT FROM 'string'
       OR NULLIF(btrim(v_result->>'run_id', v_trim_chars), '') IS NULL THEN
      RAISE EXCEPTION 'run_id_invalid';
    END IF;
    IF v_result->>'scenario_id' IS DISTINCT FROM p_fact.scenario_id::text THEN
      RAISE EXCEPTION 'scenario_id_mismatch';
    END IF;
    IF NOT v_result ? 'leading_option_id'
       OR jsonb_typeof(v_result->'leading_option_id') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'leading_option_id_shape';
    END IF;
    IF jsonb_typeof(v_result->'summary') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'summary_shape';
    END IF;
    IF v_result ? 'constraint_verdict'
       AND jsonb_typeof(v_result->'constraint_verdict') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'constraint_may_name_leading_option_shape';
    END IF;
    IF v_result->'constraint_verdict' ? 'may_name_leading_option' THEN
      IF jsonb_typeof(v_result #> '{constraint_verdict,may_name_leading_option}') IS DISTINCT FROM 'boolean' THEN
        RAISE EXCEPTION 'constraint_may_name_leading_option_shape';
      END IF;
      v_constraint_may_name_leading_option := (v_result #>> '{constraint_verdict,may_name_leading_option}')::boolean;
    END IF;
    v_run_id := v_result->>'run_id';
    IF jsonb_typeof(v_result->'computed_at') IS DISTINCT FROM 'string'
       OR (v_result->>'computed_at') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' THEN
      RAISE EXCEPTION 'result.computed_at must be a recorded ISO timestamp';
    END IF;
    v_computed_at := (v_result->>'computed_at')::timestamptz;
    IF NOT isfinite(v_computed_at) THEN
      RAISE EXCEPTION 'result.computed_at must be finite';
    END IF;
    v_snapshot := v_result->'input_snapshot';
    IF jsonb_typeof(v_snapshot) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_snapshot->'sent_digest') IS DISTINCT FROM 'string'
       OR (v_snapshot->>'sent_digest') !~ '^[0-9a-f]{64}$'
       OR v_snapshot->'snapshot_version' IS DISTINCT FROM '1'::jsonb
       OR NOT v_snapshot ? 'goal'
       OR jsonb_typeof(v_snapshot->'goal') NOT IN ('object', 'null')
       OR jsonb_typeof(v_snapshot->'options') IS DISTINCT FROM 'array'
       OR jsonb_typeof(v_snapshot->'options_not_sent') IS DISTINCT FROM 'array'
       OR jsonb_typeof(v_snapshot->'factors') IS DISTINCT FROM 'array'
       OR jsonb_typeof(v_snapshot->'constraints') IS DISTINCT FROM 'array'
       OR jsonb_typeof(v_snapshot->'links') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'result.input_snapshot with SHA-256 sent_digest required';
    END IF;
    IF v_result ? 'enrichment' AND jsonb_typeof(v_result->'enrichment') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'result.enrichment must be an object';
    END IF;
    v_enrichment := COALESCE(v_result->'enrichment', '{}'::jsonb);
    IF v_enrichment ? 'analysis_status' THEN
      IF jsonb_typeof(v_enrichment->'analysis_status') IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'result.enrichment.analysis_status must be a string';
      END IF;
      v_raw_status := v_enrichment->>'analysis_status';
      IF lower(btrim(v_raw_status, v_trim_chars)) IN ('computed', 'completed', 'ready', 'complete', 'ok', 'success') THEN
        v_status := 'succeeded';
      ELSIF v_raw_status = 'failed' THEN v_status := 'failed';
      ELSIF v_raw_status IN ('blocked', 'refused') THEN v_status := 'withheld';
      ELSE RAISE EXCEPTION 'unsupported result.enrichment.analysis_status: %', v_raw_status;
      END IF;
    ELSE
      v_status := 'succeeded'; -- legacy success, exactly as the r1 mapper
    END IF;
    v_comparisons := v_enrichment->'option_comparison';
    IF (v_enrichment ? 'option_comparison' AND jsonb_typeof(v_comparisons) IS DISTINCT FROM 'array')
       OR (v_status = 'succeeded' AND jsonb_typeof(v_comparisons) IS DISTINCT FROM 'array') THEN
      RAISE EXCEPTION 'result.enrichment.option_comparison must be an array (required for success)';
    END IF;
    v_comparisons := COALESCE(v_comparisons, '[]'::jsonb);
    v_warnings := CASE WHEN jsonb_typeof(v_enrichment->'inference_warnings') = 'array'
                      THEN v_enrichment->'inference_warnings' ELSE '[]'::jsonb END;
    v_all_warnings := v_warnings || CASE WHEN jsonb_typeof(v_result->'inference_warnings') = 'array'
                      THEN v_result->'inference_warnings' ELSE '[]'::jsonb END;
    SELECT count(*), (jsonb_agg(value)->0) INTO v_licence_count, v_licence
      FROM jsonb_array_elements(v_all_warnings)
      WHERE jsonb_typeof(value) = 'object' AND value->>'code' = 'GOAL_CHANCE_LICENSED';
    SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(v_warnings)
                   WHERE jsonb_typeof(value) = 'object' AND value->>'code' = 'GOAL_CHANCE_LICENSED')
      INTO v_licence_recorded;

    -- goalChanceLicenceForAgent: validate the recorded licence's core identity.
    -- Optional prose/target/note records are not additional permission gates.
    v_licence_valid := FALSE;
    IF v_licence_count = 1
       AND v_licence->>'form' IN ('highest', 'highest_all_likely_to_miss', 'all_likely_to_miss', 'similar', 'each')
       AND jsonb_typeof(v_licence->'option_ids') = 'array' THEN
      v_licence_valid := NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_licence->'option_ids')
                                    WHERE jsonb_typeof(value) IS DISTINCT FROM 'string');
      IF v_licence->>'form' IN ('highest', 'highest_all_likely_to_miss') THEN
        v_licence_valid := v_licence_valid
          AND jsonb_typeof(v_licence->'leader_option_id') = 'string'
          AND jsonb_typeof(v_licence->'next_option_id') = 'string'
          AND (v_licence->'option_ids') @> jsonb_build_array(v_licence->'leader_option_id')
          AND (v_licence->'option_ids') @> jsonb_build_array(v_licence->'next_option_id')
          AND v_licence->>'leader_option_id' <> v_licence->>'next_option_id';
      ELSE
        v_licence_valid := v_licence_valid AND NOT (v_licence ? 'leader_option_id' OR v_licence ? 'next_option_id');
      END IF;
      IF v_licence->>'form' = 'similar' THEN
        IF jsonb_typeof(v_licence->'similar_option_ids') IS DISTINCT FROM 'array' THEN
          v_licence_valid := FALSE;
        ELSE
          v_licence_valid := v_licence_valid AND jsonb_array_length(v_licence->'similar_option_ids') >= 2
            AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_licence->'similar_option_ids')
                            WHERE jsonb_typeof(value) IS DISTINCT FROM 'string'
                               OR NOT (v_licence->'option_ids') @> jsonb_build_array(value))
            AND (SELECT count(*) = count(DISTINCT value) FROM jsonb_array_elements(v_licence->'similar_option_ids'));
        END IF;
      ELSE
        v_licence_valid := v_licence_valid AND NOT v_licence ? 'similar_option_ids';
      END IF;
      IF v_licence ? 'withheld_option_ids' THEN
        IF v_licence->>'form' <> 'each' OR jsonb_typeof(v_licence->'withheld_option_ids') IS DISTINCT FROM 'array' THEN
          v_licence_valid := FALSE;
        ELSE
          v_licence_valid := v_licence_valid AND jsonb_array_length(v_licence->'withheld_option_ids') > 0
            AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_licence->'withheld_option_ids')
                            WHERE jsonb_typeof(value) IS DISTINCT FROM 'string'
                               OR NOT (v_licence->'option_ids') @> jsonb_build_array(value));
        END IF;
      END IF;
    END IF;
    IF NOT COALESCE(v_licence_valid, FALSE) THEN
      IF v_licence_recorded THEN
        RAISE EXCEPTION 'malformed or duplicated GOAL_CHANCE_LICENSED record';
      END IF;
      v_licence := NULL;
    END IF;

    SELECT revision INTO STRICT v_revision FROM public.scenarios WHERE id = p_fact.scenario_id;
    INSERT INTO public.analysis_runs (
      run_id, scenario_id, user_id, scenario_revision, canonical_request_hash,
      status, computed_at, leading_option_id, constraint_may_name_leading_option,
      graph_identity_hash, input_snapshot, fact_id
    ) VALUES (
      v_run_id, p_fact.scenario_id, p_fact.user_id, v_revision, v_snapshot->>'sent_digest',
      v_status, v_computed_at, v_result->>'leading_option_id', v_constraint_may_name_leading_option,
      NULL, v_snapshot, p_fact.id
    ); -- duplicate run_id is a per-fact quarantine, never an upsert

    FOR v_option IN SELECT value FROM jsonb_array_elements(v_comparisons)
    LOOP
      IF jsonb_typeof(v_option) IS DISTINCT FROM 'object'
         OR jsonb_typeof(v_option->'option_id') IS DISTINCT FROM 'string'
         OR NULLIF(btrim(v_option->>'option_id', v_trim_chars), '') IS NULL THEN
        RAISE EXCEPTION 'result.enrichment.option_comparison[].option_id required';
      END IF;
      v_option_id := v_option->>'option_id';
      IF v_option_id = ANY(v_ids) THEN RAISE EXCEPTION 'duplicate option_id: %', v_option_id; END IF;
      v_ids := array_append(v_ids, v_option_id);
      v_chance := NULL; v_low := NULL; v_high := NULL; v_driver := NULL;
      IF v_option ? 'probability_of_goal' THEN
        IF jsonb_typeof(v_option->'probability_of_goal') IS DISTINCT FROM 'number' THEN
          RAISE EXCEPTION 'option % probability_of_goal must be a JSON number', v_option_id;
        END IF;
        v_chance := (v_option->>'probability_of_goal')::numeric;
        IF v_chance < 0 OR v_chance > 1 THEN
          RAISE EXCEPTION 'option % probability_of_goal outside [0,1]', v_option_id;
        END IF;
      END IF;
      IF v_option ? 'probability_of_goal_precision' THEN
        v_precision := v_option->'probability_of_goal_precision';
        IF jsonb_typeof(v_precision) IS DISTINCT FROM 'object'
           OR v_precision->>'basis' IS DISTINCT FROM 'simulation_precision'
           OR v_precision->>'method' IS DISTINCT FROM 'wilson_score'
           OR v_precision->'confidence_level' IS DISTINCT FROM '0.95'::jsonb
           OR jsonb_typeof(v_precision->'n_informative') IS DISTINCT FROM 'number'
           OR jsonb_typeof(v_precision->'n_met') IS DISTINCT FROM 'number'
           OR jsonb_typeof(v_precision->'interval_lower') IS DISTINCT FROM 'number'
           OR jsonb_typeof(v_precision->'interval_upper') IS DISTINCT FROM 'number' THEN
          RAISE EXCEPTION 'option % invalid 95%% Wilson precision', v_option_id;
        END IF;
        v_n := (v_precision->>'n_informative')::numeric;
        v_met := (v_precision->>'n_met')::numeric;
        v_low := (v_precision->>'interval_lower')::numeric;
        v_high := (v_precision->>'interval_upper')::numeric;
        IF v_n <= 0 OR v_n > 1.7976931348623157e308 OR trunc(v_n) <> v_n
           OR v_met < 0 OR v_met > v_n OR trunc(v_met) <> v_met
           OR v_low < 0 OR v_high > 1 OR v_low > v_high OR v_chance IS NULL
           OR v_chance < v_low - 0.000000001 OR v_chance > v_high + 0.000000001 THEN
          RAISE EXCEPTION 'option % invalid Wilson counts/interval/chance', v_option_id;
        END IF;
      END IF;

      v_reason := NULL; v_withheld := FALSE;
      -- Scope validation deliberately fails closed, just like warningsOf/ids.
      FOR v_warning IN SELECT value FROM jsonb_array_elements(v_all_warnings)
        WHERE jsonb_typeof(value) = 'object' AND value->>'code' = ANY(v_withhold_codes)
      LOOP
        v_scope_valid := FALSE;
        IF jsonb_typeof(v_warning->'option_ids') = 'array' THEN
          v_scope_valid := jsonb_array_length(v_warning->'option_ids') > 0
            AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_warning->'option_ids')
                            WHERE jsonb_typeof(value) IS DISTINCT FROM 'string' OR NULLIF(btrim(value #>> '{}', v_trim_chars), '') IS NULL)
            AND (SELECT count(*) = count(DISTINCT value) FROM jsonb_array_elements(v_warning->'option_ids'));
        END IF;
        IF v_warning->>'code' IN ('GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED', 'GOAL_FIGURES_USER_EFFECT_CLAMPED')
           OR NOT v_scope_valid OR (v_warning->'option_ids') @> jsonb_build_array(v_option_id) THEN
          v_withheld := TRUE;
        END IF;
      END LOOP;
      IF v_status <> 'succeeded' THEN v_reason := 'analysis_' || v_raw_status;
      ELSIF v_withheld THEN
        -- The mapper chooses its reason from enrichment only; a root-only
        -- withhold gets the same conservative fallback as TypeScript.
        SELECT value->>'code' INTO v_reason FROM jsonb_array_elements(v_warnings) WITH ORDINALITY
        WHERE jsonb_typeof(value) = 'object' AND value->>'code' = ANY(v_withhold_codes)
          AND (value->>'code' IN ('GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED', 'GOAL_FIGURES_USER_EFFECT_CLAMPED')
            OR CASE WHEN jsonb_typeof(value->'option_ids') IS DISTINCT FROM 'array' THEN TRUE ELSE
              jsonb_array_length(value->'option_ids') = 0
              OR EXISTS (SELECT 1 FROM jsonb_array_elements(value->'option_ids') x
                         WHERE jsonb_typeof(x.value) IS DISTINCT FROM 'string' OR NULLIF(btrim(x.value #>> '{}', v_trim_chars), '') IS NULL)
              OR (SELECT count(*) <> count(DISTINCT x.value) FROM jsonb_array_elements(value->'option_ids') x)
              OR (value->'option_ids') @> jsonb_build_array(v_option_id) END)
        ORDER BY ordinality LIMIT 1;
        v_reason := COALESCE(v_reason, 'goal_chance_withheld');
      ELSIF v_licence IS NULL THEN v_reason := 'goal_chance_licence_not_recorded';
      ELSIF jsonb_typeof(v_licence->'withheld_option_ids') = 'array'
        AND (v_licence->'withheld_option_ids') @> jsonb_build_array(v_option_id) THEN
        v_reason := 'GOAL_CHANCE_LICENSED_WITHHELD_OPTION';
      ELSIF NOT (v_licence->'option_ids') @> jsonb_build_array(v_option_id) THEN
        v_reason := 'goal_chance_not_licensed_for_option';
      ELSIF v_chance IS NULL THEN v_reason := 'probability_of_goal_not_recorded';
      END IF;

      IF v_reason IS NOT NULL THEN
        v_chance := NULL; v_low := NULL; v_high := NULL;
        v_licence_status := 'withheld';
      ELSE
        IF jsonb_typeof(v_licence->'pct_by_option'->v_option_id) IS DISTINCT FROM 'number' THEN
          RAISE EXCEPTION 'option % malformed licensed percentage', v_option_id;
        END IF;
        v_pct := (v_licence->'pct_by_option'->>v_option_id)::numeric;
        IF trunc(v_pct) <> v_pct OR v_pct < 0 OR v_pct > 100 THEN
          RAISE EXCEPTION 'option % malformed licensed percentage', v_option_id;
        END IF;
        v_licence_status := CASE WHEN v_licence->'horizon_untested' = 'true'::jsonb
                                   OR jsonb_typeof(v_licence->'summary_withheld') = 'object'
                                THEN 'permitted_with_caveat' ELSE 'permitted' END;
        v_driver := v_licence->'driver_by_option'->v_option_id;
        -- Invalid/absent driver means NULL, never an invented driver or licence.
        IF NOT COALESCE(jsonb_typeof(v_driver) = 'object'
          AND jsonb_typeof(v_driver->'quantity_id') = 'string' AND v_driver->>'quantity_id' <> ''
          AND v_driver->>'authored_by' IN ('user', 'olumi', 'unattributed')
          AND CASE WHEN v_driver->>'kind' = 'factor_value' THEN
            jsonb_typeof(v_driver->'factor_id') = 'string' AND v_driver->>'factor_id' <> ''
            AND v_driver->>'side' IN ('low', 'high')
            AND CASE WHEN jsonb_typeof(v_driver->'cut_value') = 'number'
                     THEN abs((v_driver->>'cut_value')::numeric) <= 1.7976931348623157e308 ELSE FALSE END
            AND CASE WHEN jsonb_typeof(v_driver->'pct_if_side') = 'number' THEN
              (v_driver->>'pct_if_side')::numeric BETWEEN 0 AND 100
              AND trunc((v_driver->>'pct_if_side')::numeric) = (v_driver->>'pct_if_side')::numeric ELSE FALSE END
          ELSE jsonb_typeof(v_driver->'from') = 'string' AND v_driver->>'from' <> ''
            AND jsonb_typeof(v_driver->'to') = 'string' AND v_driver->>'to' <> ''
            AND CASE WHEN v_driver->>'kind' = 'link_strength' THEN
              (v_driver->>'side' = 'low' AND v_driver->>'strength' = 'weaker')
              OR (v_driver->>'side' = 'high' AND v_driver->>'strength' = 'stronger')
            WHEN v_driver->>'kind' = 'link_existence' THEN
              v_driver->>'side' IN ('absent', 'present')
              AND CASE WHEN jsonb_typeof(v_driver->'pct_if_side') = 'number' THEN
                (v_driver->>'pct_if_side')::numeric BETWEEN 0 AND 100
                AND trunc((v_driver->>'pct_if_side')::numeric) = (v_driver->>'pct_if_side')::numeric ELSE FALSE END
            ELSE FALSE END
          END, FALSE) THEN v_driver := NULL;
        END IF;
      END IF;
      INSERT INTO public.analysis_run_options (
        run_id, option_id, chance, low, high, licence_status, withheld_reason, driver
      ) VALUES (v_run_id, v_option_id, v_chance, v_low, v_high, v_licence_status, v_reason, v_driver);
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      INSERT INTO public.analysis_run_quarantine (fact_id, scenario_id, reason)
      VALUES (p_fact.id, p_fact.scenario_id,
        CASE WHEN SQLSTATE = 'P0001' AND SQLERRM IN (
          'result_shape', 'run_id_absent', 'run_id_invalid', 'scenario_id_mismatch',
          'leading_option_id_shape', 'summary_shape', 'constraint_may_name_leading_option_shape'
        ) THEN SQLERRM ELSE format('[%s] %s', SQLSTATE, SQLERRM) END);
    EXCEPTION WHEN OTHERS THEN
      NULL; -- ordinary quarantine failures must never reject a production fact
    END;
  END;
  RETURN;
END;
$$;

CREATE FUNCTION public.v5_handler_facts_derive_run()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.analysis_run_from_fact(NEW);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL; -- also guard failures before entering the derivation body
END;
$$;

REVOKE ALL ON FUNCTION public.analysis_run_from_fact(public.v5_handler_facts, text),
  public.v5_handler_facts_derive_run() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.analysis_run_from_fact(public.v5_handler_facts, text),
  public.v5_handler_facts_derive_run() TO service_role;

CREATE TRIGGER v5_handler_facts_derive_run
AFTER INSERT ON public.v5_handler_facts
FOR EACH ROW EXECUTE FUNCTION public.v5_handler_facts_derive_run();

CREATE FUNCTION public.backfill_analysis_runs(p_limit int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_fact public.v5_handler_facts;
  v_derived INTEGER := 0;
  v_quarantined INTEGER := 0;
  v_skipped_legacy INTEGER := 0;
BEGIN
  IF p_limit IS NULL OR p_limit <= 0 THEN
    RAISE EXCEPTION 'backfill_analysis_runs: p_limit must be positive' USING ERRCODE = '22023';
  END IF;
  FOR v_fact IN
    SELECT f.* FROM public.v5_handler_facts f
    WHERE (f.action_type = 'run_analysis' OR f.payload->>'fact_type' = 'run_analysis')
      AND NOT EXISTS (SELECT 1 FROM public.analysis_runs r WHERE r.fact_id = f.id)
      AND NOT EXISTS (SELECT 1 FROM public.analysis_run_quarantine q WHERE q.fact_id = f.id)
    ORDER BY CASE WHEN f.action_type = 'run_analysis'
      AND f.payload->>'fact_type' = 'run_analysis'
      AND f.payload->'fact_version' = '1'::jsonb AND f.noop IS FALSE
      AND jsonb_typeof(f.payload->'result') = 'object'
      AND (f.payload #> '{result,run_id}' IS NULL OR f.payload #> '{result,run_id}' = 'null'::jsonb)
      THEN 1 ELSE 0 END, f.created_at, f.id
    LIMIT p_limit
    FOR UPDATE OF f SKIP LOCKED
  LOOP
    PERFORM public.analysis_run_from_fact(v_fact, 'backfill');
    IF EXISTS (SELECT 1 FROM public.analysis_runs WHERE fact_id = v_fact.id) THEN
      v_derived := v_derived + 1;
    ELSIF EXISTS (SELECT 1 FROM public.analysis_run_quarantine WHERE fact_id = v_fact.id) THEN
      v_quarantined := v_quarantined + 1;
    ELSIF v_fact.action_type = 'run_analysis'
      AND v_fact.payload->>'fact_type' = 'run_analysis'
      AND v_fact.payload->'fact_version' = '1'::jsonb AND v_fact.noop IS FALSE
      AND jsonb_typeof(v_fact.payload->'result') = 'object'
      AND (v_fact.payload #> '{result,run_id}' IS NULL OR v_fact.payload #> '{result,run_id}' = 'null'::jsonb) THEN
      v_skipped_legacy := v_skipped_legacy + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('derived', v_derived, 'quarantined', v_quarantined,
                           'skipped_legacy', v_skipped_legacy);
END;
$$;

REVOKE ALL ON FUNCTION public.backfill_analysis_runs(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_analysis_runs(int) TO service_role;
