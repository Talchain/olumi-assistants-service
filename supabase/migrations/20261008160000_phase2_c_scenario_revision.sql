-- =============================================================================
-- PROPOSAL, NOT EXECUTED — Shared Data Phase 2(c): scenario revision
-- =============================================================================
-- Paul-gated: apply only after the isolated local rehearsal and step 3 approval.
--
-- WHAT / WHY
--   Add a monotonic scenario revision and a NEW append_turn_atomic_v6 wrapper.
--   v6 locks the scenario and detects replay before comparing the revision.
--   The existing v5 authority runs in the same transaction. A fresh successful
--   turn increments revision once; an accepted replay leaves it unchanged.
--   Existing v2-v5 writers do not read or increment this new column.
--
-- ADDITIVE-ONLY PROOF
--   1. One new column: public.scenarios.revision BIGINT NOT NULL DEFAULT 0.
--   2. One new RPC name: public.append_turn_atomic_v6 (CREATE, never REPLACE).
--   3. No existing RPC, trigger, grant, caller, or table definition is replaced.
--   4. No DROP, data backfill, or existing-row UPDATE is executed by migration.
--      The UPDATE below runs only when the new RPC accepts a fresh turn.
--   5. EXECUTE is revoked from PUBLIC/anon/authenticated; granted to service_role
--      only, with SECURITY DEFINER and v5's pinned pg_catalog, public search_path.
--
-- SOURCE CONTRACT / BRIEF DISCREPANCIES
--   20260920210000_v5_append_v5_replay_precedes_cas.sql returns JSONB containing
--   turn_row_id and model_version_receipt (which may be NULL on a fresh commit
--   or replay). It has no replay flag and no JSON CAS-refusal arm: stale graph
--   CAS RAISES SQLSTATE OLGC1. v6 preserves all delegated v5 exceptions without
--   catching them. Revision CAS refusal RAISES SQLSTATE OLRV1 with JSON DETAIL
--   containing reason, expected, and current; it has no JSON refusal result.
--   Detect replay under the same scenario lock via the existing turn row, not
--   via a NULL receipt. v5 still validates replay turn/mutation identity.
--   A missing scenario is compared as revision 0; v5 retains its existing
--   missing-scenario error. v6 does not create the row itself.
--   v5's last argument p_expected_base_known DEFAULT FALSE is made explicitly
--   required in v6 because PostgreSQL requires all arguments after a defaulted
--   input to have defaults, while p_expected_revision must remain required.
--   A replay may supply its original stale revision: v5 validates its identity,
--   revision CAS is skipped, and the current revision is returned without a bump.
-- =============================================================================

ALTER TABLE public.scenarios
  ADD COLUMN revision BIGINT NOT NULL DEFAULT 0;

CREATE FUNCTION public.append_turn_atomic_v6(
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
  p_expected_revision            BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_revision         BIGINT;
  v_turn_preexisting BOOLEAN;
  v_result           JSONB;
BEGIN
  SELECT revision INTO v_revision
    FROM public.scenarios
    WHERE id = p_scenario_id
    FOR UPDATE;
  IF NOT FOUND THEN
    v_revision := 0;
  END IF;

  -- A NULL model_version_receipt cannot identify replay: fresh guest/no-op
  -- commits also return NULL. The scenario lock serialises this lookup with
  -- the delegated v5 append. v5/v4 retain all replay identity checks.
  SELECT EXISTS (
    SELECT 1 FROM public.v5_conversation_turns
      WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id
  ) INTO v_turn_preexisting;

  -- Replay is decided before revision CAS: its expected revision describes an
  -- already-committed turn, so even a stale expectation recovers that result.
  -- Fresh turns have no enforcement mode or unknown-base exemption; NULL
  -- expectations are refused by the null-safe comparison.
  IF NOT v_turn_preexisting THEN
    IF p_expected_revision IS DISTINCT FROM v_revision THEN
      RAISE EXCEPTION 'append_turn_atomic_v6: revision_conflict'
        USING ERRCODE = 'OLRV1',
              DETAIL = jsonb_build_object(
                'reason', 'revision_conflict',
                'expected', p_expected_revision,
                'current', v_revision
              )::text;
    END IF;
  END IF;

  v_result := public.append_turn_atomic_v5(
    p_scenario_id,
    p_turn_id,
    p_turn_class,
    p_handler_id,
    p_request_hash,
    p_response_emitted,
    p_llm_calls_used,
    p_duration_ms,
    p_handler_facts,
    p_graph,
    p_brief_text,
    p_pending_actions,
    p_coaching_state,
    p_user_message,
    p_assistant_message,
    p_expected_graph_identity_hash,
    p_incoming_graph_identity_hash,
    p_cas_enforce,
    p_fence_generation,
    p_version_mutation_id,
    p_version_analysis_affecting_hash,
    p_version_hash_algorithm,
    p_version_projection_version,
    p_version_normaliser_version,
    p_version_graph_schema_version,
    p_version_actor_kind,
    p_version_authored_by,
    p_version_creation_kind,
    p_version_source_turn_id,
    p_expected_base_known
  );

  -- v5 returns only after a successful append or replay. Its refusals raise
  -- and roll back this transaction, including every delegated side effect.
  IF v_turn_preexisting THEN
    RETURN v_result || jsonb_build_object('revision', v_revision);
  END IF;

  UPDATE public.scenarios
    SET revision = revision + 1
    WHERE id = p_scenario_id
    RETURNING revision INTO v_revision;

  RETURN v_result || jsonb_build_object('revision', v_revision);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.append_turn_atomic_v6(
  UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER, JSONB,
  JSONB, TEXT, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BIGINT,
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN,
  BIGINT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.append_turn_atomic_v6(
  UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER, JSONB,
  JSONB, TEXT, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BIGINT,
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN,
  BIGINT
) TO service_role;
