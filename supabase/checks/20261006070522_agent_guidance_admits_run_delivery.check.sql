-- PRE/POST CHECK for 20261006070522_agent_guidance_admits_run_delivery.sql (CEE #2657).
-- Not a migration. Run it as ONE statement, BEFORE and AFTER applying the migration.
--
-- It ALWAYS ends in an exception, so everything it writes (one throwaway guest scenario, its answer rows
-- and one run_delivery fact) rolls back, whatever the client's transaction handling. Read the verdict from
-- the error text:
--   CHECK PASS pre  | …  live = 20261004142707 body; '[]' appends; a run_delivery fact is refused
--   CHECK PASS post | …  live = 20261006070522 body; '[]' appends; ONE run_delivery fact appends with its fact row
--   CHECK FAIL …         anything else (including a live body that is neither repo version): stop and look.
-- Both modes also assert: one overload, the 16-arg signature, RETURNS jsonb, SECURITY INVOKER, the
-- search_path, EXECUTE for service_role only, and that every other p_handler_facts still raises.
DO $check$
DECLARE
  c_old_md5 CONSTANT TEXT := '9800e1937c6cf9aa028f1f0fe2dd7287';  -- 20261004142707 prosrc
  c_new_md5 CONSTANT TEXT := '9bc227a08d12cc216c9365f668fb6709';  -- 20261006070522 prosrc
  c_refusal CONSTANT TEXT := 'guidance requires a final non-graph Agent answer';
  c_guidance CONSTANT JSONB := '{"version":1,"entries":{"RC-WIDEN":{"status":"offered","state_key_hash":"0123456789ab"}}}';
  c_delivery CONSTANT JSONB := '{"handler_id":"run_delivery","action_type":"run_delivery","noop":false,"payload":{"fact_type":"run_delivery","fact_version":1,"result":{"run_id":"run_check"}}}';
  v_oid OID;
  v_n INTEGER;
  v_mode TEXT;
  v_sid UUID := gen_random_uuid();
  v_fail TEXT := '';
  v_out TEXT := '';
  v_res JSONB;
  v_err TEXT;
  v_case RECORD;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'append_agent_answer_with_guidance';
  IF v_n <> 1 THEN RAISE EXCEPTION 'CHECK FAIL: % overloads of public.append_agent_answer_with_guidance', v_n; END IF;
  SELECT p.oid INTO v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'append_agent_answer_with_guidance';

  -- Signature, return type, security, search_path and privileges are the same before and after.
  IF (SELECT array_to_string(p.proargtypes::oid[]::regtype[], ',') FROM pg_proc p WHERE p.oid = v_oid)
     IS DISTINCT FROM 'uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,jsonb' THEN
    v_fail := v_fail || ' signature;';
  END IF;
  IF (SELECT p.prorettype FROM pg_proc p WHERE p.oid = v_oid) IS DISTINCT FROM 'jsonb'::regtype THEN v_fail := v_fail || ' returns;'; END IF;
  IF (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_oid) THEN v_fail := v_fail || ' security_definer;'; END IF;
  IF (SELECT p.proconfig FROM pg_proc p WHERE p.oid = v_oid) IS DISTINCT FROM ARRAY['search_path=pg_catalog, public'] THEN
    v_fail := v_fail || ' search_path;';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    v_fail := v_fail || ' privileges;';
  END IF;

  v_mode := CASE (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = v_oid)
    WHEN c_old_md5 THEN 'pre' WHEN c_new_md5 THEN 'post' ELSE NULL END;
  IF v_mode IS NULL THEN
    RAISE EXCEPTION 'CHECK FAIL: live body md5 % is neither repo version (pre % / post %) — look before applying',
      (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = v_oid), c_old_md5, c_new_md5;
  END IF;

  PERFORM public.ensure_scenario_exists(v_sid, NULL);

  FOR v_case IN SELECT * FROM (VALUES
    -- name, p_handler_facts, admitted pre, admitted post
    ('empty',            '[]'::jsonb,                                                                TRUE,  TRUE),
    ('run_delivery',     jsonb_build_array(c_delivery),                                              FALSE, TRUE),
    ('run_analysis',     jsonb_build_array(c_delivery || '{"handler_id":"run_analysis","action_type":"run_analysis","payload":{"fact_type":"run_analysis"}}'), FALSE, FALSE),
    ('two_deliveries',   jsonb_build_array(c_delivery, c_delivery),                                  FALSE, FALSE),
    ('null',             NULL::jsonb,                                                                FALSE, FALSE),
    ('bare_object',      c_delivery,                                                                 FALSE, FALSE),
    ('string_element',   '["run_delivery"]'::jsonb,                                                  FALSE, FALSE),
    ('action_mismatch',  jsonb_build_array(c_delivery || '{"action_type":"run_analysis"}'),          FALSE, FALSE),
    ('payload_mismatch', jsonb_build_array(c_delivery || '{"payload":{"fact_type":"run_analysis"}}'), FALSE, FALSE),
    ('payload_string',   jsonb_build_array(c_delivery || '{"payload":"run_delivery"}'),              FALSE, FALSE)
  ) AS t(name, facts, pre_ok, post_ok) LOOP
    v_err := NULL;
    BEGIN
      v_res := public.append_agent_answer_with_guidance(
        v_sid, 'check-' || v_case.name, 'direct_answer', NULL, 'agent_turn:check-' || v_case.name, TRUE, 0, 0,
        v_case.facts, NULL, NULL, '[]'::jsonb, NULL, 'check', 'check', c_guidance);
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
    END;
    IF (CASE v_mode WHEN 'pre' THEN v_case.pre_ok ELSE v_case.post_ok END) THEN
      IF v_err IS NOT NULL THEN
        v_fail := v_fail || format(' %s raised (%s);', v_case.name, v_err);
      ELSE
        -- The answer row carries the guidance, and exactly the facts it was given.
        SELECT count(*) INTO v_n FROM public.v5_conversation_turns t
          WHERE t.id = (v_res->>'id')::uuid AND t.agent_guidance = c_guidance;
        IF v_n <> 1 THEN v_fail := v_fail || format(' %s row without guidance;', v_case.name); END IF;
        SELECT count(*) INTO v_n FROM public.v5_handler_facts f
          WHERE f.v5_conversation_turn_id = (v_res->>'id')::uuid
            AND f.handler_id = 'run_delivery' AND f.action_type = 'run_delivery'
            AND f.payload->>'fact_type' = 'run_delivery' AND f.payload->'result'->>'run_id' = 'run_check';
        IF v_n <> jsonb_array_length(v_case.facts) THEN
          v_fail := v_fail || format(' %s wrote %s delivery facts;', v_case.name, v_n);
        END IF;
        v_out := v_out || format(' %s=appended', v_case.name);
      END IF;
    ELSE
      IF v_err IS DISTINCT FROM c_refusal THEN
        v_fail := v_fail || format(' %s not refused (%s);', v_case.name, coalesce(v_err, 'appended'));
      ELSE
        v_out := v_out || format(' %s=refused', v_case.name);
      END IF;
    END IF;
  END LOOP;

  IF v_fail <> '' THEN RAISE EXCEPTION 'CHECK FAIL % |%', v_mode, v_fail; END IF;
  RAISE EXCEPTION 'CHECK PASS % |%', v_mode, v_out;
END;
$check$;
