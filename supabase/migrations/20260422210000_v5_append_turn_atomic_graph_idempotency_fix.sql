-- ============================================================
-- V5 atomic graph commit: fix graph UPDATE idempotency ordering
-- Target: Staging Supabase
-- Date: 2026-04-22
--
-- Bug fixed (P0-A, identified by code review):
--   20260422200000 placed the graph UPDATE *before* the turn INSERT.
--   On a retry with the same (scenario_id, turn_id) and a non-null
--   p_graph, the UPDATE fired unconditionally, then the INSERT hit
--   ON CONFLICT DO NOTHING and returned the existing row id. The turn
--   row was correctly deduplicated but scenarios.graph was mutated —
--   violating the idempotency invariant: "same turn_id = same outcome".
--
--   Concrete hazard: a client retry carrying a corrected graph (e.g.
--   after a transient network error mid-flight) would silently overwrite
--   scenarios.graph even though no new turn row was created. In the
--   other direction, the original graph is preserved even if the retry
--   carries the same data, so the bug is latent but real.
--
-- Fix:
--   Move the graph UPDATE to *after* the INSERT, gated on FOUND.
--   FOUND is set to true by RETURNING ... INTO only when a new row was
--   inserted (i.e. no conflict). On conflict replay, FOUND is false,
--   the graph block is skipped, and the existing row id is returned —
--   perfectly idempotent.
--
--   Ordering is now:
--     1. SELECT user_id (scenario existence check)
--     2. INSERT v5_conversation_turns ON CONFLICT DO NOTHING
--     3. IF NOT FOUND (conflict replay) → look up existing id, RETURN
--     4. IF p_graph IS NOT NULL → UPDATE scenarios SET graph = p_graph
--     5. INSERT handler_facts
--     6. RETURN new id
--
--   The ROW_COUNT guard (v_updated = 0 → RAISE) is retained: the
--   scenario row was confirmed present in step 1, so a zero-row UPDATE
--   here still indicates an application anomaly.
--
-- Idempotency regression invariant (Improvement-A):
--   To lock this invariant in tests, verify that calling this RPC twice
--   with identical (scenario_id, turn_id) but different p_graph values
--   produces:
--     - the same returned UUID both times
--     - scenarios.graph unchanged after the second call
--   This can be tested via Supabase client or direct SQL in a migration
--   test harness. The application-level vitest suite covers the
--   StateCommitFailedError throw path; the idempotency invariant is
--   a DB-layer concern best verified in integration / SQL test context.
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
    -- Conflict replay: deduplicated turn, idempotent return.
    -- Do NOT write p_graph — scenarios.graph must not be mutated on retry.
    SELECT id INTO v_turn_id
      FROM v5_conversation_turns
      WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id;
    RETURN v_turn_id;
  END IF;

  -- New turn inserted. Now write the graph atomically in the same transaction.
  -- Gating on FOUND (above) ensures this block never runs on conflict replay,
  -- preserving the idempotency invariant for graph writes.
  IF p_graph IS NOT NULL THEN
    UPDATE scenarios SET graph = p_graph WHERE id = p_scenario_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
      -- Should never happen: step 1 confirmed the scenarios row exists.
      -- Raise so the anomaly surfaces rather than being silently dropped.
      RAISE EXCEPTION 'append_turn_atomic: scenarios row % vanished between SELECT and UPDATE', p_scenario_id;
    END IF;
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

-- No grant changes needed: the function signature is unchanged from
-- 20260422200000. The GRANT on the 10-param signature applied there
-- remains in effect. CREATE OR REPLACE preserves existing grants.
