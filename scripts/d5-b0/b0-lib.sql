-- B0 test helpers (schema b0). Disposable Postgres only. Loaded AFTER recorded-delegates.sql.
-- All helpers are SECURITY INVOKER: a call made as service_role reaches D5 as service_role.
-- plpgsql bodies are not resolved at CREATE, so this loads before the migration exists.

CREATE SCHEMA b0;
GRANT USAGE ON SCHEMA b0 TO PUBLIC;  -- so a role with no grants reaches D5's own EXECUTE check

-- Fixed identities (auth.users rows exist so claim_guest_scenario accepts them).
INSERT INTO auth.users (id) VALUES
  ('11111111-1111-4111-8111-111111111111'),  -- U1: owner
  ('22222222-2222-4222-8222-222222222222'),  -- U2: another signed-in user
  ('33333333-3333-4333-8333-333333333333');  -- UM: a viewer member

-- A fresh scenario; p_owner NULL = guest row.
CREATE FUNCTION b0.mk(p_owner uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid;
BEGIN
  INSERT INTO public.scenarios (user_id, title) VALUES (p_owner, 'b0') RETURNING id INTO v;
  RETURN v;
END $$;

-- A valid record with n questions (ids q1..qn in order), each with a node-, link- and label-only concern.
-- p_pad adds that many characters to every question's text (boundary sizes).
CREATE FUNCTION b0.rec(p_n int, p_pad int DEFAULT 0, p_op text DEFAULT NULL, p_mv text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'schema', 'construction_questions.v1',
    'operation_id', p_op,
    'model_version_id', p_mv,
    'questions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', 'q' || i,
        'text', 'Does Support or Sales own onboarding (question ' || i || ')?'
                || CASE WHEN p_pad > 0 THEN ' ' || repeat('w', p_pad) ELSE '' END,
        'source', 'ai_constructor',
        'status', 'unresolved',
        'concerns', jsonb_build_array(
          jsonb_build_object('label', 'Support capacity', 'node_id', 'fac_support_' || i),
          jsonb_build_object('label', 'Support capacity → Churn', 'from_id', 'fac_support_' || i, 'to_id', 'out_churn'),
          jsonb_build_object('label', 'Sales view (unbound)'))
      ) ORDER BY i)
      FROM generate_series(1, p_n) AS i), '[]'::jsonb))
$$;

-- Verbatim-text record: quotes, apostrophes, dashes, arrows, emoji, newlines, backslashes.
CREATE FUNCTION b0.rec_unicode() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'schema', 'construction_questions.v1',
    'questions', jsonb_build_array(jsonb_build_object(
      'id', 'q1',
      'text', E'Ana (Support) says “we can’t absorb it” — Bo (Sales) disagrees. Who owns onboarding? \U0001F6A6\nSecond line with a backslash \\ and a tab\there.',
      'source', 'ai_constructor', 'status', 'unresolved',
      'concerns', jsonb_build_array(
        jsonb_build_object('label', E'Support → Sales', 'from_id', 'fac_support', 'to_id', 'fac_sales'),
        jsonb_build_object('label', E'Ana’s capacity', 'node_id', 'fac_support')))))
$$;

-- Malformed records, by name. Unknown names raise (a harness typo must not pass as "rejected").
CREATE FUNCTION b0.bad(k text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  r jsonb := b0.rec(2);
  q jsonb := b0.rec(2)->'questions'->0;
  known text[] := ARRAY['sql_null','json_null','array','string','no_schema','wrong_schema','top_target_id','top_label',
    'top_summary','op_not_uuid','op_free_text','op_number','mv_not_uuid','no_questions','questions_object',
    'q_not_object','q_source_x','q_status_resolved','q_ids_q2_q1','q_id_q0','q_id_number','q_text_empty','q_text_blank',
    'q_text_number','q_target_id','q_no_concerns','q_concerns_object','c_from_without_to','c_to_without_from',
    'c_node_and_link','c_empty_node_id','c_no_label','c_blank_label','c_extra_key','c_string','c_node_id_number'];
BEGIN
  IF NOT (k = ANY (known)) THEN RAISE EXCEPTION 'b0.bad: unknown kind %', k; END IF;
  RETURN CASE k
    WHEN 'sql_null' THEN NULL
    WHEN 'json_null' THEN 'null'::jsonb
    WHEN 'array' THEN '[]'::jsonb
    WHEN 'string' THEN '"construction_questions.v1"'::jsonb
    WHEN 'no_schema' THEN r - 'schema'
    WHEN 'wrong_schema' THEN jsonb_set(r, '{schema}', '"construction_questions.v2"')
    WHEN 'top_target_id' THEN r || '{"target_id":"fac_support_1"}'
    WHEN 'top_label' THEN r || '{"label":"Construction questions"}'
    WHEN 'top_summary' THEN r || '{"summary":"Two open questions"}'
    WHEN 'op_not_uuid' THEN jsonb_set(r, '{operation_id}', '"op-1"')
    WHEN 'op_free_text' THEN jsonb_set(r, '{operation_id}', '"not a uuid at all"')
    WHEN 'op_number' THEN jsonb_set(r, '{operation_id}', '1')
    WHEN 'mv_not_uuid' THEN jsonb_set(r, '{model_version_id}', '"v1"')
    WHEN 'no_questions' THEN r - 'questions'
    WHEN 'questions_object' THEN jsonb_set(r, '{questions}', '{}')
    WHEN 'q_not_object' THEN jsonb_set(r, '{questions}', '["Does Support own onboarding?"]')
    WHEN 'q_source_x' THEN jsonb_set(r, '{questions,0,source}', '"x"')
    WHEN 'q_status_resolved' THEN jsonb_set(r, '{questions,0,status}', '"resolved"')
    WHEN 'q_ids_q2_q1' THEN jsonb_set(jsonb_set(r, '{questions,0,id}', '"q2"'), '{questions,1,id}', '"q1"')
    WHEN 'q_id_q0' THEN jsonb_set(r, '{questions,0,id}', '"q0"')
    WHEN 'q_id_number' THEN jsonb_set(r, '{questions,0,id}', '1')
    WHEN 'q_text_empty' THEN jsonb_set(r, '{questions,0,text}', '""')
    WHEN 'q_text_blank' THEN jsonb_set(r, '{questions,0,text}', '"  \n\t  "')
    WHEN 'q_text_number' THEN jsonb_set(r, '{questions,0,text}', '7')
    WHEN 'q_target_id' THEN jsonb_set(r, '{questions,0}', q || '{"target_id":"fac_support_1"}')
    WHEN 'q_no_concerns' THEN jsonb_set(r, '{questions,0}', q - 'concerns')
    WHEN 'q_concerns_object' THEN jsonb_set(r, '{questions,0,concerns}', '{}')
    WHEN 'c_from_without_to' THEN jsonb_set(r, '{questions,0,concerns}', '[{"label":"A → B","from_id":"n_a"}]')
    WHEN 'c_to_without_from' THEN jsonb_set(r, '{questions,0,concerns}', '[{"label":"A → B","to_id":"n_b"}]')
    WHEN 'c_node_and_link' THEN jsonb_set(r, '{questions,0,concerns}', '[{"label":"A","node_id":"n_a","from_id":"n_a","to_id":"n_b"}]')
    WHEN 'c_empty_node_id' THEN jsonb_set(r, '{questions,0,concerns}', '[{"label":"A","node_id":""}]')
    WHEN 'c_no_label' THEN jsonb_set(r, '{questions,0,concerns}', '[{"node_id":"n_a"}]')
    WHEN 'c_blank_label' THEN jsonb_set(r, '{questions,0,concerns}', '[{"label":"   ","node_id":"n_a"}]')
    WHEN 'c_extra_key' THEN jsonb_set(r, '{questions,0,concerns}', '[{"label":"A","node_id":"n_a","target_id":"n_a"}]')
    WHEN 'c_string' THEN jsonb_set(r, '{questions,0,concerns}', '["A"]')
    WHEN 'c_node_id_number' THEN jsonb_set(r, '{questions,0,concerns}', '[{"label":"A","node_id":5}]')
  END;
END $$;

-- Valid wrapper payloads (each accepted by its live wrapper's own validation).
CREATE FUNCTION b0.g() RETURNS jsonb LANGUAGE sql IMMUTABLE AS
  $$ SELECT '{"version":1,"entries":{"RC-WIDEN":{"status":"offered","state_key_hash":"0123456789ab","variant_id":"W1","slot":1}}}'::jsonb $$;
CREATE FUNCTION b0.g2() RETURNS jsonb LANGUAGE sql IMMUTABLE AS
  $$ SELECT '{"version":1,"entries":{"RC-PREMORTEM":{"status":"offered","state_key_hash":"bbbbbbbbbbbb"}}}'::jsonb $$;
CREATE FUNCTION b0.o() RETURNS jsonb LANGUAGE sql IMMUTABLE AS
  $$ SELECT '[{"id":"agent-check-capacity","label":"Check capacity","message":"Check Support capacity before deciding"}]'::jsonb $$;
CREATE FUNCTION b0.n() RETURNS jsonb LANGUAGE sql IMMUTABLE AS
  $$ SELECT '{"status":"pending","run_key":"0123456789abcdef"}'::jsonb $$;

-- The D5 call with the answer fields fixed to a valid final Agent answer.
CREATE FUNCTION b0.d5(p_scenario uuid, p_turn text, p_hash text, p_record jsonb,
  p_conditional boolean DEFAULT false, p_expected uuid DEFAULT NULL, p_caller uuid DEFAULT NULL,
  p_guidance jsonb DEFAULT NULL, p_offers jsonb DEFAULT NULL, p_run_key text DEFAULT NULL,
  p_narration jsonb DEFAULT NULL, p_graph jsonb DEFAULT NULL, p_turn_class text DEFAULT 'direct_answer')
RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  RETURN public.append_agent_answer_with_construction_questions(
    p_scenario, p_turn, p_turn_class, NULL, p_hash, TRUE, 1, 1200, '[]'::jsonb, p_graph,
    NULL, '[]'::jsonb, NULL, 'b0 user message for ' || p_turn, 'b0 assistant answer for ' || p_turn,
    p_guidance, p_offers, p_run_key, p_narration, p_conditional, p_expected, p_caller, p_record);
END $$;

-- Today's RPCs, called directly (legacy writers, no record).
CREATE FUNCTION b0.legacy_guidance(p_scenario uuid, p_turn text, p_hash text, p_guidance jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  RETURN public.append_agent_answer_with_guidance(p_scenario, p_turn, 'direct_answer', NULL, p_hash, TRUE, 1, 900,
    '[]'::jsonb, NULL, NULL, '[]'::jsonb, NULL, 'legacy user ' || p_turn, 'legacy answer ' || p_turn, p_guidance);
END $$;
CREATE FUNCTION b0.legacy_if_latest(p_scenario uuid, p_turn text, p_hash text, p_expected uuid)
RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  RETURN public.append_agent_answer_if_latest(p_expected, p_scenario, p_turn, 'direct_answer', NULL, p_hash, TRUE, 1, 900,
    '[]'::jsonb, NULL, NULL, '[]'::jsonb, NULL, 'legacy user ' || p_turn, 'legacy answer ' || p_turn, NULL, NULL, NULL);
END $$;
CREATE FUNCTION b0.cas_v1(p_scenario uuid, p_expected_revision bigint)
RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  RETURN public.create_model_version_cas_v1(p_scenario, '{"nodes":[],"edges":[]}'::jsonb, repeat('a', 64),
    'proj-1', 'norm-1', 'graph-1', 'sha256', 'b0 version', 'b0', NULL, NULL, false, NULL, NULL, p_expected_revision);
END $$;

-- State summary of one scenario.
CREATE FUNCTION b0.st(p uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT format('answers=%s cq=%s events=%s seq=%s rev=%s',
    (SELECT count(*) FROM public.v5_conversation_turns t WHERE t.scenario_id = p),
    (SELECT count(*) FROM jsonb_array_elements(s.events) e WHERE e->>'event_type' = 'construction_questions'),
    jsonb_array_length(s.events), s.event_seq, s.revision)
  FROM public.scenarios s WHERE s.id = p
$$;

-- Answer row AND record, both present and bound by identity. Returns 'ok' or the first mismatch.
CREATE FUNCTION b0.verify_written(p_scenario uuid, p_turn text, p_hash text, p_record jsonb, p_receipt jsonb,
  p_seq_before int, p_rev_before bigint, p_guidance jsonb DEFAULT NULL, p_offers jsonb DEFAULT NULL,
  p_run_key text DEFAULT NULL, p_narration jsonb DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE s record; t record; e jsonb; n int; keys text;
BEGIN
  SELECT * INTO s FROM public.scenarios WHERE id = p_scenario;
  IF NOT FOUND THEN RETURN 'scenario missing'; END IF;
  SELECT * INTO t FROM public.v5_conversation_turns WHERE scenario_id = p_scenario AND turn_id = p_turn;
  IF NOT FOUND THEN RETURN 'answer row missing'; END IF;
  IF t.request_hash IS DISTINCT FROM p_hash THEN RETURN 'answer row request_hash differs'; END IF;
  IF t.user_id IS DISTINCT FROM s.user_id THEN RETURN 'answer row user_id differs from the scenario owner'; END IF;
  IF t.turn_class <> 'direct_answer' OR t.handler_id IS NOT NULL THEN RETURN 'answer row class/handler differs'; END IF;
  IF t.assistant_message IS DISTINCT FROM 'b0 assistant answer for ' || p_turn THEN RETURN 'assistant_message differs'; END IF;
  IF t.agent_guidance IS DISTINCT FROM p_guidance THEN RETURN 'agent_guidance differs: ' || coalesce(t.agent_guidance::text, 'NULL'); END IF;
  IF t.suggested_actions IS DISTINCT FROM p_offers THEN RETURN 'suggested_actions differs'; END IF;
  IF t.suggested_actions_run_key IS DISTINCT FROM (CASE WHEN p_offers IS NULL THEN NULL ELSE p_run_key END) THEN RETURN 'offers run key differs'; END IF;
  IF t.run_narration IS DISTINCT FROM p_narration THEN RETURN 'run_narration differs'; END IF;
  IF (SELECT count(*) FROM public.v5_handler_facts f WHERE f.v5_conversation_turn_id = t.id) <> 0 THEN RETURN 'handler facts were written'; END IF;
  IF p_receipt->>'id' IS DISTINCT FROM t.id::text THEN RETURN 'receipt id is not the answer row id'; END IF;
  IF p_receipt->'replayed_prior_turn' IS DISTINCT FROM 'false'::jsonb OR p_receipt->'prior_turn_conflict' IS DISTINCT FROM 'false'::jsonb THEN
    RETURN 'receipt replay/conflict flags are not both false'; END IF;
  IF p_receipt->>'construction_event_id' IS DISTINCT FROM 'construction_questions_' || p_turn THEN RETURN 'receipt construction_event_id differs'; END IF;
  IF p_receipt->'construction_event_seq' IS DISTINCT FROM to_jsonb(p_seq_before + 1) THEN RETURN 'receipt construction_event_seq differs'; END IF;
  SELECT count(*) INTO n FROM jsonb_array_elements(s.events) x WHERE x->>'event_id' = 'construction_questions_' || p_turn;
  IF n <> 1 THEN RETURN format('record count for this answer = %s', n); END IF;
  SELECT count(*) INTO n FROM jsonb_array_elements(s.events) x WHERE x->>'event_type' = 'construction_questions' AND x->>'turn_id' = p_turn;
  IF n <> 1 THEN RETURN format('records naming this turn = %s', n); END IF;
  SELECT x INTO e FROM jsonb_array_elements(s.events) x WHERE x->>'event_id' = 'construction_questions_' || p_turn;
  SELECT string_agg(k, ',' ORDER BY k COLLATE "C") INTO keys FROM jsonb_object_keys(e) k;
  IF keys IS DISTINCT FROM 'details,event_id,event_type,seq,timestamp,turn_id' THEN RETURN 'event keys differ: ' || keys; END IF;
  IF e->>'event_type' IS DISTINCT FROM 'construction_questions' THEN RETURN 'event_type differs'; END IF;
  IF e->>'turn_id' IS DISTINCT FROM p_turn THEN RETURN 'event turn_id differs'; END IF;
  IF e->'seq' IS DISTINCT FROM to_jsonb(p_seq_before + 1) THEN RETURN 'event seq is not old event_seq + 1'; END IF;
  IF e->'details' IS DISTINCT FROM p_record THEN RETURN 'event details are not the record verbatim'; END IF;
  IF s.event_seq <> p_seq_before + 1 THEN RETURN 'scenarios.event_seq is not old + 1'; END IF;
  IF s.revision <> p_rev_before THEN RETURN format('revision moved %s -> %s', p_rev_before, s.revision); END IF;
  RETURN 'ok';
END $$;

-- Per-function call counts of the CURRENT transaction (pg_stat_xact_user_functions; track_functions = all).
-- Read inside the call's own transaction, so no stats-flush timing is involved.
CREATE FUNCTION b0.xcalls() RETURNS text LANGUAGE sql AS $$
  WITH names(full_name, short) AS (VALUES
    ('append_agent_answer_with_construction_questions', 'd5'),
    ('append_agent_answer_if_latest', 'if_latest'),
    ('append_agent_answer_if_latest_narrated', 'if_latest_narrated'),
    ('append_agent_answer_narrated', 'narrated'),
    ('append_agent_answer_with_offers', 'offers'),
    ('append_agent_answer_with_guidance', 'guidance'),
    ('append_turn_atomic_v2', 'v2'))
  SELECT COALESCE(string_agg(n.short || '=' || x.calls, ' ' ORDER BY n.short COLLATE "C"), '')
  FROM names n JOIN pg_stat_xact_user_functions x ON x.schemaname = 'public' AND x.funcname = n.full_name
  WHERE x.calls > 0
$$;

-- Forced failures, installed per case.
CREATE TABLE b0.fail_targets (scenario_id uuid PRIMARY KEY);
CREATE TABLE b0.snap (name text PRIMARY KEY, val jsonb);
GRANT SELECT ON b0.fail_targets TO service_role;
CREATE FUNCTION b0.force_event_failure() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.events IS DISTINCT FROM OLD.events AND EXISTS (SELECT 1 FROM b0.fail_targets WHERE scenario_id = NEW.id) THEN
    RAISE EXCEPTION 'b0 forced event failure';
  END IF;
  RETURN NEW;
END $$;
-- Forces D5's answer-row identity re-check to miss: the stored request_hash differs from the one passed.
CREATE FUNCTION b0.tamper_hash() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.turn_id LIKE 'b14b-%' THEN NEW.request_hash := NEW.request_hash || ':tampered'; END IF;
  RETURN NEW;
END $$;

-- Catalogue and data fingerprints (apply / rollback rows).
CREATE FUNCTION b0.fn_snapshot(p_exclude text DEFAULT '') RETURNS jsonb LANGUAGE sql AS $$
  SELECT COALESCE(jsonb_object_agg(n.nspname || '.' || p.proname || '(' || oidvectortypes(p.proargtypes) || ')',
           md5(pg_get_functiondef(p.oid)) || '|' || COALESCE(p.proacl::text, '')), '{}'::jsonb)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public', 'auth') AND p.proname <> p_exclude
$$;
CREATE FUNCTION b0.cat_snapshot() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'relations', (SELECT md5(string_agg(c.relname || ':' || c.relkind::text || ':' || COALESCE(c.relacl::text, '') || ':' || c.relrowsecurity::text || c.relforcerowsecurity::text, ',' ORDER BY c.relname))
                  FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace),
    'columns', (SELECT md5(string_agg(c.relname || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':' || COALESCE(a.attacl::text, ''), ',' ORDER BY c.relname, a.attnum))
                FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid WHERE c.relnamespace = 'public'::regnamespace AND a.attnum > 0 AND NOT a.attisdropped),
    'constraints', (SELECT md5(string_agg(conname || ':' || pg_get_constraintdef(oid), ',' ORDER BY conname)) FROM pg_constraint WHERE connamespace = 'public'::regnamespace),
    'triggers', (SELECT md5(string_agg(pg_get_triggerdef(t.oid), ',' ORDER BY t.tgname)) FROM pg_trigger t WHERE NOT t.tgisinternal),
    'policies', (SELECT count(*) FROM pg_policy),
    'indexes', (SELECT md5(string_agg(pg_get_indexdef(indexrelid), ',' ORDER BY indexrelid::regclass::text)) FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid WHERE c.relnamespace = 'public'::regnamespace),
    'default_acl', (SELECT md5(string_agg(defaclrole::regrole::text || ':' || defaclnamespace::regnamespace::text || ':' || defaclobjtype::text || ':' || defaclacl::text, ',' ORDER BY defaclrole, defaclnamespace, defaclobjtype)) FROM pg_default_acl))
$$;
CREATE FUNCTION b0.data_snapshot() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'scenarios', (SELECT md5(string_agg(id::text || ':' || COALESCE(user_id::text, 'guest') || ':' || revision::text || ':' || event_seq::text || ':' || md5(events::text) || ':' || updated_at::text, ',' ORDER BY id)) FROM public.scenarios),
    'turns', (SELECT md5(string_agg(id::text || ':' || turn_id || ':' || request_hash || ':' || COALESCE(user_id::text, 'guest'), ',' ORDER BY id)) FROM public.v5_conversation_turns),
    'n_scenarios', (SELECT count(*) FROM public.scenarios),
    'n_turns', (SELECT count(*) FROM public.v5_conversation_turns),
    'n_cq_events', (SELECT count(*) FROM public.scenarios s, jsonb_array_elements(s.events) e WHERE e->>'event_type' = 'construction_questions'),
    'max_revision', (SELECT max(revision) FROM public.scenarios))
$$;
CREATE FUNCTION b0.evseq(p uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(string_agg((e->>'event_type') || ':' || (e->>'seq'), ',' ORDER BY (e->>'seq')::int), '')
  FROM public.scenarios s, jsonb_array_elements(s.events) e WHERE s.id = p
$$;
