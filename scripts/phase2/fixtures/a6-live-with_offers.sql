-- LOCAL A6 fixture extracted from DL's LIVE source, 10 Oct 2026.
-- prosrc md5 ea9988e21459581bdf18097534a6e373; length 3623 characters / 3623 UTF-8 bytes.
-- Body bytes and dollar-quote tags retained; never a migration.
CREATE FUNCTION "public"."append_agent_answer_with_offers"("p_scenario_id" "uuid", "p_turn_id" "text", "p_turn_class" "text", "p_handler_id" "text", "p_request_hash" "text", "p_response_emitted" boolean, "p_llm_calls_used" integer, "p_duration_ms" integer, "p_handler_facts" "jsonb", "p_graph" "jsonb", "p_brief_text" "text", "p_pending_actions" "jsonb", "p_coaching_state" "jsonb", "p_user_message" "text", "p_assistant_message" "text", "p_agent_guidance" "jsonb", "p_suggested_actions" "jsonb", "p_suggested_actions_run_key" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $_$
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
      OR (v_action->>'id') = 'agent-run-analysis'
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
$_$;
ALTER FUNCTION public.append_agent_answer_with_offers(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,jsonb,jsonb,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.append_agent_answer_with_offers(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,jsonb,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_agent_answer_with_offers(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,jsonb,jsonb,text) TO service_role;
