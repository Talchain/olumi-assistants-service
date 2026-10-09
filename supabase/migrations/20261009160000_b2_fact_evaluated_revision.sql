-- B2(c): frozen evaluated revision is fact-ELEMENT metadata, never payload.
-- DL-run on the prod-shared table. Apply steps in order; do NOT wrap this file
-- in --single-transaction. Each step commits independently. A refused later
-- guard leaves earlier steps applied: inspect and resolve drift before retrying.
-- CREATE OR REPLACE preserves existing owner/ACL, args, defaults and attributes.
-- v4 base: supplied v4-deployed-functiondef.sql (pg_get_functiondef output).
-- Definition SHA-256: 1a0d0f20e50e517e2bb868f996d40ae2b04746369668ddabde01ac23c474c4e5.
-- Deployed prosrc MD5: db7bdbe3e2052237c623d8c5477a96e5; length(prosrc)=4856.
-- Only the fact INSERT changes; every other body byte is retained.
-- Claim bases: 20261009040000_phase2_a_legacy_unattributable.sql.
-- Their expected hashes appear once each, in named STEP 3 constants below.
-- Derived via hashlib.md5(body.encode('utf-8')).hexdigest(), where body is
-- exactly between AS $$ and $$; (including leading/trailing newlines).

-- STEP 1 — own transaction: metadata-only nullable column, no default/rewrite,
-- no inline CHECK or validation scan. ACCESS EXCLUSIVE bounded by lock_timeout.
BEGIN;
SET LOCAL lock_timeout = '3s';
ALTER TABLE public.v5_handler_facts ADD COLUMN evaluated_scenario_revision integer NULL;
ALTER TABLE public.v5_handler_facts ADD CONSTRAINT v5_handler_facts_evaluated_revision_nonneg
  CHECK (evaluated_scenario_revision >= 0) NOT VALID;
COMMIT;

-- STEP 2 — own transaction: fail closed before replacing the sole fact INSERT.
-- Nested CASE gates numeric parsing by JSON type and int casting by range/whole
-- number checks. Invalid/missing metadata becomes NULL, preserving user turns.
BEGIN;
SET LOCAL lock_timeout = '3s';
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = to_regprocedure('public.append_turn_atomic_v4(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,text,text,boolean,bigint)')
      AND md5(p.prosrc) = 'db7bdbe3e2052237c623d8c5477a96e5'
      AND pg_get_function_identity_arguments(p.oid) = 'p_scenario_id uuid, p_turn_id text, p_turn_class text, p_handler_id text, p_request_hash text, p_response_emitted boolean, p_llm_calls_used integer, p_duration_ms integer, p_handler_facts jsonb, p_graph jsonb, p_brief_text text, p_pending_actions jsonb, p_coaching_state jsonb, p_user_message text, p_assistant_message text, p_expected_graph_identity_hash text, p_incoming_graph_identity_hash text, p_cas_enforce boolean, p_fence_generation bigint'
  ) THEN
    RAISE EXCEPTION 'B2 guard refused: public.append_turn_atomic_v4 body or identity arguments changed';
  END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.append_turn_atomic_v4(p_scenario_id uuid, p_turn_id text, p_turn_class text, p_handler_id text, p_request_hash text, p_response_emitted boolean, p_llm_calls_used integer, p_duration_ms integer, p_handler_facts jsonb, p_graph jsonb DEFAULT NULL::jsonb, p_brief_text text DEFAULT NULL::text, p_pending_actions jsonb DEFAULT '[]'::jsonb, p_coaching_state jsonb DEFAULT NULL::jsonb, p_user_message text DEFAULT NULL::text, p_assistant_message text DEFAULT NULL::text, p_expected_graph_identity_hash text DEFAULT NULL::text, p_incoming_graph_identity_hash text DEFAULT NULL::text, p_cas_enforce boolean DEFAULT false, p_fence_generation bigint DEFAULT NULL::bigint)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_turn_id          UUID;
  v_user_id          UUID;
  v_current_hash     TEXT;
  v_has_graph        BOOLEAN;
  v_fact             JSONB;
  v_updated          INTEGER;
  v_fence_generation BIGINT;
  v_fence_stopped_at TIMESTAMPTZ;
  v_fence_max        BIGINT;
  v_already_committed BOOLEAN;
BEGIN
  SELECT user_id, graph_identity_hash, (graph IS NOT NULL)
    INTO v_user_id, v_current_hash, v_has_graph
    FROM scenarios
    WHERE id = p_scenario_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'scenario % not found', p_scenario_id;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM v5_conversation_turns
    WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id
  ) INTO v_already_committed;

  IF p_fence_generation IS NOT NULL AND p_graph IS NOT NULL AND NOT v_already_committed THEN
    SELECT generation, stopped_at
      INTO v_fence_generation, v_fence_stopped_at
      FROM v5_turn_fence
      WHERE scenario_id = p_scenario_id AND generation = p_fence_generation
      FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = 'OLTF3',
        MESSAGE = format(
          'append_turn_atomic_v4: no fence row for scenario %s at generation %s — the write cannot be ordered',
          p_scenario_id, p_fence_generation),
        DETAIL = '{}';
    END IF;

    SELECT MAX(generation) INTO v_fence_max
      FROM v5_turn_fence
      WHERE scenario_id = p_scenario_id;

    IF v_fence_stopped_at IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = 'OLTF1',
        MESSAGE = format(
          'append_turn_atomic_v4: the turn admitted at generation %s on scenario %s was explicitly stopped at %s',
          v_fence_generation, p_scenario_id, v_fence_stopped_at),
        DETAIL = format('{"generation": %s, "max_generation": %s}',
                        v_fence_generation, v_fence_max);
    END IF;

    IF p_fence_generation < v_fence_max AND v_has_graph THEN
      RAISE EXCEPTION USING
        ERRCODE = 'OLTF2',
        MESSAGE = format(
          'append_turn_atomic_v4: the turn admitted at generation %s is superseded on scenario %s (max generation %s)',
          p_fence_generation, p_scenario_id, v_fence_max),
        DETAIL = format('{"generation": %s, "max_generation": %s}',
                        p_fence_generation, v_fence_max);
    END IF;
  END IF;

  INSERT INTO v5_conversation_turns (
    scenario_id, user_id, turn_id, turn_class, handler_id,
    request_hash, response_emitted, llm_calls_used, duration_ms,
    pending_actions, coaching_state, user_message, assistant_message
  ) VALUES (
    p_scenario_id, v_user_id, p_turn_id, p_turn_class, p_handler_id,
    p_request_hash, p_response_emitted, p_llm_calls_used, p_duration_ms,
    COALESCE(p_pending_actions, '[]'::jsonb), p_coaching_state,
    p_user_message, p_assistant_message
  )
  ON CONFLICT (scenario_id, turn_id) DO NOTHING
  RETURNING id INTO v_turn_id;

  IF NOT FOUND THEN
    SELECT id INTO v_turn_id
      FROM v5_conversation_turns
      WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id;
    RETURN v_turn_id;
  END IF;

  IF p_graph IS NOT NULL THEN
    IF p_cas_enforce
       AND p_expected_graph_identity_hash IS NOT NULL
       AND v_current_hash IS NOT NULL
       AND v_current_hash IS DISTINCT FROM p_expected_graph_identity_hash
       AND (p_incoming_graph_identity_hash IS NULL
            OR p_incoming_graph_identity_hash IS DISTINCT FROM v_current_hash)
    THEN
      RAISE EXCEPTION USING
        ERRCODE = 'OLGC1',
        MESSAGE = format(
          'append_turn_atomic_v4: stale graph write for scenario %s (expected %s, current %s)',
          p_scenario_id, p_expected_graph_identity_hash, v_current_hash);
    END IF;

    UPDATE scenarios
       SET graph = p_graph,
           graph_identity_hash = p_incoming_graph_identity_hash
     WHERE id = p_scenario_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
      RAISE EXCEPTION 'append_turn_atomic_v4: scenarios row % vanished under lock', p_scenario_id;
    END IF;
  END IF;

  IF jsonb_array_length(COALESCE(p_handler_facts, '[]'::jsonb)) > 0 THEN
    FOR v_fact IN SELECT * FROM jsonb_array_elements(p_handler_facts)
    LOOP
      INSERT INTO v5_handler_facts (
        v5_conversation_turn_id, scenario_id, user_id,
        handler_id, action_type, noop, payload, evaluated_scenario_revision
      ) VALUES (
        v_turn_id,
        p_scenario_id,
        v_user_id,
        v_fact->>'handler_id',
        v_fact->>'action_type',
        COALESCE((v_fact->>'noop')::boolean, FALSE),
        COALESCE(v_fact->'payload', '{}'::jsonb),
        CASE WHEN jsonb_typeof(v_fact->'evaluated_scenario_revision') = 'number' THEN
          CASE WHEN (v_fact->>'evaluated_scenario_revision')::numeric >= 0
            AND (v_fact->>'evaluated_scenario_revision')::numeric <= 2147483647
            AND trunc((v_fact->>'evaluated_scenario_revision')::numeric)
              = (v_fact->>'evaluated_scenario_revision')::numeric
          THEN (v_fact->>'evaluated_scenario_revision')::numeric::integer
          ELSE NULL END
        ELSE NULL END
      );
    END LOOP;
  END IF;

  IF p_brief_text IS NOT NULL THEN
    UPDATE scenarios
       SET brief_text = p_brief_text,
           updated_at = NOW()
     WHERE id = p_scenario_id
       AND (brief_text IS NULL OR brief_text = '');
  END IF;

  RETURN v_turn_id;
END;
$function$;

-- Re-assert the deployed ACL: {postgres=X/postgres,service_role=X/postgres}.
REVOKE ALL ON FUNCTION public.append_turn_atomic_v4(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,text,text,boolean,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_turn_atomic_v4(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,text,text,boolean,bigint) TO service_role;
COMMIT;

-- STEP 3 — own transaction: current claim bodies plus the sibling metadata key.
-- RETURNS stays jsonb: no DROP+CREATE, so identity and ACL remain unchanged.
BEGIN;
SET LOCAL lock_timeout = '3s';
DO $claim_guards$
DECLARE
  expected_claim_analysis_run_facts_md5 CONSTANT text := 'aa43423e62f68b00a07f1f116e406ad8';
  expected_claim_analysis_run_reconciliation_md5 CONSTANT text := '3c14bc6590d368ca44f690f938ad55b0';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = to_regprocedure('public.claim_analysis_run_facts(integer)')
      AND md5(p.prosrc) = expected_claim_analysis_run_facts_md5
      AND pg_get_function_identity_arguments(p.oid) = 'p_sweep_limit integer'
  ) THEN
    RAISE EXCEPTION 'B2 guard refused: public.claim_analysis_run_facts body or identity arguments changed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = to_regprocedure('public.claim_analysis_run_reconciliation(integer)')
      AND md5(p.prosrc) = expected_claim_analysis_run_reconciliation_md5
      AND pg_get_function_identity_arguments(p.oid) = 'p_sweep_limit integer'
  ) THEN
    RAISE EXCEPTION 'B2 guard refused: public.claim_analysis_run_reconciliation body or identity arguments changed';
  END IF;
END;
$claim_guards$;

CREATE OR REPLACE FUNCTION public.claim_analysis_run_facts(p_sweep_limit INTEGER DEFAULT 20)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '50ms'
AS $$
DECLARE
  s public.analysis_run_sweep_state;
  batch JSONB;
  last_at TIMESTAMPTZ;
  last_id UUID;
  cutoff TIMESTAMPTZ;
  window_count INTEGER;
  token UUID := gen_random_uuid();
BEGIN
  IF p_sweep_limit IS NULL OR p_sweep_limit < 1 OR p_sweep_limit > 20 THEN
    RAISE EXCEPTION 'sweep limit must be in [1,20]' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO s FROM public.analysis_run_sweep_state WHERE singleton FOR UPDATE SKIP LOCKED;
  IF NOT FOUND OR s.lease_until > clock_timestamp() THEN
    RETURN jsonb_build_object('facts','[]'::jsonb,'depth_estimate',NULL,'oldest_pending_age_seconds',NULL,'window_count',0);
  END IF;
  -- DEFAULT now() reflects transaction start, not commit. Never cross a still
  -- open writer, including prepared transactions; no lock on the writer is taken.
  SELECT LEAST(statement_timestamp(),
    COALESCE((SELECT min(xact_start) FROM pg_stat_activity WHERE datname = current_database()
      AND pid <> pg_backend_pid() AND xact_start IS NOT NULL), statement_timestamp()),
    CASE WHEN EXISTS (SELECT 1 FROM pg_prepared_xacts WHERE database = current_database())
      THEN '-infinity'::timestamptz ELSE statement_timestamp() END) INTO cutoff;
  WITH fact_window AS MATERIALIZED (
    SELECT h.* FROM public.v5_handler_facts h
    WHERE h.action_type = 'run_analysis' AND NOT h.noop
      AND (h.created_at, h.id) > (s.processed_at, s.processed_id)
      AND h.created_at < cutoff
    ORDER BY h.created_at, h.id LIMIT p_sweep_limit
  ), pending AS (
    SELECT h.* FROM fact_window h
    WHERE NOT EXISTS (SELECT 1 FROM public.analysis_runs r WHERE r.fact_id = h.id)
      AND NOT EXISTS (SELECT 1 FROM public.analysis_run_quarantine q WHERE q.fact_id = h.id)
      AND NOT EXISTS (SELECT 1 FROM public.analysis_run_unattributable u WHERE u.fact_id = h.id)
  )
  SELECT COALESCE((SELECT jsonb_agg(jsonb_build_object('fact_id',h.id,'scenario_id',h.scenario_id,
      'payload',h.payload,'noop',h.noop,'evaluated_scenario_revision',h.evaluated_scenario_revision) ORDER BY h.created_at,h.id) FROM pending h), '[]'),
    (SELECT h.created_at FROM fact_window h ORDER BY h.created_at DESC,h.id DESC LIMIT 1),
    (SELECT h.id FROM fact_window h ORDER BY h.created_at DESC,h.id DESC LIMIT 1),
    (SELECT count(*) FROM fact_window)
    INTO batch, last_at, last_id, window_count;
  UPDATE public.analysis_run_sweep_state SET lease_id = token, lease_until = clock_timestamp()+interval '30 seconds',
    window_last_at = last_at, window_last_id = last_id WHERE singleton;
  RETURN jsonb_build_object('facts', batch, 'lease_id', token, 'window_count', window_count,
    -- Lower-bound depth in this <=20-row window; never an unbounded COUNT(*).
    'depth_estimate', jsonb_array_length(batch),
    'oldest_pending_age_seconds', CASE WHEN jsonb_array_length(batch) > 0 THEN
      (SELECT EXTRACT(epoch FROM clock_timestamp()-h.created_at) FROM public.v5_handler_facts h
        WHERE h.id = (batch->0->>'fact_id')::uuid) ELSE NULL END);
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_analysis_run_reconciliation(p_sweep_limit INTEGER DEFAULT 20)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '50ms'
AS $$
DECLARE
  s public.analysis_run_sweep_state;
  batch JSONB;
  oldest_at TIMESTAMPTZ;
  token UUID := gen_random_uuid();
BEGIN
  IF p_sweep_limit IS NULL OR p_sweep_limit < 1 OR p_sweep_limit > 20 THEN
    RAISE EXCEPTION 'sweep limit must be in [1,20]' USING ERRCODE = '22023';
  END IF;
  -- Share the normal sweep's lease, including across processes. No source locks.
  SELECT * INTO s FROM public.analysis_run_sweep_state WHERE singleton FOR UPDATE SKIP LOCKED;
  IF NOT FOUND OR s.lease_until > clock_timestamp() THEN
    RETURN jsonb_build_object('facts','[]'::jsonb,'depth_estimate',NULL,'oldest_pending_age_seconds',NULL,'window_count',0);
  END IF;
  WITH pending AS MATERIALIZED (
    SELECT h.* FROM public.v5_handler_facts h
    WHERE h.action_type = 'run_analysis' AND NOT h.noop
      AND NOT EXISTS (SELECT 1 FROM public.analysis_runs r WHERE r.fact_id = h.id)
      AND NOT EXISTS (SELECT 1 FROM public.analysis_run_quarantine q WHERE q.fact_id = h.id)
      AND NOT EXISTS (SELECT 1 FROM public.analysis_run_unattributable u WHERE u.fact_id = h.id)
    ORDER BY h.created_at, h.id LIMIT p_sweep_limit
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('fact_id',h.id,'scenario_id',h.scenario_id,
    'payload',h.payload,'noop',h.noop,'evaluated_scenario_revision',h.evaluated_scenario_revision) ORDER BY h.created_at,h.id),'[]'::jsonb), min(h.created_at)
    INTO batch, oldest_at FROM pending h;
  -- NULL boundary marks release-only completion: reconciliation cannot advance
  -- the range cursor. The result cap does not bound older terminal index entries.
  UPDATE public.analysis_run_sweep_state SET lease_id = token, lease_until = clock_timestamp()+interval '30 seconds',
    window_last_at = NULL, window_last_id = NULL WHERE singleton;
  RETURN jsonb_build_object('facts',batch,'lease_id',token,'window_count',jsonb_array_length(batch),
    'depth_estimate',jsonb_array_length(batch),
    'oldest_pending_age_seconds',EXTRACT(epoch FROM clock_timestamp()-oldest_at));
END;
$$;

COMMIT;
