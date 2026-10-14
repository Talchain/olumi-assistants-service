-- ============================================================================
-- D5 route B: the AI's construction questions, committed WITH the answer that asked them
-- (repo path when PR'd: supabase/migrations/20261014120000_d5_construction_questions_event.sql)
-- Round 2 (14 Oct 08:3xZ), after Codex CHECK-D5-B (FAIL, 2 blockers): ONE function, no separately callable helper.
--
-- ⚠ AUTHORED, NOT APPLIED. The shared Supabase (etmmuzwxtcjipwphdola) is shared with production:
--   applying this is Paul's call (CLAUDE.md §7.6). Read-only facts below were measured 14 Oct 2026 07:55–08:25Z.
-- ⚠ APPLY AS ONE TRANSACTION (the Supabase migration runner / apply_migration does; by hand use
--   `psql --single-transaction`), so the function is never executable by anon/authenticated between
--   CREATE (Supabase default privileges auto-grant EXECUTE) and the REVOKE below.
--
-- THE CONTRACT: while this function and the CEE writer are both deployed, a construction answer and its
--   record commit together or not at all.
--   · There is no other writer of `construction_questions` events: the ONLY function this migration adds
--     appends one, and only after it has itself written the answer row in the same call (re-checked by
--     id, scenario, turn and request hash before the append). No orphan record can be written.
--   · Any failure (malformed record, 42501, answer row absent) raises, and the transaction rolls back
--     the answer with it.
--   · No size or count cap: the record is a subset of the drafter's own output, which the provider
--     already bounds (max_output_tokens 12,000 on every one of 807 drafter calls in 10 days; largest raw
--     output 11,265 bytes). Shape is checked; no D5 size cap or omission; any storage failure rolls back
--     both the answer and the record.
--
-- WHAT: ONE new, distinctly named function, append_agent_answer_with_construction_questions(...),
--   SECURITY INVOKER (as every live answer wrapper: narrated, offers, guidance, if_latest are all
--   prosecdef=false), EXECUTE for service_role only. It delegates the answer to the EXISTING writers,
--   byte-for-byte unchanged, exactly as CEE's dispatch picks them today (supabase-store.ts:753-787
--   conditional, :857-878 unconditional), then appends the event inline under the locks it already holds.
--   service_role (live): UPDATE on scenarios incl. events/event_seq, BYPASSRLS, EXECUTE on every delegate.
--
-- WHAT IT DOES NOT TOUCH: no table, column, constraint, policy, trigger or existing function/grant.
--   `append_agent_answer_with_guidance` (live md5 fbc87d7d…, its 0.79 handler-facts guard) is NOT amended:
--   the record never rides in p_handler_facts, which stays '[]'. No v5_handler_facts row, so no
--   20-turn window at any CEE pin counts it. No new store: the existing `scenarios.events` ledger.
--
-- WHY THE EXISTING EVENT WRITERS CANNOT BE REUSED (live bodies read 14 Oct):
--   · append_scenario_event (md5 11729bdf…): `WHERE id = p_scenario_id AND user_id = auth.uid()` →
--     refuses every service-role call (auth.uid() NULL) and every guest row (user_id NULL).
--   · create_model_version / _cas_v1 (md5 b6eb0ce5… / 2efc0176…): raise MV001 on a guest row.
--     16,180 of 20,869 scenarios are guest rows; the served journey witnesses run as guests.
--
-- PERMISSION (the EXISTING contract, repeated under the row lock — defence in depth, not a new rule):
--   CEE admits a write with scenarioAccessDecision(owner, verified caller) (scenario-access.ts:15-25;
--   persist floor door-ownership.ts:112): a guest row (owner NULL) is open; an owned row needs the SAME
--   verified user; a scenario member is a VIEWER (scenario_access() returns 'viewer'; only POST
--   /assist/v1/scenarios/:id/graph admits a member, scenario-ownership.ts:59-62, :187-192) and never writes.
--   CEE passes p_caller_user_id = readVerifiedWriteCaller() (door-ownership.ts:68), the identity the
--   floor already used. A mismatch (e.g. the guest row was claimed mid-turn) raises 42501 and the whole
--   transaction — answer included — rolls back; CEE maps 42501 to its existing ModelWriteOwnershipRefused.
--
-- CONCURRENCY (live, 14 Oct):
--   · Lock order = advisory(hashtextextended(scenario_id::text,0)) → scenarios row FOR UPDATE, the order
--     append_agent_answer_if_latest[_narrated] already use. Those two are the only holders of that
--     advisory key (pg_proc scan); every other scenarios writer takes the row lock only → no cycle.
--   · All 10 live functions that write `events` append (`COALESCE(events,'[]') || …`) under the row
--     lock; 5 UI *_and_log RPCs go through append_scenario_event. No UI path writes `events` wholesale;
--     no UI CAS on updated_at/revision/event_seq (0 hits in DGAI production bed21070, staging 341bec5c
--     and main 7b5992fc).
--   · scenarios_bump_revision (live) bumps `revision` only for graph/brief_text/framing/stage/
--     current_model_version_id → this append never moves `revision`, so no revision-CAS writer
--     (v4r, v6, create_model_version_cas_v1) sees a conflict from it.
--
-- NO FALLBACK: the CEE writer PR merges only after this is applied, and treats PGRST202/42883 from this
--   RPC as a failed answer write (today's `not_recorded` path), never as "save the answer without it".
-- ROLLBACK ORDER: revert the CEE writer FIRST, then D5-B-ROLLBACK.sql.
-- ============================================================================

-- Preconditions: every delegate exists with the exact signature it is called with. Fail fast, create nothing.
DO $pre$
BEGIN
  IF to_regprocedure('public.append_agent_answer_if_latest(uuid,uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,jsonb,jsonb,text)') IS NULL
     OR to_regprocedure('public.append_agent_answer_if_latest_narrated(uuid,uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,jsonb,jsonb,text,jsonb)') IS NULL
     OR to_regprocedure('public.append_agent_answer_narrated(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,jsonb,jsonb,text,jsonb)') IS NULL
     OR to_regprocedure('public.append_agent_answer_with_offers(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,jsonb,jsonb,text)') IS NULL
     OR to_regprocedure('public.append_agent_answer_with_guidance(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,jsonb)') IS NULL
     OR to_regprocedure('public.append_turn_atomic_v2(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text)') IS NULL THEN
    RAISE EXCEPTION 'D5-B: an answer-writer delegate is missing; nothing was created';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'scenarios' AND column_name = 'events')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'scenarios' AND column_name = 'event_seq') THEN
    RAISE EXCEPTION 'D5-B: scenarios.events / event_seq missing; nothing was created';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public'
               AND p.proname IN ('append_construction_questions_event', 'append_agent_answer_with_construction_questions')) THEN
    RAISE EXCEPTION 'D5-B: a function with one of these names already exists; nothing was created';
  END IF;
END
$pre$;

CREATE FUNCTION public.append_agent_answer_with_construction_questions(
  p_scenario_id UUID, p_turn_id TEXT, p_turn_class TEXT, p_handler_id TEXT,
  p_request_hash TEXT, p_response_emitted BOOLEAN, p_llm_calls_used INTEGER,
  p_duration_ms INTEGER, p_handler_facts JSONB, p_graph JSONB,
  p_brief_text TEXT, p_pending_actions JSONB, p_coaching_state JSONB,
  p_user_message TEXT, p_assistant_message TEXT, p_agent_guidance JSONB,
  p_suggested_actions JSONB, p_suggested_actions_run_key TEXT, p_run_narration JSONB,
  p_conditional BOOLEAN, p_expected_latest_row_id UUID,
  p_caller_user_id UUID, p_construction_questions JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uuid          CONSTANT TEXT := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_event_id      TEXT;
  v_existing      UUID;
  v_existing_hash TEXT;
  v_receipt       JSONB;
  v_owner         UUID;
  v_events        JSONB;
  v_seq           INTEGER;
  v_event         JSONB;
  v_q             JSONB;
  v_i             BIGINT;
  v_c             JSONB;
BEGIN
  -- 1. The narrated wrapper's guard, verbatim: only a visible final Agent answer.
  IF p_turn_class IS DISTINCT FROM 'direct_answer' OR p_handler_id IS NOT NULL
    OR p_request_hash IS NULL OR p_request_hash NOT LIKE 'agent_turn:%'
    OR p_turn_id IS NULL OR p_turn_id LIKE '%:claim'
    OR p_response_emitted IS DISTINCT FROM TRUE OR p_graph IS NOT NULL
    OR p_brief_text IS NOT NULL OR p_coaching_state IS NOT NULL THEN
    RAISE EXCEPTION 'construction questions require a final non-graph Agent answer';
  END IF;
  IF p_conditional IS NULL THEN
    RAISE EXCEPTION 'construction questions append: p_conditional is required' USING ERRCODE = '22023';
  END IF;
  -- One record per answer row: its id is DERIVED from the answer's turn id, never chosen by the caller.
  v_event_id := 'construction_questions_' || p_turn_id;

  -- 2. The record's SHAPE, checked before anything is written. No size or count cap (see header).
  --    {schema, operation_id?, model_version_id?, questions[]}; no `target_id`/`label`/`summary` keys, so no
  --    UI surface lifts text out of it (renderTimeline reads details.target_id). CASE/COALESCE fix the
  --    evaluation order and map every NULL to FALSE.
  IF NOT COALESCE(CASE WHEN jsonb_typeof(p_construction_questions) = 'object' THEN
       (p_construction_questions - 'schema' - 'operation_id' - 'model_version_id' - 'questions') = '{}'::jsonb
       AND p_construction_questions->'schema' = '"construction_questions.v1"'::jsonb
       AND (NOT (p_construction_questions ? 'operation_id') OR p_construction_questions->'operation_id' = 'null'::jsonb
            OR (jsonb_typeof(p_construction_questions->'operation_id') = 'string'
                AND (p_construction_questions->>'operation_id') ~ v_uuid))
       AND (NOT (p_construction_questions ? 'model_version_id') OR p_construction_questions->'model_version_id' = 'null'::jsonb
            OR (jsonb_typeof(p_construction_questions->'model_version_id') = 'string'
                AND (p_construction_questions->>'model_version_id') ~ v_uuid))
       AND jsonb_typeof(p_construction_questions->'questions') = 'array'
     ELSE FALSE END, FALSE) THEN
    RAISE EXCEPTION 'construction questions append: invalid record envelope' USING ERRCODE = '22023';
  END IF;
  FOR v_q, v_i IN SELECT value, ordinality FROM jsonb_array_elements(p_construction_questions->'questions') WITH ORDINALITY LOOP
    -- Each question: verbatim text, its source, its status, what it is about. Ids q1..qN in asked order.
    IF NOT COALESCE(CASE WHEN jsonb_typeof(v_q) = 'object' THEN
         (v_q - 'id' - 'text' - 'source' - 'status' - 'concerns') = '{}'::jsonb
         AND v_q->'id' = to_jsonb('q' || v_i::text)
         AND jsonb_typeof(v_q->'text') = 'string'
         AND (v_q->>'text') ~ '[^[:space:]]'
         AND v_q->'source' = '"ai_constructor"'::jsonb
         AND v_q->'status' = '"unresolved"'::jsonb
         AND jsonb_typeof(v_q->'concerns') = 'array'
       ELSE FALSE END, FALSE) THEN
      RAISE EXCEPTION 'construction questions append: invalid question %', v_i USING ERRCODE = '22023';
    END IF;
    FOR v_c IN SELECT value FROM jsonb_array_elements(v_q->'concerns') LOOP
      -- A concern: the drafter's exact label, bound to ONE node, or to one directed link, or unbound (label only).
      IF NOT COALESCE(CASE WHEN jsonb_typeof(v_c) = 'object' THEN
           (v_c - 'label' - 'node_id' - 'from_id' - 'to_id') = '{}'::jsonb
           AND jsonb_typeof(v_c->'label') = 'string' AND (v_c->>'label') ~ '[^[:space:]]'
           AND (NOT (v_c ? 'node_id') OR (jsonb_typeof(v_c->'node_id') = 'string' AND (v_c->>'node_id') <> ''))
           AND (NOT (v_c ? 'from_id') OR (jsonb_typeof(v_c->'from_id') = 'string' AND (v_c->>'from_id') <> ''))
           AND (NOT (v_c ? 'to_id')   OR (jsonb_typeof(v_c->'to_id')   = 'string' AND (v_c->>'to_id')   <> ''))
           AND (v_c ? 'from_id') = (v_c ? 'to_id')
           AND NOT ((v_c ? 'node_id') AND (v_c ? 'from_id'))
         ELSE FALSE END, FALSE) THEN
        RAISE EXCEPTION 'construction questions append: invalid concern on question %', v_i USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END LOOP;

  -- 3. Locks, in append_agent_answer_if_latest[_narrated]'s order: advisory, then the row (both re-entrant below).
  PERFORM pg_advisory_xact_lock(hashtextextended(p_scenario_id::text, 0));
  SELECT user_id INTO v_owner FROM public.scenarios WHERE id = p_scenario_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'scenario % not found', p_scenario_id; END IF;

  -- 4. The existing contract: guest row open; owned row only for the same verified caller; members never write.
  --    Checked before the answer is written, so a refusal writes neither.
  IF v_owner IS NOT NULL AND v_owner IS DISTINCT FROM p_caller_user_id THEN
    RAISE EXCEPTION 'construction questions append: caller may not write scenario %', p_scenario_id
      USING ERRCODE = '42501';
  END IF;

  SELECT id, request_hash INTO v_existing, v_existing_hash FROM public.v5_conversation_turns
    WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id;

  -- 5. The answer, through the existing writers, unchanged, chosen exactly as the CEE store chooses them today.
  IF p_conditional THEN
    IF p_run_narration IS NOT NULL THEN
      v_receipt := public.append_agent_answer_if_latest_narrated(
        p_expected_latest_row_id,
        p_scenario_id, p_turn_id, p_turn_class, p_handler_id, p_request_hash,
        p_response_emitted, p_llm_calls_used, p_duration_ms, p_handler_facts,
        p_graph, p_brief_text, p_pending_actions, p_coaching_state,
        p_user_message, p_assistant_message, p_agent_guidance,
        p_suggested_actions, p_suggested_actions_run_key, p_run_narration);
    ELSE
      v_receipt := public.append_agent_answer_if_latest(
        p_expected_latest_row_id,
        p_scenario_id, p_turn_id, p_turn_class, p_handler_id, p_request_hash,
        p_response_emitted, p_llm_calls_used, p_duration_ms, p_handler_facts,
        p_graph, p_brief_text, p_pending_actions, p_coaching_state,
        p_user_message, p_assistant_message, p_agent_guidance,
        p_suggested_actions, p_suggested_actions_run_key);
    END IF;
    -- Nothing was written: no record either. The store re-reads and retries, as today.
    IF jsonb_typeof(v_receipt) = 'object' AND v_receipt->>'status' = 'latest_moved' THEN
      RETURN v_receipt;
    END IF;
  ELSIF p_run_narration IS NOT NULL THEN
    v_receipt := public.append_agent_answer_narrated(
      p_scenario_id, p_turn_id, p_turn_class, p_handler_id, p_request_hash,
      p_response_emitted, p_llm_calls_used, p_duration_ms, p_handler_facts,
      p_graph, p_brief_text, p_pending_actions, p_coaching_state,
      p_user_message, p_assistant_message, p_agent_guidance,
      p_suggested_actions, p_suggested_actions_run_key, p_run_narration);
  ELSIF p_suggested_actions IS NOT NULL THEN
    v_receipt := public.append_agent_answer_with_offers(
      p_scenario_id, p_turn_id, p_turn_class, p_handler_id, p_request_hash,
      p_response_emitted, p_llm_calls_used, p_duration_ms, p_handler_facts,
      p_graph, p_brief_text, p_pending_actions, p_coaching_state,
      p_user_message, p_assistant_message, p_agent_guidance,
      p_suggested_actions, p_suggested_actions_run_key);
  ELSIF p_agent_guidance IS NOT NULL THEN
    v_receipt := public.append_agent_answer_with_guidance(
      p_scenario_id, p_turn_id, p_turn_class, p_handler_id, p_request_hash,
      p_response_emitted, p_llm_calls_used, p_duration_ms, p_handler_facts,
      p_graph, p_brief_text, p_pending_actions, p_coaching_state,
      p_user_message, p_assistant_message, p_agent_guidance);
  ELSE
    v_receipt := to_jsonb(public.append_turn_atomic_v2(
      p_scenario_id, p_turn_id, p_turn_class, p_handler_id, p_request_hash,
      p_response_emitted, p_llm_calls_used, p_duration_ms, p_handler_facts,
      p_graph, p_brief_text, p_pending_actions, p_coaching_state,
      p_user_message, p_assistant_message));
  END IF;

  -- The plain v2 path returns the row id alone; give it the same receipt the wrappers return.
  IF jsonb_typeof(v_receipt) = 'string' THEN
    v_receipt := jsonb_build_object('id', v_receipt #>> '{}',
      'replayed_prior_turn', v_existing IS NOT NULL AND v_existing_hash IS NOT DISTINCT FROM p_request_hash,
      'prior_turn_conflict', v_existing IS NOT NULL AND v_existing_hash IS DISTINCT FROM p_request_hash);
  END IF;

  -- 6. Only the call that WROTE the answer row writes its record; a replay or a conflicting resend never does.
  IF v_existing IS NOT NULL THEN
    RETURN v_receipt || jsonb_build_object('construction_event_id', NULL);
  END IF;

  -- The answer row this call wrote must be present, by identity, before its record is appended.
  PERFORM 1 FROM public.v5_conversation_turns
    WHERE id = (v_receipt->>'id')::uuid AND scenario_id = p_scenario_id
      AND turn_id = p_turn_id AND request_hash = p_request_hash;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'construction questions append: answer row % not found; nothing is kept', v_receipt->>'id';
  END IF;

  -- 7. The record, inline, under the row lock held since step 3. Same event shape as append_scenario_event.
  SELECT events, event_seq INTO v_events, v_seq FROM public.scenarios WHERE id = p_scenario_id;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(v_events, '[]'::jsonb)) AS e
             WHERE e->>'event_id' = v_event_id) THEN
    -- Unreachable while this is the only writer of the type (the answer row was new); never a duplicate.
    RAISE EXCEPTION 'construction questions append: record % already exists for a new answer row', v_event_id;
  END IF;
  v_seq := COALESCE(v_seq, 0) + 1;
  v_event := jsonb_build_object(
    'event_id',   v_event_id,
    'event_type', 'construction_questions',
    'seq',        v_seq,
    'timestamp',  to_jsonb(now()),
    'details',    p_construction_questions,
    'turn_id',    p_turn_id
  );
  UPDATE public.scenarios
     SET events     = COALESCE(events, '[]'::jsonb) || jsonb_build_array(v_event),
         event_seq  = v_seq,
         updated_at = now()
   WHERE id = p_scenario_id;
  RETURN v_receipt || jsonb_build_object('construction_event_id', v_event_id, 'construction_event_seq', v_seq);
END;
$$;
REVOKE ALL ON FUNCTION public.append_agent_answer_with_construction_questions(
  uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb, jsonb, text, text,
  jsonb, jsonb, text, jsonb, boolean, uuid, uuid, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_agent_answer_with_construction_questions(
  uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb, jsonb, text, text,
  jsonb, jsonb, text, jsonb, boolean, uuid, uuid, jsonb
) TO service_role;
COMMENT ON FUNCTION public.append_agent_answer_with_construction_questions(
  uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb, jsonb, text, text,
  jsonb, jsonb, text, jsonb, boolean, uuid, uuid, jsonb
) IS 'D5: the final Agent answer (existing writers, unchanged) and its construction_questions event, together or not at all. The only writer of that event type. Service role only.';

-- Postconditions: exactly one D5 function, and its grants are exactly as stated, or the migration fails.
DO $post$
DECLARE
  v_answer CONSTANT TEXT := 'public.append_agent_answer_with_construction_questions(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,jsonb,jsonb,text,jsonb,boolean,uuid,uuid,jsonb)';
BEGIN
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('append_construction_questions_event', 'append_agent_answer_with_construction_questions')) <> 1 THEN
    RAISE EXCEPTION 'D5-B: expected exactly one D5 function';
  END IF;
  IF has_function_privilege('anon', v_answer, 'EXECUTE') OR has_function_privilege('authenticated', v_answer, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_answer, 'EXECUTE') THEN
    RAISE EXCEPTION 'D5-B: grants are not service_role-only';
  END IF;
END
$post$;

NOTIFY pgrst, 'reload schema';
