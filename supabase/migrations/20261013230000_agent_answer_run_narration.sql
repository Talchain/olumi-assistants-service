-- Context (T1h): a replayed Agent answer names the Run it was sent with, after a restart too. The answer's own
-- narration ({status, run_key}) is stored WITH its row, whatever offers or guidance the answer carried.
-- Additive: ONE nullable column (with its own CHECK) and TWO NEW, distinctly named functions. No existing function,
-- grant, constraint or policy changes, so every existing caller (production CEE included) resolves exactly as before. A new name, not
-- a defaulted parameter on the live wrappers: Postgres cannot add a parameter in place, and an overload beside the
-- live signature makes PostgREST's named-argument resolution ambiguous (20260426160532).
-- Order-safe: the store calls these only for a write that carries narration, and falls back to the existing
-- path on PGRST202 / 42883 when this migration is absent. Rollback: rollback/20261013230000_*.do-not-apply.
ALTER TABLE public.v5_conversation_turns ADD COLUMN IF NOT EXISTS run_narration JSONB;
COMMENT ON COLUMN public.v5_conversation_turns.run_narration IS
  'The final Agent answer''s own narration, {status, run_key}: the Run it was sent with (16-hex key). NULL = unknown.';
-- NULL, or exactly {status, run_key}: every status the live route sends (`stale` included: an Explain press on a
-- moved Run, agent-v1-turn.ts narrationStatus) and a 16-hex key. `IS TRUE`: a missing field makes the predicate NULL,
-- which a bare CHECK would accept ({} or {"status":"ready"}). NOT VALID: the column is new, so every existing row is
-- NULL; this skips a validation scan under the ADD COLUMN lock on a shared table, and still checks every write.
ALTER TABLE public.v5_conversation_turns ADD CONSTRAINT v5_conversation_turns_run_narration_shape CHECK (
  run_narration IS NULL OR (CASE WHEN jsonb_typeof(run_narration) = 'object' THEN
    (run_narration - 'status' - 'run_key') = '{}'::jsonb
    AND jsonb_typeof(run_narration->'status') = 'string'
    AND (run_narration->>'status') IN ('pending', 'ready', 'unavailable', 'stale')
    AND jsonb_typeof(run_narration->'run_key') = 'string'
    AND (run_narration->>'run_key') ~ '^[0-9a-f]{16}$'
  ELSE FALSE END) IS TRUE
) NOT VALID;

CREATE FUNCTION public.append_agent_answer_narrated(
  p_scenario_id UUID, p_turn_id TEXT, p_turn_class TEXT, p_handler_id TEXT,
  p_request_hash TEXT, p_response_emitted BOOLEAN, p_llm_calls_used INTEGER,
  p_duration_ms INTEGER, p_handler_facts JSONB, p_graph JSONB,
  p_brief_text TEXT, p_pending_actions JSONB, p_coaching_state JSONB,
  p_user_message TEXT, p_assistant_message TEXT, p_agent_guidance JSONB,
  p_suggested_actions JSONB, p_suggested_actions_run_key TEXT, p_run_narration JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id UUID;
  v_existing UUID;
  v_existing_hash TEXT;
  v_receipt JSONB;
BEGIN
  -- Only a visible final Agent answer; no graph, handler, brief or coaching write authority.
  IF p_turn_class IS DISTINCT FROM 'direct_answer' OR p_handler_id IS NOT NULL
    OR p_request_hash IS NULL OR p_request_hash NOT LIKE 'agent_turn:%'
    OR p_turn_id IS NULL OR p_turn_id LIKE '%:claim'
    OR p_response_emitted IS DISTINCT FROM TRUE OR p_graph IS NOT NULL
    OR p_brief_text IS NOT NULL OR p_coaching_state IS NOT NULL THEN
    RAISE EXCEPTION 'narration requires a final non-graph Agent answer';
  END IF;
  IF p_run_narration IS NULL OR jsonb_typeof(p_run_narration) IS DISTINCT FROM 'object'
    OR (p_run_narration - 'status' - 'run_key') <> '{}'::jsonb
    OR jsonb_typeof(p_run_narration->'status') IS DISTINCT FROM 'string'
    OR (p_run_narration->>'status') NOT IN ('pending', 'ready', 'unavailable', 'stale')
    OR jsonb_typeof(p_run_narration->'run_key') IS DISTINCT FROM 'string'
    OR (p_run_narration->>'run_key') !~ '^[0-9a-f]{16}$' THEN
    RAISE EXCEPTION 'invalid answer Run narration';
  END IF;

  -- Same lock order as the wrappers it delegates to; a retry never replaces the first answer's narration.
  PERFORM 1 FROM public.scenarios WHERE id = p_scenario_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'scenario % not found', p_scenario_id; END IF;
  SELECT id, request_hash INTO v_existing, v_existing_hash FROM public.v5_conversation_turns
    WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id;

  -- The existing wrappers keep their own validation and receipts, unchanged.
  IF p_suggested_actions IS NOT NULL THEN
    v_receipt := public.append_agent_answer_with_offers(
      p_scenario_id, p_turn_id, p_turn_class, p_handler_id, p_request_hash,
      p_response_emitted, p_llm_calls_used, p_duration_ms, p_handler_facts,
      p_graph, p_brief_text, p_pending_actions, p_coaching_state,
      p_user_message, p_assistant_message, p_agent_guidance,
      p_suggested_actions, p_suggested_actions_run_key
    );
    v_id := (v_receipt->>'id')::uuid;
  ELSIF p_agent_guidance IS NOT NULL THEN
    v_receipt := public.append_agent_answer_with_guidance(
      p_scenario_id, p_turn_id, p_turn_class, p_handler_id, p_request_hash,
      p_response_emitted, p_llm_calls_used, p_duration_ms, p_handler_facts,
      p_graph, p_brief_text, p_pending_actions, p_coaching_state,
      p_user_message, p_assistant_message, p_agent_guidance
    );
    v_id := (v_receipt->>'id')::uuid;
  ELSE
    v_id := public.append_turn_atomic_v2(
      p_scenario_id, p_turn_id, p_turn_class, p_handler_id, p_request_hash,
      p_response_emitted, p_llm_calls_used, p_duration_ms, p_handler_facts,
      p_graph, p_brief_text, p_pending_actions, p_coaching_state,
      p_user_message, p_assistant_message
    );
    v_receipt := jsonb_build_object('id', v_id,
      'replayed_prior_turn', v_existing IS NOT NULL AND v_existing_hash IS NOT DISTINCT FROM p_request_hash,
      'prior_turn_conflict', v_existing IS NOT NULL AND v_existing_hash IS DISTINCT FROM p_request_hash);
  END IF;
  IF v_existing IS NULL THEN
    UPDATE public.v5_conversation_turns SET run_narration = p_run_narration
      WHERE id = v_id AND scenario_id = p_scenario_id AND turn_id = p_turn_id
        AND request_hash = p_request_hash;
    IF NOT FOUND THEN RAISE EXCEPTION 'narration answer row not found'; END IF;
  END IF;
  RETURN v_receipt;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.append_agent_answer_narrated(
  uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb, jsonb, text, text, jsonb, jsonb, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_agent_answer_narrated(
  uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb, jsonb, text, text, jsonb, jsonb, text, jsonb
) TO service_role;

-- The conditional twin of append_agent_answer_if_latest (20261007090000), byte-for-byte in its guard, lock and
-- latest-row check; it then delegates to the narrated append above.
CREATE FUNCTION public.append_agent_answer_if_latest_narrated(
  p_expected_latest_row_id UUID,
  p_scenario_id UUID, p_turn_id TEXT, p_turn_class TEXT, p_handler_id TEXT,
  p_request_hash TEXT, p_response_emitted BOOLEAN, p_llm_calls_used INTEGER,
  p_duration_ms INTEGER, p_handler_facts JSONB, p_graph JSONB,
  p_brief_text TEXT, p_pending_actions JSONB, p_coaching_state JSONB,
  p_user_message TEXT, p_assistant_message TEXT, p_agent_guidance JSONB,
  p_suggested_actions JSONB, p_suggested_actions_run_key TEXT, p_run_narration JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_latest UUID;
BEGIN
  IF p_turn_class IS DISTINCT FROM 'direct_answer' OR p_handler_id IS NOT NULL
    OR p_request_hash IS NULL OR p_request_hash NOT LIKE 'agent_turn:%'
    OR p_turn_id IS NULL OR p_turn_id LIKE '%:claim'
    OR p_response_emitted IS DISTINCT FROM TRUE OR p_graph IS NOT NULL
    OR p_brief_text IS NOT NULL OR p_coaching_state IS NOT NULL THEN
    RAISE EXCEPTION 'conditional append requires a final non-graph Agent answer';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_scenario_id::text, 0));
  SELECT id INTO v_latest FROM public.v5_conversation_turns
    WHERE scenario_id = p_scenario_id AND turn_id NOT LIKE '%:claim'
    ORDER BY created_at DESC LIMIT 1;
  IF v_latest IS DISTINCT FROM p_expected_latest_row_id THEN
    RETURN jsonb_build_object('status', 'latest_moved');
  END IF;

  RETURN public.append_agent_answer_narrated(
    p_scenario_id, p_turn_id, p_turn_class, p_handler_id, p_request_hash,
    p_response_emitted, p_llm_calls_used, p_duration_ms, p_handler_facts,
    p_graph, p_brief_text, p_pending_actions, p_coaching_state,
    p_user_message, p_assistant_message, p_agent_guidance,
    p_suggested_actions, p_suggested_actions_run_key, p_run_narration
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.append_agent_answer_if_latest_narrated(
  uuid, uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb, jsonb, text, text, jsonb, jsonb, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_agent_answer_if_latest_narrated(
  uuid, uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb, jsonb, text, text, jsonb, jsonb, text, jsonb
) TO service_role;
NOTIFY pgrst, 'reload schema';
