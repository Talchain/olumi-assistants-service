-- Context: S-D.1b protects held proposals and scope issues carried by a final
-- Agent answer against a latest-row change between the floor's read and append.
-- Additive: ONE new function only; existing schema, functions and grants stay intact.
-- Order-safe: deploy code first, then this migration after DL review. Missing-RPC
-- PGRST202 / 42883 falls back to the existing append path, logged once per process.
-- Residual window under READ COMMITTED: a NON-conditional writer does not take
-- this advisory lock and can insert after our check, before the delegate inserts
-- (including while the delegate waits for its scenarios row lock). Offers and
-- guidance delegates take FOR UPDATE; plain v2 takes FOR SHARE, both AFTER this
-- check. Those locks do not close the earlier window. The delegate ultimately
-- inserts through v2, whose created_at is DEFAULT NOW(), transaction-start time,
-- NOT insert/commit time. An interleaving row is not guaranteed to be older than
-- ours: earlier-started transactions can sort older, later-started ones newer,
-- and created_at ties have no tie-breaker in the existing reader. Even conditional
-- transactions can insert out of created_at order after waiting for this lock.
-- Thus "it simply becomes an older row, as if before our read" is NOT guaranteed;
-- an interleaving decline/arrival can still be lost from the newest row. Replay
-- returns the original row unchanged and does not create a new timestamp.
-- The floor also deliberately falls back unconditionally after three moved checks
-- to retain the user's answer. No database execution is claimed by this file.

CREATE FUNCTION public.append_agent_answer_if_latest(
  p_expected_latest_row_id UUID,
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
  v_latest UUID;
BEGIN
  -- This entry has no graph/fence/version authority. The existing wrappers
  -- retain their own metadata validation and replay/conflict semantics.
  IF p_turn_class IS DISTINCT FROM 'direct_answer' OR p_handler_id IS NOT NULL
    OR p_request_hash IS NULL OR p_request_hash NOT LIKE 'agent_turn:%'
    OR p_turn_id IS NULL OR p_turn_id LIKE '%:claim'
    OR p_response_emitted IS DISTINCT FROM TRUE OR p_graph IS NOT NULL
    OR p_brief_text IS NOT NULL OR p_coaching_state IS NOT NULL THEN
    RAISE EXCEPTION 'conditional append requires a final non-graph Agent answer';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_scenario_id::text, 0));
  -- Exactly readMostRecentPendingActions: all non-claim rows, even rows with
  -- empty actions or non-Agent hashes. Do not add a filter or tie-breaker.
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
    -- Only convert the UUID to its JSON string representation; no new receipt.
    RETURN to_jsonb(public.append_turn_atomic_v2(
      p_scenario_id, p_turn_id, p_turn_class, p_handler_id, p_request_hash,
      p_response_emitted, p_llm_calls_used, p_duration_ms, p_handler_facts,
      p_graph, p_brief_text, p_pending_actions, p_coaching_state,
      p_user_message, p_assistant_message
    ));
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.append_agent_answer_if_latest(
  uuid, uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb, jsonb, text, text, jsonb, jsonb, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_agent_answer_if_latest(
  uuid, uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb, jsonb, text, text, jsonb, jsonb, text
) TO service_role;
NOTIFY pgrst, 'reload schema';
