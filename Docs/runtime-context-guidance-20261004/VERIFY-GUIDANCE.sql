-- DL runs AFTER applying the migration and BEFORE merging/serving the CEE build.
-- Read/write assertions are transaction-local; ROLLBACK leaves the real scenario unchanged.
BEGIN;
SET LOCAL ROLE service_role;
DO $$
DECLARE
  sid UUID := 'a4dc8a3d-3e42-42aa-9505-1fdf44ce2587';
  tid TEXT := 'context-guidance-verify-' || gen_random_uuid()::text;
  receipt JSONB;
  first_id UUID;
  original JSONB := '{"version":1,"entries":{"RC-WIDEN":{"status":"offered","state_key_hash":"012345abcdef"}}}';
  changed JSONB := '{"version":1,"entries":{"RC-WIDEN":{"status":"pressed","state_key_hash":"012345abcdef"}}}';
BEGIN
  IF has_function_privilege('anon',
    'public.append_agent_answer_with_guidance(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,jsonb)', 'EXECUTE')
    OR has_function_privilege('authenticated',
    'public.append_agent_answer_with_guidance(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'guidance RPC has public execution privilege';
  END IF;
  receipt := public.append_agent_answer_with_guidance(sid,tid,'direct_answer',NULL,
    'agent_turn:verify',TRUE,0,1,'[]',NULL,NULL,'[]',NULL,'verify','first answer',original);
  first_id := (receipt->>'id')::uuid;
  IF receipt->'replayed_prior_turn' <> 'false'::jsonb OR receipt->'prior_turn_conflict' <> 'false'::jsonb THEN
    RAISE EXCEPTION 'new answer receipt invalid';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.v5_conversation_turns WHERE id=first_id
    AND scenario_id=sid AND assistant_message='first answer' AND agent_guidance=original) THEN
    RAISE EXCEPTION 'answer and metadata did not commit together';
  END IF;
  receipt := public.append_agent_answer_with_guidance(sid,tid,'direct_answer',NULL,
    'agent_turn:verify',TRUE,0,1,'[]',NULL,NULL,'[]',NULL,'verify','changed answer',changed);
  IF receipt->'replayed_prior_turn' <> 'true'::jsonb THEN RAISE EXCEPTION 'same-request retry not marked'; END IF;
  receipt := public.append_agent_answer_with_guidance(sid,tid,'direct_answer',NULL,
    'agent_turn:different',TRUE,0,1,'[]',NULL,NULL,'[]',NULL,'different','changed answer',changed);
  IF receipt->'prior_turn_conflict' <> 'true'::jsonb THEN RAISE EXCEPTION 'different request not refused'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.v5_conversation_turns WHERE id=first_id
    AND assistant_message='first answer' AND agent_guidance=original) THEN
    RAISE EXCEPTION 'retry replaced first answer or events';
  END IF;
  BEGIN
    PERFORM public.append_agent_answer_with_guidance(sid,tid||'-invalid','direct_answer',NULL,
      'agent_turn:verify',TRUE,0,1,'[]',NULL,NULL,'[]',NULL,'verify','invalid',
      '{"version":1,"entries":{"RC-WIDEN":{"status":"offered","state_key_hash":"012345abcdef","copy":"private words"}}}');
    RAISE EXCEPTION 'malformed metadata accepted' USING ERRCODE='XX000';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.v5_conversation_turns WHERE scenario_id=sid AND turn_id=tid||'-invalid') THEN
    RAISE EXCEPTION 'malformed metadata left a partial answer';
  END IF;
END;
$$;
ROLLBACK;
