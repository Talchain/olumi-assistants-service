-- =============================================================================
-- PROPOSAL, NOT EXECUTED — Phase 2(c): revision CAS for unversioned v4 appends
-- =============================================================================
-- Paul-gated. de rehearses locally; the DL applies after approval.
-- Additive: one NEW function. Existing v4, v5, v6, tables and triggers unchanged.
-- Prerequisites: scenarios.revision, scenarios_bump_revision and the existing
-- 19-argument v4 from 20260806120000_v5_turn_fence_first_write_exemption.sql.
--
-- Signature: v4's exact first 19 names/types/order, then required revision.
-- PostgreSQL cannot place a required input after a defaulted input. Therefore
-- v4r makes all 20 inputs required; v4's defaults remain unchanged on v4 itself:
--   graph/brief_text/coaching_state/user_message/assistant_message = NULL;
--   pending_actions = '[]'::jsonb; expected/incoming graph hashes = NULL;
--   cas_enforce = FALSE; fence_generation = NULL.
-- appendAtomicFenced already supplies every one of v4's 19 named values
-- (supabase-store.ts:476-493, 1370-1387). af must do the same for v4r, adding
-- p_expected_revision; absent optional values must be explicit NULL/[]/FALSE.
--
-- Control flow is v6's: lock scenario, detect replay before revision compare,
-- delegate without catching v4 errors, re-read trigger-owned revision.
-- Missing scenario compares as revision 0, as in v6; v4 retains its error.
-- v4 returns UUID, so v4r wraps that UUID, not a v5 model-version envelope.
-- =============================================================================

SET LOCAL lock_timeout = '3s';

CREATE FUNCTION public.append_turn_atomic_v4r(
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
  v_turn_row_id      UUID;
BEGIN
  SELECT revision INTO v_revision
    FROM public.scenarios
    WHERE id = p_scenario_id
    FOR UPDATE;
  IF NOT FOUND THEN
    v_revision := 0;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.v5_conversation_turns
      WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id
  ) INTO v_turn_preexisting;

  -- Already-committed retries skip revision CAS. v4 still owns replay/fence/CAS.
  IF NOT v_turn_preexisting THEN
    IF p_expected_revision IS DISTINCT FROM v_revision THEN
      RAISE EXCEPTION 'append_turn_atomic_v4r: revision_conflict'
        USING ERRCODE = 'OLRV1',
              DETAIL = jsonb_build_object(
                'reason', 'revision_conflict',
                'expected', p_expected_revision,
                'current', v_revision
              )::text;
    END IF;
  END IF;

  v_turn_row_id := public.append_turn_atomic_v4(
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
    p_fence_generation
  );

  -- No exception handler: delegated fence/CAS failures propagate unchanged.
  SELECT revision INTO v_revision
    FROM public.scenarios
    WHERE id = p_scenario_id;

  RETURN jsonb_build_object('turn_row_id', v_turn_row_id, 'revision', v_revision);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.append_turn_atomic_v4r(
  UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER, JSONB,
  JSONB, TEXT, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BIGINT, BIGINT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.append_turn_atomic_v4r(
  UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER, JSONB,
  JSONB, TEXT, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BIGINT, BIGINT
) TO service_role;
