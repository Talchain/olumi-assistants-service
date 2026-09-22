CREATE OR REPLACE FUNCTION public.append_turn_atomic_v3(p_scenario_id uuid, p_turn_id text, p_turn_class text, p_handler_id text, p_request_hash text, p_response_emitted boolean, p_llm_calls_used integer, p_duration_ms integer, p_handler_facts jsonb, p_graph jsonb DEFAULT NULL::jsonb, p_brief_text text DEFAULT NULL::text, p_pending_actions jsonb DEFAULT '[]'::jsonb, p_coaching_state jsonb DEFAULT NULL::jsonb, p_user_message text DEFAULT NULL::text, p_assistant_message text DEFAULT NULL::text, p_expected_graph_identity_hash text DEFAULT NULL::text, p_incoming_graph_identity_hash text DEFAULT NULL::text, p_cas_enforce boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_turn_id      UUID;
  v_user_id      UUID;
  v_current_hash TEXT;
  v_fact         JSONB;
  v_updated      INTEGER;
BEGIN
  -- Row lock FIRST: serialises concurrent graph writers on this scenario for
  -- the remainder of the transaction. This is exactly what the app-side hook
  -- cannot do — the compare below is race-free. Also reads the recorded
  -- current identity hash under the same lock.
  SELECT user_id, graph_identity_hash
    INTO v_user_id, v_current_hash
    FROM scenarios
    WHERE id = p_scenario_id
    FOR UPDATE;
  -- Use FOUND (set by SELECT INTO) to distinguish "row absent" from
  -- "guest row with user_id IS NULL".
  IF NOT FOUND THEN
    RAISE EXCEPTION 'scenario % not found', p_scenario_id;
  END IF;

  INSERT INTO v5_conversation_turns (
    scenario_id, user_id, turn_id, turn_class, handler_id,
    request_hash, response_emitted, llm_calls_used, duration_ms,
    pending_actions, coaching_state, user_message, assistant_message
  ) VALUES (
    p_scenario_id, v_user_id, p_turn_id, p_turn_class, p_handler_id,
    p_request_hash, p_response_emitted, p_llm_calls_used, p_duration_ms,
    COALESCE(p_pending_actions, '[]'::jsonb), p_coaching_state,
    p_user_message, p_assistant_message
  )
  ON CONFLICT (scenario_id, turn_id) DO NOTHING
  RETURNING id INTO v_turn_id;

  IF NOT FOUND THEN
    -- Conflict replay: identical (scenario_id, turn_id) already committed.
    -- SKIP CAS ENTIRELY and return the existing row id — retry safety. A
    -- retried request whose first attempt already won must never surface a
    -- stale-write error for its own successful write. Nothing is mutated
    -- (same load-bearing idempotency invariant as v2): not scenarios.graph,
    -- not graph_identity_hash, not brief_text.
    SELECT id INTO v_turn_id
      FROM v5_conversation_turns
      WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id;
    RETURN v_turn_id;
  END IF;

  -- New turn inserted. Now write the graph atomically in the same transaction.
  -- Gating on FOUND (above) ensures this block never runs on conflict replay,
  -- preserving the idempotency invariant for graph writes.
  IF p_graph IS NOT NULL THEN
    -- In-transaction CAS, under the FOR UPDATE lock taken above.
    -- Enforce ONLY when the caller opted in AND supplied an expected hash
    -- AND a recorded current hash exists AND the incoming write is not a
    -- self-noop (incoming == current ⇒ content-idempotent, always allowed —
    -- mirrors the app-side self_noop category). Any of these being false
    -- falls through to today's unconditional UPDATE (v2-equivalent).
    IF p_cas_enforce
       AND p_expected_graph_identity_hash IS NOT NULL
       AND v_current_hash IS NOT NULL
       AND v_current_hash IS DISTINCT FROM p_expected_graph_identity_hash
       AND (p_incoming_graph_identity_hash IS NULL
            OR p_incoming_graph_identity_hash IS DISTINCT FROM v_current_hash)
    THEN
      -- Typed, matchable error: the app maps SQLSTATE 'OLGC1' (custom class)
      -- onto its GraphStaleWriteError envelope (409-class refresh-reconfirm).
      -- The WHOLE transaction rolls back — the turn row included — so no
      -- partial state survives and nothing is clobbered.
      RAISE EXCEPTION USING
        ERRCODE = 'OLGC1',
        MESSAGE = format(
          'append_turn_atomic_v3: stale graph write for scenario %s (expected %s, current %s)',
          p_scenario_id, p_expected_graph_identity_hash, v_current_hash);
    END IF;

    UPDATE scenarios
       SET graph = p_graph,
           graph_identity_hash = p_incoming_graph_identity_hash
     WHERE id = p_scenario_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
      -- Should never happen: the FOR UPDATE above confirmed the row exists.
      -- Raise so the anomaly surfaces rather than being silently dropped.
      RAISE EXCEPTION 'append_turn_atomic_v3: scenarios row % vanished under lock', p_scenario_id;
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

  -- V5 Phase 1 brief persistence: write user-supplied brief_text once.
  -- First-write-wins enforced by the WHERE predicate. ROW_COUNT is NOT
  -- checked here — a "no rows updated" outcome means the brief was
  -- already set, which is the intended write-once behaviour.
  IF p_brief_text IS NOT NULL THEN
    UPDATE scenarios
       SET brief_text = p_brief_text,
           updated_at = NOW()
     WHERE id = p_scenario_id
       AND (brief_text IS NULL OR brief_text = '');
  END IF;

  RETURN v_turn_id;
END;
$function$
