-- =============================================================================
-- PROPOSAL, NOT EXECUTED — Shared Data Phase 2(a): typed analysis runs
-- =============================================================================
-- Additive only: three new tables, one view and a NEW append_turn_atomic_v7.
-- Existing v2-v6 RPCs and Phase 2(c)'s revision/trigger are never replaced.
-- Prerequisite: 20261008160000_phase2_c_scenario_revision.sql.
--
-- licence_status values, from src/orchestrator-v5/compose/leader-licence.ts:27:
--   permitted, permitted_with_caveat, withheld.
-- These are stored per option; withholding a leader does not by itself withhold
-- an option's goal chance. The TypeScript mapper reads each option's own licence.
--
-- p_runs contract: an array of objects with run_id, canonical_request_hash,
-- status, computed_at, graph_identity_hash, input_snapshot, and options (array
-- of option_id, chance, low, high, licence_status, withheld_reason, driver).
-- scenario_id/user_id/fact_id/revision are bound here, never caller authority.
-- serialiseHandlerFacts stores payload = {fact_type, fact_version, result};
-- execution identity is payload.result.run_id and the frozen canonical request
-- hash is payload.result.input_snapshot.sent_digest (not the turn request hash).
-- A fresh run must have exactly one matching fact from this committed turn,
-- with the same snapshot/hash. A missing or ambiguous fact is a defect: RAISE
-- rolls back the delegated turn and every run/option in this transaction.
-- Replay is checked under the same scenario lock BEFORE v6, so it writes no
-- typed rows even when p_runs is supplied. v6 retains replay-before-CAS, OLRV1,
-- graph CAS/fence validation and the authoritative returned scenario revision.
-- RLS has no anon/authenticated policies; tables/view/RPC are service-role only.
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
  raw         JSONB,
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

CREATE FUNCTION public.append_turn_atomic_v7(
  p_scenario_id                  UUID,
  p_turn_id                      TEXT,
  p_turn_class                   TEXT,
  p_handler_id                   TEXT,
  p_request_hash                 TEXT,
  p_response_emitted             BOOLEAN,
  p_llm_calls_used               INTEGER,
  p_duration_ms                  INTEGER,
  p_handler_facts                JSONB,
  p_graph                        JSONB,
  p_brief_text                   TEXT,
  p_pending_actions              JSONB,
  p_coaching_state               JSONB,
  p_user_message                 TEXT,
  p_assistant_message            TEXT,
  p_expected_graph_identity_hash TEXT,
  p_incoming_graph_identity_hash TEXT,
  p_cas_enforce                  BOOLEAN,
  p_fence_generation             BIGINT,
  p_version_mutation_id          UUID,
  p_version_analysis_affecting_hash TEXT,
  p_version_hash_algorithm       TEXT,
  p_version_projection_version   TEXT,
  p_version_normaliser_version   TEXT,
  p_version_graph_schema_version TEXT,
  p_version_actor_kind           TEXT,
  p_version_authored_by          TEXT,
  p_version_creation_kind        TEXT,
  p_version_source_turn_id       TEXT,
  p_expected_base_known          BOOLEAN,
  p_expected_revision            BIGINT,
  p_runs                         JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id          UUID;
  v_turn_preexisting BOOLEAN;
  v_result           JSONB;
  v_run              JSONB;
  v_option           JSONB;
  v_fact_ids         UUID[];
  v_fact_payload     JSONB;
BEGIN
  -- The same row lock v6 uses makes the pre-delegation replay check atomic
  -- with the canonical turn append; reacquiring it inside v6 is harmless.
  SELECT user_id INTO v_user_id
    FROM public.scenarios
    WHERE id = p_scenario_id
    FOR UPDATE;

  SELECT EXISTS (
    SELECT 1 FROM public.v5_conversation_turns
    WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id
  ) INTO v_turn_preexisting;

  v_result := public.append_turn_atomic_v6(
    p_scenario_id, p_turn_id, p_turn_class, p_handler_id, p_request_hash,
    p_response_emitted, p_llm_calls_used, p_duration_ms, p_handler_facts,
    p_graph, p_brief_text, p_pending_actions, p_coaching_state,
    p_user_message, p_assistant_message, p_expected_graph_identity_hash,
    p_incoming_graph_identity_hash, p_cas_enforce, p_fence_generation,
    p_version_mutation_id, p_version_analysis_affecting_hash,
    p_version_hash_algorithm, p_version_projection_version,
    p_version_normaliser_version, p_version_graph_schema_version,
    p_version_actor_kind, p_version_authored_by, p_version_creation_kind,
    p_version_source_turn_id, p_expected_base_known, p_expected_revision
  );

  IF v_turn_preexisting OR p_runs IS NULL THEN
    RETURN v_result;
  END IF;
  IF jsonb_typeof(p_runs) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'append_turn_atomic_v7: p_runs must be an array'
      USING ERRCODE = '22023';
  END IF;

  FOR v_run IN SELECT value FROM jsonb_array_elements(p_runs)
  LOOP
    IF jsonb_typeof(v_run) IS DISTINCT FROM 'object'
       OR NULLIF(btrim(v_run->>'run_id'), '') IS NULL
       OR jsonb_typeof(v_run->'input_snapshot') IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_run->'options') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'append_turn_atomic_v7: malformed typed run'
        USING ERRCODE = '22023';
    END IF;

    SELECT array_agg(id) INTO v_fact_ids
      FROM public.v5_handler_facts
      WHERE v5_conversation_turn_id = (v_result->>'turn_row_id')::uuid
        AND scenario_id = p_scenario_id
        AND payload->>'fact_type' = 'run_analysis'
        AND payload #>> '{result,run_id}' = v_run->>'run_id';
    IF COALESCE(cardinality(v_fact_ids), 0) <> 1 THEN
      RAISE EXCEPTION 'append_turn_atomic_v7: run % must match exactly one handler fact for this turn (found %)',
        v_run->>'run_id', COALESCE(cardinality(v_fact_ids), 0)
        USING ERRCODE = '23503';
    END IF;
    SELECT payload INTO v_fact_payload FROM public.v5_handler_facts
      WHERE id = v_fact_ids[1];
    IF v_run->>'canonical_request_hash' IS NULL
       OR v_run->>'canonical_request_hash' IS DISTINCT FROM
          v_fact_payload #>> '{result,input_snapshot,sent_digest}'
       OR v_run->'input_snapshot' IS DISTINCT FROM
          v_fact_payload #> '{result,input_snapshot}' THEN
      RAISE EXCEPTION 'append_turn_atomic_v7: run % snapshot or canonical request hash disagrees with its fact',
        v_run->>'run_id' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.analysis_runs (
      run_id, scenario_id, user_id, scenario_revision, canonical_request_hash,
      status, computed_at, graph_identity_hash, input_snapshot, fact_id
    ) VALUES (
      v_run->>'run_id', p_scenario_id, v_user_id, (v_result->>'revision')::bigint,
      v_run->>'canonical_request_hash', v_run->>'status',
      (v_run->>'computed_at')::timestamptz, v_run->>'graph_identity_hash',
      v_run->'input_snapshot', v_fact_ids[1]
    );

    FOR v_option IN SELECT value FROM jsonb_array_elements(v_run->'options')
    LOOP
      IF jsonb_typeof(v_option) IS DISTINCT FROM 'object'
         OR NULLIF(btrim(v_option->>'option_id'), '') IS NULL THEN
        RAISE EXCEPTION 'append_turn_atomic_v7: malformed option for run %',
          v_run->>'run_id' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.analysis_run_options (
        run_id, option_id, chance, low, high, licence_status, withheld_reason, driver
      ) VALUES (
        v_run->>'run_id', v_option->>'option_id',
        (v_option->>'chance')::numeric, (v_option->>'low')::numeric,
        (v_option->>'high')::numeric, v_option->>'licence_status',
        v_option->>'withheld_reason', NULLIF(v_option->'driver', 'null'::jsonb)
      );
    END LOOP;
  END LOOP;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.append_turn_atomic_v7(
  UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER, JSONB,
  JSONB, TEXT, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BIGINT,
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN,
  BIGINT, JSONB
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.append_turn_atomic_v7(
  UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER, JSONB,
  JSONB, TEXT, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BIGINT,
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN,
  BIGINT, JSONB
) TO service_role;
