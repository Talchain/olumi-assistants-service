
DECLARE
  v_turn_id          UUID;
  v_user_id          UUID;
  v_current_hash     TEXT;
  v_has_graph        BOOLEAN;
  v_fact             JSONB;
  v_updated          INTEGER;
  v_fence_generation BIGINT;
  v_fence_stopped_at TIMESTAMPTZ;
  v_fence_max        BIGINT;
  v_already_committed BOOLEAN;
BEGIN
  SELECT user_id, graph_identity_hash, (graph IS NOT NULL)
    INTO v_user_id, v_current_hash, v_has_graph
    FROM scenarios
    WHERE id = p_scenario_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'scenario % not found', p_scenario_id;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM v5_conversation_turns
    WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id
  ) INTO v_already_committed;

  IF p_fence_generation IS NOT NULL AND p_graph IS NOT NULL AND NOT v_already_committed THEN
    SELECT generation, stopped_at
      INTO v_fence_generation, v_fence_stopped_at
      FROM v5_turn_fence
      WHERE scenario_id = p_scenario_id AND generation = p_fence_generation
      FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = 'OLTF3',
        MESSAGE = format(
          'append_turn_atomic_v4: no fence row for scenario %s at generation %s — the write cannot be ordered',
          p_scenario_id, p_fence_generation),
        DETAIL = '{}';
    END IF;

    SELECT MAX(generation) INTO v_fence_max
      FROM v5_turn_fence
      WHERE scenario_id = p_scenario_id;

    IF v_fence_stopped_at IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = 'OLTF1',
        MESSAGE = format(
          'append_turn_atomic_v4: the turn admitted at generation %s on scenario %s was explicitly stopped at %s',
          v_fence_generation, p_scenario_id, v_fence_stopped_at),
        DETAIL = format('{"generation": %s, "max_generation": %s}',
                        v_fence_generation, v_fence_max);
    END IF;

    IF p_fence_generation < v_fence_max AND v_has_graph THEN
      RAISE EXCEPTION USING
        ERRCODE = 'OLTF2',
        MESSAGE = format(
          'append_turn_atomic_v4: the turn admitted at generation %s is superseded on scenario %s (max generation %s)',
          p_fence_generation, p_scenario_id, v_fence_max),
        DETAIL = format('{"generation": %s, "max_generation": %s}',
                        p_fence_generation, v_fence_max);
    END IF;
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
    SELECT id INTO v_turn_id
      FROM v5_conversation_turns
      WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id;
    RETURN v_turn_id;
  END IF;

  IF p_graph IS NOT NULL THEN
    IF p_cas_enforce
       AND p_expected_graph_identity_hash IS NOT NULL
       AND v_current_hash IS NOT NULL
       AND v_current_hash IS DISTINCT FROM p_expected_graph_identity_hash
       AND (p_incoming_graph_identity_hash IS NULL
            OR p_incoming_graph_identity_hash IS DISTINCT FROM v_current_hash)
    THEN
      RAISE EXCEPTION USING
        ERRCODE = 'OLGC1',
        MESSAGE = format(
          'append_turn_atomic_v4: stale graph write for scenario %s (expected %s, current %s)',
          p_scenario_id, p_expected_graph_identity_hash, v_current_hash);
    END IF;

    UPDATE scenarios
       SET graph = p_graph,
           graph_identity_hash = p_incoming_graph_identity_hash
     WHERE id = p_scenario_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
      RAISE EXCEPTION 'append_turn_atomic_v4: scenarios row % vanished under lock', p_scenario_id;
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

  IF p_brief_text IS NOT NULL THEN
    UPDATE scenarios
       SET brief_text = p_brief_text,
           updated_at = NOW()
     WHERE id = p_scenario_id
       AND (brief_text IS NULL OR brief_text = '');
  END IF;

  RETURN v_turn_id;
END;
