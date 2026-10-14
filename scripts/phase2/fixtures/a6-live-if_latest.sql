-- LOCAL A6 fixture extracted from DL's LIVE source, 10 Oct 2026.
-- prosrc md5 7d038f624e222134c7ac58c8db79281e; length 1994 characters / 1994 UTF-8 bytes.
-- Body bytes and dollar-quote tags retained; never a migration.
CREATE FUNCTION "public"."append_agent_answer_if_latest"("p_expected_latest_row_id" "uuid", "p_scenario_id" "uuid", "p_turn_id" "text", "p_turn_class" "text", "p_handler_id" "text", "p_request_hash" "text", "p_response_emitted" boolean, "p_llm_calls_used" integer, "p_duration_ms" integer, "p_handler_facts" "jsonb", "p_graph" "jsonb", "p_brief_text" "text", "p_pending_actions" "jsonb", "p_coaching_state" "jsonb", "p_user_message" "text", "p_assistant_message" "text", "p_agent_guidance" "jsonb", "p_suggested_actions" "jsonb", "p_suggested_actions_run_key" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
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

  IF p_suggested_actions IS NOT NULL THEN
    RETURN public.append_agent_answer_with_offers(
      p_scenario_id, p_turn_id, p_turn_class, p_handler_id, p_request_hash,
      p_response_emitted, p_llm_calls_used, p_duration_ms, p_handler_facts,
      p_graph, p_brief_text, p_pending_actions, p_coaching_state,
      p_user_message, p_assistant_message, p_agent_guidance,
      p_suggested_actions, p_suggested_actions_run_key
    );
  ELSIF p_agent_guidance IS NOT NULL THEN
    RETURN public.append_agent_answer_with_guidance(
      p_scenario_id, p_turn_id, p_turn_class, p_handler_id, p_request_hash,
      p_response_emitted, p_llm_calls_used, p_duration_ms, p_handler_facts,
      p_graph, p_brief_text, p_pending_actions, p_coaching_state,
      p_user_message, p_assistant_message, p_agent_guidance
    );
  ELSE
    RETURN to_jsonb(public.append_turn_atomic_v2(
      p_scenario_id, p_turn_id, p_turn_class, p_handler_id, p_request_hash,
      p_response_emitted, p_llm_calls_used, p_duration_ms, p_handler_facts,
      p_graph, p_brief_text, p_pending_actions, p_coaching_state,
      p_user_message, p_assistant_message
    ));
  END IF;
END;
$$;
ALTER FUNCTION public.append_agent_answer_if_latest(uuid,uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,jsonb,jsonb,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.append_agent_answer_if_latest(uuid,uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,jsonb,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_agent_answer_if_latest(uuid,uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,jsonb,jsonb,text) TO service_role;
