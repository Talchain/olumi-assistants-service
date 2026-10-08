-- PROPOSAL REHEARSAL — NOT EXECUTED; ISOLATED LOCAL SCHEMA/DATA COPY ONLY.
-- Requires existing append_turn_atomic_v4/v5 and Phase 2(c)'s revision column
-- and trigger. No network, shared DB/data, or Docker provisioning is used here.
-- Example (supply the local password separately):
--   psql -X --host=127.0.0.1 --port=54322 --username=postgres --dbname=postgres \
--     --file=scripts/phase2/rehearse-a.sql
-- All migration, baseline backfill, synthetic writes, assertions, and proposal
-- rollback share one transaction. The final ROLLBACK removes every change.
-- Row (c) proves the malformed fact is accepted and retained by the real RPC;
-- the harness deliberately does not COMMIT it outside this disposable scope.
-- Every requested row prints PASS/FAIL; the final aggregate RAISE rejects FAIL.
-- There are 27 report rows plus the final transaction-cleanup check (28 total);
-- preflight is a separate prerequisite check. New j-q probes preserve the
-- original a-h data deltas by rolling back their synthetic writes immediately.
--
-- REVISION ORDERING (b): v4 UPDATEs graph BEFORE INSERTing handler facts:
-- 20260806120000_v5_turn_fence_first_write_exemption.sql:322-347. v5 delegates
-- at 20260920210000_v5_append_v5_replay_precedes_cas.sql:284-304. Therefore the
-- fact trigger sees the post-graph-update revision. This guest fixture has no
-- later model-version head update, so that also equals the final revision.
-- For an owned version-creating v5 turn, the later current_model_version_id
-- UPDATE (:444-449) can bump revision again AFTER facts. The typed run records
-- insertion-time revision, not that later final revision. A non-NULL brief
-- can likewise be UPDATEd after facts inside v4 (:350-356); helpers send NULL.

\set ON_ERROR_STOP on
\set ON_ERROR_ROLLBACK off

SELECT :'HOST' IN ('localhost', '127.0.0.1', '::1')
       OR :'HOST' LIKE '/%' AS phase2_a_local_endpoint
\gset
\if :phase2_a_local_endpoint
\else
  \echo 'REFUSED: rehearse-a.sql requires a loopback host or local Unix socket.'
  \quit 3
\endif

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.scenarios') IS NULL
     OR to_regclass('public.v5_conversation_turns') IS NULL
     OR to_regclass('public.v5_handler_facts') IS NULL
     OR to_regprocedure('public.append_turn_atomic_v4(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,text,text,boolean,bigint)') IS NULL
     OR to_regprocedure('public.append_turn_atomic_v5(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,text,text,boolean,bigint,uuid,text,text,text,text,text,text,text,text,text,boolean)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.scenarios'::regclass
                    AND attname = 'revision' AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.scenarios'::regclass
                    AND tgname = 'scenarios_bump_revision' AND NOT tgisinternal
                    AND tgenabled <> 'D') THEN
    RAISE EXCEPTION 'Requires an isolated local copy with v4/v5 and Phase 2(c) revision/trigger';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relname IN
               ('analysis_runs', 'analysis_run_options', 'analysis_run_quarantine', 'latest_successful_run'))
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public' AND p.proname IN
                  ('analysis_run_from_fact', 'v5_handler_facts_derive_run', 'backfill_analysis_runs', 'append_turn_atomic_v7'))
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.v5_handler_facts'::regclass
                AND tgname = 'v5_handler_facts_derive_run' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Requires every Phase 2(a) object and old v7 overload to be absent';
  END IF;
  RAISE NOTICE 'PASS preflight (isolated local v4/v5 + revision schema, no Phase 2(a) objects)';
END;
$preflight$;

CREATE TEMP TABLE phase2_a_counts_before ON COMMIT DROP AS
SELECT (SELECT count(*) FROM public.scenarios) AS scenarios,
       (SELECT count(*) FROM public.v5_conversation_turns) AS turns,
       (SELECT count(*) FROM public.v5_handler_facts) AS facts;
SELECT scenarios AS phase2_a_original_scenarios,
       turns AS phase2_a_original_turns,
       facts AS phase2_a_original_facts FROM phase2_a_counts_before
\gset

-- Existing relations, functions/ACLs and triggers must match exactly after
-- proposal rollback. The snapshot includes v2-v6 and the revision trigger.
CREATE TEMP TABLE phase2_a_schema_before ON COMMIT DROP AS
SELECT 'relation'::text AS kind, c.oid,
       jsonb_build_object('name', c.relname, 'kind', c.relkind,
                          'acl', c.relacl, 'options', c.reloptions,
                          'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity) AS definition
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'
UNION ALL
SELECT 'function', p.oid,
       jsonb_build_object('definition', pg_get_functiondef(p.oid), 'acl', p.proacl)
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prokind <> 'a'
UNION ALL
SELECT 'trigger', t.oid,
       jsonb_build_object('definition', pg_get_triggerdef(t.oid), 'enabled', t.tgenabled)
FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public';

SELECT 'before migration/backfill/synthetic seed' AS phase,
       scenarios AS scenarios_rows, turns AS v5_conversation_turns_rows,
       facts AS v5_handler_facts_rows FROM phase2_a_counts_before;

\ir ../../supabase/migrations/20261008170000_phase2_a_typed_runs.sql

CREATE TEMP TABLE phase2_a_results (
  check_name TEXT PRIMARY KEY, passed BOOLEAN NOT NULL, detail TEXT
) ON COMMIT DROP;
CREATE TEMP TABLE phase2_a_seed (scenario_id UUID NOT NULL, prefix TEXT NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE phase2_a_baseline (
  derived BIGINT NOT NULL, quarantined BIGINT NOT NULL, skipped_legacy BIGINT NOT NULL,
  skipped_refusal BIGINT NOT NULL,
  runs BIGINT NOT NULL, options BIGINT NOT NULL, quarantine BIGINT NOT NULL
) ON COMMIT DROP;

-- Role probes receive access only to this temporary report surface.
GRANT INSERT ON TABLE phase2_a_results TO anon, authenticated;
DO $temporary_report_access$
BEGIN
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO anon, authenticated',
                 (SELECT nspname FROM pg_namespace WHERE oid = pg_my_temp_schema()));
END;
$temporary_report_access$;

CREATE FUNCTION pg_temp.phase2_a_report(check_name TEXT, passed BOOLEAN, detail TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql AS $report$
BEGIN
  INSERT INTO phase2_a_results VALUES (check_name, passed, detail);
  RAISE NOTICE '% % %', CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END, check_name, COALESCE(detail, '');
END;
$report$;

-- Exactly isAnalysisRefusalFact plus absent/null identity: refusal_not_a_run.
CREATE FUNCTION pg_temp.phase2_a_is_refusal(f public.v5_handler_facts)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE AS $refusal$
  SELECT COALESCE(f.payload->>'fact_type' = 'run_analysis' AND f.noop = FALSE
    AND f.payload #> '{result,enrichment,analysis_status}' = '"refused"'::jsonb
    AND (f.payload #> '{result,run_id}' IS NULL OR f.payload #> '{result,run_id}' = 'null'::jsonb), FALSE);
$refusal$;

-- Exactly the backfill's valid non-refusal pre-run-identity shell. Malformed carriers and
-- non-object results remain actionable quarantine candidates, even without IDs.
CREATE FUNCTION pg_temp.phase2_a_is_legacy(f public.v5_handler_facts)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE AS $legacy$
  SELECT COALESCE(f.action_type = 'run_analysis'
    AND f.payload->>'fact_type' = 'run_analysis'
    AND f.payload->'fact_version' = '1'::jsonb AND f.noop = FALSE
    AND jsonb_typeof(f.payload->'result') = 'object'
    AND NOT pg_temp.phase2_a_is_refusal(f)
    AND (f.payload #> '{result,run_id}' IS NULL OR f.payload #> '{result,run_id}' = 'null'::jsonb), FALSE);
$legacy$;

-- Predict the two skip counters in the same bounded selection as backfill,
-- including copies whose refusal and legacy timestamps are interleaved.
CREATE FUNCTION pg_temp.phase2_a_skipped_counts(p_limit INTEGER)
RETURNS JSONB LANGUAGE SQL AS $skipped_counts$
  SELECT jsonb_build_object(
    'skipped_legacy', count(*) FILTER (WHERE pg_temp.phase2_a_is_legacy(picked.fact)),
    'skipped_refusal', count(*) FILTER (WHERE pg_temp.phase2_a_is_refusal(picked.fact)))
  FROM (
    SELECT f AS fact FROM public.v5_handler_facts f
    WHERE (f.action_type = 'run_analysis' OR f.payload->>'fact_type' = 'run_analysis')
      AND NOT EXISTS (SELECT 1 FROM public.analysis_runs r WHERE r.fact_id = f.id)
      AND NOT EXISTS (SELECT 1 FROM public.analysis_run_quarantine q WHERE q.fact_id = f.id)
    ORDER BY CASE WHEN pg_temp.phase2_a_is_legacy(f) OR pg_temp.phase2_a_is_refusal(f)
      THEN 1 ELSE 0 END, f.created_at, f.id
    LIMIT p_limit
  ) picked;
$skipped_counts$;

-- Drain existing eligible facts before the synthetic cases so the global
-- backfill in (g) has exactly three pending facts. This is a real derivation,
-- not a synthetic quarantine or a claim that a data copy has no old facts.
-- Legacy and refusal rows remain in the fact table without run/quarantine markers. Count
-- that census once and exclude it from no-progress detection and loop exit.
-- A quiescent isolated copy and successful quarantine storage are required;
-- no-progress detection prevents a silently non-terminating backfill loop.
DO $baseline_backfill$
DECLARE v_result JSONB; v_pending BIGINT; v_remaining BIGINT;
        v_derived BIGINT := 0; v_quarantined BIGINT := 0; v_skipped_legacy BIGINT; v_skipped_refusal BIGINT;
BEGIN
  BEGIN
    SELECT count(*) INTO v_skipped_legacy FROM public.v5_handler_facts f
    WHERE pg_temp.phase2_a_is_legacy(f);
    SELECT count(*) INTO v_skipped_refusal FROM public.v5_handler_facts f
    WHERE pg_temp.phase2_a_is_refusal(f);
    LOOP
      SELECT count(*) INTO v_pending FROM public.v5_handler_facts f
      WHERE (f.action_type = 'run_analysis' OR f.payload->>'fact_type' = 'run_analysis')
        AND NOT pg_temp.phase2_a_is_legacy(f)
        AND NOT pg_temp.phase2_a_is_refusal(f)
        AND NOT EXISTS (SELECT 1 FROM public.analysis_runs r WHERE r.fact_id = f.id)
        AND NOT EXISTS (SELECT 1 FROM public.analysis_run_quarantine q WHERE q.fact_id = f.id);
      EXIT WHEN v_pending = 0;
      v_result := public.backfill_analysis_runs(1000);
      v_derived := v_derived + (v_result->>'derived')::bigint;
      v_quarantined := v_quarantined + (v_result->>'quarantined')::bigint;
      SELECT count(*) INTO v_remaining FROM public.v5_handler_facts f
      WHERE (f.action_type = 'run_analysis' OR f.payload->>'fact_type' = 'run_analysis')
        AND NOT pg_temp.phase2_a_is_legacy(f)
        AND NOT pg_temp.phase2_a_is_refusal(f)
        AND NOT EXISTS (SELECT 1 FROM public.analysis_runs r WHERE r.fact_id = f.id)
        AND NOT EXISTS (SELECT 1 FROM public.analysis_run_quarantine q WHERE q.fact_id = f.id);
      IF v_remaining >= v_pending THEN
        RAISE EXCEPTION 'Baseline backfill made no progress (% pending); result %', v_pending, v_result;
      END IF;
    END LOOP;
    INSERT INTO phase2_a_baseline
    SELECT v_derived, v_quarantined, v_skipped_legacy, v_skipped_refusal, (SELECT count(*) FROM public.analysis_runs),
           (SELECT count(*) FROM public.analysis_run_options),
           (SELECT count(*) FROM public.analysis_run_quarantine);
    PERFORM pg_temp.phase2_a_report('baseline_backfill', TRUE,
      format('existing facts: %s derived, %s quarantined, %s legacy skipped, %s refusal skipped; all changes rolled back',
             v_derived, v_quarantined, v_skipped_legacy, v_skipped_refusal));
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.phase2_a_report('baseline_backfill', FALSE, format('[%s] %s', SQLSTATE, SQLERRM));
    INSERT INTO phase2_a_baseline VALUES (0, 0, 0, 0, 0, 0, 0);
  END;
END;
$baseline_backfill$;

SELECT 'after existing-fact baseline backfill' AS phase,
       derived AS existing_facts_derived, quarantined AS existing_facts_quarantined,
       skipped_legacy AS existing_facts_skipped_legacy,
       skipped_refusal AS existing_facts_skipped_refusal,
       runs AS analysis_runs_rows, options AS analysis_run_options_rows,
       quarantine AS analysis_run_quarantine_rows FROM phase2_a_baseline;

-- Payload projection copied from r1's actual served capture:
-- src/orchestrator-v5/agent-lane/__tests__/fixtures/cut9-prod-p1-2-7e3f8fb-readback-run1.json (j).
-- Option IDs, probability_of_goal, complete Wilson records, warning/licence
-- records (including driver_by_option), run timestamp, and currentness hash
-- retain the capture's values. The capture omits input_snapshot: as in r1's
-- typed-run-rows.test.ts factFromRead, the explicit schema-valid sentinel
-- snapshot below is a TEST upgrade, never reconstructed historical inputs.
-- Each case changes only scenario/run identity and its stated corruption/status
-- or ordering timestamp; graph/revision fixtures are synthetic local inputs.
CREATE TEMP TABLE phase2_a_fixture (payload JSONB NOT NULL) ON COMMIT DROP;
INSERT INTO phase2_a_fixture VALUES ($captured_payload$
{
  "fact_type": "run_analysis",
  "fact_version": 1,
  "result": {
    "scenario_id": "a0ca1b01-0318-4081-90fb-cf5207342519",
    "leading_option_id": null,
    "summary": "No single option can be put forward yet. The result is not yet robust — small changes could flip it. Olumi works out ‘Starter tier MRR’ as ‘Starter tier monthly price’ × ‘Starter subscribers’. That’s Olumi’s reading of how they combine; tell me if it’s wrong. 'Keep pricing as it is' was analysed as no change — the factors it compares against were held at the values your model records today. I supplied 6 of the values behind this, because your brief did not state them. They are mine rather than yours. Changing any of them changes what this model implies.",
    "enrichment": {
      "option_comparison": [
        {
          "option_id": "raise_prices_10",
          "probability_of_goal": 0.4677,
          "probability_of_goal_precision": {
            "basis": "simulation_precision",
            "n_met": 4677,
            "method": "wilson_score",
            "n_informative": 10000,
            "interval_lower": 0.4579349226515052,
            "interval_upper": 0.47748988364324035,
            "confidence_level": 0.95
          }
        },
        {
          "option_id": "launch_49_starter_tier",
          "probability_of_goal": 0.5204,
          "probability_of_goal_precision": {
            "basis": "simulation_precision",
            "n_met": 5204,
            "method": "wilson_score",
            "n_informative": 10000,
            "interval_lower": 0.5106023835310499,
            "interval_upper": 0.5301819493354264,
            "confidence_level": 0.95
          }
        },
        {
          "option_id": "keep_pricing_as_it_is",
          "probability_of_goal": 0,
          "probability_of_goal_precision": {
            "basis": "simulation_precision",
            "n_met": 0,
            "method": "wilson_score",
            "n_informative": 10000,
            "interval_lower": 0,
            "interval_upper": 0.00038399837067659557,
            "confidence_level": 0.95
          }
        }
      ],
      "option_comparison_status": "computed",
      "inference_warnings": [
        {
          "code": "FACTOR_EVPPI_NOT_COMPUTED",
          "field": "factor_evppi",
          "message": "Value-of-information ran but produced no rows. The reason is not known at this layer and has deliberately not been inferred.",
          "severity": "info"
        },
        {
          "code": "GOAL_HORIZON_NOT_TESTED",
          "message": "This model doesn't yet say whether any option gets there within 9 months.",
          "node_ids": [
            "monthly_recurring_revenue"
          ],
          "severity": "info"
        },
        {
          "code": "GOAL_CHANCE_LICENSED",
          "form": "each",
          "target": {
            "unit": "£/month",
            "value": 126000,
            "comparator": "at_least"
          },
          "message": "Each option’s chance of meeting your goal is licensed on this Run.",
          "severity": "info",
          "option_ids": [
            "raise_prices_10",
            "launch_49_starter_tier",
            "keep_pricing_as_it_is"
          ],
          "horizon_line": "This model doesn't yet say whether any option gets there within 9 months.",
          "pct_by_option": {
            "raise_prices_10": 47,
            "keep_pricing_as_it_is": 0,
            "launch_49_starter_tier": 52
          },
          "driver_by_option": {
            "raise_prices_10": {
              "to": "monthly_recurring_revenue",
              "from": "existing_plan_price_increase",
              "kind": "link_strength",
              "side": "low",
              "strength": "weaker",
              "authored_by": "user",
              "quantity_id": "existing_plan_price_increase->monthly_recurring_revenue",
              "user_stated_link": true
            },
            "launch_49_starter_tier": {
              "to": "monthly_recurring_revenue",
              "from": "starter_tier_mrr",
              "kind": "link_strength",
              "side": "low",
              "strength": "weaker",
              "authored_by": "olumi",
              "quantity_id": "starter_tier_mrr->monthly_recurring_revenue",
              "user_stated_link": false
            }
          },
          "horizon_untested": true,
          "summary_withheld": {
            "form": "similar",
            "cause": "olumi_existence_assumption"
          },
          "no_driver_by_option": {
            "keep_pricing_as_it_is": "none"
          },
          "user_link_existence": {
            "links": 2,
            "one_in": 5
          },
          "display_rounding_by_option": {
            "raise_prices_10": "whole",
            "keep_pricing_as_it_is": "whole",
            "launch_49_starter_tier": "whole"
          }
        }
      ]
    },
    "computed_at": "2026-10-07T07:53:50.172Z",
    "graph_hash_at_run": "66f8f59b6d4dbe90",
    "run_id": "faf1bf9cba45bd8ed2da45dde18d1467aa38c3e12cb93c50734fb8047de6dcce",
    "input_snapshot": {
      "snapshot_version": 1,
      "sent_digest": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "goal": null,
      "options": [
        {
          "option_id": "raise_prices_10",
          "settings": []
        },
        {
          "option_id": "launch_49_starter_tier",
          "settings": []
        },
        {
          "option_id": "keep_pricing_as_it_is",
          "settings": []
        }
      ],
      "options_not_sent": [],
      "factors": [],
      "constraints": [],
      "links": []
    }
  }
}$captured_payload$::jsonb);

CREATE FUNCTION pg_temp.phase2_a_fact(scenario_id UUID, run_id TEXT,
                                    analysis_status TEXT DEFAULT NULL, computed_at TIMESTAMPTZ DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql AS $fact$
DECLARE v_payload JSONB;
BEGIN
  SELECT payload INTO v_payload FROM phase2_a_fixture;
  v_payload := jsonb_set(v_payload, '{result,scenario_id}', to_jsonb(scenario_id::text));
  v_payload := jsonb_set(v_payload, '{result,run_id}', to_jsonb(run_id));
  IF analysis_status IS NOT NULL THEN
    v_payload := jsonb_set(v_payload, '{result,enrichment,analysis_status}', to_jsonb(analysis_status));
  END IF;
  IF computed_at IS NOT NULL THEN
    v_payload := jsonb_set(v_payload, '{result,computed_at}', to_jsonb(computed_at));
  END IF;
  RETURN jsonb_build_object('handler_id', 'run_analysis', 'action_type', 'run_analysis',
                            'noop', FALSE, 'payload', v_payload);
END;
$fact$;

CREATE FUNCTION pg_temp.phase2_a_append_v4(scenario_id UUID, turn_id TEXT, facts JSONB,
                                         graph JSONB DEFAULT NULL, incoming_hash TEXT DEFAULT NULL)
RETURNS UUID LANGUAGE SQL AS $v4$
  SELECT public.append_turn_atomic_v4(
    p_scenario_id => scenario_id, p_turn_id => turn_id,
    p_turn_class => 'handler', p_handler_id => 'run_analysis',
    p_request_hash => 'phase2-a:request:' || turn_id,
    p_response_emitted => TRUE, p_llm_calls_used => 0, p_duration_ms => 0,
    p_handler_facts => facts, p_graph => graph, p_brief_text => NULL,
    p_pending_actions => '[]'::jsonb, p_coaching_state => NULL,
    p_user_message => 'Synthetic local trigger rehearsal.',
    p_assistant_message => 'Synthetic local trigger receipt.',
    p_expected_graph_identity_hash => NULL,
    p_incoming_graph_identity_hash => incoming_hash, p_cas_enforce => FALSE,
    p_fence_generation => NULL
  );
$v4$;

CREATE FUNCTION pg_temp.phase2_a_append_v5(scenario_id UUID, turn_id TEXT, facts JSONB,
                                         graph JSONB, incoming_hash TEXT)
RETURNS JSONB LANGUAGE SQL AS $v5$
  SELECT public.append_turn_atomic_v5(
    p_scenario_id => scenario_id, p_turn_id => turn_id,
    p_turn_class => 'handler', p_handler_id => 'run_analysis',
    p_request_hash => 'phase2-a:request:' || turn_id,
    p_response_emitted => TRUE, p_llm_calls_used => 0, p_duration_ms => 0,
    p_handler_facts => facts, p_graph => graph, p_brief_text => NULL,
    p_pending_actions => '[]'::jsonb, p_coaching_state => NULL,
    p_user_message => 'Synthetic local trigger rehearsal.',
    p_assistant_message => 'Synthetic local trigger receipt.',
    p_expected_graph_identity_hash => NULL,
    p_incoming_graph_identity_hash => incoming_hash, p_cas_enforce => FALSE,
    p_fence_generation => NULL, p_version_mutation_id => gen_random_uuid(),
    p_version_analysis_affecting_hash => incoming_hash,
    p_version_hash_algorithm => 'sha256', p_version_projection_version => '1',
    p_version_normaliser_version => '1', p_version_graph_schema_version => '1',
    p_version_actor_kind => 'system', p_version_authored_by => NULL,
    p_version_creation_kind => 'committed_mutation',
    p_version_source_turn_id => turn_id, p_expected_base_known => FALSE
  );
$v5$;

DO $rehearsal$
DECLARE
  v_scenario UUID := gen_random_uuid();
  v_prefix TEXT;
  v_fact JSONB;
  v_result JSONB;
  v_turn UUID;
  v_a_turn UUID;
  v_fact_id UUID;
  v_revision BIGINT;
  v_before JSONB;
  v_backfill JSONB;
  v_repeat JSONB;
  v_run TEXT;
  v_case INTEGER;
  v_timestamp TIMESTAMPTZ;
BEGIN
  v_prefix := 'phase2-a-' || v_scenario::text || '-';
  SELECT (payload #>> '{result,computed_at}')::timestamptz INTO v_timestamp FROM phase2_a_fixture;
  INSERT INTO public.scenarios (id, user_id, graph)
  VALUES (v_scenario, NULL, '{"nodes":[],"edges":[]}'::jsonb);
  INSERT INTO phase2_a_seed VALUES (v_scenario, v_prefix);
  -- Start at revision 1 through the actual revision trigger, not a direct
  -- revision assignment. Row (a)'s analysis-only v4 leaves this unchanged.
  UPDATE public.scenarios SET graph = '{"nodes":[{"id":"phase2-a-goal","type":"goal","label":"Revision 1"}],"edges":[]}'::jsonb
  WHERE id = v_scenario;

  BEGIN
    SELECT revision INTO v_revision FROM public.scenarios WHERE id = v_scenario;
    v_fact := pg_temp.phase2_a_fact(v_scenario, v_prefix || 'R1', NULL, v_timestamp + interval '1 day');
    v_a_turn := pg_temp.phase2_a_append_v4(v_scenario, v_prefix || 'turn-a', jsonb_build_array(v_fact), NULL);
    SELECT id INTO v_fact_id FROM public.v5_handler_facts WHERE v5_conversation_turn_id = v_a_turn;
    IF v_revision <> 1 OR (SELECT revision FROM public.scenarios WHERE id = v_scenario) <> v_revision
       OR (SELECT count(*) FROM public.analysis_runs WHERE fact_id = v_fact_id) <> 1
       OR (SELECT count(*) FROM public.analysis_run_options WHERE run_id = v_prefix || 'R1') <> 3
       OR NOT EXISTS (SELECT 1 FROM public.analysis_runs WHERE fact_id = v_fact_id
            AND scenario_revision = v_revision AND scenario_id = v_scenario AND user_id IS NULL
            AND status = 'succeeded' AND canonical_request_hash = repeat('a', 64)
            AND input_snapshot = v_fact #> '{payload,result,input_snapshot}'
            AND computed_at = v_timestamp + interval '1 day' AND graph_identity_hash IS NULL)
       OR EXISTS (SELECT 1 FROM public.analysis_run_quarantine WHERE fact_id = v_fact_id)
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(v_fact #> '{payload,result,enrichment,option_comparison}') option
         LEFT JOIN public.analysis_run_options o ON o.run_id = v_prefix || 'R1' AND o.option_id = option->>'option_id'
         WHERE o.option_id IS NULL OR o.chance IS DISTINCT FROM (option->>'probability_of_goal')::numeric
           OR o.low IS DISTINCT FROM (option #>> '{probability_of_goal_precision,interval_lower}')::numeric
           OR o.high IS DISTINCT FROM (option #>> '{probability_of_goal_precision,interval_upper}')::numeric
           OR o.licence_status <> 'permitted_with_caveat' OR o.withheld_reason IS NOT NULL
       )
       OR NOT EXISTS (SELECT 1 FROM public.analysis_run_options o
         CROSS JOIN LATERAL jsonb_array_elements(v_fact #> '{payload,result,enrichment,inference_warnings}') w
         WHERE o.run_id = v_prefix || 'R1' AND o.option_id = 'raise_prices_10'
           AND w->>'code' = 'GOAL_CHANCE_LICENSED' AND o.driver = w #> '{driver_by_option,raise_prices_10}') THEN
      RAISE EXCEPTION 'v4 analysis-only must retain one run, three exact captured options, and current revision 1';
    END IF;
    PERFORM pg_temp.phase2_a_report('a_v4_analysis_only', TRUE, 'revision 1; exact captured probabilities/Wilson/licence/driver paths');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.phase2_a_report('a_v4_analysis_only', FALSE, format('[%s] %s', SQLSTATE, SQLERRM));
  END;

  BEGIN
    SELECT revision INTO v_revision FROM public.scenarios WHERE id = v_scenario;
    v_fact := pg_temp.phase2_a_fact(v_scenario, v_prefix || 'R2');
    v_result := pg_temp.phase2_a_append_v5(v_scenario, v_prefix || 'turn-b', jsonb_build_array(v_fact),
      '{"nodes":[{"id":"phase2-a-goal","type":"goal","label":"Revision 2"}],"edges":[]}'::jsonb, repeat('b', 64));
    v_turn := (v_result->>'turn_row_id')::uuid;
    IF v_revision <> 1 OR (SELECT revision FROM public.scenarios WHERE id = v_scenario) <> 2
       OR v_result->'model_version_receipt' IS DISTINCT FROM 'null'::jsonb
       OR (SELECT count(*) FROM public.analysis_runs WHERE run_id = v_prefix || 'R2') <> 1
       OR (SELECT count(*) FROM public.analysis_run_options WHERE run_id = v_prefix || 'R2') <> 3
       OR NOT EXISTS (SELECT 1 FROM public.analysis_runs r JOIN public.v5_handler_facts f ON f.id = r.fact_id
          WHERE r.run_id = v_prefix || 'R2' AND r.scenario_revision = v_revision + 1
            AND f.v5_conversation_turn_id = v_turn AND r.status = 'succeeded') THEN
      RAISE EXCEPTION 'v5 guest graph change must derive the fact at post-graph-bump revision 2';
    END IF;
    PERFORM pg_temp.phase2_a_report('b_v5_graph_post_bump', TRUE, 'v4 graph UPDATE precedes fact INSERT; guest insertion/final revision = 2');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.phase2_a_report('b_v5_graph_post_bump', FALSE, format('[%s] %s', SQLSTATE, SQLERRM));
  END;

  BEGIN
    v_fact := pg_temp.phase2_a_fact(v_scenario, v_prefix || 'malformed');
    -- Corrupt the LAST option, so this also detects a leaked run/earlier option
    -- if the SQL's all-or-nothing derivation sub-block is missing.
    v_fact := jsonb_set(v_fact, '{payload,result,enrichment,option_comparison,2,probability_of_goal}', '1.7'::jsonb);
    v_turn := pg_temp.phase2_a_append_v4(v_scenario, v_prefix || 'turn-c', jsonb_build_array(v_fact), NULL);
    SELECT id INTO v_fact_id FROM public.v5_handler_facts WHERE v5_conversation_turn_id = v_turn;
    IF v_fact_id IS NULL
       OR (SELECT count(*) FROM public.v5_handler_facts WHERE id = v_fact_id) <> 1
       OR EXISTS (SELECT 1 FROM public.analysis_runs WHERE fact_id = v_fact_id OR run_id = v_prefix || 'malformed')
       OR EXISTS (SELECT 1 FROM public.analysis_run_options WHERE run_id = v_prefix || 'malformed')
       OR (SELECT count(*) FROM public.analysis_run_quarantine WHERE fact_id = v_fact_id) <> 1
       OR NOT EXISTS (SELECT 1 FROM public.analysis_run_quarantine WHERE fact_id = v_fact_id
                       AND scenario_id = v_scenario AND btrim(reason) <> '')
       OR NOT EXISTS (SELECT 1 FROM public.v5_handler_facts WHERE id = v_fact_id AND payload = v_fact->'payload') THEN
      RAISE EXCEPTION 'malformed chance 1.7 must keep the real fact, leak no run/options, and record exactly one quarantine';
    END IF;
    PERFORM pg_temp.phase2_a_report('c_malformed_fact_retained', TRUE, 'RPC returned; fact retained; 0 run/options, 1 quarantine (outer rehearsal later rolls back)');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.phase2_a_report('c_malformed_fact_retained', FALSE, format('[%s] %s', SQLSTATE, SQLERRM));
  END;

  BEGIN
    v_fact := jsonb_build_object('handler_id', 'inspect_graph', 'action_type', 'inspect_graph',
      'noop', FALSE, 'payload', jsonb_build_object('fact_type', 'inspect_graph', 'fact_version', 1, 'result', '{}'::jsonb));
    v_turn := pg_temp.phase2_a_append_v4(v_scenario, v_prefix || 'turn-d', jsonb_build_array(v_fact), NULL);
    SELECT id INTO v_fact_id FROM public.v5_handler_facts WHERE v5_conversation_turn_id = v_turn;
    IF v_fact_id IS NULL OR EXISTS (SELECT 1 FROM public.analysis_runs WHERE fact_id = v_fact_id)
       OR EXISTS (SELECT 1 FROM public.analysis_run_quarantine WHERE fact_id = v_fact_id) THEN
      RAISE EXCEPTION 'non-run fact must persist without deriving or quarantining anything';
    END IF;
    PERFORM pg_temp.phase2_a_report('d_non_run_ignored', TRUE);
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.phase2_a_report('d_non_run_ignored', FALSE, format('[%s] %s', SQLSTATE, SQLERRM));
  END;

  BEGIN
    v_before := jsonb_build_object('scenario', (SELECT to_jsonb(s) FROM public.scenarios s WHERE id = v_scenario),
      'turns', (SELECT count(*) FROM public.v5_conversation_turns),
      'facts', (SELECT count(*) FROM public.v5_handler_facts),
      'runs', (SELECT count(*) FROM public.analysis_runs),
      'options', (SELECT count(*) FROM public.analysis_run_options),
      'quarantine', (SELECT count(*) FROM public.analysis_run_quarantine));
    v_fact := pg_temp.phase2_a_fact(v_scenario, v_prefix || 'R1', NULL, v_timestamp + interval '1 day');
    v_turn := pg_temp.phase2_a_append_v4(v_scenario, v_prefix || 'turn-a', jsonb_build_array(v_fact), NULL);
    IF v_turn IS DISTINCT FROM v_a_turn OR (SELECT count(*) FROM public.analysis_runs WHERE run_id = v_prefix || 'R1') <> 1
       OR v_before IS DISTINCT FROM jsonb_build_object('scenario', (SELECT to_jsonb(s) FROM public.scenarios s WHERE id = v_scenario),
         'turns', (SELECT count(*) FROM public.v5_conversation_turns),
         'facts', (SELECT count(*) FROM public.v5_handler_facts),
         'runs', (SELECT count(*) FROM public.analysis_runs),
         'options', (SELECT count(*) FROM public.analysis_run_options),
         'quarantine', (SELECT count(*) FROM public.analysis_run_quarantine)) THEN
      RAISE EXCEPTION 'same v4 turn must return the original ID before fact INSERT and preserve exactly one run';
    END IF;
    PERFORM pg_temp.phase2_a_report('e_v4_replay_no_duplicate', TRUE, 'original turn ID; exactly one R1 run; every count unchanged');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.phase2_a_report('e_v4_replay_no_duplicate', FALSE, format('[%s] %s', SQLSTATE, SQLERRM));
  END;

  BEGIN
    v_fact := pg_temp.phase2_a_fact(v_scenario, v_prefix || 'R3', 'failed', v_timestamp + interval '2 days');
    v_turn := pg_temp.phase2_a_append_v4(v_scenario, v_prefix || 'turn-f', jsonb_build_array(v_fact),
      '{"nodes":[{"id":"phase2-a-goal","type":"goal","label":"Revision 3"}],"edges":[]}'::jsonb, repeat('c', 64));
    SELECT run_id INTO v_run FROM public.latest_successful_run WHERE scenario_id = v_scenario;
    IF (SELECT revision FROM public.scenarios WHERE id = v_scenario) <> 3
       OR NOT EXISTS (SELECT 1 FROM public.analysis_runs WHERE run_id = v_prefix || 'R3' AND scenario_revision = 3 AND status = 'failed')
       OR (SELECT count(*) FROM public.analysis_run_options WHERE run_id = v_prefix || 'R3'
            AND chance IS NULL AND low IS NULL AND high IS NULL AND driver IS NULL
            AND licence_status = 'withheld' AND withheld_reason = 'analysis_failed') <> 3
       OR v_run IS DISTINCT FROM v_prefix || 'R2'
       OR NOT EXISTS (SELECT 1 FROM public.analysis_runs r1 JOIN public.analysis_runs r2 ON r2.scenario_id = r1.scenario_id
            WHERE r1.run_id = v_prefix || 'R1' AND r1.scenario_revision = 1
              AND r2.run_id = v_prefix || 'R2' AND r2.scenario_revision = 2 AND r1.computed_at > r2.computed_at) THEN
      RAISE EXCEPTION 'view must prefer succeeded revision 2 over later-timestamp revision 1 and failed revision 3';
    END IF;
    PERFORM pg_temp.phase2_a_report('f_latest_successful_revision_order', TRUE, 'R2 wins over newer-clock R1 and failed R3');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.phase2_a_report('f_latest_successful_revision_order', FALSE, format('[%s] %s', SQLSTATE, SQLERRM));
  END;

  BEGIN
    ALTER TABLE public.v5_handler_facts DISABLE TRIGGER v5_handler_facts_derive_run;
    FOR v_case IN 1..3 LOOP
      v_fact := pg_temp.phase2_a_fact(v_scenario, v_prefix || 'backfill-' || v_case);
      PERFORM pg_temp.phase2_a_append_v4(v_scenario, v_prefix || 'turn-g-' || v_case, jsonb_build_array(v_fact), NULL);
    END LOOP;
    ALTER TABLE public.v5_handler_facts ENABLE TRIGGER v5_handler_facts_derive_run;
    IF (SELECT count(*) FROM public.v5_handler_facts WHERE scenario_id = v_scenario
          AND payload #>> '{result,run_id}' LIKE v_prefix || 'backfill-%') <> 3
       OR EXISTS (SELECT 1 FROM public.analysis_runs WHERE scenario_id = v_scenario AND run_id LIKE v_prefix || 'backfill-%') THEN
      RAISE EXCEPTION 'three trigger-disabled real facts must exist without typed rows';
    END IF;
    v_before := pg_temp.phase2_a_skipped_counts(1000);
    v_backfill := public.backfill_analysis_runs(1000);
    v_result := pg_temp.phase2_a_skipped_counts(1000);
    v_repeat := public.backfill_analysis_runs(1000);
    IF v_backfill IS DISTINCT FROM (jsonb_build_object('derived', 3, 'quarantined', 0) || v_before)
       OR v_repeat IS DISTINCT FROM (jsonb_build_object('derived', 0, 'quarantined', 0) || v_result)
       OR (SELECT count(*) FROM public.analysis_runs WHERE scenario_id = v_scenario AND run_id LIKE v_prefix || 'backfill-%') <> 3
       OR (SELECT count(*) FROM public.analysis_run_options WHERE run_id LIKE v_prefix || 'backfill-%') <> 9
       OR EXISTS (SELECT 1 FROM public.analysis_run_quarantine q JOIN public.v5_handler_facts f ON f.id = q.fact_id
            WHERE f.scenario_id = v_scenario AND f.payload #>> '{result,run_id}' LIKE v_prefix || 'backfill-%')
       OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.v5_handler_facts'::regclass
                       AND tgname = 'v5_handler_facts_derive_run' AND tgenabled = 'O') THEN
      RAISE EXCEPTION 'backfill must derive 3/0, repeat 0/0, and leave trigger enabled; got %, %', v_backfill, v_repeat;
    END IF;
    PERFORM pg_temp.phase2_a_report('g_backfill_three_then_zero', TRUE, format('first %s, repeat %s', v_backfill, v_repeat));
  EXCEPTION WHEN OTHERS THEN
    -- The sub-block rollback restores ENABLEd trigger state even if an insert
    -- fails between DISABLE and ENABLE. No later probe runs with it disabled.
    PERFORM pg_temp.phase2_a_report('g_backfill_three_then_zero', FALSE, format('[%s] %s', SQLSTATE, SQLERRM));
  END;

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                AND tablename IN ('analysis_runs', 'analysis_run_options', 'analysis_run_quarantine'))
       OR (SELECT count(*) FROM pg_class WHERE oid IN ('public.analysis_runs'::regclass,
                  'public.analysis_run_options'::regclass, 'public.analysis_run_quarantine'::regclass)
           AND relrowsecurity) <> 3
       OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.latest_successful_run'::regclass
                       AND reloptions @> ARRAY['security_invoker=true'])
       OR NOT has_table_privilege('service_role', 'public.analysis_runs', 'SELECT')
       OR NOT has_table_privilege('service_role', 'public.analysis_run_options', 'SELECT')
       OR NOT has_table_privilege('service_role', 'public.analysis_run_quarantine', 'SELECT')
       OR NOT has_table_privilege('service_role', 'public.latest_successful_run', 'SELECT')
       OR NOT has_function_privilege('service_role', 'public.backfill_analysis_runs(integer)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.backfill_analysis_runs(integer)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.backfill_analysis_runs(integer)', 'EXECUTE') THEN
      RAISE EXCEPTION 'RLS, invoker view and service-only backfill ACLs must match the proposal';
    END IF;
    PERFORM pg_temp.phase2_a_report('h_rls_view_backfill_acl', TRUE);
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.phase2_a_report('h_rls_view_backfill_acl', FALSE, format('[%s] %s', SQLSTATE, SQLERRM));
  END;
END;
$rehearsal$;

-- Each new synthetic probe rolls its writes back on the dedicated success
-- sentinel before reporting, preserving the original a-h data-count checks.
CREATE FUNCTION pg_temp.phase2_a_expect_quarantine(p_scenario_id UUID, p_turn_id TEXT,
                                                  p_fact JSONB, p_expected_reason TEXT)
RETURNS VOID LANGUAGE plpgsql AS $expect_quarantine$
DECLARE v_turn UUID; v_fact_id UUID;
BEGIN
  v_turn := pg_temp.phase2_a_append_v4(p_scenario_id, p_turn_id, jsonb_build_array(p_fact), NULL);
  SELECT f.id INTO v_fact_id FROM public.v5_handler_facts f WHERE f.v5_conversation_turn_id = v_turn;
  IF v_fact_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.v5_handler_facts f WHERE f.id = v_fact_id AND f.payload = p_fact->'payload')
     OR EXISTS (SELECT 1 FROM public.analysis_runs r WHERE r.fact_id = v_fact_id)
     OR (SELECT count(*) FROM public.analysis_run_quarantine q WHERE q.fact_id = v_fact_id) <> 1
     OR NOT EXISTS (SELECT 1 FROM public.analysis_run_quarantine q WHERE q.fact_id = v_fact_id
                    AND q.scenario_id = p_scenario_id AND q.reason = p_expected_reason) THEN
    RAISE EXCEPTION 'Fact must be retained without a run and with exactly one % quarantine', p_expected_reason;
  END IF;
END;
$expect_quarantine$;

DO $round3$
DECLARE
  v_scenario UUID;
  v_prefix TEXT;
  v_fact JSONB;
  v_turn UUID;
  v_fact_ids UUID[] := ARRAY[]::UUID[];
  v_case INTEGER;
  v_expected_reason TEXT;
  v_early TIMESTAMPTZ;
  v_result JSONB;
  v_repeat JSONB;
BEGIN
  SELECT scenario_id, prefix INTO STRICT v_scenario, v_prefix FROM phase2_a_seed;

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.analysis_run_quarantine'::regclass
                AND attname = 'raw' AND NOT attisdropped)
       OR (SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.analysis_run_quarantine'::regclass
            AND attnum > 0 AND NOT attisdropped) <> 5
       OR NOT EXISTS (SELECT 1 FROM public.analysis_run_quarantine q
         JOIN public.v5_handler_facts f ON f.id = q.fact_id
         WHERE f.scenario_id = v_scenario AND f.payload #>> '{result,run_id}' = v_prefix || 'malformed'
           AND f.payload #> '{result,enrichment,option_comparison,2,probability_of_goal}' = '1.7'::jsonb) THEN
      RAISE EXCEPTION 'Quarantine must keep only id/fact_id/scenario_id/reason/seen_at; original payload stays in facts';
    END IF;
    PERFORM pg_temp.phase2_a_report('j_quarantine_reference_only', TRUE, 'no raw column; retained fact is the payload reference');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.phase2_a_report('j_quarantine_reference_only', FALSE, format('[%s] %s', SQLSTATE, SQLERRM));
  END;

  BEGIN
    BEGIN
      FOR v_case IN 1..2 LOOP
        v_fact := pg_temp.phase2_a_fact(v_scenario, v_prefix || 'live-absent-' || v_case);
        IF v_case = 1 THEN v_fact := v_fact #- '{payload,result,run_id}';
        ELSE v_fact := jsonb_set(v_fact, '{payload,result,run_id}', 'null'::jsonb); END IF;
        PERFORM pg_temp.phase2_a_expect_quarantine(v_scenario, v_prefix || 'turn-live-absent-' || v_case,
                                                  v_fact, 'run_id_absent');
      END LOOP;
      RAISE SQLSTATE 'P2A01' USING MESSAGE = 'rollback successful synthetic probe';
    EXCEPTION WHEN SQLSTATE 'P2A01' THEN NULL;
    END;
    PERFORM pg_temp.phase2_a_report('k_trigger_absent_quarantined', TRUE, 'computed non-refusal facts with missing and JSON-null run_id quarantine run_id_absent');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.phase2_a_report('k_trigger_absent_quarantined', FALSE, format('[%s] %s', SQLSTATE, SQLERRM));
  END;

  BEGIN
    BEGIN
      -- Earlier than the local copy's existing facts so the strict bounded
      -- backfill selects and locks these two synthetic legacy shells rather
      -- than locking the complete historical legacy corpus.
      SELECT COALESCE(min(created_at), now()) - interval '1 second' INTO v_early FROM public.v5_handler_facts;
      IF NOT isfinite(v_early) THEN RAISE EXCEPTION 'Legacy probe requires finite source fact timestamps'; END IF;
      ALTER TABLE public.v5_handler_facts DISABLE TRIGGER v5_handler_facts_derive_run;
      FOR v_case IN 1..2 LOOP
        v_fact := pg_temp.phase2_a_fact(v_scenario, v_prefix || 'legacy-' || v_case);
        IF v_case = 1 THEN v_fact := v_fact #- '{payload,result,run_id}';
        ELSE v_fact := jsonb_set(v_fact, '{payload,result,run_id}', 'null'::jsonb); END IF;
        v_turn := pg_temp.phase2_a_append_v4(v_scenario, v_prefix || 'turn-legacy-' || v_case, jsonb_build_array(v_fact), NULL);
        UPDATE public.v5_handler_facts SET created_at = v_early WHERE v5_conversation_turn_id = v_turn;
        v_fact_ids := v_fact_ids || ARRAY(SELECT id FROM public.v5_handler_facts WHERE v5_conversation_turn_id = v_turn);
      END LOOP;
      ALTER TABLE public.v5_handler_facts ENABLE TRIGGER v5_handler_facts_derive_run;
      v_result := public.backfill_analysis_runs(2);
      v_repeat := public.backfill_analysis_runs(2);
      IF v_result IS DISTINCT FROM '{"derived":0,"quarantined":0,"skipped_legacy":2,"skipped_refusal":0}'::jsonb
         OR v_repeat IS DISTINCT FROM v_result OR cardinality(v_fact_ids) <> 2
         OR (SELECT count(*) FROM public.v5_handler_facts WHERE id = ANY(v_fact_ids)) <> 2
         OR EXISTS (SELECT 1 FROM public.analysis_runs WHERE fact_id = ANY(v_fact_ids))
         OR EXISTS (SELECT 1 FROM public.analysis_run_quarantine WHERE fact_id = ANY(v_fact_ids)) THEN
        RAISE EXCEPTION 'Backfill must repeatedly skip both retained pre-run-identity facts without markers; got %, %', v_result, v_repeat;
      END IF;
      RAISE SQLSTATE 'P2A01' USING MESSAGE = 'rollback successful synthetic probe';
    EXCEPTION WHEN SQLSTATE 'P2A01' THEN NULL;
    END;
    PERFORM pg_temp.phase2_a_report('l_backfill_legacy_skipped', TRUE, 'missing/null: skipped_legacy=2; repeat=2; no run/quarantine marker');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.phase2_a_report('l_backfill_legacy_skipped', FALSE, format('[%s] %s', SQLSTATE, SQLERRM));
  END;

  BEGIN
    BEGIN
      FOR v_case IN 1..3 LOOP
        v_fact := pg_temp.phase2_a_fact(v_scenario, v_prefix || 'invalid-id-' || v_case);
        v_fact := jsonb_set(v_fact, '{payload,result,run_id}',
          CASE v_case WHEN 1 THEN '""'::jsonb WHEN 2 THEN '"  "'::jsonb ELSE '17'::jsonb END);
        PERFORM pg_temp.phase2_a_expect_quarantine(v_scenario, v_prefix || 'turn-invalid-id-' || v_case,
                                                  v_fact, 'run_id_invalid');
      END LOOP;
      -- The same present-but-invalid IDs stay quarantine candidates in the
      -- BACKFILL path; they must not be mistaken for absent legacy identity.
      ALTER TABLE public.v5_handler_facts DISABLE TRIGGER v5_handler_facts_derive_run;
      FOR v_case IN 1..2 LOOP
        v_fact := pg_temp.phase2_a_fact(v_scenario, v_prefix || 'backfill-invalid-' || v_case);
        v_fact := jsonb_set(v_fact, '{payload,result,run_id}', CASE v_case WHEN 1 THEN '""'::jsonb ELSE 'false'::jsonb END);
        PERFORM pg_temp.phase2_a_append_v4(v_scenario, v_prefix || 'turn-backfill-invalid-' || v_case,
                                         jsonb_build_array(v_fact), NULL);
      END LOOP;
      ALTER TABLE public.v5_handler_facts ENABLE TRIGGER v5_handler_facts_derive_run;
      v_result := public.backfill_analysis_runs(2);
      IF v_result IS DISTINCT FROM '{"derived":0,"quarantined":2,"skipped_legacy":0,"skipped_refusal":0}'::jsonb
         OR (SELECT count(*) FROM public.analysis_run_quarantine q JOIN public.v5_handler_facts f ON f.id = q.fact_id
              JOIN public.v5_conversation_turns t ON t.id = f.v5_conversation_turn_id
              WHERE t.scenario_id = v_scenario AND t.turn_id LIKE v_prefix || 'turn-backfill-invalid-%'
                AND q.reason = 'run_id_invalid') <> 2 THEN
        RAISE EXCEPTION 'Backfill must prioritize and quarantine present invalid IDs before legacy rows; got %', v_result;
      END IF;
      RAISE SQLSTATE 'P2A01' USING MESSAGE = 'rollback successful synthetic probe';
    EXCEPTION WHEN SQLSTATE 'P2A01' THEN NULL;
    END;
    PERFORM pg_temp.phase2_a_report('m_present_run_id_invalid', TRUE, 'empty/blank/non-string trigger IDs and empty/boolean backfill IDs quarantine run_id_invalid');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.phase2_a_report('m_present_run_id_invalid', FALSE, format('[%s] %s', SQLSTATE, SQLERRM));
  END;

  BEGIN
    BEGIN
      FOR v_case IN 1..5 LOOP
        v_fact := pg_temp.phase2_a_fact(v_scenario, v_prefix || 'shape-' || v_case);
        CASE v_case
          WHEN 1 THEN v_expected_reason := 'scenario_id_mismatch';
            v_fact := jsonb_set(v_fact, '{payload,result,scenario_id}', to_jsonb(gen_random_uuid()::text));
          WHEN 2 THEN v_expected_reason := 'leading_option_id_shape';
            v_fact := jsonb_set(v_fact, '{payload,result,leading_option_id}', '17'::jsonb);
          WHEN 3 THEN v_expected_reason := 'summary_shape';
            v_fact := jsonb_set(v_fact, '{payload,result,summary}', '{}'::jsonb);
          WHEN 4 THEN v_expected_reason := 'result_shape';
            v_fact := jsonb_set(v_fact, '{payload,result}', '[]'::jsonb);
          WHEN 5 THEN v_expected_reason := 'constraint_may_name_leading_option_shape';
            v_fact := jsonb_set(v_fact, '{payload,result,constraint_verdict}', '{"may_name_leading_option":"true"}'::jsonb);
        END CASE;
        PERFORM pg_temp.phase2_a_expect_quarantine(v_scenario, v_prefix || 'turn-shape-' || v_case,
                                                  v_fact, v_expected_reason);
      END LOOP;
      RAISE SQLSTATE 'P2A01' USING MESSAGE = 'rollback successful synthetic probe';
    EXCEPTION WHEN SQLSTATE 'P2A01' THEN NULL;
    END;
    PERFORM pg_temp.phase2_a_report('n_distinct_shape_reasons', TRUE,
      'scenario_id_mismatch; leading_option_id_shape; summary_shape; result_shape; constraint_may_name_leading_option_shape');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.phase2_a_report('n_distinct_shape_reasons', FALSE, format('[%s] %s', SQLSTATE, SQLERRM));
  END;

  BEGIN
    BEGIN
      FOR v_case IN 1..4 LOOP
        v_fact := pg_temp.phase2_a_fact(v_scenario, v_prefix || 'producer-' || v_case);
        IF v_case < 3 THEN
          v_fact := jsonb_set(v_fact, '{payload,result,leading_option_id}', '"launch_49_starter_tier"'::jsonb);
          v_fact := jsonb_set(v_fact, '{payload,result,constraint_verdict}',
            jsonb_build_object('may_name_leading_option', v_case = 1));
        ELSIF v_case = 4 THEN
          v_fact := jsonb_set(v_fact, '{payload,result,constraint_verdict}', '{}'::jsonb);
        END IF;
        PERFORM pg_temp.phase2_a_append_v4(v_scenario, v_prefix || 'turn-producer-' || v_case,
                                         jsonb_build_array(v_fact), NULL);
        IF NOT EXISTS (SELECT 1 FROM public.analysis_runs WHERE run_id = v_prefix || 'producer-' || v_case
              AND leading_option_id IS NOT DISTINCT FROM CASE WHEN v_case < 3 THEN 'launch_49_starter_tier'::text ELSE NULL END
              AND constraint_may_name_leading_option IS NOT DISTINCT FROM CASE WHEN v_case < 3 THEN v_case = 1 ELSE NULL::boolean END)
           OR (SELECT count(*) FROM public.analysis_run_options WHERE run_id = v_prefix || 'producer-' || v_case
                AND chance IS NOT NULL AND licence_status = 'permitted_with_caveat') <> 3 THEN
          RAISE EXCEPTION 'Producer source leader/verdict must preserve true/false/absent NULL without inferring or overriding option licences';
        END IF;
      END LOOP;
      RAISE SQLSTATE 'P2A01' USING MESSAGE = 'rollback successful synthetic probe';
    EXCEPTION WHEN SQLSTATE 'P2A01' THEN NULL;
    END;
    PERFORM pg_temp.phase2_a_report('o_producer_leader_fields', TRUE, 'source leader and true/false verdict preserved; absent outer/nested verdict and null leader remain NULL');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.phase2_a_report('o_producer_leader_fields', FALSE, format('[%s] %s', SQLSTATE, SQLERRM));
  END;
END;
$round3$;

-- The refusal fixture mirrors buildAnalysisRefusalFact, including its deliberate
-- lack of run_id and input_snapshot. Exercise the real v4 fact writer with the
-- production derivation trigger installed, then the bounded backfill twice.
DO $round4$
DECLARE
  v_scenario UUID;
  v_prefix TEXT;
  v_fact JSONB;
  v_turn UUID;
  v_fact_id UUID;
  v_fact_ids UUID[] := ARRAY[]::UUID[];
  v_case INTEGER;
  v_early TIMESTAMPTZ;
  v_result JSONB;
  v_repeat JSONB;
BEGIN
  SELECT scenario_id, prefix INTO STRICT v_scenario, v_prefix FROM phase2_a_seed;
  BEGIN
    BEGIN
      SELECT COALESCE(min(created_at), now()) - interval '1 second' INTO v_early FROM public.v5_handler_facts;
      IF NOT isfinite(v_early) THEN RAISE EXCEPTION 'Refusal probe requires finite source fact timestamps'; END IF;
      FOR v_case IN 1..2 LOOP
        v_fact := jsonb_build_object('handler_id', 'run_analysis', 'action_type', 'run_analysis',
          'noop', FALSE, 'payload', jsonb_build_object('fact_type', 'run_analysis', 'fact_version', 1,
            'result', jsonb_build_object('scenario_id', v_scenario::text, 'leading_option_id', NULL,
              'summary', 'Analysis attempt was refused before computation.',
              'enrichment', jsonb_build_object('analysis_status', 'refused', 'refusal_reason_code', 'analysis_not_ready'),
              'computed_at', '2026-10-08T12:00:00.000Z')));
        IF v_case = 2 THEN v_fact := jsonb_set(v_fact, '{payload,result,run_id}', 'null'::jsonb); END IF;
        v_turn := pg_temp.phase2_a_append_v4(v_scenario, v_prefix || 'turn-refusal-' || v_case,
                                           jsonb_build_array(v_fact), NULL);
        SELECT id INTO v_fact_id FROM public.v5_handler_facts WHERE v5_conversation_turn_id = v_turn;
        IF v_fact_id IS NULL
           OR NOT EXISTS (SELECT 1 FROM public.v5_handler_facts WHERE id = v_fact_id AND payload = v_fact->'payload')
           OR EXISTS (SELECT 1 FROM public.analysis_runs WHERE fact_id = v_fact_id)
           OR EXISTS (SELECT 1 FROM public.analysis_run_quarantine WHERE fact_id = v_fact_id) THEN
          RAISE EXCEPTION 'v4 refusal marker must retain its fact with 0 runs and 0 quarantine';
        END IF;
        UPDATE public.v5_handler_facts SET created_at = v_early WHERE id = v_fact_id;
        v_fact_ids := array_append(v_fact_ids, v_fact_id);
      END LOOP;
      v_result := public.backfill_analysis_runs(2);
      v_repeat := public.backfill_analysis_runs(2);
      IF v_result IS DISTINCT FROM '{"derived":0,"quarantined":0,"skipped_legacy":0,"skipped_refusal":2}'::jsonb
         OR v_repeat IS DISTINCT FROM v_result
         OR (SELECT count(*) FROM public.v5_handler_facts WHERE id = ANY(v_fact_ids)) <> 2
         OR EXISTS (SELECT 1 FROM public.analysis_runs WHERE fact_id = ANY(v_fact_ids))
         OR EXISTS (SELECT 1 FROM public.analysis_run_quarantine WHERE fact_id = ANY(v_fact_ids)) THEN
        RAISE EXCEPTION 'Backfill must repeatedly classify refusal_not_a_run without markers; got %, %', v_result, v_repeat;
      END IF;
      -- A refused status carrying a real Run identity remains a withheld Run.
      v_fact := pg_temp.phase2_a_fact(v_scenario, v_prefix || 'refusal-with-run', 'refused');
      PERFORM pg_temp.phase2_a_append_v4(v_scenario, v_prefix || 'turn-refusal-with-run',
                                       jsonb_build_array(v_fact), NULL);
      IF NOT EXISTS (SELECT 1 FROM public.analysis_runs WHERE run_id = v_prefix || 'refusal-with-run' AND status = 'withheld')
         OR (SELECT count(*) FROM public.analysis_run_options WHERE run_id = v_prefix || 'refusal-with-run'
              AND chance IS NULL AND licence_status = 'withheld' AND withheld_reason = 'analysis_refused') <> 3 THEN
        RAISE EXCEPTION 'Refusal with run_id must follow normal withheld Run derivation';
      END IF;
      RAISE SQLSTATE 'P2A01' USING MESSAGE = 'rollback successful synthetic probe';
    EXCEPTION WHEN SQLSTATE 'P2A01' THEN NULL;
    END;
    PERFORM pg_temp.phase2_a_report('q_refusal_not_a_run', TRUE,
      'real v4 returned; refusal facts retained; 0 runs, 0 quarantine; backfill/repeat skipped_refusal=2; refusal with run_id withheld (outer rehearsal later rolls back)');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.phase2_a_report('q_refusal_not_a_run', FALSE, format('[%s] %s', SQLSTATE, SQLERRM));
  END;
END;
$round4$;

-- Statement timeout starts when a statement enters the server, so SET LOCAL
-- and the deliberately slow INSERT are separate commands. Test-only sleep is
-- injected INSIDE the actual derivation exception sub-block; the production
-- trigger remains installed. The savepoint restores the exact function body.
-- Sequence advancement survives a savepoint rollback, proving the timeout
-- reached the derivation body rather than firing during planning or locking.
CREATE TEMP TABLE phase2_a_cancel_before ON COMMIT DROP AS
SELECT (SELECT count(*) FROM public.v5_handler_facts) AS facts,
       (SELECT count(*) FROM public.analysis_runs) AS runs,
       (SELECT count(*) FROM public.analysis_run_options) AS options,
       (SELECT count(*) FROM public.analysis_run_quarantine) AS quarantine,
       pg_get_functiondef('public.analysis_run_from_fact(public.v5_handler_facts,text)'::regprocedure) AS derivation;
CREATE TEMP SEQUENCE phase2_a_cancel_entered;
SAVEPOINT phase2_a_cancel_probe;
DO $inject_slow_derivation$
DECLARE v_definition TEXT; v_anchor TEXT := E'  BEGIN\n    IF p_fact.action_type';
BEGIN
  SELECT derivation INTO v_definition FROM phase2_a_cancel_before;
  IF strpos(v_definition, v_anchor) = 0 THEN RAISE EXCEPTION 'Derivation sleep injection anchor missing'; END IF;
  EXECUTE replace(v_definition, v_anchor,
    E'  BEGIN\n    PERFORM nextval(''pg_temp.phase2_a_cancel_entered''::regclass);\n    PERFORM pg_sleep(1); -- test-only cancellation probe\n    IF p_fact.action_type');
END;
$inject_slow_derivation$;
SET LOCAL statement_timeout = '25ms';
\set phase2_a_cancel_sqlstate 00000
\set ON_ERROR_STOP off
INSERT INTO public.v5_handler_facts (v5_conversation_turn_id, scenario_id, user_id, handler_id, action_type, noop, payload)
SELECT t.id, s.scenario_id, NULL, 'run_analysis', 'run_analysis', FALSE,
       pg_temp.phase2_a_fact(s.scenario_id, s.prefix || 'cancelled') -> 'payload'
FROM phase2_a_seed s JOIN public.v5_conversation_turns t
  ON t.scenario_id = s.scenario_id AND t.turn_id = s.prefix || 'turn-a';
\set phase2_a_cancel_failed :ERROR
\if :phase2_a_cancel_failed
  \set phase2_a_cancel_sqlstate :LAST_ERROR_SQLSTATE
\endif
ROLLBACK TO SAVEPOINT phase2_a_cancel_probe;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT phase2_a_cancel_probe;
SELECT pg_temp.phase2_a_report('p_statement_timeout_cancels',
  :'phase2_a_cancel_failed'::boolean AND :'phase2_a_cancel_sqlstate' = '57014'
    AND (SELECT is_called AND last_value = 1 FROM pg_temp.phase2_a_cancel_entered)
    AND (SELECT facts FROM phase2_a_cancel_before) = (SELECT count(*) FROM public.v5_handler_facts)
    AND (SELECT runs FROM phase2_a_cancel_before) = (SELECT count(*) FROM public.analysis_runs)
    AND (SELECT options FROM phase2_a_cancel_before) = (SELECT count(*) FROM public.analysis_run_options)
    AND (SELECT quarantine FROM phase2_a_cancel_before) = (SELECT count(*) FROM public.analysis_run_quarantine)
    AND (SELECT derivation FROM phase2_a_cancel_before) = pg_get_functiondef('public.analysis_run_from_fact(public.v5_handler_facts,text)'::regprocedure),
  format('standalone INSERT SQLSTATE %s; entered derivation before timeout; no fact/run/option/quarantine persisted; original function restored',
         :'phase2_a_cancel_sqlstate'));

-- Actual SELECT attempts as each restricted role; errors are captured per
-- surface rather than inferring denial from a catalog grant inspection.
SAVEPOINT phase2_a_anon_acl;
SET LOCAL ROLE anon;
DO $anon_acl$
DECLARE v_table TEXT; v_denied BOOLEAN; v_detail TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['analysis_runs', 'analysis_run_options', 'analysis_run_quarantine', 'latest_successful_run'] LOOP
    v_denied := FALSE; v_detail := NULL;
    BEGIN
      EXECUTE format('SELECT 1 FROM public.%I LIMIT 1', v_table);
    EXCEPTION WHEN insufficient_privilege THEN v_denied := TRUE;
    WHEN OTHERS THEN v_detail := format('[%s] %s', SQLSTATE, SQLERRM);
    END;
    INSERT INTO pg_temp.phase2_a_results VALUES ('h_anon_cannot_select_' || v_table, v_denied, v_detail);
    RAISE NOTICE '% h_anon_cannot_select_%', CASE WHEN v_denied THEN 'PASS' ELSE 'FAIL' END, v_table;
  END LOOP;
END;
$anon_acl$;
RESET ROLE;
RELEASE SAVEPOINT phase2_a_anon_acl;

SAVEPOINT phase2_a_authenticated_acl;
SET LOCAL ROLE authenticated;
DO $authenticated_acl$
DECLARE v_table TEXT; v_denied BOOLEAN; v_detail TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['analysis_runs', 'analysis_run_options', 'analysis_run_quarantine', 'latest_successful_run'] LOOP
    v_denied := FALSE; v_detail := NULL;
    BEGIN
      EXECUTE format('SELECT 1 FROM public.%I LIMIT 1', v_table);
    EXCEPTION WHEN insufficient_privilege THEN v_denied := TRUE;
    WHEN OTHERS THEN v_detail := format('[%s] %s', SQLSTATE, SQLERRM);
    END;
    INSERT INTO pg_temp.phase2_a_results VALUES ('h_authenticated_cannot_select_' || v_table, v_denied, v_detail);
    RAISE NOTICE '% h_authenticated_cannot_select_%', CASE WHEN v_denied THEN 'PASS' ELSE 'FAIL' END, v_table;
  END LOOP;
END;
$authenticated_acl$;
RESET ROLE;
RELEASE SAVEPOINT phase2_a_authenticated_acl;

SELECT 'after a-h and j-q writer/backfill/cancellation/role probes' AS phase,
       (SELECT count(*) FROM public.scenarios) AS scenarios_rows,
       (SELECT count(*) FROM public.v5_conversation_turns) AS v5_conversation_turns_rows,
       (SELECT count(*) FROM public.v5_handler_facts) AS v5_handler_facts_rows,
       (SELECT count(*) FROM public.analysis_runs) AS analysis_runs_rows,
       (SELECT count(*) FROM public.analysis_run_options) AS analysis_run_options_rows,
       (SELECT count(*) FROM public.analysis_run_quarantine) AS analysis_run_quarantine_rows;

CREATE TEMP TABLE phase2_a_counts_after ON COMMIT DROP AS
SELECT (SELECT count(*) FROM public.scenarios) AS scenarios,
       (SELECT count(*) FROM public.v5_conversation_turns) AS turns,
       (SELECT count(*) FROM public.v5_handler_facts) AS facts;

DO $final_counts$
BEGIN
  BEGIN
    IF (SELECT count(*) FROM public.scenarios) <> (SELECT scenarios + 1 FROM phase2_a_counts_before)
       OR (SELECT count(*) FROM public.v5_conversation_turns) <> (SELECT turns + 8 FROM phase2_a_counts_before)
       OR (SELECT count(*) FROM public.v5_handler_facts) <> (SELECT facts + 8 FROM phase2_a_counts_before)
       OR (SELECT count(*) FROM public.analysis_runs) <> (SELECT runs + 6 FROM phase2_a_baseline)
       OR (SELECT count(*) FROM public.analysis_run_options) <> (SELECT options + 18 FROM phase2_a_baseline)
       OR (SELECT count(*) FROM public.analysis_run_quarantine) <> (SELECT quarantine + 1 FROM phase2_a_baseline) THEN
      RAISE EXCEPTION 'Expected deltas: 1 scenario, 8 turns/facts, 6 runs, 18 options, 1 quarantine; replay writes nothing';
    END IF;
    PERFORM pg_temp.phase2_a_report('final_counts', TRUE);
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.phase2_a_report('final_counts', FALSE, format('[%s] %s', SQLSTATE, SQLERRM));
  END;
END;
$final_counts$;

\ir ../../supabase/migrations/rollback/20261008170000_phase2_a_typed_runs_rollback.sql.do-not-apply

DO $rollback_assertions$
BEGIN
  BEGIN
    IF to_regclass('public.analysis_runs') IS NOT NULL
       OR to_regclass('public.analysis_run_options') IS NOT NULL
       OR to_regclass('public.analysis_run_quarantine') IS NOT NULL
       OR to_regclass('public.latest_successful_run') IS NOT NULL
       OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname IN
                    ('analysis_run_from_fact', 'v5_handler_facts_derive_run', 'backfill_analysis_runs', 'append_turn_atomic_v7'))
       OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.v5_handler_facts'::regclass
                    AND tgname = 'v5_handler_facts_derive_run' AND NOT tgisinternal) THEN
      RAISE EXCEPTION 'Rollback left a Phase 2(a) object installed';
    END IF;
    IF EXISTS (
      WITH schema_now AS (
        SELECT 'relation'::text AS kind, c.oid,
               jsonb_build_object('name', c.relname, 'kind', c.relkind, 'acl', c.relacl, 'options', c.reloptions,
                                  'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity) AS definition
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'
        UNION ALL
        SELECT 'function', p.oid, jsonb_build_object('definition', pg_get_functiondef(p.oid), 'acl', p.proacl)
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prokind <> 'a'
        UNION ALL
        SELECT 'trigger', t.oid, jsonb_build_object('definition', pg_get_triggerdef(t.oid), 'enabled', t.tgenabled)
        FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'
      )
      SELECT 1 FROM schema_now c FULL JOIN phase2_a_schema_before b USING (kind, oid)
      WHERE c.definition IS DISTINCT FROM b.definition
    ) OR EXISTS (
      SELECT 1 FROM phase2_a_counts_after
      WHERE scenarios <> (SELECT count(*) FROM public.scenarios)
         OR turns <> (SELECT count(*) FROM public.v5_conversation_turns)
         OR facts <> (SELECT count(*) FROM public.v5_handler_facts)
    ) THEN
      RAISE EXCEPTION 'Rollback must remove exactly new objects and preserve existing relations, functions/ACLs, triggers and data counts';
    END IF;
    PERFORM pg_temp.phase2_a_report('i_rollback_exact_new_objects', TRUE);
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.phase2_a_report('i_rollback_exact_new_objects', FALSE, format('[%s] %s', SQLSTATE, SQLERRM));
  END;
END;
$rollback_assertions$;

SELECT CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS result, check_name, detail
FROM phase2_a_results ORDER BY check_name;
SELECT 'after proposal rollback (synthetic facts still inside transaction)' AS phase,
       (SELECT count(*) FROM public.scenarios) AS scenarios_rows,
       (SELECT count(*) FROM public.v5_conversation_turns) AS v5_conversation_turns_rows,
       (SELECT count(*) FROM public.v5_handler_facts) AS v5_handler_facts_rows;

DO $aggregate$
DECLARE v_failures TEXT;
BEGIN
  IF (SELECT count(*) FROM phase2_a_results) <> 27 THEN
    RAISE EXCEPTION 'Phase 2(a) rehearsal must record all 27 checks before transaction cleanup';
  END IF;
  SELECT string_agg(check_name || ': ' || COALESCE(detail, 'expected assertion did not hold'), '; ' ORDER BY check_name)
    INTO v_failures FROM phase2_a_results WHERE NOT passed;
  IF v_failures IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 2(a) rehearsal FAIL: %', v_failures;
  END IF;
END;
$aggregate$;

ROLLBACK;

SELECT 'after transaction cleanup (original counts restored)' AS phase,
       (SELECT count(*) FROM public.scenarios) AS scenarios_rows,
       (SELECT count(*) FROM public.v5_conversation_turns) AS v5_conversation_turns_rows,
       (SELECT count(*) FROM public.v5_handler_facts) AS v5_handler_facts_rows;
SELECT (SELECT count(*) FROM public.scenarios) = :phase2_a_original_scenarios
   AND (SELECT count(*) FROM public.v5_conversation_turns) = :phase2_a_original_turns
   AND (SELECT count(*) FROM public.v5_handler_facts) = :phase2_a_original_facts
   AS phase2_a_counts_restored
\gset
\if :phase2_a_counts_restored
  \echo 'PASS transaction cleanup restored original row counts.'
\else
  \echo 'FAIL transaction cleanup changed original row counts.'
  DO $cleanup_failure$ BEGIN RAISE EXCEPTION 'Phase 2(a) cleanup row-count mismatch'; END; $cleanup_failure$;
\endif
