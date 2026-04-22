-- ============================================================
-- V5 atomic graph commit: extend append_turn_atomic with p_graph
-- Target: Staging Supabase
-- Date: 2026-04-22
--
-- Problem solved:
--   The V5 draft_graph dispatcher previously wrote the graph to
--   scenarios.graph via a separate store_draft_graph RPC call, then
--   appended the turn row via append_turn_atomic. These were two
--   separate database operations, creating a split-state risk:
--     - Graph stored + turn commit fails → graph exists, no turn record
--     - Turn committed + graph store fails → turn record, no graph
--   The V5 session contract (Slice B) requires that successful turns
--   write both the turn record and any associated state atomically.
--
-- Fix:
--   Add optional p_graph JSONB DEFAULT NULL to append_turn_atomic.
--   When non-null, the RPC runs UPDATE scenarios SET graph = p_graph
--   inside the same PL/pgSQL transaction as the turn insert. Both
--   writes commit together or neither does.
--
-- Design decisions:
--   - DEFAULT NULL: fully backward-compatible. All existing callers
--     that omit p_graph continue to work without change.
--   - UPDATE-only semantics for the graph write: same rationale as
--     store_draft_graph — pre-flight (ensure_scenario_exists) always
--     creates the scenarios row first. A missing row at this point is
--     an application error that should surface, not be silently papered
--     over. We reuse the same ROW_COUNT guard.
--   - store_draft_graph RPC is retained for future out-of-band use
--     (e.g. admin tooling) but is no longer in the critical V5 path.
--   - SECURITY DEFINER with service-role key — same posture as all
--     other V5 RPCs.
--   - CREATE OR REPLACE is safe: the new signature (9 existing params
--     + 1 optional) is a superset of the old signature. Postgres
--     resolves the old 9-param call via the DEFAULT.
--
-- Grant notes:
--   The old 9-param overload grant is REVOKED and re-applied to the
--   new 10-param signature. Postgres treats these as distinct overloads
--   for grant purposes; both forms must be granted explicitly.
-- ============================================================

CREATE OR REPLACE FUNCTION append_turn_atomic(
  p_scenario_id      UUID,
  p_turn_id          TEXT,
  p_turn_class       TEXT,
  p_handler_id       TEXT,
  p_request_hash     TEXT,
  p_response_emitted BOOLEAN,
  p_llm_calls_used   INTEGER,
  p_duration_ms      INTEGER,
  p_handler_facts    JSONB,
  p_graph            JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_turn_id   UUID;
  v_user_id   UUID;
  v_fact      JSONB;
  v_updated   INTEGER;
BEGIN
  SELECT user_id INTO v_user_id FROM scenarios WHERE id = p_scenario_id;
  -- Use FOUND (set by SELECT INTO) to distinguish "row absent" from
  -- "guest row with user_id IS NULL".
  IF NOT FOUND THEN
    RAISE EXCEPTION 'scenario % not found', p_scenario_id;
  END IF;

  -- When a draft graph is provided, persist it atomically with the turn insert.
  -- Both succeed or both roll back — no split-state risk.
  IF p_graph IS NOT NULL THEN
    UPDATE scenarios SET graph = p_graph WHERE id = p_scenario_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
      -- Should never happen: we just confirmed the row exists via SELECT above.
      -- Raise rather than silently continue so the caller surfaces the anomaly.
      RAISE EXCEPTION 'append_turn_atomic: scenarios row % vanished between SELECT and UPDATE', p_scenario_id;
    END IF;
  END IF;

  INSERT INTO v5_conversation_turns (
    scenario_id, user_id, turn_id, turn_class, handler_id,
    request_hash, response_emitted, llm_calls_used, duration_ms
  ) VALUES (
    p_scenario_id, v_user_id, p_turn_id, p_turn_class, p_handler_id,
    p_request_hash, p_response_emitted, p_llm_calls_used, p_duration_ms
  )
  ON CONFLICT (scenario_id, turn_id) DO NOTHING
  RETURNING id INTO v_turn_id;

  IF NOT FOUND THEN
    SELECT id INTO v_turn_id
      FROM v5_conversation_turns
      WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id;
    RETURN v_turn_id;
  END IF;

  IF jsonb_array_length(COALESCE(p_handler_facts, '[]'::jsonb)) > 0 THEN
    FOR v_fact IN SELECT * FROM jsonb_array_elements(p_handler_facts)
    LOOP
      INSERT INTO v5_handler_facts (
        v5_conversation_turn_id, scenario_id, user_id,
        handler_id, action_type, noop, payload
      ) VALUES (
        v_turn_id,
        p_scenario_id,
        v_user_id,
        v_fact->>'handler_id',
        v_fact->>'action_type',
        COALESCE((v_fact->>'noop')::boolean, FALSE),
        COALESCE(v_fact->'payload', '{}'::jsonb)
      );
    END LOOP;
  END IF;

  RETURN v_turn_id;
END;
$$;

-- Revoke old 9-param grant and apply to the new 10-param signature.
REVOKE EXECUTE ON FUNCTION append_turn_atomic(UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION append_turn_atomic(UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER, JSONB) FROM service_role;
GRANT  EXECUTE ON FUNCTION append_turn_atomic(UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER, JSONB, JSONB) TO service_role;
