-- Context: the plain-text controls offered by the final Agent answer survive a reload.
-- Nullable, with no backfill. Existing graph/fence/version RPCs and RLS are unchanged.
-- Order-safe: the store falls back to its existing delegate when this RPC is absent.
ALTER TABLE public.v5_conversation_turns
  ADD COLUMN IF NOT EXISTS suggested_actions JSONB,
  ADD COLUMN IF NOT EXISTS suggested_actions_run_key TEXT;
COMMENT ON COLUMN public.v5_conversation_turns.suggested_actions IS
  'Original final-answer plain-text offers, in order; id, label and message only, never execution or approval metadata.';
COMMENT ON COLUMN public.v5_conversation_turns.suggested_actions_run_key IS
  'Nullable 16-hex reference to the scenario, graph and computed-at Run on which these answer offers were made.';

CREATE FUNCTION public.append_agent_answer_with_offers(
  p_scenario_id UUID, p_turn_id TEXT, p_turn_class TEXT, p_handler_id TEXT,
  p_request_hash TEXT, p_response_emitted BOOLEAN, p_llm_calls_used INTEGER,
  p_duration_ms INTEGER, p_handler_facts JSONB, p_graph JSONB,
  p_brief_text TEXT, p_pending_actions JSONB, p_coaching_state JSONB,
  p_user_message TEXT, p_assistant_message TEXT, p_agent_guidance JSONB,
  p_suggested_actions JSONB, p_suggested_actions_run_key TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id UUID;
  v_existing UUID;
  v_existing_hash TEXT;
  v_action JSONB;
  v_receipt JSONB;
BEGIN
  -- The delegate retains authority over handler facts, including parked answer facts.
  IF p_turn_class IS DISTINCT FROM 'direct_answer' OR p_handler_id IS NOT NULL
    OR p_request_hash IS NULL OR p_request_hash NOT LIKE 'agent_turn:%'
    OR p_turn_id IS NULL OR p_turn_id LIKE '%:claim'
    OR p_response_emitted IS DISTINCT FROM TRUE OR p_graph IS NOT NULL
    OR p_brief_text IS NOT NULL OR p_coaching_state IS NOT NULL THEN
    RAISE EXCEPTION 'offers require a final non-graph Agent answer';
  END IF;
  IF jsonb_typeof(p_suggested_actions) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid answer offers envelope';
  END IF;
  IF jsonb_array_length(p_suggested_actions) NOT BETWEEN 1 AND 8 THEN
    RAISE EXCEPTION 'answer offers cap exceeded';
  END IF;
  FOR v_action IN SELECT value FROM jsonb_array_elements(p_suggested_actions) LOOP
    IF jsonb_typeof(v_action) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'invalid answer offer';
    END IF;
    IF jsonb_typeof(v_action->'id') IS DISTINCT FROM 'string'
      OR jsonb_typeof(v_action->'label') IS DISTINCT FROM 'string'
      OR jsonb_typeof(v_action->'message') IS DISTINCT FROM 'string'
      OR (v_action - 'id' - 'label' - 'message') <> '{}'::jsonb
      OR (v_action->>'id') !~ '^agent-[a-z0-9-]{1,80}$'
      OR char_length(v_action->>'label') NOT BETWEEN 1 AND 80
      OR char_length(v_action->>'message') NOT BETWEEN 1 AND 400 THEN
      RAISE EXCEPTION 'invalid plain-text answer offer';
    END IF;
  END LOOP;
  IF p_suggested_actions_run_key IS NOT NULL AND p_suggested_actions_run_key !~ '^[0-9a-f]{16}$' THEN
    RAISE EXCEPTION 'invalid answer offers Run key';
  END IF;

  -- Same lock order as the guidance wrapper; retries never replace the first answer's offers.
  PERFORM 1 FROM public.scenarios WHERE id = p_scenario_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'scenario % not found', p_scenario_id; END IF;
  SELECT id, request_hash INTO v_existing, v_existing_hash FROM public.v5_conversation_turns
    WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id;

  IF p_agent_guidance IS NOT NULL THEN
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
  END IF;
  IF v_existing IS NULL THEN
    UPDATE public.v5_conversation_turns SET suggested_actions = p_suggested_actions,
      suggested_actions_run_key = p_suggested_actions_run_key
      WHERE id = v_id AND scenario_id = p_scenario_id AND turn_id = p_turn_id
        AND request_hash = p_request_hash;
    IF NOT FOUND THEN RAISE EXCEPTION 'offers answer row not found'; END IF;
  END IF;
  RETURN jsonb_build_object('id', v_id,
    'replayed_prior_turn', v_existing IS NOT NULL AND v_existing_hash IS NOT DISTINCT FROM p_request_hash,
    'prior_turn_conflict', v_existing IS NOT NULL AND v_existing_hash IS DISTINCT FROM p_request_hash);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.append_agent_answer_with_offers(
  uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb, jsonb, text, text, jsonb, jsonb, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_agent_answer_with_offers(
  uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb, jsonb, text, text, jsonb, jsonb, text
) TO service_role;
NOTIFY pgrst, 'reload schema';
