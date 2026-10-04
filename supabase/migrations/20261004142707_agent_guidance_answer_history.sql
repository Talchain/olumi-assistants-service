-- Context: post-egress, content-free guidance events live WITH the final answer.
-- Apply before serving this CEE build. Old answers remain NULL; existing RLS and
-- every graph/fence/version RPC are unchanged. DL applies at merge.
ALTER TABLE public.v5_conversation_turns ADD COLUMN IF NOT EXISTS agent_guidance JSONB;
COMMENT ON COLUMN public.v5_conversation_turns.agent_guidance IS
  'Versioned content-free final-answer guidance events; policy/item digests, status and state hash only.';

CREATE FUNCTION public.append_agent_answer_with_guidance(
  p_scenario_id UUID, p_turn_id TEXT, p_turn_class TEXT, p_handler_id TEXT,
  p_request_hash TEXT, p_response_emitted BOOLEAN, p_llm_calls_used INTEGER,
  p_duration_ms INTEGER, p_handler_facts JSONB, p_graph JSONB,
  p_brief_text TEXT, p_pending_actions JSONB, p_coaching_state JSONB,
  p_user_message TEXT, p_assistant_message TEXT, p_agent_guidance JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id UUID;
  v_existing UUID;
  v_existing_hash TEXT;
  v_entry RECORD;
BEGIN
  -- This wrapper may only append a visible Agent answer. It cannot acquire a
  -- graph, handler, brief or pre-dispatch coaching write authority.
  IF p_turn_class IS DISTINCT FROM 'direct_answer' OR p_handler_id IS NOT NULL
    OR p_request_hash IS NULL OR p_request_hash NOT LIKE 'agent_turn:%'
    OR p_turn_id IS NULL OR p_turn_id LIKE '%:claim'
    OR p_response_emitted IS DISTINCT FROM TRUE OR p_graph IS NOT NULL
    OR p_brief_text IS NOT NULL OR p_coaching_state IS NOT NULL
    OR p_handler_facts IS DISTINCT FROM '[]'::jsonb THEN
    RAISE EXCEPTION 'guidance requires a final non-graph Agent answer';
  END IF;
  IF p_agent_guidance IS NULL OR jsonb_typeof(p_agent_guidance) <> 'object'
    OR p_agent_guidance->'version' IS DISTINCT FROM '1'::jsonb
    OR jsonb_typeof(p_agent_guidance->'entries') IS DISTINCT FROM 'object'
    OR (p_agent_guidance - 'version' - 'entries') <> '{}'::jsonb THEN
    RAISE EXCEPTION 'invalid guidance envelope';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_agent_guidance->'entries')) > 3 THEN
    RAISE EXCEPTION 'guidance event cap exceeded';
  END IF;
  FOR v_entry IN SELECT key, value FROM jsonb_each(p_agent_guidance->'entries') LOOP
    IF v_entry.key !~ '^(RC-WIDEN|RC-WHAT-CHANGES|RC-PREMORTEM|RC-COACH-EDITS|RC-STRENGTHEN-ITEM:[0-9a-f]{12})$'
      OR jsonb_typeof(v_entry.value) <> 'object'
      OR jsonb_typeof(v_entry.value->'status') IS DISTINCT FROM 'string'
      OR (v_entry.value->>'status') NOT IN ('offered', 'pressed', 'completed', 'dismissed')
      OR jsonb_typeof(v_entry.value->'state_key_hash') IS DISTINCT FROM 'string'
      OR (v_entry.value->>'state_key_hash') !~ '^[0-9a-f]{12}$'
      OR (v_entry.value - 'status' - 'state_key_hash') <> '{}'::jsonb THEN
      RAISE EXCEPTION 'invalid content-free guidance event';
    END IF;
  END LOOP;

  -- Same lock order as the existing appends. All v2 callers take FOR SHARE on
  -- this row; FOR UPDATE serialises insertion with this exact-id existence
  -- check. Thus a concurrent retry can never replace the first answer's events.
  PERFORM 1 FROM public.scenarios WHERE id = p_scenario_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'scenario % not found', p_scenario_id; END IF;
  SELECT id, request_hash INTO v_existing, v_existing_hash FROM public.v5_conversation_turns
    WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id;

  v_id := public.append_turn_atomic_v2(
    p_scenario_id, p_turn_id, p_turn_class, p_handler_id, p_request_hash,
    p_response_emitted, p_llm_calls_used, p_duration_ms, p_handler_facts,
    p_graph, p_brief_text, p_pending_actions, p_coaching_state,
    p_user_message, p_assistant_message
  );
  IF v_existing IS NULL THEN
    UPDATE public.v5_conversation_turns SET agent_guidance = p_agent_guidance
      WHERE id = v_id AND scenario_id = p_scenario_id AND turn_id = p_turn_id
        AND request_hash = p_request_hash;
    IF NOT FOUND THEN RAISE EXCEPTION 'guidance answer row not found'; END IF;
  END IF;
  RETURN jsonb_build_object('id', v_id,
    'replayed_prior_turn', v_existing IS NOT NULL AND v_existing_hash IS NOT DISTINCT FROM p_request_hash,
    'prior_turn_conflict', v_existing IS NOT NULL AND v_existing_hash IS DISTINCT FROM p_request_hash);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.append_agent_answer_with_guidance(
  uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb, jsonb, text, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_agent_answer_with_guidance(
  uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb, jsonb, text, text, jsonb
) TO service_role;
